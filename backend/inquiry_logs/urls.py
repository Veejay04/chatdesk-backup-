from django.urls import path

from .views import ChatAskView, InquiryLogFeedbackView, InquiryLogListView

urlpatterns = [
    path("chat/ask/", ChatAskView.as_view(), name="chat-ask"),
    path("chat/logs/<int:log_id>/feedback/", InquiryLogFeedbackView.as_view(), name="chat-log-feedback"),
    path("inquiry-logs/", InquiryLogListView.as_view(), name="inquiry-log-list"),
]