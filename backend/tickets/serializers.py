from rest_framework import serializers

from offices.models import Office

from .models import Ticket


class TicketSerializer(serializers.ModelSerializer):
    user_id = serializers.PrimaryKeyRelatedField(source="user", read_only=True)
    log_id = serializers.PrimaryKeyRelatedField(source="log", read_only=True)
    office_name = serializers.CharField(source="office.name", read_only=True, default=None)

    class Meta:
        model = Ticket
        fields = [
            "ticket_id", "user_id", "resolved_by", "log_id", "title", "subject_category",
            "office", "office_name", "issue_description", "conversation_context", "status", "resolution",
            "created_at", "resolved_at",
        ]
        read_only_fields = [
            "ticket_id", "user_id", "log_id", "resolved_by", "office_name", "conversation_context",
            "created_at", "resolved_at",
        ]


class TicketCreateSerializer(serializers.ModelSerializer):
    """POST /api/v1/tickets/ - student manual creation, bypassing the AI."""

    class Meta:
        model = Ticket
        fields = ["title", "subject_category", "issue_description"]
        extra_kwargs = {"title": {"required": False}}

    def create(self, validated_data):
        request = self.context["request"]
        # A manual ticket's category is already the student's own words.
        validated_data.setdefault("title", validated_data["subject_category"][:100])
        return Ticket.objects.create(user=request.user, **validated_data)


class TicketUpdateSerializer(serializers.ModelSerializer):
    """PATCH /api/v1/tickets/{id}/ - admin only. Status, resolution text,
    subject_category (auto-escalated tickets start as the generic
    "Unresolved Inquiry" - the admin can set a real category once they've
    read the issue), and which office is responsible (routing); resolved_by
    and resolved_at are set server-side in the view, not accepted as input."""

    office = serializers.PrimaryKeyRelatedField(
        queryset=Office.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = Ticket
        fields = ["status", "resolution", "office", "title", "subject_category"]
