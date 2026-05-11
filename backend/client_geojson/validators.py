from __future__ import annotations

import json

from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry
from rest_framework.exceptions import ValidationError

from client_map_layers.geojson_utils import normalize_geojson_for_leaflet
from config.file_validation import validate_text_decodable, validate_uploaded_file_basics

ALLOWED_GEOJSON_TYPES = {
    "FeatureCollection",
    "Feature",
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
}


def validate_geojson_upload(uploaded_file):
    """Valide le GeoJSON et calcule des métadonnées WGS84 compatibles Leaflet."""
    max_size = getattr(settings, "MAX_GEOJSON_UPLOAD_SIZE", 20 * 1024 * 1024)

    validate_uploaded_file_basics(
        uploaded_file,
        allowed_extensions={".geojson", ".json"},
        max_size=max_size,
        label="GeoJSON",
    )

    try:
        data = json.loads(validate_text_decodable(uploaded_file, label="GeoJSON"))
    except json.JSONDecodeError as exc:
        raise ValidationError("Le fichier n'est pas un JSON valide.") from exc

    if not isinstance(data, dict):
        raise ValidationError("Le GeoJSON doit être un objet JSON.")
    if data.get("type") not in ALLOWED_GEOJSON_TYPES:
        raise ValidationError("Le fichier n'est pas un GeoJSON valide.")

    normalized, metadata = normalize_geojson_for_leaflet(data)
    max_features = getattr(settings, "MAX_GEOJSON_FEATURES", 50000)
    features = normalized.get("features") or []
    if len(features) > max_features:
        raise ValidationError(f"Le fichier contient trop d'objets. Maximum autorisé : {max_features}.")

    for index, feature in enumerate(features):
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not geometry:
            raise ValidationError(f"L'élément #{index + 1} ne contient pas de géométrie.")
        try:
            GEOSGeometry(json.dumps(geometry), srid=4326)
        except Exception as exc:
            raise ValidationError(f"Géométrie invalide #{index + 1}: {exc}") from exc

    return {"geojson_type": "FeatureCollection", **metadata}
