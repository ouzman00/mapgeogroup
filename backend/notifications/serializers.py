from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    type = serializers.SerializerMethodField()
    priority = serializers.SerializerMethodField()
    href = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            "id",
            "title",
            "message",
            "notification_type",
            "type",
            "severity",
            "priority",
            "target_url",
            "href",
            "related_type",
            "related_id",
            "is_read",
            "created_at",
        ]

    def get_type(self, obj):
        labels = {
            "document": "Document",
            "parcel": "Parcelle",
            "support": "Support",
            "appointment": "Rendez-vous",
            "success": "Information",
            "warning": "Information",
            "error": "Information",
            "info": "Information",
        }
        return labels.get(obj.notification_type, obj.get_notification_type_display() or "Information")

    def get_priority(self, obj):
        raw = (obj.severity or obj.notification_type or "info").lower()
        if any(value in raw for value in ["error", "erreur", "critical", "critique"]):
            return "Erreur"
        if any(value in raw for value in ["warning", "warn", "alerte"]):
            return "Alerte"
        if any(value in raw for value in ["success", "succ", "valid"]):
            return "Succès"
        return "Information"

    def get_href(self, obj):
        if obj.target_url:
            return obj.target_url

        related_type = (obj.related_type or "").lower()
        if obj.related_id:
            if "document" in related_type:
                return f"/documents/{obj.related_id}"
            if "support" in related_type or "ticket" in related_type:
                return f"/support/{obj.related_id}"
            if "parcel" in related_type or "parcelle" in related_type:
                return f"/parcels/{obj.related_id}/carto"

        if obj.notification_type == "document":
            return "/documents"
        if obj.notification_type == "parcel":
            return "/parcels"
        if obj.notification_type == "support":
            return "/support"
        return "/notifications"
