from rest_framework import generics, permissions

from .serializers import RegisterPushTokenSerializer


class RegisterPushTokenView(generics.CreateAPIView):
    """POST /api/v1/notifications/register-device/ - any authenticated user.
    Idempotent: re-registering the same expo_push_token just re-points it at
    whichever account is currently logged in (see PushToken.expo_push_token
    being unique) - handles device-sharing/re-login cleanly without leaving
    stale tokens pointed at a previous student."""

    serializer_class = RegisterPushTokenSerializer
    permission_classes = [permissions.IsAuthenticated]
