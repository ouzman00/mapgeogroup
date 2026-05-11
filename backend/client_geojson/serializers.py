from rest_framework import serializers

from .models import GeoJsonLayer
from .validators import validate_geojson_upload


TYPE_GROUPS = {
    GeoJsonLayer.TYPE_OCCUPATION_SOL: "zonage",
    GeoJsonLayer.TYPE_PARCELLES: "cadastre",
    GeoJsonLayer.TYPE_ZONES_PROTEGEES: "zonage",
    GeoJsonLayer.TYPE_LIMITES_ADMIN: "contexte",
    GeoJsonLayer.TYPE_AUTRE: "contexte",
}

SENSITIVE_METADATA_KEYS = {
    "private_path",
    "storage_path",
    "absolute_path",
    "file_path",
    "source_path",
    "original_path",
    "tiles_path",
    "service_url",
    "tile_url",
}


def sanitize_manager_metadata(value):
    if isinstance(value, list):
        return [sanitize_manager_metadata(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        key: sanitize_manager_metadata(item)
        for key, item in value.items()
        if str(key).lower() not in SENSITIVE_METADATA_KEYS
    }


def should_mask_sensitive_admin_fields(context):
    request = (context or {}).get("request")
    user = getattr(request, "user", None)
    return bool(user and getattr(user, "role", None) != "admin")


def normalize_geometry_type(geometry_types):
    if not geometry_types:
        return ""
    values = {str(value).lower() for value in geometry_types}
    if values <= {"point", "multipoint"}:
        return "point"
    if values <= {"linestring", "multilinestring", "line"}:
        return "line"
    if values <= {"polygon", "multipolygon"}:
        return "polygon"
    return ""


def _layer_endpoint(layer):
    return f"/geojson-layers/{layer.id}/"


class GeoJsonLayerListSerializer(serializers.ModelSerializer):
    type = serializers.CharField(source="layer_type")
    group = serializers.SerializerMethodField()
    endpoint = serializers.SerializerMethodField()
    service = serializers.SerializerMethodField()
    visible = serializers.SerializerMethodField()
    geometry_type = serializers.SerializerMethodField()
    metadata = serializers.SerializerMethodField()

    class Meta:
        model = GeoJsonLayer
        fields = [
            "id",
            "name",
            "description",
            "type",
            "group",
            "endpoint",
            "service",
            "visible",
            "is_active",
            "geometry_type",
            "metadata",
            "created_at",
            "updated_at",
        ]

    def get_group(self, obj):
        return TYPE_GROUPS.get(obj.layer_type, "contexte")

    def get_endpoint(self, obj):
        return _layer_endpoint(obj)

    def get_service(self, obj):
        return "geojson"

    def get_visible(self, obj):
        return obj.is_active

    def get_geometry_type(self, obj):
        geometry_types = (obj.metadata or {}).get("geometry_types") or {}
        return normalize_geometry_type(geometry_types.keys() if isinstance(geometry_types, dict) else geometry_types)

    def get_metadata(self, obj):
        return sanitize_manager_metadata(obj.metadata or {})


class GeoJsonLayerAdminSerializer(serializers.ModelSerializer):
    client_id = serializers.IntegerField(source="client.id", read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)
    type = serializers.CharField(source="layer_type")
    metadata = serializers.SerializerMethodField()

    class Meta:
        model = GeoJsonLayer
        fields = [
            "id",
            "client_id",
            "client_name",
            "name",
            "description",
            "type",
            "is_active",
            "original_filename",
            "file_size",
            "metadata",
            "created_at",
            "updated_at",
        ]

    def get_metadata(self, obj):
        metadata = obj.metadata or {}
        if should_mask_sensitive_admin_fields(self.context):
            return sanitize_manager_metadata(metadata)
        return metadata


class GeoJsonLayerCreateSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True)
    type = serializers.ChoiceField(source="layer_type", choices=GeoJsonLayer.TYPE_CHOICES)

    class Meta:
        model = GeoJsonLayer
        fields = ["name", "description", "type", "file", "is_active"]

    def validate_file(self, uploaded_file):
        metadata = validate_geojson_upload(uploaded_file)
        self.context["geojson_metadata"] = metadata
        return uploaded_file

    def create(self, validated_data):
        uploaded_file = validated_data["file"]
        validated_data["original_filename"] = uploaded_file.name
        validated_data["file_size"] = uploaded_file.size
        validated_data["metadata"] = self.context.get("geojson_metadata", {})
        return super().create(validated_data)


class GeoJsonLayerUpdateSerializer(serializers.ModelSerializer):
    type = serializers.ChoiceField(source="layer_type", choices=GeoJsonLayer.TYPE_CHOICES, required=False)

    class Meta:
        model = GeoJsonLayer
        fields = ["name", "description", "type", "is_active"]
