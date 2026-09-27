from rest_framework import serializers

from .models import PushToken


class RegisterPushTokenSerializer(serializers.Serializer):
    expo_push_token = serializers.CharField(max_length=255)

    def create(self, validated_data):
        user = self.context["request"].user
        token, _ = PushToken.objects.update_or_create(
            expo_push_token=validated_data["expo_push_token"],
            defaults={"user": user},
        )
        return token
