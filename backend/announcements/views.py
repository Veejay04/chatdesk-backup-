from rest_framework import generics

from notifications.services import send_push_to_users
from users.models import User

from .models import Announcement
from .permissions import IsAdminOrReadOnly
from .serializers import AnnouncementSerializer


class AnnouncementListCreateView(generics.ListCreateAPIView):
    """GET all authenticated users, POST admin only."""

    queryset = Announcement.objects.all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAdminOrReadOnly]

    def perform_create(self, serializer):
        announcement = serializer.save()
        send_push_to_users(
            User.objects.filter(role=User.Role.STUDENT),
            title=announcement.title,
            body=announcement.content[:100],
            data={"type": "announcement", "announcement_id": announcement.announcement_id},
        )


class AnnouncementDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Announcement.objects.all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAdminOrReadOnly]
    lookup_url_kwarg = "announcement_id"