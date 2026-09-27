from django.contrib import admin

from .models import PushToken


@admin.register(PushToken)
class PushTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "expo_push_token", "created_at")
    search_fields = ("user__email", "expo_push_token")
