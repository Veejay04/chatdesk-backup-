from django.shortcuts import render

# Create your views here.
from django.utils import timezone
from rest_framework import generics, permissions, status as http_status
from rest_framework.response import Response

from users.permissions import IsOfficeStaff, IsStudent

from .models import Ticket
from .serializers import TicketCreateSerializer, TicketSerializer, TicketUpdateSerializer


class TicketListCreateView(generics.ListCreateAPIView):
    """
    GET  /api/v1/tickets/ - superadmin: all tickets (?status=, ?category=,
                            ?office=, ?search= filters). office_admin: tickets
                            routed to their own office only (?status=,
                            ?category=, ?search=; ?office= is ignored).
                            student: own tickets only. ?search= matches
                            issue_description. Paginated.
    POST /api/v1/tickets/ - student only, manual creation bypassing the AI.
    """

    def get_queryset(self):
        user = self.request.user
        qs = Ticket.objects.all()
        status_param = self.request.query_params.get("status")
        category_param = self.request.query_params.get("category")
        search = self.request.query_params.get("search")

        if user.role == user.Role.SUPERADMIN:
            office_param = self.request.query_params.get("office")
            if status_param:
                qs = qs.filter(status=status_param)
            if category_param:
                qs = qs.filter(subject_category=category_param)
            if office_param:
                qs = qs.filter(office_id=office_param)
            if search:
                qs = qs.filter(issue_description__icontains=search)
            return qs

        if user.role == user.Role.OFFICE_ADMIN:
            qs = qs.filter(office=user.office)
            if status_param:
                qs = qs.filter(status=status_param)
            if category_param:
                qs = qs.filter(subject_category=category_param)
            if search:
                qs = qs.filter(issue_description__icontains=search)
            return qs

        # Students always see only their own tickets - ownership is enforced
        # server-side, not trusted from the ?creator=me query param.
        return qs.filter(user=user)

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
        if user.role == user.Role.SUPERADMIN:
            return Ticket.objects.all()
        if user.role == user.Role.OFFICE_ADMIN:
            return Ticket.objects.filter(office=user.office)
        return Ticket.objects.filter(user=user)

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
        if serializer.validated_data.get("status") == Ticket.Status.RESOLVED:
            if ticket.resolved_by_id is None:
                extra["resolved_by"] = self.request.user
            extra["resolved_at"] = timezone.now()
        serializer.save(**extra)