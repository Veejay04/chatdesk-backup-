from django.urls import path

from .views import RegisterPushTokenView

urlpatterns = [
    path("notifications/register-device/", RegisterPushTokenView.as_view(), name="register-push-token"),
]
