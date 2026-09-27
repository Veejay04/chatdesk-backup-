from django.db.models import Q
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.permissions import IsOfficeStaff, IsStudent

from .models import InquiryLog
from .serializers import ChatAskSerializer, InquiryLogFeedbackSerializer, InquiryLogSerializer
from .services import classify_message


class ChatAskView(APIView):
    """POST /api/v1/chat/ask/ - student only. Logs every interaction and
    escalates to a ticket when the classifier can't resolve the intent."""

    permission_classes = [IsStudent]

    def post(self, request):
        serializer = ChatAskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = serializer.validated_data["message"]
        office = serializer.validated_data.get("office")

        result = classify_message(message, office=office)

        log = InquiryLog.objects.create(
            user=request.user,
            office=office,
            user_message=message,
            detected_intent=result["detected_intent"],
            chatbot_response=result["reply"],
            is_escalated=result["detected_intent"] == "unresolved_complex_query",
        )

        payload = {
            "log_id": log.log_id,
            "detected_intent": log.detected_intent,
            "reply": log.chatbot_response,
            "is_escalated": log.is_escalated,
        }

        if log.is_escalated:
            try:
                from tickets.services import create_ticket_from_log
            except ImportError:
                # tickets app lands in feature/ticket-escalation-logic - log is still recorded
                return Response(payload, status=status.HTTP_201_CREATED)
            ticket = create_ticket_from_log(log, office=office)
            payload["ticket_id"] = ticket.ticket_id
            return Response(payload, status=status.HTTP_201_CREATED)

        return Response(payload, status=status.HTTP_200_OK)


class InquiryLogFeedbackView(generics.UpdateAPIView):
    """PATCH /api/v1/chat/logs/{log_id}/feedback/ - student only, and only
    ever on their own logs (get_queryset scopes this, matching the
    student-ticket-ownership pattern elsewhere: someone else's log_id just
    404s rather than 403s). The only field accepted is `feedback`."""

    serializer_class = InquiryLogFeedbackSerializer
    permission_classes = [IsStudent]
    lookup_url_kwarg = "log_id"

    def get_queryset(self):
        return InquiryLog.objects.filter(user=self.request.user)


class InquiryLogListView(generics.ListAPIView):
    """GET /api/v1/inquiry-logs/ - superadmin or office_admin. Raw logs for
    system analytics. Office Admins only see logs tagged with their office
    (the student picked it in the mobile category selector) or that
    escalated into a ticket later routed to their office - a log with
    neither has no way to be attributed to any one office.
    ?intent=, ?user_id=, ?is_escalated=, ?date_from=, ?date_to= filter.
    Paginated."""

    serializer_class = InquiryLogSerializer
    permission_classes = [IsOfficeStaff]

    def get_queryset(self):
        qs = InquiryLog.objects.all()
        user = self.request.user
        if user.role == user.Role.OFFICE_ADMIN:
            qs = qs.filter(Q(office=user.office) | Q(ticket__office=user.office)).distinct()

        intent = self.request.query_params.get("intent")
        if intent:
            qs = qs.filter(detected_intent=intent)
        user_id = self.request.query_params.get("user_id")
        if user_id:
            qs = qs.filter(user_id=user_id)
        is_escalated = self.request.query_params.get("is_escalated")
        if is_escalated is not None:
            qs = qs.filter(is_escalated=is_escalated.lower() in ("1", "true", "yes"))
        date_from = self.request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(timestamp__date__gte=date_from)
        date_to = self.request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(timestamp__date__lte=date_to)
        return qs