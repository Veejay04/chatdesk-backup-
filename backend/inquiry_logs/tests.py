from unittest import mock

from config.testing import BaseAPITestCase, FakeOpenAI
from faqs.models import Faq
from tickets.models import Ticket

from . import services
from .models import InquiryLog

ASK = "/api/v1/chat/ask/"
ENROLLMENT_ANSWER = "Apply online, submit your documents, then confirm your subjects in the portal."


class ChatbotDecisionTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.student = self.make_user("student@example.com")
        self.client = self.client_for(self.student)
        Faq.objects.create(
            intent_keyword="enrollment_process", question_text="What's the process of enrollment?",
            answer_content=ENROLLMENT_ANSWER, category="Enrollment",
        )
        Faq.objects.create(
            intent_keyword="scholarship_requirements", question_text="What are scholarship requirements?",
            answer_content="Submit your COR, a 2x2 ID picture, and your grades to OSA.", category="Scholarship",
        )

    def ask(self, message, fake, history=None):
        with mock.patch.object(services, "_client", fake):
            return self.client.post(ASK, {"message": message, "history": history or []}, format="json")

    def test_gibberish_is_unclear_without_calling_the_ai(self):
        fake = FakeOpenAI({})
        response = self.ask("f", fake)
        self.assertEqual(response.data["detected_intent"], "unclear")
        self.assertEqual(fake.calls, 0)
        self.assertFalse(Ticket.objects.exists())

    def test_exact_faq_question_is_answered_without_the_ai(self):
        fake = FakeOpenAI({})
        response = self.ask("what's the process of enrollment", fake)
        self.assertEqual(response.data["reply"], ENROLLMENT_ANSWER)
        self.assertTrue(response.data["is_answer"])
        self.assertEqual(fake.calls, 0)

    def test_confident_match_answers(self):
        fake = FakeOpenAI({
            "message_type": "faq_match", "matched_intent_keyword": "scholarship_requirements",
            "match_confidence": "high",
        })
        response = self.ask("ano requirements sa scholarship?", fake)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["detected_intent"], "scholarship_requirements")
        self.assertTrue(response.data["is_answer"])

    def test_unsure_match_asks_did_you_mean_instead_of_guessing(self):
        fake = FakeOpenAI({
            "message_type": "faq_match", "matched_intent_keyword": "enrollment_process",
            "match_confidence": "medium",
        })
        response = self.ask("paano yung requirements?", fake)
        self.assertEqual(response.data["detected_intent"], "needs_clarification")
        self.assertEqual(response.data["suggested_questions"], ["What's the process of enrollment?"])
        self.assertFalse(response.data["is_answer"])

    def test_off_topic_and_small_talk_never_create_tickets(self):
        for decision in ({"message_type": "off_topic"}, {"message_type": "conversational"}):
            self.ask("what's the weather?", FakeOpenAI(decision))
        self.assertFalse(Ticket.objects.exists())

    def test_real_concern_creates_titled_ticket_with_conversation(self):
        history = [
            {"role": "user", "text": "I have a problem with my grades"},
            {"role": "assistant", "text": services.CLARIFY_REPLY},
        ]
        fake = FakeOpenAI({"message_type": "needs_staff", "ticket_title": "Incorrect Math Grade"})
        response = self.ask("my math grade was encoded wrong", fake, history)
        self.assertEqual(response.status_code, 201)
        ticket = Ticket.objects.get(ticket_id=response.data["ticket_id"])
        self.assertEqual(ticket.title, "Incorrect Math Grade")
        self.assertIn("my math grade was encoded wrong", ticket.conversation_context)
        self.assertIn("problem with my grades", ticket.conversation_context)

    def test_repeat_of_open_ticket_points_to_it_instead_of_duplicating(self):
        first = self.ask("my math grade was encoded wrong", FakeOpenAI({"message_type": "needs_staff"}))
        ticket_id = first.data["ticket_id"]
        # AI recognizes the same concern...
        by_ai = self.ask(
            "talk to staff",
            FakeOpenAI({"message_type": "needs_staff", "duplicate_of_ticket_id": str(ticket_id)}),
        )
        # ...and an exact repeat is caught even if the AI misses it.
        exact = self.ask("my math grade was encoded wrong", FakeOpenAI({"message_type": "needs_staff"}))
        for response in (by_ai, exact):
            self.assertEqual(response.data["detected_intent"], "duplicate_ticket")
            self.assertEqual(response.data["ticket_id"], ticket_id)
        self.assertEqual(Ticket.objects.count(), 1)

    def test_clarification_is_asked_only_once(self):
        history = [
            {"role": "user", "text": "help with my account"},
            {"role": "assistant", "text": services.CLARIFY_REPLY},
        ]
        response = self.ask("basta problem", FakeOpenAI({"message_type": "needs_clarification"}), history)
        self.assertEqual(response.data["detected_intent"], "unresolved_complex_query")
        self.assertEqual(Ticket.objects.count(), 1)

    def test_ai_failure_escalates_once(self):
        fake = FakeOpenAI(error=TimeoutError("OpenAI timed out"))
        first = self.ask("my scholarship grant was not released", fake)
        second = self.ask("my scholarship grant was not released", fake)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.data["detected_intent"], "duplicate_ticket")
        self.assertEqual(Ticket.objects.count(), 1)

    def test_message_over_1000_characters_is_rejected(self):
        fake = FakeOpenAI({})
        response = self.ask("a" * 1001, fake)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(fake.calls, 0)
        self.assertFalse(InquiryLog.objects.exists())

    def test_chat_is_rate_limited(self):
        fake = FakeOpenAI({})
        for _ in range(20):
            self.assertEqual(self.ask("?", fake).status_code, 200)
        self.assertEqual(self.ask("?", fake).status_code, 429)


class FeedbackTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.student = self.make_user("student@example.com")
        self.client = self.client_for(self.student)

    def log(self, intent):
        return InquiryLog.objects.create(
            user=self.student, user_message="x", detected_intent=intent, chatbot_response="y"
        )

    def test_faq_answer_can_be_rated(self):
        log = self.log("scholarship_requirements")
        response = self.client.patch(f"/api/v1/chat/logs/{log.log_id}/feedback/", {"feedback": "up"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_non_answers_cannot_be_rated(self):
        for intent in ("unclear", "conversational", "off_topic", "needs_clarification", "unresolved_complex_query"):
            log = self.log(intent)
            response = self.client.patch(
                f"/api/v1/chat/logs/{log.log_id}/feedback/", {"feedback": "down"}, format="json"
            )
            self.assertEqual(response.status_code, 400, intent)

    def test_cannot_rate_another_students_log(self):
        other = self.make_user("other@example.com")
        log = InquiryLog.objects.create(
            user=other, user_message="x", detected_intent="scholarship_requirements", chatbot_response="y"
        )
        response = self.client.patch(f"/api/v1/chat/logs/{log.log_id}/feedback/", {"feedback": "up"}, format="json")
        self.assertEqual(response.status_code, 404)
