import os
import shutil
import tempfile
from io import BytesIO
from smtplib import SMTPException
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image

from config.testing import PASSWORD, BaseAPITestCase

from .models import PasswordResetCode, User

LOGIN = "/api/v1/auth/login/"
REFRESH = "/api/v1/auth/token/refresh/"
REGISTER = "/api/v1/auth/register/"
RESET_REQUEST = "/api/v1/auth/password-reset/request/"
RESET_CONFIRM = "/api/v1/auth/password-reset/confirm/"
RESEND = "/api/v1/auth/verify-email/resend/"

NO_EMAIL = {"REAL_EMAIL_ENABLED": False, "EMAIL_DEV_FALLBACK": False}
DEV_FALLBACK = {"REAL_EMAIL_ENABLED": False, "EMAIL_DEV_FALLBACK": True}
REAL_EMAIL = {"REAL_EMAIL_ENABLED": True, "EMAIL_DEV_FALLBACK": False}


def registration(**overrides):
    return {
        "email": "new.student@example.com",
        "password": PASSWORD,
        "first_name": "Juan",
        "last_name": "Dela Cruz",
        "school_id": "2026-00001",
        "course": "BSIT",
        **overrides,
    }


class LoginAndSessionTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.student = self.make_user("student@example.com")

    def login(self, password=PASSWORD):
        return self.client.post(LOGIN, {"email": "student@example.com", "password": password}, format="json")

    def test_login_returns_tokens(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_wrong_password_reason_is_in_non_field_errors(self):
        response = self.login("wrong-password")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["details"]["non_field_errors"], ["Invalid email or password."])

    def test_refresh_rotates_and_only_the_newest_refresh_token_works(self):
        # The apps must store the refresh token each refresh returns -
        # reusing the original one is exactly what logged users out.
        first_refresh = self.login().data["refresh"]
        rotated = self.client.post(REFRESH, {"refresh": first_refresh}, format="json")
        self.assertEqual(rotated.status_code, 200)
        self.assertIn("refresh", rotated.data)

        self.assertEqual(self.client.post(REFRESH, {"refresh": first_refresh}, format="json").status_code, 401)
        self.assertEqual(
            self.client.post(REFRESH, {"refresh": rotated.data["refresh"]}, format="json").status_code, 200
        )

    def test_login_is_rate_limited_per_email(self):
        for _ in range(10):
            self.login("wrong-password")
        self.assertEqual(self.login().status_code, 429)

    @override_settings(REQUIRE_EMAIL_VERIFICATION=True)
    def test_unverified_student_blocked_only_when_verification_required(self):
        self.student.is_email_verified = False
        self.student.save()
        response = self.login()
        self.assertEqual(response.status_code, 400)
        self.assertIn("verify your email", response.data["details"]["non_field_errors"][0])

    def test_unverified_student_can_log_in_by_default(self):
        self.student.is_email_verified = False
        self.student.save()
        self.assertEqual(self.login().status_code, 200)


@override_settings(**DEV_FALLBACK)
class RegistrationTests(BaseAPITestCase):
    def test_register_accepts_any_domain_by_default(self):
        response = self.client.post(REGISTER, registration(email="someone@gmail.com"), format="json")
        self.assertEqual(response.status_code, 201)
        self.assertIn("dev_verify_url", response.data)

    def test_register_rejects_common_password(self):
        response = self.client.post(REGISTER, registration(password="password123"), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data["details"])

    def test_register_rejects_password_similar_to_email(self):
        response = self.client.post(
            REGISTER, registration(email="juandelacruz2026@example.com", password="juandelacruz2026"), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data["details"])

    @override_settings(ALLOWED_EMAIL_DOMAINS=["ustp.edu.ph"])
    def test_register_enforces_school_domain_when_configured(self):
        rejected = self.client.post(REGISTER, registration(email="someone@gmail.com"), format="json")
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("email", rejected.data["details"])
        accepted = self.client.post(REGISTER, registration(email="someone@ustp.edu.ph"), format="json")
        self.assertEqual(accepted.status_code, 201)

    @override_settings(**NO_EMAIL)
    def test_no_dev_link_returned_outside_debug(self):
        response = self.client.post(REGISTER, registration(), format="json")
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("dev_verify_url", response.data)

    @override_settings(**REAL_EMAIL)
    def test_failed_verification_email_rolls_back_the_account(self):
        with mock.patch("users.services.send_mail", side_effect=SMTPException("Gmail down")):
            response = self.client.post(REGISTER, registration(), format="json")
        self.assertEqual(response.status_code, 503)
        self.assertFalse(User.objects.filter(email="new.student@example.com").exists())
        # So the retry isn't blocked by "email already exists".
        with mock.patch("users.services.send_mail"):
            self.assertEqual(self.client.post(REGISTER, registration(), format="json").status_code, 201)

    @override_settings(PUBLIC_BASE_URL="https://chatdesk.example.edu")
    def test_verification_link_uses_public_base_url(self):
        response = self.client.post(REGISTER, registration(), format="json")
        self.assertTrue(response.data["dev_verify_url"].startswith("https://chatdesk.example.edu/api/v1/"))

    def test_resend_verification_is_generic_and_issues_a_new_link(self):
        self.client.post(REGISTER, registration(), format="json")
        known = self.client.post(RESEND, {"email": "new.student@example.com"}, format="json")
        unknown = self.client.post(RESEND, {"email": "nobody@example.com"}, format="json")
        self.assertEqual(known.data["message"], unknown.data["message"])
        self.assertIn("dev_verify_url", known.data)
        self.assertNotIn("dev_verify_url", unknown.data)


class PasswordResetTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.student = self.make_user("student@example.com")

    def request_code(self):
        return self.client.post(RESET_REQUEST, {"email": "student@example.com"}, format="json")

    def confirm(self, code, password="Brand-New-Pass-2026"):
        return self.client.post(
            RESET_CONFIRM,
            {"email": "student@example.com", "code": code, "new_password": password},
            format="json",
        )

    def issue_code(self):
        """Create a code directly (bypassing the 60s request cooldown)."""
        with override_settings(**DEV_FALLBACK):
            PasswordResetCode.objects.filter(user=self.student).update(created_at="2000-01-01T00:00:00Z")
            return self.request_code().data["dev_code"]

    @override_settings(**NO_EMAIL)
    def test_code_never_returned_outside_debug(self):
        response = self.request_code()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("dev_code", response.data)

    @override_settings(**DEV_FALLBACK)
    def test_code_returned_in_debug_without_email(self):
        self.assertIn("dev_code", self.request_code().data)

    @override_settings(**REAL_EMAIL)
    def test_email_failure_looks_like_success_and_leaves_no_code(self):
        with mock.patch("users.services.send_mail", side_effect=SMTPException("Gmail down")):
            failed = self.request_code()
        unknown = self.client.post(RESET_REQUEST, {"email": "nobody@example.com"}, format="json")
        self.assertEqual(failed.status_code, 200)
        self.assertEqual(failed.data, unknown.data)
        self.assertFalse(PasswordResetCode.objects.filter(user=self.student, is_used=False).exists())

    def test_only_the_newest_code_is_valid(self):
        old_code = self.issue_code()
        new_code = self.issue_code()
        if old_code == new_code:
            self.skipTest("Random codes collided")
        self.assertEqual(self.confirm(old_code).status_code, 400)
        self.assertEqual(self.confirm(new_code).status_code, 200)

    def test_code_is_burned_after_five_wrong_guesses(self):
        code = self.issue_code()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(PasswordResetCode.MAX_ATTEMPTS):
            self.assertEqual(self.confirm(wrong).status_code, 400)
        self.assertEqual(self.confirm(code).status_code, 400)

    def test_successful_reset_signs_out_existing_sessions(self):
        old_refresh = self.client.post(
            LOGIN, {"email": "student@example.com", "password": PASSWORD}, format="json"
        ).data["refresh"]
        self.assertEqual(self.confirm(self.issue_code()).status_code, 200)
        self.assertEqual(self.client.post(REFRESH, {"refresh": old_refresh}, format="json").status_code, 401)
        relogin = self.client.post(
            LOGIN, {"email": "student@example.com", "password": "Brand-New-Pass-2026"}, format="json"
        )
        self.assertEqual(relogin.status_code, 200)


class ProfilePictureTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        self.student = self.make_user("student@example.com")
        self.client = self.client_for(self.student)

    def upload(self, image, fmt="PNG", name="photo.png"):
        buffer = BytesIO()
        image.save(buffer, format=fmt)
        file = SimpleUploadedFile(name, buffer.getvalue(), content_type=f"image/{fmt.lower()}")
        with override_settings(MEDIA_ROOT=self.media_root):
            return self.client.patch("/api/v1/auth/me/", {"profile_picture": file}, format="multipart")

    def test_large_picture_is_shrunk_to_512(self):
        response = self.upload(Image.new("RGB", (2000, 1000), "navy"))
        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        with Image.open(os.path.join(self.media_root, self.student.profile_picture.name)) as saved:
            self.assertLessEqual(max(saved.size), 512)

    def test_picture_over_2mb_is_rejected(self):
        noise = Image.frombytes("RGB", (1200, 1200), os.urandom(1200 * 1200 * 3))
        response = self.upload(noise)
        self.assertEqual(response.status_code, 400)
        self.assertIn("2 MB", response.data["details"]["profile_picture"][0])


class CollegeTests(BaseAPITestCase):
    def test_every_course_belongs_to_exactly_one_college(self):
        from .colleges import COLLEGES

        grouped = [course for college in COLLEGES for course in college["courses"]]
        self.assertEqual(sorted(grouped), sorted(code for code, _ in User.Course.choices))

    def test_college_list_endpoint(self):
        client = self.client_for(self.make_user("student@example.com"))
        data = client.get("/api/v1/colleges/").data
        it = next(c for c in data if c["key"] == "it_computing")
        self.assertIn({"code": "BSIT", "name": "BS Information Technology"}, it["courses"])


@override_settings(**DEV_FALLBACK)
class InputValidationTests(BaseAPITestCase):
    def test_school_id_must_be_digits_and_hyphens(self):
        for bad in ("abc123", "12", "2026_0001", "-202600001"):
            response = self.client.post(REGISTER, registration(school_id=bad), format="json")
            self.assertEqual(response.status_code, 400, bad)
            self.assertIn("school_id", response.data["details"])
        for good in ("2023304440", "2026-00006"):
            response = self.client.post(
                REGISTER, registration(school_id=good, email=f"{good}@example.com"), format="json"
            )
            self.assertEqual(response.status_code, 201, good)

    def test_names_must_contain_letters(self):
        response = self.client.post(REGISTER, registration(first_name="1234", last_name="   "), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("first_name", response.data["details"])
        self.assertIn("last_name", response.data["details"])

    def test_admin_created_accounts_follow_password_rules(self):
        superadmin = self.client_for(self.make_user("super@example.com", role=User.Role.SUPERADMIN))
        response = superadmin.post(
            "/api/v1/users/",
            {"email": "new@example.com", "password": "12345678", "first_name": "New", "last_name": "User"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data["details"])
