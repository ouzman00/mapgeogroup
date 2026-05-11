from __future__ import annotations

import json
import re
from urllib.parse import quote

from django.conf import settings
from django.db import transaction
from rest_framework import serializers

from .geojson_utils import as_feature_collection, summarize_geojson_attributes
from .models import ClientMapLayer
from .services.vector_import import import_geojson_features_to_db
from .services.postgis_import import import_postgis_features_to_db, normalize_postgis_options, safe_postgis_metadata
from .validators import parse_json_object, validate_bounds, validate_layer_payload

SUPPORTED_LAYER_TYPES = {ClientMapLayer.LAYER_GEOJSON, ClientMapLayer.LAYER_WMS, ClientMapLayer.LAYER_WFS}
SUPPORTED_DATA_FORMATS = {ClientMapLayer.FORMAT_WMS, ClientMapLayer.FORMAT_WFS, ClientMapLayer.FORMAT_POSTGIS}
SUPPORTED_SOURCE_MESSAGE = "Sources de données supportées : PostGIS, WFS ou WMS uniquement."
DEFAULT_GEOJSON_STYLE_COLOR = "#FBBF24"
DEFAULT_GEOJSON_FILL_OPACITY = 0.16
DEFAULT_GEOJSON_STROKE_OPACITY = 0.9
DEFAULT_GEOJSON_STROKE_WEIGHT = 3
DEFAULT_GEOJSON_POINT_RADIUS = 7
GEOJSON_CATEGORY_PALETTE = [
    "#2563EB", "#059669", "#D97706", "#7C3AED", "#DC2626", "#0891B2",
    "#4F46E5", "#16A34A", "#EA580C", "#DB2777", "#0F766E", "#9333EA",
    "#0369A1", "#65A30D", "#B45309", "#BE123C", "#0E7490", "#4338CA",
    "#15803D", "#C2410C", "#A21CAF", "#334155", "#047857", "#B91C1C",
]
HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

LAYER_GROUPS = {
    ClientMapLayer.LAYER_GEOJSON: "zonage",
    ClientMapLayer.LAYER_WMS: "contexte",
    ClientMapLayer.LAYER_WFS: "zonage",
    ClientMapLayer.FORMAT_POSTGIS: "zonage",
}
LAYER_LABELS = dict(ClientMapLayer.LAYER_TYPE_CHOICES)
FORMAT_LABELS = dict(ClientMapLayer.DATA_FORMAT_CHOICES)
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


