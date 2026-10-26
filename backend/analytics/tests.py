from config.testing import BaseAPITestCase
from inquiry_logs.models import InquiryLog
from users.models import User


class AnalyticsOverviewTests(BaseAPITestCase):
    def test_small_talk_is_reported_separately_from_inquiries(self):
        student = self.make_user("student@example.com")
        for intent, escalated in [
            ("scholarship_requirements", False),
            ("scholarship_requirements", False),
            ("unresolved_complex_query", True),
            ("conversational", False),
            ("conversational", False),
            ("unclear", False),
            ("off_topic", False),
            ("duplicate_ticket", False),
        ]:
            InquiryLog.objects.create(
                user=student, user_message="x", detected_intent=intent,
                chatbot_response="y", is_escalated=escalated,
            )
        superadmin = self.client_for(self.make_user("super@example.com", role=User.Role.SUPERADMIN))
        data = superadmin.get("/api/v1/analytics/overview/").data

        self.assertEqual(data["total_inquiries"], 3)
        self.assertEqual(data["total_escalations"], 1)
        self.assertEqual(data["total_messages"], 8)
        self.assertEqual(
            {row["intent"] for row in data["intent_frequencies"]},
            {"scholarship_requirements", "unresolved_complex_query"},
        )
        self.assertEqual(
            {row["intent"]: row["count"] for row in data["other_interactions"]},
            {"conversational": 2, "unclear": 1, "off_topic": 1, "duplicate_ticket": 1},
        )
