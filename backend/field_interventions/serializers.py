from rest_framework import serializers

from .models import FieldIntervention


class FieldInterventionSerializer(serializers.ModelSerializer):
    parcel_reference = serializers.CharField(source="parcel.reference", read_only=True)
    parcel_commune = serializers.CharField(source="parcel.commune", read_only=True)
    agent_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = FieldIntervention
        fields = [
            "id",
            "parcel",
            "parcel_reference",
            "parcel_commune",
            "title",
            "scheduled_date",
            "agent",
            "agent_name",
            "status",
            "status_label",
            "report",
            "visible_to_client",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def get_agent_name(self, obj):
        if not obj.agent_id:
            return ""
        full_name = f"{obj.agent.first_name} {obj.agent.last_name}".strip()
        return full_name or obj.agent.company_name or obj.agent.username


class FieldInterventionCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = FieldIntervention
        fields = [
            "id",
            "parcel",
            "title",
            "scheduled_date",
            "agent",
            "status",
            "report",
            "visible_to_client",
        ]
