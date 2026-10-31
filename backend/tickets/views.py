from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status as http_status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.colleges import filter_by_college
from users.permissions import IsOfficeStaff, IsStudent

from .models import Ticket
from .serializers import (
    TicketCreateSerializer,
    TicketFollowUpSerializer,
    TicketSerializer,
    TicketUpdateSerializer,
)

UNASSIGNED = "unassigned"


def apply_ticket_filters(qs, params, allow_office_filter):
    """?status=, ?category=, ?source=staff|ai, ?college=, ?search= (title,
    question or ticket code) and - for Super Admin only - ?office=<id> or
    ?office=unassigned."""
    if params.get("status"):
        qs = qs.filter(status=params["status"])
    if params.get("category"):
        qs = qs.filter(subject_category=params["category"])
    source = params.get("source")
    if source == "staff":
        qs = qs.filter(is_ai_resolved=False)
    elif source == "ai":
        qs = qs.filter(is_ai_resolved=True)
    qs = filter_by_college(qs, params.get("college"))
    office = params.get("office")
    if allow_office_filter and office:
        qs = qs.filter(office__isnull=True) if office == UNASSIGNED else qs.filter(office_id=office)
    search = params.get("search")
    if search:
        qs = qs.filter(
            Q(issue_description__icontains=search)
            | Q(title__icontains=search)
            | Q(ticket_code__icontains=search.strip())
        )
    return qs


class TicketListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/v1/tickets/ - superadmin: all tickets. office_admin: tickets
                            routed to their own office only (?office= is
                            ignored). student: own tickets only. Filters:
                            see apply_ticket_filters. Paginated.
    POST /api/v1/tickets/ - student only, manual creation bypassing the AI.
    """

    def get_queryset(self):
        user = self.request.user
        qs = Ticket.objects.select_related("user", "office")
        params = self.request.query_params

        if user.role == user.Role.SUPERADMIN:
            return apply_ticket_filters(qs, params, allow_office_filter=True)

        if user.role == user.Role.OFFICE_ADMIN:
            if user.office_id is None:
                return qs.none()
            return apply_ticket_filters(qs.filter(office=user.office), params, allow_office_filter=False)

        # Students always see only their own tickets - ownership is enforced
        # server-side, not trusted from the ?creator=me query param.
        own = qs.filter(user=user)
        source = params.get("source")
        if source == "staff":
            own = own.filter(is_ai_resolved=False)
        elif source == "ai":
            own = own.filter(is_ai_resolved=True)
        return own

    def get_serializer_class(self):
        return TicketCreateSerializer if self.request.method == "POST" else TicketSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsStudent()]
        return [permissions.IsAuthenticated()]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ticket = serializer.save()
        return Response(TicketSerializer(ticket).data, status=http_status.HTTP_201_CREATED)


class TicketDetailView(generics.RetrieveUpdateAPIView):
    """
    GET   /api/v1/tickets/{ticket_id}/ - all roles; students restricted to
          their own, office_admin restricted to their office's tickets.
    PATCH /api/v1/tickets/{ticket_id}/ - superadmin or office_admin. An
          office_admin can update status/resolution but can't reroute a
          ticket to a different office - see perform_update below.
    """

    lookup_url_kwarg = "ticket_id"

    def get_queryset(self):
        user = self.request.user
        qs = Ticket.objects.select_related("user", "office")
        if user.role == user.Role.SUPERADMIN:
            return qs
        if user.role == user.Role.OFFICE_ADMIN:
            if user.office_id is None:
                return qs.none()
            return qs.filter(office=user.office)
        return qs.filter(user=user)

    def get_serializer_class(self):
        return TicketUpdateSerializer if self.request.method == "PATCH" else TicketSerializer

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [IsOfficeStaff()]
        return [permissions.IsAuthenticated()]

    def perform_update(self, serializer):
        user = self.request.user
        ticket = self.get_object()
        if user.role == user.Role.OFFICE_ADMIN:
            serializer.validated_data.pop("office", None)
        extra = {}
        changes_answer = {"status", "resolution"} & serializer.validated_data.keys()
        if ticket.is_ai_resolved and changes_answer:
            # Staff stepped in on a chatbot-answered ticket - it's theirs now.
            extra["is_ai_resolved"] = False
        if serializer.validated_data.get("status") == Ticket.Status.RESOLVED:
            if ticket.resolved_by_id is None:
                extra["resolved_by"] = self.request.user
            extra["resolved_at"] = timezone.now()
        serializer.save(**extra)


class TicketFollowUpView(APIView):
    """POST /api/v1/tickets/{ticket_id}/follow-up/ - student, own tickets.
    "I still need help" on a chatbot-answered ticket: reopens it as pending
    for staff, keeping the same ticket code, with the chatbot's answer moved
    into the conversation so staff see what the student already got."""

    permission_classes = [IsStudent]

    def post(self, request, ticket_id):
        serializer = TicketFollowUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = serializer.validated_data.get("message", "").strip()

        with transaction.atomic():
            ticket = get_object_or_404(
                Ticket.objects.select_for_update(), ticket_id=ticket_id, user=request.user
            )
            if not ticket.is_ai_resolved:
                return Response(
                    {
                        "error": "validation_error",
                        "message": "This ticket is already with OSA staff.",
                        "details": {},
                    },
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            context_lines = [ticket.conversation_context] if ticket.conversation_context else []
            context_lines.append(f"ChatDesk answered: {ticket.resolution or ''}")
            context_lines.append("Student asked for staff follow-up.")
            if message:
                context_lines.append(f"Student: {message}")
            ticket.conversation_context = "\n".join(context_lines)
            ticket.status = Ticket.Status.PENDING
            ticket.is_ai_resolved = False
            ticket.resolution = None
            ticket.resolved_at = None
            ticket.resolved_by = None
            ticket.reopened_at = timezone.now()
            ticket.save()

        return Response(TicketSerializer(ticket).data, status=http_status.HTTP_200_OK)
