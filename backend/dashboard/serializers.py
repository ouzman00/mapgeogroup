from rest_framework import serializers


class DashboardStatsSerializer(serializers.Serializer):
    total_parcels = serializers.IntegerField()
    active_parcels = serializers.IntegerField()
    completed_parcels = serializers.IntegerField()
    total_documents = serializers.IntegerField()
    unread_notifications = serializers.IntegerField()
    open_support_tickets = serializers.IntegerField()