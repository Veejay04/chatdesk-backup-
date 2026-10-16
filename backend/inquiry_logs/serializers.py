from rest_framework import serializers

from offices.models import Office

from .models import InquiryLog


class InquiryLogSerializer(serializers.ModelSerializer):
    user_id = serializers.PrimaryKeyRelatedField(source="user", read_only=True)
    office_name = serializers.CharField(source="office.name", read_only=True, default=None)

    class Meta:
        model = InquiryLog
        fields = [
            "log_id", "user_id", "user_message", "detected_intent",
            "chatbot_response", "is_escalated", "office", "office_name",
            "feedback", "timestamp",
        ]
        read_only_fields = fields


class ChatTurnSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["user", "assistant"])
    text = serializers.CharField(allow_blank=True, trim_whitespace=True)


class ChatAskSerializer(serializers.Serializer):
    message = serializers.CharField(allow_blank=False, trim_whitespace=True)
    # Earlier turns of the current chat, oldest first - context only, so
    # follow-ups like "is that all?" aren't escalated. Optional.
    history = ChatTurnSerializer(many=True, required=False, max_length=20)
    # Which office/category the student picked before asking - optional at
    # the API level (older mobile builds or a "General" skip option can omit
    # it), but the mobile UI is expected to always collect it now.
    office = serializers.PrimaryKeyRelatedField(
        queryset=Office.objects.all(), required=False, allow_null=True
    )


class InquiryLogFeedbackSerializer(serializers.ModelSerializer):
    """PATCH-only, student-facing: the sole field a student can ever touch
    on one of their own inquiry logs is their thumbs up/down."""

    class Meta:
        model = InquiryLog
        fields = ["feedback"]