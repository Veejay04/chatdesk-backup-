from django.db.models import Count, Q
from rest_framework.response import Response
from rest_framework.views import APIView

from inquiry_logs.models import DUPLICATE_TICKET_INTENT, NON_INQUIRY_INTENTS, InquiryLog
from tickets.models import Ticket

# Logged chat turns that aren't a new question: small talk, clarification
# prompts, off-topic, gibberish, and repeats of an already-open ticket.
OTHER_INTERACTION_INTENTS = (*NON_INQUIRY_INTENTS, DUPLICATE_TICKET_INTENT)
from users.permissions import IsOfficeStaff


class AnalyticsOverviewView(APIView):
    """GET /api/v1/analytics/overview/ - superadmin or office_admin.
    Office Admins see only their own office's slice: tickets assigned to
    their office, and inquiry logs either tagged with their office (picked
    via the mobile category selector) or that escalated into one of those
    tickets. A log with neither isn't attributable to any one office.
    Optional ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD to scope the range."""

    permission_classes = [IsOfficeStaff]

    def get(self, request):
        user = request.user
        logs = InquiryLog.objects.all()
        tickets_base = Ticket.objects.all()
        if user.role == user.Role.OFFICE_ADMIN:
            logs = logs.filter(Q(office=user.office) | Q(ticket__office=user.office)).distinct()
            tickets_base = tickets_base.filter(office=user.office)

        date_from = request.query_params.get("date_from")
        date_to = request.query_params.get("date_to")
        if date_from:
            logs = logs.filter(timestamp__date__gte=date_from)
        if date_to:
            logs = logs.filter(timestamp__date__lte=date_to)

        def frequencies(queryset):
            return [
                {"intent": row["detected_intent"], "count": row["count"]}
                for row in queryset.values("detected_intent")
                                   .annotate(count=Count("detected_intent"))
                                   .order_by("-count")
            ]

        # Only real questions (FAQ answers + escalations) count as inquiries,
        # so "hi"/"ok thanks" don't inflate totals or dilute the topic chart.
        inquiries = logs.exclude(detected_intent__in=OTHER_INTERACTION_INTENTS)
        intent_frequencies = frequencies(inquiries)
        other_interactions = frequencies(logs.filter(detected_intent__in=OTHER_INTERACTION_INTENTS))

        tickets = tickets_base
        if date_from:
            tickets = tickets.filter(created_at__date__gte=date_from)
        if date_to:
            tickets = tickets.filter(created_at__date__lte=date_to)
        tickets_by_status = {
            value: tickets.filter(status=value).count()
            for value, _ in Ticket.Status.choices
        }
        total_tickets = tickets.count()
        resolved = tickets_by_status.get(Ticket.Status.RESOLVED, 0)
        resolution_rate = round(resolved / total_tickets, 2) if total_tickets else 0.0

        return Response({
            "total_inquiries": inquiries.count(),
            "total_escalations": inquiries.filter(is_escalated=True).count(),
            "resolution_rate": resolution_rate,
            "intent_frequencies": intent_frequencies,
            "total_messages": logs.count(),
            "other_interactions": other_interactions,
            "tickets_by_status": tickets_by_status,
        })