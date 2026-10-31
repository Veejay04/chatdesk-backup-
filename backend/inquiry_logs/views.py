from django.db import transaction
from django.db.models import Q
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from tickets.services import create_ai_answered_ticket, create_ticket_from_log
from users.colleges import filter_by_college
from users.models import User
from users.permissions import IsOfficeStaff, IsStudent

from .models import ESCALATED_INTENT, InquiryLog
from .serializers import ChatAskSerializer, InquiryLogFeedbackSerializer, InquiryLogSerializer
from .services import classify_message, duplicate_result, exact_repeat_ticket, format_turns


class ChatAskView(APIView):
    """POST /api/v1/chat/ask/ - student only. Logs every interaction, then
    answers, asks to clarify, points to an already-open ticket, or creates a
    new ticket - whichever classify_message decided."""

    permission_classes = [IsStudent]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "chat"

    def post(self, request):
        serializer = ChatAskSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = serializer.validated_data["message"]
        office = serializer.validated_data.get("office")
        history = serializer.validated_data.get("history")

        # The AI call (~seconds) stays outside the transaction/lock.
        result = classify_message(message, office=office, history=history, user=request.user)

        with transaction.atomic():
            ticket = None
            if result["detected_intent"] == ESCALATED_INTENT:
                # Serialize this student's escalations: a second request that
                # raced past classify_message's duplicate check waits here,
                # then sees the first request's ticket.
                User.objects.select_for_update().filter(pk=request.user.pk).first()
                repeat = exact_repeat_ticket(request.user, message)
                if repeat is not None:
                    result = duplicate_result(repeat)

            log = InquiryLog.objects.create(
                user=request.user,
                office=office,
                user_message=message,
                detected_intent=result["detected_intent"],
                chatbot_response=result["reply"],
                is_escalated=result["detected_intent"] == ESCALATED_INTENT,
            )
            context = format_turns(history)
            conversation = f"{context}\nStudent: {message}" if context else ""
            if log.is_escalated:
                ticket = create_ticket_from_log(
                    log, office=office, title=result["ticket_title"], conversation_context=conversation
                )
            elif result.get("faq") is not None:
                # Every real question gets a ticket: an FAQ answer is recorded
                # as one already resolved by the AI (not in the staff queue).
                ticket = create_ai_answered_ticket(
                    log, result["faq"], office=office, conversation_context=conversation
                )

        payload = {
            "log_id": log.log_id,
            "detected_intent": log.detected_intent,
            "reply": log.chatbot_response,
            "is_escalated": log.is_escalated,
            "is_answer": log.is_answer,
            "suggested_questions": result.get("suggested_questions", []),
        }
        linked_ticket = ticket or result.get("existing_ticket")
        if linked_ticket is not None:
            payload["ticket_id"] = linked_ticket.ticket_id
            payload["ticket_code"] = linked_ticket.ticket_code
            payload["ticket_title"] = linked_ticket.title
            payload["ticket_ai_resolved"] = linked_ticket.is_ai_resolved

        return Response(payload, status=status.HTTP_201_CREATED if log.is_escalated else status.HTTP_200_OK)


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
    ?intent=, ?user_id=, ?is_escalated=, ?date_from=, ?date_to=, ?college=
    and (Super Admin) ?office= filter. Paginated."""

    serializer_class = InquiryLogSerializer
    permission_classes = [IsOfficeStaff]

    def get_queryset(self):
        qs = InquiryLog.objects.select_related("user", "office", "ticket")
        user = self.request.user
        if user.role == user.Role.OFFICE_ADMIN:
            qs = qs.filter(Q(office=user.office) | Q(ticket__office=user.office)).distinct()
        else:
            # ?office=<id> or ?office=unassigned - Super Admin only. A log
            # belongs to an office if the student picked it or its ticket
            # was routed there.
            office = self.request.query_params.get("office")
            if office == "unassigned":
                qs = qs.filter(office__isnull=True).filter(Q(ticket__isnull=True) | Q(ticket__office__isnull=True))
            elif office:
                qs = qs.filter(Q(office_id=office) | Q(ticket__office_id=office)).distinct()
        qs = filter_by_college(qs, self.request.query_params.get("college"))

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