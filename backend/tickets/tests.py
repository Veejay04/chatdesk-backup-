from config.testing import BaseAPITestCase
from offices.models import Office
from users.models import User

from .models import Ticket


class TicketAccessTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.registrar = Office.objects.create(name="Test Office Registrar")
        self.osa = Office.objects.create(name="Test Office OSA")
        self.alice = self.make_user("alice@example.com")
        self.bob = self.make_user("bob@example.com")
        self.alice_ticket = Ticket.objects.create(
            user=self.alice, title="Lost School ID", subject_category="Unresolved Inquiry",
            issue_description="Lost my ID", office=self.registrar,
        )
        self.bob_ticket = Ticket.objects.create(
            user=self.bob, title="Grade Correction", subject_category="Unresolved Inquiry",
            issue_description="Wrong grade", office=self.osa,
        )
        self.registrar_admin = self.make_user(
            "registrar@example.com", role=User.Role.OFFICE_ADMIN, office=self.registrar
        )

    def ids(self, response):
        return {row["ticket_id"] for row in response.data["results"]}

    def test_student_sees_only_own_tickets(self):
        client = self.client_for(self.alice)
        self.assertEqual(self.ids(client.get("/api/v1/tickets/")), {self.alice_ticket.ticket_id})
        self.assertEqual(client.get(f"/api/v1/tickets/{self.bob_ticket.ticket_id}/").status_code, 404)

    def test_office_admin_sees_only_their_office(self):
        client = self.client_for(self.registrar_admin)
        self.assertEqual(self.ids(client.get("/api/v1/tickets/")), {self.alice_ticket.ticket_id})
        self.assertEqual(client.get(f"/api/v1/tickets/{self.bob_ticket.ticket_id}/").status_code, 404)

    def test_office_admin_cannot_reroute_but_can_resolve(self):
        client = self.client_for(self.registrar_admin)
        response = client.patch(
            f"/api/v1/tickets/{self.alice_ticket.ticket_id}/",
            {"status": "resolved", "resolution": "Visit the Registrar window.", "office": self.osa.office_id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.alice_ticket.refresh_from_db()
        self.assertEqual(self.alice_ticket.status, Ticket.Status.RESOLVED)
        self.assertEqual(self.alice_ticket.office, self.registrar)
        self.assertEqual(self.alice_ticket.resolved_by, self.registrar_admin)
        self.assertIsNotNone(self.alice_ticket.resolved_at)

    def test_students_cannot_update_tickets(self):
        response = self.client_for(self.alice).patch(
            f"/api/v1/tickets/{self.alice_ticket.ticket_id}/", {"status": "resolved"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_search_matches_title(self):
        superadmin = self.client_for(self.make_user("super@example.com", role=User.Role.SUPERADMIN))
        response = superadmin.get("/api/v1/tickets/", {"search": "school id"})
        self.assertEqual(self.ids(response), {self.alice_ticket.ticket_id})