def sanitize_client_metadata(value):
    if isinstance(value, list):
        return [sanitize_client_metadata(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        key: sanitize_client_metadata(item)
        for key, item in value.items()
        if str(key).lower() not in SENSITIVE_METADATA_KEYS
    }


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


def _source_kind(value):
    return str(value or "").strip().lower()


def is_supported_source(layer):
    return _source_kind(layer.layer_type) in SUPPORTED_LAYER_TYPES and _source_kind(layer.data_format) in SUPPORTED_DATA_FORMATS


def service_for(obj):
    data_format = _source_kind(obj.data_format)
    layer_type = _source_kind(obj.layer_type)
    if data_format == ClientMapLayer.FORMAT_POSTGIS or layer_type == ClientMapLayer.LAYER_GEOJSON:
        return "geojson"
    if data_format == ClientMapLayer.FORMAT_WMS or layer_type == ClientMapLayer.LAYER_WMS:
        return "wms"
    if data_format == ClientMapLayer.FORMAT_WFS or layer_type == ClientMapLayer.LAYER_WFS:
        return "wfs"
    return "unsupported"


def has_file(layer):
    return bool(getattr(layer, "file", None) and getattr(layer.file, "name", ""))


def source_kind_for(layer):
    return str(getattr(layer, "source_kind", "") or "").strip().lower()


def is_database_layer(layer):
    return source_kind_for(layer) == ClientMapLayer.SOURCE_DATABASE


def is_styled_vector_layer(layer):
    service = service_for(layer)
    return service == "geojson" or (service == "wfs" and is_database_layer(layer))


def configured_wms_service_url(layer):
    return str(getattr(layer, "service_url", "") or getattr(settings, "GEOSERVER_WMS_URL", "") or "").strip()


def wms_tile_crs(layer):
    metadata = layer.metadata or {}
    return str(metadata.get("wms_crs") or "EPSG:3857").strip().upper()


def wms_tile_version(layer):
    metadata = layer.metadata or {}
    return str(metadata.get("wms_version") or "1.3.0").strip()


def wfs_version(layer):
    metadata = layer.metadata or {}
    return str(metadata.get("wfs_version") or "2.0.0").strip()


def service_layer_names(value):
    return [name.strip() for name in str(value or "").split(",") if name.strip()]


def wms_legend_items_for_layer(layer):
    if service_for(layer) != "wms" or not getattr(layer, "id", None):
        return []
    items = []
    titles = (getattr(layer, "metadata", {}) or {}).get("wms_layer_titles")
    titles = titles if isinstance(titles, dict) else {}
    for index, layer_name in enumerate(service_layer_names(getattr(layer, "service_layers", ""))):
        label = str(titles.get(layer_name) or layer_name).strip() or getattr(layer, "name", "Couche WMS")
        items.append({
            "id": f"wms-legend-{layer.id}-{index}",
            "label": label,
            "symbol": "wms-legend",
            "imageEndpoint": f"/map-layers/{layer.id}/legend/?layer={quote(layer_name, safe='')}",
            "source": "wms_server",
        })
    return items


def metadata_with_wms_legend(layer, metadata=None):
    metadata = dict(metadata if isinstance(metadata, dict) else (getattr(layer, "metadata", {}) or {}))
    if service_for(layer) == "wms":
        legend_items = wms_legend_items_for_layer(layer)
        if legend_items:
            # Pour les WMS, la légende affichée côté client vient du serveur WMS
            # via le proxy GetLegendGraphic/LegendURL, jamais d'une analyse locale.
            metadata["legend"] = legend_items
            metadata["legend_source"] = "wms_server"
    return metadata


def is_wms_proxy_compatible(layer):
    # Le proxy de tuiles WMS actuel travaille en EPSG:3857.
    return wms_tile_crs(layer) == "EPSG:3857"


def is_client_displayable_layer(layer):
    if not layer.is_active or layer.processing_status != ClientMapLayer.STATUS_READY:
        return False
    if not is_supported_source(layer):
        return False

    service = service_for(layer)
    if service == "geojson":
        return is_database_layer(layer)
    if service == "wms":
        return bool(configured_wms_service_url(layer) and str(layer.service_layers or "").strip() and is_wms_proxy_compatible(layer))
    if service == "wfs":
        return is_database_layer(layer) or bool(str(layer.service_url or "").strip() and str(layer.service_layers or "").strip())
    return False


def display_message_for(layer):
    if is_client_displayable_layer(layer):
        return ""

    metadata = layer.metadata or {}
    processing_error = layer.processing_error or metadata.get("processing_error") or ""
    service = service_for(layer)

    if not is_supported_source(layer):
        return SUPPORTED_SOURCE_MESSAGE
    if not layer.is_active:
        return "Couche masquée côté client. Réactivez-la pour l’afficher."
    if processing_error:
        return processing_error
    if metadata.get("crs_required") or metadata.get("needs_crs"):
        return ClientMapLayer.CRS_REQUIRED_MESSAGE
    if service == "geojson" and not is_database_layer(layer):
        return "Couche vectorielle non importée en base PostGIS."
    if service == "wms" and configured_wms_service_url(layer) and str(layer.service_layers or "").strip() and not is_wms_proxy_compatible(layer):
        return f"WMS CRS non supporté par le proxy de tuiles actuel : {wms_tile_crs(layer)}. Utilisez EPSG:3857 pour l’affichage portail."
    if service == "wms" and not (configured_wms_service_url(layer) and str(layer.service_layers or "").strip()):
        return "WMS mal configuré : GeoServer WMS et nom de couche requis."
    if service == "wfs" and not (str(layer.service_url or "").strip() and str(layer.service_layers or "").strip()):
        return "WFS mal configuré : URL du service et nom de couche requis."
    if layer.processing_status == ClientMapLayer.STATUS_PENDING:
        return "Couche stockée, en attente de préparation avant affichage client."
    if layer.processing_status == ClientMapLayer.STATUS_PROCESSING:
        return "Couche en préparation, non affichable pour le moment."
    if layer.processing_status == ClientMapLayer.STATUS_FAILED:
        return "La préparation de cette couche a échoué."
    return "Couche non disponible pour l’affichage client."



def metadata_with_lazy_attribute_fields(layer):
    metadata = dict(getattr(layer, "metadata", {}) or {})
    if metadata.get("attribute_fields") or service_for(layer) != "geojson" or is_database_layer(layer) or not has_file(layer):
        return metadata
    try:
        with layer.file.open("rb") as fh:
            payload = json.load(fh)
        collection = as_feature_collection(payload)
        metadata["attribute_fields"] = summarize_geojson_attributes(collection.get("features") or [])
    except Exception:
        metadata["attribute_fields"] = []
    return metadata


def normalize_style_color(value, default=None):
    raw = str(value or "").strip()
    if not raw:
        return default
    if not raw.startswith("#") and len(raw) == 6:
        raw = f"#{raw}"
    if not HEX_COLOR_RE.match(raw):
        raise serializers.ValidationError("Couleur invalide : utilisez un hexadécimal au format #RRGGBB.")
    return raw.upper()


def normalize_style_number(value, default, minimum=0, maximum=1, label="Valeur"):
    if value in (None, ""):
        return default
    try:
        number = float(str(value).replace(",", "."))
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError(f"{label} invalide : valeur numérique attendue.") from exc
    if number < minimum or number > maximum:
        raise serializers.ValidationError(f"{label} invalide : valeur attendue entre {minimum} et {maximum}.")
    return number


def normalize_style_mode(value, default="single"):
    raw = str(value if value not in (None, "") else default or "single").strip().lower()
    if raw in {"single", "unique", "simple"}:
        return "single"
    if raw in {"categorized", "categorise", "categorisé", "categorise", "category", "categories"}:
        return "categorized"
    raise serializers.ValidationError("Mode de symbologie invalide : utilisez single ou categorized.")


def parse_json_list(value, field_name):
    if value in (None, ""):
        return None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise serializers.ValidationError(f"{field_name} invalide : JSON attendu.") from exc
    if not isinstance(value, list):
        raise serializers.ValidationError(f"{field_name} invalide : liste attendue.")
    return value


def normalize_category_value(value):
    if value is None:
        return "__null__"
    value = str(value).strip()
    return value[:200] if value else "__empty__"


def default_category_label(value):
    if value == "__null__":
        return "Non renseigné"
    if value == "__empty__":
        return "Non renseigné"
    return str(value or "Autre")[:120]


def category_style_from_payload(payload, base_style, index=0):
    payload = payload if isinstance(payload, dict) else {}
    style_payload = payload.get("style") if isinstance(payload.get("style"), dict) else payload
    fallback_color = GEOJSON_CATEGORY_PALETTE[index % len(GEOJSON_CATEGORY_PALETTE)]
    current_style = {
        **(base_style or {}),
        "color": style_payload.get("color") or style_payload.get("strokeColor") or style_payload.get("style_stroke_color") or fallback_color,
        "strokeColor": style_payload.get("strokeColor") or style_payload.get("color") or style_payload.get("style_stroke_color") or fallback_color,
        "fillColor": style_payload.get("fillColor") or style_payload.get("fill") or style_payload.get("style_fill_color") or fallback_color,
    }
    return style_metadata_from_options(
        style_color=style_payload.get("style_color") or style_payload.get("color"),
        fill_color=style_payload.get("style_fill_color") or style_payload.get("fillColor") or style_payload.get("fill"),
        stroke_color=style_payload.get("style_stroke_color") or style_payload.get("strokeColor") or style_payload.get("color"),
        fill_opacity=style_payload.get("style_fill_opacity") if "style_fill_opacity" in style_payload else style_payload.get("fillOpacity"),
        stroke_opacity=style_payload.get("style_stroke_opacity") if "style_stroke_opacity" in style_payload else style_payload.get("opacity"),
        stroke_weight=style_payload.get("style_weight") if "style_weight" in style_payload else style_payload.get("weight"),
        point_radius=style_payload.get("style_radius") if "style_radius" in style_payload else style_payload.get("radius"),
        current_style=current_style,
        style_mode="single",
    )


def normalize_style_categories(value, current_categories=None, base_style=None):
    parsed = parse_json_list(value, "Catégories de symbologie")
    if parsed is None:
        parsed = current_categories if isinstance(current_categories, list) else []
    if len(parsed) > 60:
        raise serializers.ValidationError("Trop de catégories : maximum 60 valeurs pour garder une légende lisible.")
    categories = []
    seen = set()
    for index, item in enumerate(parsed):
        if not isinstance(item, dict):
            raise serializers.ValidationError("Chaque catégorie de symbologie doit être un objet.")
        value_key = normalize_category_value(item.get("value"))
        if value_key in seen:
            continue
        seen.add(value_key)
        label = str(item.get("label") or default_category_label(value_key)).strip()[:120]
        categories.append({
            "value": value_key,
            "label": label or default_category_label(value_key),
            "style": category_style_from_payload(item, base_style, index=index),
        })
    return categories


def style_metadata_from_options(
    *,
    style_color=None,
    fill_color=None,
    stroke_color=None,
    fill_opacity=None,
    stroke_opacity=None,
    stroke_weight=None,
    point_radius=None,
    current_style=None,
    style_mode=None,
    category_field=None,
    categories=None,
):
    current_style = current_style if isinstance(current_style, dict) else {}
    base_color = normalize_style_color(
        style_color or current_style.get("color") or current_style.get("strokeColor"),
        DEFAULT_GEOJSON_STYLE_COLOR,
    )
    fill = normalize_style_color(fill_color or current_style.get("fillColor") or current_style.get("fill"), base_color)
    stroke = normalize_style_color(stroke_color or current_style.get("strokeColor") or current_style.get("color"), base_color)
    weight = normalize_style_number(
        stroke_weight if stroke_weight not in (None, "") else current_style.get("weight"),
        DEFAULT_GEOJSON_STROKE_WEIGHT,
        minimum=0.5,
        maximum=12,
        label="Épaisseur de bordure",
    )
    opacity = normalize_style_number(
        stroke_opacity if stroke_opacity not in (None, "") else current_style.get("opacity"),
        DEFAULT_GEOJSON_STROKE_OPACITY,
        minimum=0,
        maximum=1,
        label="Opacité de bordure",
    )
    fill_opacity_value = normalize_style_number(
        fill_opacity if fill_opacity not in (None, "") else current_style.get("fillOpacity"),
        DEFAULT_GEOJSON_FILL_OPACITY,
        minimum=0,
        maximum=1,
        label="Opacité de remplissage",
    )
    radius = normalize_style_number(
        point_radius if point_radius not in (None, "") else current_style.get("radius"),
        DEFAULT_GEOJSON_POINT_RADIUS,
        minimum=2,
        maximum=30,
        label="Taille des points",
    )
    style = {
        "mode": normalize_style_mode(style_mode, current_style.get("mode") or "single"),
        "color": stroke,
        "strokeColor": stroke,
        "fillColor": fill,
        "fill": fill,
        "weight": weight,
        "opacity": opacity,
        "fillOpacity": fill_opacity_value,
        "radius": radius,
    }
    previous_field = current_style.get("categoryField") or ""
    next_field = str(category_field if category_field is not None else previous_field).strip()
    if style["mode"] == "categorized":
        if not next_field:
            raise serializers.ValidationError("Choisissez l’attribut utilisé pour la symbologie catégorisée.")
        style["categoryField"] = next_field[:120]
        style["categories"] = normalize_style_categories(categories, current_style.get("categories"), style)
        if not style["categories"]:
            raise serializers.ValidationError("Ajoutez au moins une catégorie de symbologie.")
    else:
        # On garde les anciennes catégories en mémoire pour permettre de revenir au mode catégorisé,
        # mais le rendu client utilise uniquement le style unique tant que mode=single.
        if next_field:
            style["categoryField"] = next_field[:120]
        if categories is not None or isinstance(current_style.get("categories"), list):
            style["categories"] = normalize_style_categories(categories, current_style.get("categories"), style)
    return style

def style_metadata_from_color(color):
    return style_metadata_from_options(style_color=color)


def metadata_with_geojson_style(metadata, **style_options):
    metadata = dict(metadata or {})
    current_style = metadata.get("style") if isinstance(metadata.get("style"), dict) else {}
    metadata["style"] = {
        **current_style,
        **style_metadata_from_options(current_style=current_style, **style_options),
    }
    return metadata


def get_geojson_style_from_metadata(metadata):
    style = metadata.get("style") if isinstance(metadata, dict) else None
    return style_metadata_from_options(current_style=style if isinstance(style, dict) else {})


def get_style_color_from_metadata(metadata):
    return get_geojson_style_from_metadata(metadata).get("color", DEFAULT_GEOJSON_STYLE_COLOR)


def get_style_fill_color_from_metadata(metadata):
    return get_geojson_style_from_metadata(metadata).get("fillColor", DEFAULT_GEOJSON_STYLE_COLOR)


def get_style_stroke_color_from_metadata(metadata):
    return get_geojson_style_from_metadata(metadata).get("strokeColor", DEFAULT_GEOJSON_STYLE_COLOR)


def get_style_fill_opacity_from_metadata(metadata):
    return get_geojson_style_from_metadata(metadata).get("fillOpacity", DEFAULT_GEOJSON_FILL_OPACITY)


def get_style_stroke_opacity_from_metadata(metadata):
    return get_geojson_style_from_metadata(metadata).get("opacity", DEFAULT_GEOJSON_STROKE_OPACITY)


def get_style_weight_from_metadata(metadata):
    return get_geojson_style_from_metadata(metadata).get("weight", DEFAULT_GEOJSON_STROKE_WEIGHT)


def get_style_radius_from_metadata(metadata):
    return get_geojson_style_from_metadata(metadata).get("radius", DEFAULT_GEOJSON_POINT_RADIUS)


class ClientMapLayerListSerializer(serializers.ModelSerializer):
    type = serializers.CharField(source="layer_type", read_only=True)
    layer_type_label = serializers.SerializerMethodField()
    data_format_label = serializers.SerializerMethodField()
    group = serializers.SerializerMethodField()
    service = serializers.SerializerMethodField()
    endpoint = serializers.SerializerMethodField()
    tile_endpoint = serializers.SerializerMethodField()
    visible = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()
    geometry_type = serializers.SerializerMethodField()
    display_message = serializers.SerializerMethodField()
    requires_tiling = serializers.SerializerMethodField()
    style_color = serializers.SerializerMethodField()
    style_fill_color = serializers.SerializerMethodField()
    style_stroke_color = serializers.SerializerMethodField()
    style_fill_opacity = serializers.SerializerMethodField()
    style_stroke_opacity = serializers.SerializerMethodField()
    style_weight = serializers.SerializerMethodField()
    style_radius = serializers.SerializerMethodField()
    metadata = serializers.SerializerMethodField()

    class Meta:
        model = ClientMapLayer
        fields = [
            "id",
            "name",
            "description",
            "type",
            "layer_type",
            "layer_type_label",
            "data_format",
            "data_format_label",
            "source_kind",
            "group",
            "service",
            "endpoint",
            "tile_endpoint",
            "visible",
            "available",
            "display_message",
            "requires_tiling",
            "is_active",
            "processing_status",
            "bounds",
            "center",
            "min_zoom",
            "max_zoom",
            "opacity",
            "z_index",
            "geometry_type",
            "style_color",
            "style_fill_color",
            "style_stroke_color",
            "style_fill_opacity",
            "style_stroke_opacity",
            "style_weight",
            "style_radius",
            "metadata",
            "created_at",
            "updated_at",
        ]

    def get_layer_type_label(self, obj):
        return LAYER_LABELS.get(obj.layer_type, obj.layer_type)

    def get_data_format_label(self, obj):
        return FORMAT_LABELS.get(obj.data_format, obj.data_format)

    def get_group(self, obj):
        return LAYER_GROUPS.get(obj.layer_type, "contexte")

    def get_service(self, obj):
        return service_for(obj)

    def get_endpoint(self, obj):
        return f"/map-layers/{obj.id}/geojson/" if service_for(obj) in {"geojson", "wfs"} else f"/map-layers/{obj.id}/"

    def get_tile_endpoint(self, obj):
        return f"/map-layers/{obj.id}/tiles/{{z}}/{{x}}/{{y}}/" if service_for(obj) == "wms" else ""

    def get_visible(self, obj):
        return is_client_displayable_layer(obj)

    def get_available(self, obj):
        return is_client_displayable_layer(obj)

    def get_display_message(self, obj):
        return display_message_for(obj)

    def get_requires_tiling(self, obj):
        return False

    def get_geometry_type(self, obj):
        geom = (obj.metadata or {}).get("geometry_types") or {}
        return normalize_geometry_type(geom.keys() if isinstance(geom, dict) else geom)

    def get_style_color(self, obj):
        return get_style_color_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else ""

    def get_style_fill_color(self, obj):
        return get_style_fill_color_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else ""

    def get_style_stroke_color(self, obj):
        return get_style_stroke_color_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else ""

    def get_style_fill_opacity(self, obj):
        return get_style_fill_opacity_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else None

    def get_style_stroke_opacity(self, obj):
        return get_style_stroke_opacity_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else None

    def get_style_weight(self, obj):
        return get_style_weight_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else None

    def get_style_radius(self, obj):
        return get_style_radius_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else None

    def get_metadata(self, obj):
        return sanitize_client_metadata(metadata_with_wms_legend(obj, obj.metadata or {}))


class AdminMapLayerSerializer(serializers.ModelSerializer):
    client_id = serializers.IntegerField(source="client.id", read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)
    type = serializers.CharField(source="layer_type", read_only=True)
    layer_type_label = serializers.SerializerMethodField()
    data_format_label = serializers.SerializerMethodField()
    available = serializers.SerializerMethodField()
    display_message = serializers.SerializerMethodField()
    requires_tiling = serializers.SerializerMethodField()
    style_color = serializers.SerializerMethodField()
    style_fill_color = serializers.SerializerMethodField()
    style_stroke_color = serializers.SerializerMethodField()
    style_fill_opacity = serializers.SerializerMethodField()
    style_stroke_opacity = serializers.SerializerMethodField()
    style_weight = serializers.SerializerMethodField()
    style_radius = serializers.SerializerMethodField()

    class Meta:
        model = ClientMapLayer
        fields = [
            "id",
            "client_id",
            "client_name",
            "name",
            "description",
            "type",
            "layer_type",
            "layer_type_label",
            "data_format",
            "data_format_label",
            "tile_url",
            "service_url",
            "service_layers",
            "source_kind",
            "is_active",
            "available",
            "display_message",
            "requires_tiling",
            "bounds",
            "center",
            "min_zoom",
            "max_zoom",
            "opacity",
            "z_index",
            "style_color",
            "style_fill_color",
            "style_stroke_color",
            "style_fill_opacity",
            "style_stroke_opacity",
            "style_weight",
            "style_radius",
            "processing_status",
            "processing_error",
            "original_filename",
            "file_size",
            "metadata",
            "created_at",
            "updated_at",
        ]

    def get_layer_type_label(self, obj):
        return LAYER_LABELS.get(obj.layer_type, obj.layer_type)

    def get_data_format_label(self, obj):
        return FORMAT_LABELS.get(obj.data_format, obj.data_format)

    def get_available(self, obj):
        return is_client_displayable_layer(obj)

    def get_display_message(self, obj):
        return display_message_for(obj)

    def get_requires_tiling(self, obj):
        return False

    def get_style_color(self, obj):
        return get_style_color_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else ""

    def get_style_fill_color(self, obj):
        return get_style_fill_color_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else ""

    def get_style_stroke_color(self, obj):
        return get_style_stroke_color_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else ""

    def get_style_fill_opacity(self, obj):
        return get_style_fill_opacity_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else None

    def get_style_stroke_opacity(self, obj):
        return get_style_stroke_opacity_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else None

    def get_style_weight(self, obj):
        return get_style_weight_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else None

    def get_style_radius(self, obj):
        return get_style_radius_from_metadata(obj.metadata or {}) if is_styled_vector_layer(obj) else None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # L'admin voit la configuration utile, mais jamais les URLs signées/privées ni les chemins serveur.
        data["service_url"] = ""
        data["tile_url"] = ""
        data["metadata"] = sanitize_client_metadata(metadata_with_wms_legend(instance, metadata_with_lazy_attribute_fields(instance)))
        return data


class MapLayerCreateSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True, required=False, allow_null=True)
    source_crs = serializers.CharField(write_only=True, required=False, allow_blank=True)
    source_kind = serializers.CharField(required=False, allow_blank=True)
    wms_crs = serializers.CharField(write_only=True, required=False, allow_blank=True)
    wms_version = serializers.CharField(write_only=True, required=False, allow_blank=True)
    wfs_version = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_host = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_port = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_database = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_password = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    postgis_schema = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_table = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_geometry_column = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_id_column = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_source_srid = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_where_clause = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_limit = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_color = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_fill_color = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_stroke_color = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_fill_opacity = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_stroke_opacity = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_weight = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_radius = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_mode = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_category_field = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_categories = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = ClientMapLayer
        fields = [
            "name",
            "description",
            "layer_type",
            "data_format",
            "file",
            "source_crs",
            "source_kind",
            "wms_crs",
            "wms_version",
            "wfs_version",
            "postgis_host",
            "postgis_port",
            "postgis_database",
            "postgis_username",
            "postgis_password",
            "postgis_schema",
            "postgis_table",
            "postgis_geometry_column",
            "postgis_id_column",
            "postgis_source_srid",
            "postgis_where_clause",
            "postgis_limit",
            "style_color",
            "style_fill_color",
            "style_stroke_color",
            "style_fill_opacity",
            "style_stroke_opacity",
            "style_weight",
            "style_radius",
            "style_mode",
            "style_category_field",
            "style_categories",
            "service_url",
            "service_layers",
            "is_active",
            "bounds",
            "center",
            "min_zoom",
            "max_zoom",
            "opacity",
            "z_index",
        ]

    def validate(self, attrs):
        layer_type = _source_kind(attrs.get("layer_type"))
        data_format = _source_kind(attrs.get("data_format"))
        if layer_type not in SUPPORTED_LAYER_TYPES or data_format not in SUPPORTED_DATA_FORMATS:
            raise serializers.ValidationError(SUPPORTED_SOURCE_MESSAGE)
        if data_format == ClientMapLayer.FORMAT_GEOJSON:
            raise serializers.ValidationError("L’import GeoJSON local est désactivé en production. Utilisez PostGIS, WFS ou WMS GeoServer.")
        if data_format == ClientMapLayer.FORMAT_POSTGIS:
            if layer_type != ClientMapLayer.LAYER_GEOJSON:
                raise serializers.ValidationError("Une source PostGIS doit créer une couche vectorielle GeoJSON.")
        elif layer_type != data_format:
            raise serializers.ValidationError("Le type et le format doivent être cohérents : PostGIS, WMS ou WFS.")

        requested_source_kind = source_kind_for(type("Obj", (), {"source_kind": attrs.get("source_kind")})())
        if not requested_source_kind:
            requested_source_kind = ClientMapLayer.SOURCE_SERVICE if data_format == ClientMapLayer.FORMAT_WMS else ClientMapLayer.SOURCE_DATABASE
        if requested_source_kind not in {ClientMapLayer.SOURCE_DATABASE, ClientMapLayer.SOURCE_SERVICE, ClientMapLayer.SOURCE_FILE}:
            raise serializers.ValidationError({"source_kind": "Mode de source invalide."})
        if data_format in {ClientMapLayer.FORMAT_WFS, ClientMapLayer.FORMAT_POSTGIS}:
            requested_source_kind = ClientMapLayer.SOURCE_DATABASE
        if data_format == ClientMapLayer.FORMAT_WMS:
            requested_source_kind = ClientMapLayer.SOURCE_SERVICE
        attrs["source_kind"] = requested_source_kind

        attrs["bounds"] = validate_bounds(parse_json_object(attrs.get("bounds"), "bounds"), required=False)
        attrs["center"] = parse_json_object(attrs.get("center"), "center")
        metadata = validate_layer_payload(
            layer_type,
            data_format,
            uploaded_file=attrs.get("file"),
            bounds=attrs.get("bounds"),
            service_url=attrs.get("service_url") or "",
            service_layers=attrs.get("service_layers") or "",
            source_crs=attrs.get("source_crs") or None,
            wms_crs=attrs.get("wms_crs") or None,
            wms_version=attrs.get("wms_version") or None,
            wfs_version=attrs.get("wfs_version") or None,
            postgis_options=normalize_postgis_options(attrs) if data_format == ClientMapLayer.FORMAT_POSTGIS else None,
        )

        if data_format in {ClientMapLayer.FORMAT_POSTGIS, ClientMapLayer.FORMAT_WFS}:
            metadata = metadata_with_geojson_style(
                metadata,
                style_color=attrs.get("style_color"),
                fill_color=attrs.get("style_fill_color"),
                stroke_color=attrs.get("style_stroke_color"),
                fill_opacity=attrs.get("style_fill_opacity"),
                stroke_opacity=attrs.get("style_stroke_opacity"),
                stroke_weight=attrs.get("style_weight"),
                point_radius=attrs.get("style_radius"),
                style_mode=attrs.get("style_mode"),
                category_field=attrs.get("style_category_field"),
                categories=attrs.get("style_categories"),
            )

        self.context["map_layer_metadata"] = metadata
        if not attrs.get("bounds") and isinstance(metadata.get("bounds_wgs84"), dict):
            attrs["bounds"] = metadata["bounds_wgs84"]
        if not attrs.get("center") and isinstance(attrs.get("bounds"), dict) and attrs["bounds"]:
            try:
                attrs["center"] = {
                    "lat": (float(attrs["bounds"]["south"]) + float(attrs["bounds"]["north"])) / 2,
                    "lng": (float(attrs["bounds"]["west"]) + float(attrs["bounds"]["east"])) / 2,
                }
            except Exception:
                pass
        attrs["opacity"] = min(1, max(0, float(str(attrs.get("opacity", 1)).replace(",", "."))))
        attrs["min_zoom"] = max(0, int(attrs.get("min_zoom", 0)))
        attrs["max_zoom"] = min(24, max(attrs["min_zoom"], int(attrs.get("max_zoom", 22))))
        attrs["processing_status"] = ClientMapLayer.STATUS_READY
        attrs["processing_error"] = ""
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        source_crs = validated_data.pop("source_crs", None)
        postgis_options = normalize_postgis_options(validated_data) if _source_kind(validated_data.get("data_format")) == ClientMapLayer.FORMAT_POSTGIS else None
        for key in ("wms_crs", "wms_version", "wfs_version", "postgis_host", "postgis_port", "postgis_database", "postgis_username", "postgis_password", "postgis_schema", "postgis_table", "postgis_geometry_column", "postgis_id_column", "postgis_source_srid", "postgis_where_clause", "postgis_limit", "style_color", "style_fill_color", "style_stroke_color", "style_fill_opacity", "style_stroke_opacity", "style_weight", "style_radius", "style_mode", "style_category_field", "style_categories"):
            validated_data.pop(key, None)

        uploaded_file = validated_data.get("file")
        data_format = _source_kind(validated_data.get("data_format"))
        metadata = dict(self.context.get("map_layer_metadata", {}) or {})

        if uploaded_file:
            validated_data["original_filename"] = uploaded_file.name
            validated_data["file_size"] = uploaded_file.size

        if data_format == ClientMapLayer.FORMAT_GEOJSON:
            raise serializers.ValidationError({"data_format": "L’import GeoJSON local est désactivé. Utilisez PostGIS, WFS ou WMS GeoServer."})

        if data_format == ClientMapLayer.FORMAT_WFS:
            # Le WFS est consommé comme source d'import puis la carte sert les features depuis PostGIS.
            validated_data["source_kind"] = ClientMapLayer.SOURCE_DATABASE
            validated_data["metadata"] = {**metadata, "storage": "database", "source_kind": ClientMapLayer.SOURCE_DATABASE}
            layer = super().create(validated_data)
            from .views import fetch_wfs_geojson  # import local pour éviter une dépendance circulaire au chargement
            normalized = fetch_wfs_geojson(layer, bbox=None, limit=getattr(settings, "MAX_WFS_IMPORT_FEATURES", 20000))
            import_metadata = import_geojson_features_to_db(layer, normalized, source_crs="EPSG:4326")
            layer.metadata = {**(layer.metadata or {}), **import_metadata, "source_format": "wfs"}
            layer.save(update_fields=["metadata", "updated_at"])
            return layer

        if data_format == ClientMapLayer.FORMAT_POSTGIS:
            validated_data["layer_type"] = ClientMapLayer.LAYER_GEOJSON
            validated_data["source_kind"] = ClientMapLayer.SOURCE_DATABASE
            validated_data["file"] = None
            validated_data["service_url"] = ""
            validated_data["service_layers"] = ""
            validated_data["metadata"] = {**metadata, **safe_postgis_metadata(postgis_options or {})}
            layer = super().create(validated_data)
            import_metadata = import_postgis_features_to_db(layer, postgis_options or {})
            layer.metadata = {**(layer.metadata or {}), **import_metadata}
            if isinstance(import_metadata.get("bounds_wgs84"), dict) and not layer.bounds:
                layer.bounds = import_metadata["bounds_wgs84"]
            layer.save(update_fields=["metadata", "bounds", "updated_at"])
            return layer

        if data_format == ClientMapLayer.FORMAT_WMS:
            validated_data["source_kind"] = ClientMapLayer.SOURCE_SERVICE
            if not str(validated_data.get("service_url") or "").strip() and getattr(settings, "GEOSERVER_WMS_URL", ""):
                validated_data["service_url"] = settings.GEOSERVER_WMS_URL
            metadata = {**metadata, "source_kind": ClientMapLayer.SOURCE_SERVICE, "wms_provider": "geoserver"}

        validated_data["metadata"] = metadata
        return super().create(validated_data)


