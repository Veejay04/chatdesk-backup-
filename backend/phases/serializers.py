from rest_framework import serializers

from .models import SchoolPhase


class SchoolPhaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = SchoolPhase
        fields = [
            "phase_id", "name", "start_date", "end_date",
            "guidance_message", "suggested_questions",
        ]
        read_only_fields = ["phase_id"]

    def validate(self, attrs):
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))

        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError(
                {"end_date": ["end_date must be on or after start_date."]}
            )
        # Overlaps are allowed - real academic calendars overlap constantly
        # (e.g. graduation applications during midterms). CurrentPhaseView
        # picks deterministically when more than one is active.
        return attrs