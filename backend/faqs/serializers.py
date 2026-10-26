from rest_framework import serializers

from offices.models import Office

from .models import Faq

BROKEN_CHARACTER = "�"
MIN_ANSWER_LENGTH = 15


class FaqSerializer(serializers.ModelSerializer):
    user_id = serializers.PrimaryKeyRelatedField(source="user", read_only=True)
    office = serializers.PrimaryKeyRelatedField(
        queryset=Office.objects.all(), required=False, allow_null=True
    )
    office_name = serializers.CharField(source="office.name", read_only=True, default=None)

    class Meta:
        model = Faq
        fields = ["faq_id", "user_id", "intent_keyword", "question_text",
                  "answer_content", "category", "office", "office_name",
                  "created_at", "updated_at", "updated_by"]
        read_only_fields = ["faq_id", "created_at", "updated_at", "updated_by", "user_id"]

    def _reject_broken_characters(self, value):
        if BROKEN_CHARACTER in value:
            raise serializers.ValidationError(
                f"Contains a broken character ({BROKEN_CHARACTER}), usually from copy-pasting - "
                "please retype that part."
            )
        return value

    def validate_question_text(self, value):
        return self._reject_broken_characters(value)

    def validate_answer_content(self, value):
        # Students see this text word for word - a placeholder like
        # "OSA ONLY" would be sent as a real answer.
        if len(value.strip()) < MIN_ANSWER_LENGTH:
            raise serializers.ValidationError(
                f"Answer is too short to help a student (at least {MIN_ANSWER_LENGTH} characters)."
            )
        return self._reject_broken_characters(value)
