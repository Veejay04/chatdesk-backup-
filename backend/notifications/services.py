"""
Sends push notifications through Expo's push service. Deliberately fails
silently (logs and moves on) rather than raising - a notification failing
to send should never block the ticket-resolve or announcement-create
request that triggered it.
"""

import logging

import requests

from .models import PushToken

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
# Expo accepts up to 100 messages per request.
CHUNK_SIZE = 100


def _post_chunk(messages):
    try:
        requests.post(
            EXPO_PUSH_URL,
            json=messages,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            timeout=10,
        )
    except requests.RequestException:
        logger.warning("Expo push send failed for a batch of %d message(s)", len(messages))


def send_push_to_tokens(tokens, title, body, data=None):
    """tokens: iterable of raw Expo push token strings (e.g. 'ExponentPushToken[...]')."""
    tokens = [t for t in tokens if t]
    if not tokens:
        return

    messages = [{"to": token, "title": title, "body": body, "data": data or {}} for token in tokens]
    for i in range(0, len(messages), CHUNK_SIZE):
        _post_chunk(messages[i : i + CHUNK_SIZE])


def send_push_to_users(users, title, body, data=None):
    """users: iterable of User instances (or a queryset)."""
    tokens = PushToken.objects.filter(user__in=users).values_list("expo_push_token", flat=True)
    send_push_to_tokens(tokens, title, body, data=data)
