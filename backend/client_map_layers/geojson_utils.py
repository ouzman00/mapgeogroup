from __future__ import annotations

import copy
import math
import re
from collections import Counter
from typing import Any

from django.conf import settings
from pyproj import Transformer
from rest_framework.exceptions import ValidationError

WGS84_SRID = 4326
DEFAULT_PROJECTED_SRID = int(getattr(settings, "PRIVATE_GEOJSON_DEFAULT_SOURCE_SRID", 32628))
SENEGAL_UTM_BOUNDS = {
    "min_x": 150000,
    "max_x": 900000,
    "min_y": 1350000,
    "max_y": 1900000,
}
WEB_MERCATOR_LIMIT = 20037508.342789244

_GEOMETRY_TYPES = {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"}
_TRANSFORMERS: dict[tuple[int, int], Transformer] = {}
SUPPORTED_SOURCE_SRIDS = {4326, 3857, DEFAULT_PROJECTED_SRID}


def _transformer(source_srid: int, target_srid: int = WGS84_SRID) -> Transformer:
    key = (int(source_srid), int(target_srid))
    if key not in _TRANSFORMERS:
        _TRANSFORMERS[key] = Transformer.from_crs(f"EPSG:{source_srid}", f"EPSG:{target_srid}", always_xy=True)
    return _TRANSFORMERS[key]


def _is_position(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
        and math.isfinite(float(value[0]))
        and math.isfinite(float(value[1]))
    )


def _walk_positions(geometry: dict[str, Any]):
    if not isinstance(geometry, dict):
        return
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates")

    if geom_type == "Point":
        if _is_position(coords):
            yield coords
        return

    if geom_type in {"MultiPoint", "LineString"}:
        for pos in coords or []:
            if _is_position(pos):
                yield pos
        return

    if geom_type in {"MultiLineString", "Polygon"}:
        for line in coords or []:
            for pos in line or []:
                if _is_position(pos):
                    yield pos
        return

    if geom_type == "MultiPolygon":
        for polygon in coords or []:
            for ring in polygon or []:
                for pos in ring or []:
                    if _is_position(pos):
                        yield pos
        return

    if geom_type == "GeometryCollection":
        for child in geometry.get("geometries") or []:
            yield from _walk_positions(child)


def _iter_geometries(data: dict[str, Any]):
    if not isinstance(data, dict):
        return
    data_type = data.get("type")
    if data_type == "FeatureCollection":
        for feature in data.get("features") or []:
            geometry = feature.get("geometry") if isinstance(feature, dict) else None
            if geometry:
                yield geometry
    elif data_type == "Feature":
        geometry = data.get("geometry")
        if geometry:
            yield geometry
    elif data_type in _GEOMETRY_TYPES:
        yield data


def geometry_type_counts(data: dict[str, Any]) -> dict[str, int]:
    counts: Counter[str] = Counter()

    def collect(geometry: dict[str, Any] | None):
        if not isinstance(geometry, dict):
            return
        geom_type = geometry.get("type")
        if geom_type == "GeometryCollection":
            for child in geometry.get("geometries") or []:
                collect(child)
        elif geom_type:
            counts[str(geom_type)] += 1

    for geometry in _iter_geometries(data):
        collect(geometry)
    return dict(counts)


def collect_positions(data: dict[str, Any]) -> list[list[float]]:
    positions: list[list[float]] = []
    for geometry in _iter_geometries(data):
        positions.extend([list(pos[:2]) for pos in _walk_positions(geometry)])
    return positions


def bounds_from_positions(positions: list[list[float]]) -> dict[str, float]:
    if not positions:
        return {}
    xs = [float(pos[0]) for pos in positions]
    ys = [float(pos[1]) for pos in positions]
    return {"west": min(xs), "south": min(ys), "east": max(xs), "north": max(ys)}


def _all_wgs84_positions(positions: list[list[float]]) -> bool:
    return bool(positions) and all(-180 <= float(x) <= 180 and -90 <= float(y) <= 90 for x, y in positions)


def _looks_like_senegal_utm(positions: list[list[float]]) -> bool:
    if not positions:
        return False
    bounds = bounds_from_positions(positions)
    return (
        SENEGAL_UTM_BOUNDS["min_x"] <= bounds["west"] <= SENEGAL_UTM_BOUNDS["max_x"]
        and SENEGAL_UTM_BOUNDS["min_x"] <= bounds["east"] <= SENEGAL_UTM_BOUNDS["max_x"]
        and SENEGAL_UTM_BOUNDS["min_y"] <= bounds["south"] <= SENEGAL_UTM_BOUNDS["max_y"]
        and SENEGAL_UTM_BOUNDS["min_y"] <= bounds["north"] <= SENEGAL_UTM_BOUNDS["max_y"]
    )


def _looks_like_web_mercator(positions: list[list[float]]) -> bool:
    if not positions or _all_wgs84_positions(positions):
        return False
    return all(abs(float(x)) <= WEB_MERCATOR_LIMIT and abs(float(y)) <= WEB_MERCATOR_LIMIT for x, y in positions)


def _parse_srid_candidate(candidate: Any) -> int | None:
    if candidate in (None, ""):
        return None
    if isinstance(candidate, int):
        return candidate
    if isinstance(candidate, dict):
        candidate = candidate.get("properties", {}).get("name") or candidate.get("name")
    value = str(candidate or "").strip()
    if not value:
        return None
    if value.upper().startswith("EPSG:") and value.split(":")[-1].strip().isdigit():
        return int(value.split(":")[-1].strip())
    match = re.search(r"EPSG[:/\s]+(?::)?(\d+)", value, flags=re.IGNORECASE)
    if match:
        return int(match.group(1))
    if value.isdigit():
        return int(value)
    return None


def extract_geojson_srid(data: dict[str, Any], metadata: dict[str, Any] | None = None, source_crs: Any | None = None) -> tuple[int | None, str]:
    metadata = metadata or {}
    candidates = [
        (source_crs, "admin"),
        (metadata.get("source_crs"), "metadata"),
        (metadata.get("source_srid"), "metadata"),
        (metadata.get("projection"), "metadata"),
        (data.get("crs") if isinstance(data, dict) else None, "geojson"),
    ]

    for candidate, origin in candidates:
        srid = _parse_srid_candidate(candidate)
        if srid:
            return srid, origin
    return None, "missing"


def infer_source_srid(data: dict[str, Any], metadata: dict[str, Any] | None = None, source_crs: Any | None = None) -> tuple[int, str]:
    explicit_srid, origin = extract_geojson_srid(data, metadata, source_crs=source_crs)
    if explicit_srid:
        return explicit_srid, origin

    positions = collect_positions(data)
    if not positions or _all_wgs84_positions(positions):
        return WGS84_SRID, "wgs84_coordinates"

    raise ValidationError("CRS source requis : les coordonnées GeoJSON semblent projetées et ne peuvent pas être supposées en EPSG:4326.")

def _transform_position(position: Any, transformer: Transformer | None) -> Any:
    if not _is_position(position):
        return position
    x, y = float(position[0]), float(position[1])
    rest = list(position[2:]) if isinstance(position, (list, tuple)) else []
    if transformer:
        x, y = transformer.transform(x, y)
    return [x, y, *rest]


def _transform_coords(coords: Any, depth: int, transformer: Transformer | None) -> Any:
    if depth == 0:
        return _transform_position(coords, transformer)
    if not isinstance(coords, list):
        return coords
    return [_transform_coords(item, depth - 1, transformer) for item in coords]


def _transform_geometry(geometry: dict[str, Any], transformer: Transformer | None) -> dict[str, Any]:
    if not isinstance(geometry, dict):
        return geometry
    geometry = copy.deepcopy(geometry)
    geom_type = geometry.get("type")
    depths = {
        "Point": 0,
        "MultiPoint": 1,
        "LineString": 1,
        "MultiLineString": 2,
        "Polygon": 2,
        "MultiPolygon": 3,
    }
    if geom_type in depths:
        geometry["coordinates"] = _transform_coords(geometry.get("coordinates"), depths[geom_type], transformer)
    elif geom_type == "GeometryCollection":
        geometry["geometries"] = [_transform_geometry(child, transformer) for child in geometry.get("geometries") or []]
    return geometry


def as_feature_collection(data: dict[str, Any]) -> dict[str, Any]:
    data_type = data.get("type") if isinstance(data, dict) else None
    if data_type == "FeatureCollection":
        features = data.get("features") if isinstance(data.get("features"), list) else []
        return {**data, "type": "FeatureCollection", "features": features}
    if data_type == "Feature":
        return {"type": "FeatureCollection", "features": [data]}
    if data_type in _GEOMETRY_TYPES:
        return {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": data, "properties": {}}]}
    raise ValidationError("Le GeoJSON doit être une FeatureCollection, un Feature ou une géométrie GeoJSON.")


def normalize_geojson_for_leaflet(data: dict[str, Any], metadata: dict[str, Any] | None = None, source_crs: Any | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    """Retourne toujours une FeatureCollection WGS84 exploitable par Leaflet."""
    if not isinstance(data, dict):
        raise ValidationError("Le GeoJSON doit être un objet JSON.")

    source_srid, crs_source = infer_source_srid(data, metadata, source_crs=source_crs)
    if source_srid not in SUPPORTED_SOURCE_SRIDS:
        raise ValidationError(f"CRS GeoJSON non supporté pour l'import automatique : EPSG:{source_srid}.")
    transformer = None if source_srid == WGS84_SRID else _transformer(source_srid, WGS84_SRID)
    feature_collection = as_feature_collection(data)
    normalized_features = []

    for index, feature in enumerate(feature_collection.get("features") or []):
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValidationError(f"L'objet GeoJSON #{index + 1} n'est pas un Feature valide.")
        geometry = feature.get("geometry")
        if not geometry:
            raise ValidationError(f"Géométrie manquante sur l'objet #{index + 1}.")
        normalized_features.append({
            **feature,
            "geometry": _transform_geometry(geometry, transformer),
            "properties": feature.get("properties") if isinstance(feature.get("properties"), dict) else {},
        })

    normalized = {
        **{key: value for key, value in feature_collection.items() if key not in {"features", "crs"}},
        "type": "FeatureCollection",
        "features": normalized_features,
    }

    positions = collect_positions(normalized)
    if positions and not _all_wgs84_positions(positions):
        raise ValidationError("Les coordonnées GeoJSON ne peuvent pas être converties en longitude/latitude WGS84 valides.")

    metadata_patch = {
        "feature_count": len(normalized_features),
        "geometry_types": geometry_type_counts(normalized),
        "source_crs": f"EPSG:{source_srid}",
        "detected_crs": f"EPSG:{source_srid}",
        "display_crs": "EPSG:4326",
        "served_crs": "EPSG:4326",
        "crs_source": crs_source,
        "bounds_wgs84": bounds_from_positions(positions),
        "attribute_fields": summarize_geojson_attributes(normalized_features),
    }
    return normalized, metadata_patch




def _normalise_property_value(value: Any) -> tuple[str, str]:
    if value is None:
        return "__null__", "Non renseigné"
    if isinstance(value, bool):
        return ("true" if value else "false"), ("Oui" if value else "Non")
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        label = str(value)
        return label, label
    if isinstance(value, (list, dict)):
        label = str(value)[:120]
        return label, label
    label = str(value).strip()
    if not label:
        return "__empty__", "Non renseigné"
    return label[:200], label[:120]


def _property_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return "number"
    if isinstance(value, str):
        return "text"
    return "complex"


def summarize_geojson_attributes(features: list[dict[str, Any]], max_fields: int = 60, max_values: int = 30, sample_size: int = 5000) -> list[dict[str, Any]]:
    """Résume les propriétés attributaires utiles pour une symbologie catégorisée.

    Les champs à cardinalité élevée restent visibles, mais ne sont pas marqués comme
    pertinents pour éviter de proposer par défaut des identifiants ou libellés uniques.
    """
    field_stats: dict[str, dict[str, Any]] = {}
    for feature in (features or [])[:sample_size]:
        props = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            continue
        for key, raw_value in props.items():
            name = str(key or "").strip()
            if not name or len(name) > 120:
                continue
            stats = field_stats.setdefault(name, {"count": 0, "types": Counter(), "values": Counter(), "labels": {}})
            stats["count"] += 1
            stats["types"][_property_type(raw_value)] += 1
            value_key, label = _normalise_property_value(raw_value)
            stats["values"][value_key] += 1
            stats["labels"].setdefault(value_key, label)

    fields = []
    for name, stats in field_stats.items():
        values_counter: Counter[str] = stats["values"]
        values = [
            {"value": value, "label": stats["labels"].get(value, value), "count": count}
            for value, count in values_counter.most_common(max_values)
        ]
        unique_count = len(values_counter)
        present_count = int(stats["count"])
        missing_count = max(0, len(features or []) - present_count)
        type_counts = dict(stats["types"])
        dominant_type = max(type_counts.items(), key=lambda item: item[1])[0] if type_counts else "unknown"
        # Pertinent si le champ a plusieurs valeurs, mais pas une valeur par feature.
        suitable = 1 < unique_count <= max_values and present_count >= 1
        fields.append({
            "name": name,
            "label": name.replace("_", " ").strip().capitalize(),
            "type": dominant_type,
            "count": present_count,
            "missing_count": missing_count,
            "unique_count": unique_count,
            "values": values,
            "truncated": unique_count > max_values,
            "suitable": suitable,
        })

    fields.sort(key=lambda field: (not field["suitable"], field["unique_count"], field["name"].lower()))
    return fields[:max_fields]


def parse_wgs84_bbox(value: str | None) -> tuple[float, float, float, float] | None:
    if not value:
        return None
    try:
        west, south, east, north = [float(item) for item in str(value).split(",")]
    except Exception:
        return None
    if west >= east or south >= north:
        return None
    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
        return None
    return west, south, east, north


def _geometry_bounds(geometry: dict[str, Any]) -> dict[str, float]:
    return bounds_from_positions(list(_walk_positions(geometry)))


def _bounds_intersects(bounds: dict[str, float], bbox: tuple[float, float, float, float]) -> bool:
    if not bounds:
        return False
    west, south, east, north = bbox
    return not (bounds["east"] < west or bounds["west"] > east or bounds["north"] < south or bounds["south"] > north)


def filter_feature_collection(data: dict[str, Any], bbox: tuple[float, float, float, float] | None = None, limit: int | None = None) -> dict[str, Any]:
    if data.get("type") != "FeatureCollection":
        data = as_feature_collection(data)
    features = data.get("features") if isinstance(data.get("features"), list) else []
    if bbox:
        features = [feature for feature in features if _bounds_intersects(_geometry_bounds(feature.get("geometry") or {}), bbox)]
    if limit and limit > 0:
        features = features[:limit]
    result = {**data, "features": features}
    result["metadata"] = {
        **(data.get("metadata") if isinstance(data.get("metadata"), dict) else {}),
        "count": len(features),
        "geometry_types": geometry_type_counts(result),
        "bbox_filtered": bool(bbox),
    }
    return result
