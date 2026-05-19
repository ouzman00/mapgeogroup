from rest_framework import serializers

from .models import ClientAction


class ClientActionSerializer(serializers.ModelSerializer):
    parcel_reference = serializers.CharField(source="parcel.reference", read_only=True)
    parcel_commune = serializers.CharField(source="parcel.commune", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    action_type_label = serializers.CharField(source="get_action_type_display", read_only=True)

    class Meta:
        model = ClientAction
        fields = [
            "id",
            "parcel",
            "parcel_reference",
            "parcel_commune",
            "title",
            "description",
            "action_type",
            "action_type_label",
            "status",
            "status_label",
            "due_date",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["completed_at", "created_at", "updated_at"]


class ClientActionCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClientAction
        fields = [
            "id",
            "parcel",
            "title",
            "description",
            "action_type",
            "status",
            "due_date",
        ]
