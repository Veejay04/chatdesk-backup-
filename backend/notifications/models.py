from django.conf import settings
from django.db import models


class PushToken(models.Model):
    """
    tbl_push_token - one row per (user, device). A student can be logged
    in on more than one device, so this is a separate table rather than a
    single field on User; expo_push_token is unique so re-registering the
    same device (e.g. after reinstalling) just moves the token to whichever
    account is currently logged in rather than creating a duplicate row.
    """

    token_id = models.BigAutoField(primary_key=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_tokens"
    )
    expo_push_token = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "tbl_push_token"

    def __str__(self):
        return f"{self.user.email} ({self.expo_push_token[:20]}...)"
