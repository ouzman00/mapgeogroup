from __future__ import annotations

import json
from typing import Any

from django.contrib.gis.geos import GEOSGeometry, Polygon
from django.db import transaction
from rest_framework.exceptions import ValidationError

from client_map_layers.geojson_utils import (
    as_feature_collection,
    bounds_from_positions,
    collect_positions,
    geometry_type_counts,
    normalize_geojson_for_leaflet,
    summarize_geojson_attributes,
)
from client_map_layers.models import ClientMapLayer, ClientMapLayerFeature


def _feature_id(feature: dict[str, Any], fallback: int) -> str:
    properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
    value = feature.get("id") or properties.get("id") or properties.get("fid") or properties.get("objectid") or ""
    return str(value or fallback)[:255]


def import_geojson_features_to_db(layer: ClientMapLayer, payload: dict[str, Any], *, source_crs: str | None = None, replace: bool = True) -> dict[str, Any]:
    """Normalise un GeoJSON en EPSG:4326 puis stocke ses features dans PostGIS."""
    normalized, metadata_patch = normalize_geojson_for_leaflet(payload, layer.metadata or {}, source_crs=source_crs)
    features = normalized.get("features") or []
    if not features:
        raise ValidationError("Le GeoJSON ne contient aucune feature exploitable.")

    objects: list[ClientMapLayerFeature] = []
    for index, feature in enumerate(features, start=1):
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not geometry:
            raise ValidationError(f"Géométrie manquante sur l'objet #{index}.")
        try:
            geom = GEOSGeometry(json.dumps(geometry), srid=4326)
        except Exception as exc:
            raise ValidationError(f"Géométrie invalide #{index}: {exc}") from exc
        if geom.empty:
            continue
        properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
        objects.append(
            ClientMapLayerFeature(
                layer=layer,
                geometry=geom,
                properties=properties,
                source_feature_id=_feature_id(feature, index),
            )
        )

    if not objects:
        raise ValidationError("Aucune géométrie valide n'a pu être importée en base.")

    with transaction.atomic():
        if replace:
            ClientMapLayerFeature.objects.filter(layer=layer).delete()
        ClientMapLayerFeature.objects.bulk_create(objects, batch_size=1000)

    return {
        **metadata_patch,
        "source_format": layer.data_format or "geojson",
        "storage": "database",
        "source_kind": ClientMapLayer.SOURCE_DATABASE,
        "feature_count": len(objects),
        "geojson_type": "FeatureCollection",
    }


def build_db_geojson(layer: ClientMapLayer, *, bbox: tuple[float, float, float, float] | None = None, limit: int = 2500) -> dict[str, Any]:
    """Construit une FeatureCollection GeoJSON depuis les features PostGIS d'une couche."""
    queryset = layer.features.all().order_by("id")
    if bbox:
        west, south, east, north = bbox
        bbox_geom = Polygon.from_bbox((west, south, east, north))
        bbox_geom.srid = 4326
        queryset = queryset.filter(geometry__intersects=bbox_geom)

    limit = max(0, min(int(limit or 2500), 20000))
    rows = list(queryset[:limit])
    features: list[dict[str, Any]] = []
    positions: list[list[float]] = []
    for row in rows:
        geometry = json.loads(row.geometry.geojson)
        properties = row.properties if isinstance(row.properties, dict) else {}
        feature: dict[str, Any] = {
            "type": "Feature",
            "id": row.source_feature_id or row.id,
            "geometry": geometry,
            "properties": properties,
        }
        features.append(feature)
        positions.extend(collect_positions({"type": "FeatureCollection", "features": [feature]}))

    collection = {"type": "FeatureCollection", "features": features}
    return {
        **collection,
        "metadata": {
            "storage": "database",
            "source_kind": ClientMapLayer.SOURCE_DATABASE,
            "layer_id": layer.id,
            "count": len(features),
            "feature_count": layer.features.count(),
            "bbox_filtered": bool(bbox),
            "geometry_types": geometry_type_counts(collection),
            "bounds_wgs84": bounds_from_positions(positions),
            "attribute_fields": summarize_geojson_attributes(features),
            "served_crs": "EPSG:4326",
        },
    }


def geojson_payload_from_file(uploaded_file) -> dict[str, Any]:
    try:
        uploaded_file.seek(0)
        raw = uploaded_file.read()
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValidationError("JSON invalide.") from exc
    except Exception as exc:
        raise ValidationError(f"Impossible de lire le fichier GeoJSON : {exc}") from exc
    finally:
        try:
            uploaded_file.seek(0)
        except Exception:
            pass
    return as_feature_collection(payload)