class MapLayerUpdateSerializer(serializers.ModelSerializer):
    wms_crs = serializers.CharField(write_only=True, required=False, allow_blank=True)
    wms_version = serializers.CharField(write_only=True, required=False, allow_blank=True)
    wfs_version = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_host = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_port = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_database = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_password = serializers.CharField(write_only=True, required=False, allow_blank=True, trim_whitespace=False)
    postgis_schema = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_table = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_geometry_column = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_id_column = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_source_srid = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_where_clause = serializers.CharField(write_only=True, required=False, allow_blank=True)
    postgis_limit = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_color = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_fill_color = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_stroke_color = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_fill_opacity = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_stroke_opacity = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_weight = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_radius = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_mode = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_category_field = serializers.CharField(write_only=True, required=False, allow_blank=True)
    style_categories = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = ClientMapLayer
        fields = [
            "name",
            "description",
            "layer_type",
            "data_format",
            "service_url",
            "service_layers",
            "is_active",
            "bounds",
            "center",
            "min_zoom",
            "max_zoom",
            "opacity",
            "z_index",
            "processing_status",
            "processing_error",
            "wms_crs",
            "wms_version",
            "wfs_version",
            "postgis_host",
            "postgis_port",
            "postgis_database",
            "postgis_username",
            "postgis_password",
            "postgis_schema",
            "postgis_table",
            "postgis_geometry_column",
            "postgis_id_column",
            "postgis_source_srid",
            "postgis_where_clause",
            "postgis_limit",
            "style_color",
            "style_fill_color",
            "style_stroke_color",
            "style_fill_opacity",
            "style_stroke_opacity",
            "style_weight",
            "style_radius",
            "style_mode",
            "style_category_field",
            "style_categories",
        ]

    def validate(self, attrs):
        layer_type = _source_kind(attrs.get("layer_type", getattr(self.instance, "layer_type", "")))
        data_format = _source_kind(attrs.get("data_format", getattr(self.instance, "data_format", "")))
        if layer_type not in SUPPORTED_LAYER_TYPES or data_format not in SUPPORTED_DATA_FORMATS:
            raise serializers.ValidationError(SUPPORTED_SOURCE_MESSAGE)
        if data_format == ClientMapLayer.FORMAT_GEOJSON:
            raise serializers.ValidationError("L’import GeoJSON local est désactivé en production. Utilisez PostGIS, WFS ou WMS GeoServer.")
        if data_format == ClientMapLayer.FORMAT_POSTGIS:
            if layer_type != ClientMapLayer.LAYER_GEOJSON:
                raise serializers.ValidationError("Une source PostGIS doit rester une couche vectorielle GeoJSON.")
        elif layer_type != data_format:
            raise serializers.ValidationError("Le type et le format doivent être cohérents : PostGIS, WMS ou WFS.")
        style_attrs = {key: attrs.get(key) for key in ("style_color", "style_fill_color", "style_stroke_color", "style_fill_opacity", "style_stroke_opacity", "style_weight", "style_radius", "style_mode", "style_category_field", "style_categories") if key in attrs}
        if style_attrs and data_format in {ClientMapLayer.FORMAT_POSTGIS, ClientMapLayer.FORMAT_WFS}:
            style_metadata_from_options(
                style_color=style_attrs.get("style_color"),
                fill_color=style_attrs.get("style_fill_color"),
                stroke_color=style_attrs.get("style_stroke_color"),
                fill_opacity=style_attrs.get("style_fill_opacity"),
                stroke_opacity=style_attrs.get("style_stroke_opacity"),
                stroke_weight=style_attrs.get("style_weight"),
                point_radius=style_attrs.get("style_radius"),
                style_mode=style_attrs.get("style_mode"),
                category_field=style_attrs.get("style_category_field"),
                categories=style_attrs.get("style_categories"),
                current_style=(getattr(self.instance, "metadata", {}) or {}).get("style") if self.instance else None,
            )
        if "bounds" in attrs:
            attrs["bounds"] = validate_bounds(parse_json_object(attrs.get("bounds"), "bounds"), required=False)
        if "center" in attrs:
            attrs["center"] = parse_json_object(attrs.get("center"), "center")
        if "opacity" in attrs:
            attrs["opacity"] = min(1, max(0, float(str(attrs["opacity"]).replace(",", "."))))
        if "min_zoom" in attrs:
            attrs["min_zoom"] = max(0, int(attrs["min_zoom"]))
        if "max_zoom" in attrs:
            min_zoom = int(attrs.get("min_zoom", getattr(self.instance, "min_zoom", 0) or 0))
            attrs["max_zoom"] = min(24, max(min_zoom, int(attrs["max_zoom"])))

        # P1 sécurité : une couche WMS/WFS modifiée doit repasser par les mêmes
        # validations qu'à la création. Sans cela, un manager pourrait créer une
        # couche sûre puis modifier service_url vers un hôte non allowlisté.
        if data_format in {ClientMapLayer.FORMAT_WMS, ClientMapLayer.FORMAT_WFS}:
            metadata = getattr(self.instance, "metadata", {}) or {}
            validate_layer_payload(
                layer_type,
                data_format,
                service_url=attrs.get("service_url", getattr(self.instance, "service_url", "") or ""),
                service_layers=attrs.get("service_layers", getattr(self.instance, "service_layers", "") or ""),
                wms_crs=attrs.get("wms_crs") or metadata.get("wms_crs"),
                wms_version=attrs.get("wms_version") or metadata.get("wms_version"),
                wfs_version=attrs.get("wfs_version") or metadata.get("wfs_version"),
            )
        return attrs

    def update(self, instance, validated_data):
        metadata = dict(instance.metadata or {})
        style_color = validated_data.pop("style_color", None)
        style_fill_color = validated_data.pop("style_fill_color", None)
        style_stroke_color = validated_data.pop("style_stroke_color", None)
        style_fill_opacity = validated_data.pop("style_fill_opacity", None)
        style_stroke_opacity = validated_data.pop("style_stroke_opacity", None)
        style_weight = validated_data.pop("style_weight", None)
        style_radius = validated_data.pop("style_radius", None)
        style_mode = validated_data.pop("style_mode", None)
        style_category_field = validated_data.pop("style_category_field", None)
        style_categories = validated_data.pop("style_categories", None)
        wms_crs = validated_data.pop("wms_crs", None)
        wms_version_value = validated_data.pop("wms_version", None)
        wfs_version_value = validated_data.pop("wfs_version", None)

        next_data_format = _source_kind(validated_data.get("data_format", instance.data_format))
        style_update_requested = any(value not in (None, "") for value in (style_color, style_fill_color, style_stroke_color, style_fill_opacity, style_stroke_opacity, style_weight, style_radius, style_mode, style_category_field)) or style_categories is not None
        if next_data_format in {ClientMapLayer.FORMAT_POSTGIS, ClientMapLayer.FORMAT_WFS} and style_update_requested:
            metadata = metadata_with_geojson_style(
                metadata,
                style_color=style_color,
                fill_color=style_fill_color,
                stroke_color=style_stroke_color,
                fill_opacity=style_fill_opacity,
                stroke_opacity=style_stroke_opacity,
                stroke_weight=style_weight,
                point_radius=style_radius,
                style_mode=style_mode,
                category_field=style_category_field,
                categories=style_categories,
            )
        if next_data_format == ClientMapLayer.FORMAT_WMS:
            if wms_crs:
                metadata["wms_crs"] = str(wms_crs).strip().upper()
            if wms_version_value:
                metadata["wms_version"] = str(wms_version_value).strip()
        if next_data_format == ClientMapLayer.FORMAT_WFS and wfs_version_value:
            metadata["wfs_version"] = str(wfs_version_value).strip()
            metadata["served_crs"] = "EPSG:4326"

        validated_data["metadata"] = metadata
        return super().update(instance, validated_data)
