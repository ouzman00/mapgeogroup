from rest_framework import serializers


class MapLayerInfoSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    group = serializers.CharField()
    type = serializers.CharField()
    endpoint = serializers.CharField()
    visible = serializers.BooleanField()
    minZoom = serializers.IntegerField(required=False)
    maxZoom = serializers.IntegerField(required=False)
    labelMinZoom = serializers.IntegerField(required=False)
    geometry_type = serializers.CharField(required=False, allow_blank=True)
    available = serializers.BooleanField()
    table = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    fields = serializers.DictField(required=False)
    legend = serializers.ListField(required=False)
