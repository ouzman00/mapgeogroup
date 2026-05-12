from __future__ import annotations

import csv
import io
import json
from decimal import Decimal, ROUND_HALF_UP
from math import isfinite
from typing import Iterable

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

try:
    from django.contrib.gis.geos import GEOSGeometry, Point
except Exception:  # pragma: no cover - permet une erreur explicite si les libs GIS manquent au runtime
    GEOSGeometry = None
    Point = None

from organizations.models import Organization, OrganizationMembership

from .models import Parcel, ParcelGeometryVersion
from .status_utils import normalize_parcel_status

User = get_user_model()

STATUS_PROGRESS_MAP = {
    "planned": 15, "surveying": 45, "processing": 70, "draft": 55,
    "ready": 90, "completed": 100, "disputed": 25, "to_verify": 80,
}

PROJECTED_SRID = 32628
PROJECTED_CRS_LABEL = "EPSG:32628"
WGS84_SRID = 4326


def _looks_like_wgs84_degrees(x, y) -> bool:
    """Retourne True si un point ressemble à des degrés GPS WGS84.

    L'application stocke et échange les géométries en EPSG:32628, donc en mètres.
    Des coordonnées de type [2.35, 48.85] ou [-17.4, 14.7] sont presque
    certainement des longitudes/latitudes et doivent être rejetées au lieu
    d'être sauvegardées silencieusement comme des mètres.
    """
    return -180 <= float(x) <= 180 and -90 <= float(y) <= 90

GEOJSON_GEOMETRY_TYPES = {
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
}


# ---------------------------------------------------------------------------
# Helpers métier
# ---------------------------------------------------------------------------


def get_parcel_progress(parcel):
    prefetched_events = getattr(parcel, "_prefetched_objects_cache", {}).get("timeline_events")
    if prefetched_events is not None:
        last_event = None
        for event in prefetched_events:
            if last_event is None or (event.event_date, event.id or 0) > (last_event.event_date, last_event.id or 0):
                last_event = event
    else:
        last_event = parcel.timeline_events.order_by("-event_date", "-id").first()
    if last_event and last_event.progress is not None:
        return max(0, min(100, int(last_event.progress)))
    return STATUS_PROGRESS_MAP.get(parcel.status, 0)


def _to_decimal(value, default=None):
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value).replace(" ", "").replace(",", "."))
    except Exception:
        return default


def _sanitize_geojson_text(value: str) -> str:
    """Nettoie un JSON copié depuis l'UI sans transformer la géométrie.

    Certains affichages français insèrent des espaces insécables ou fines entre
    les milliers (ex. 287 802). JSON ne les accepte pas dans les nombres.
    """
    text = str(value or "").strip().lstrip("\ufeff")
    for sep in ("\u00a0", "\u202f"):
        text = text.replace(sep, "")
    return text


# ---------------------------------------------------------------------------
# Normalisation GeoJSON toutes géométries
# ---------------------------------------------------------------------------


def _is_position(value) -> bool:
    if isinstance(value, dict):
        has_lon = any(key in value for key in ("lon", "lng", "longitude", "x", "easting", "east"))
        has_lat = any(key in value for key in ("lat", "latitude", "y", "northing", "north"))
        return has_lon and has_lat
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and not isinstance(value[0], (list, tuple, dict))
        and not isinstance(value[1], (list, tuple, dict))
    )


def _normalize_position(point, label="point"):
    """Normalise une position projetée en mètres [x, y].

    Le projet travaille en EPSG:32628 (UTM zone 28N), donc les coordonnées
    attendues dans l'API sont des mètres, pas des degrés. On accepte aussi des
    dictionnaires {x, y} et, pour compatibilité CSV, {easting, northing}.
    """
    if not _is_position(point):
        raise serializers.ValidationError({"geometry": f"Coordonnée invalide pour {label}."})
    try:
        if isinstance(point, dict):
            raw_x = point.get("x", point.get("easting", point.get("east", point.get("lon", point.get("lng", point.get("longitude"))))))
            raw_y = point.get("y", point.get("northing", point.get("north", point.get("lat", point.get("latitude")))))
            x = float(raw_x)
            y = float(raw_y)
        else:
            x = float(point[0])
            y = float(point[1])
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError({"geometry": f"Coordonnées non numériques pour {label}."}) from exc

    if not (isfinite(x) and isfinite(y)):
        raise serializers.ValidationError({"geometry": f"Coordonnées projetées non finies pour {label}."})

    if _looks_like_wgs84_degrees(x, y):
        raise serializers.ValidationError({
            "geometry": (
                f"Les coordonnées de {label} ressemblent à des degrés GPS WGS84 "
                "(longitude/latitude). L'API attend des coordonnées projetées "
                "en mètres EPSG:32628 [x, y]. Transformez d'abord les données "
                "ou indiquez explicitement une source WGS84 dans l'import frontend."
            )
        })

    if not (abs(x) < 10_000_000 and abs(y) < 10_000_000):
        raise serializers.ValidationError({"geometry": f"Coordonnées projetées hors limites pour {label}."})

    return [x, y]


def _normalize_point(coordinates):
    return _normalize_position(coordinates, "Point")


def _normalize_linestring(coordinates):
    if not isinstance(coordinates, (list, tuple)):
        raise serializers.ValidationError({"geometry": "Une LineString doit contenir une liste de points."})
    line = [_normalize_position(point, f"point {index + 1}") for index, point in enumerate(coordinates)]
    if len(line) < 2:
        raise serializers.ValidationError({"geometry": "Une ligne doit contenir au moins 2 points."})
    return line


def _normalize_ring(raw_ring):
    ring = [_normalize_position(point, f"point {index + 1}") for index, point in enumerate(raw_ring or [])]
    if len(ring) < 3:
        raise serializers.ValidationError({"geometry": "Un polygone doit contenir au moins 3 sommets."})
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    if len(ring) < 4:
        raise serializers.ValidationError({"geometry": "Le polygone doit être fermé."})
    return ring


def _looks_like_ring(value) -> bool:
    return isinstance(value, (list, tuple)) and bool(value) and all(_is_position(point) for point in value)


def _looks_like_polygon(value) -> bool:
    return isinstance(value, (list, tuple)) and bool(value) and all(_looks_like_ring(ring) for ring in value)


def _normalize_polygon(coordinates):
    if _looks_like_ring(coordinates):
        # Tolérance : l'utilisateur/frontend a envoyé directement la liste des points
        # au lieu de [[points]]. On la transforme en polygone GeoJSON valide.
        coordinates = [coordinates]
    if not isinstance(coordinates, (list, tuple)) or not coordinates:
        raise serializers.ValidationError({"geometry": "Un Polygon doit contenir au moins un anneau."})
    return [_normalize_ring(ring) for ring in coordinates]


def _normalize_multipolygon(coordinates):
    if _looks_like_polygon(coordinates):
        # Tolérance : l'utilisateur/frontend a envoyé un Polygon sous type MultiPolygon.
        coordinates = [coordinates]
    if not isinstance(coordinates, (list, tuple)) or not coordinates:
        raise serializers.ValidationError({"geometry": "Un MultiPolygon doit contenir au moins un polygone."})
    return [_normalize_polygon(polygon) for polygon in coordinates]


def _infer_geometry_from_coordinates(coordinates):
    """Infère Polygon/MultiPolygon depuis un bloc coordinates sans type."""
    if _looks_like_ring(coordinates):
        return {"type": "Polygon", "coordinates": [coordinates]}
    if _looks_like_polygon(coordinates):
        return {"type": "Polygon", "coordinates": coordinates}
    if isinstance(coordinates, (list, tuple)) and coordinates and all(_looks_like_polygon(polygon) for polygon in coordinates):
        return {"type": "MultiPolygon", "coordinates": coordinates}
    return None


def _geometry_from_feature(geometry):
    gtype = geometry.get("type")

    if gtype == "Feature":
        extracted = geometry.get("geometry")
        if extracted:
            return extracted

        # Tolérance UX/API : certains collages mettent coordinates au niveau de
        # la Feature au lieu de geometry.coordinates. On infère la géométrie.
        inferred = _infer_geometry_from_coordinates(geometry.get("coordinates"))
        if inferred:
            return inferred

        raise serializers.ValidationError({"geometry": "La Feature GeoJSON ne contient pas de géométrie."})

    if gtype == "FeatureCollection":
        features = geometry.get("features") or []
        geometries = []
        for index, feature in enumerate(features):
            if not isinstance(feature, dict):
                raise serializers.ValidationError({"geometry": f"Feature invalide à la position {index + 1}."})
            feature_geometry = _geometry_from_feature(feature) if feature.get("type") == "Feature" else feature.get("geometry")
            if feature_geometry:
                geometries.append(feature_geometry)
        if not geometries:
            raise serializers.ValidationError({"geometry": "La FeatureCollection ne contient aucune géométrie."})
        if len(geometries) == 1:
            return geometries[0]
        return {"type": "GeometryCollection", "geometries": geometries}

    if not gtype and geometry.get("geometry"):
        return geometry["geometry"]

    if (not gtype or gtype not in GEOJSON_GEOMETRY_TYPES) and geometry.get("coordinates") is not None:
        inferred = _infer_geometry_from_coordinates(geometry.get("coordinates"))
        if inferred:
            return inferred

    return geometry


def _geometry_from_raw_coordinates(value):
    """Accepte quelques formats simples saisis à la main.

    - [lon, lat] -> Point
    - [[lon, lat], [lon, lat], ...] fermé et >= 4 -> Polygon
    - [[lon, lat], [lon, lat], ...] non fermé -> LineString
    """
    if _is_position(value):
        return {"type": "Point", "coordinates": value}
    if _looks_like_ring(value):
        normalized_line = [_normalize_position(point, f"point {index + 1}") for index, point in enumerate(value)]
        if len(normalized_line) >= 4 and normalized_line[0] == normalized_line[-1]:
            return {"type": "Polygon", "coordinates": [normalized_line]}
        if len(normalized_line) >= 3:
            # Ancien comportement attendu dans ton formulaire de parcelle : une liste de
            # sommets doit devenir un polygone. On ferme automatiquement l'anneau.
            return {"type": "Polygon", "coordinates": [normalized_line]}
        return {"type": "LineString", "coordinates": normalized_line}
    raise serializers.ValidationError({"geometry": "Le champ geometry doit être un objet GeoJSON valide."})


def _validate_with_shapely(geometry):
    try:
        from shapely.geometry import shape  # type: ignore
        from shapely.validation import explain_validity  # type: ignore
    except Exception:
        return geometry

    try:
        shaped = shape(geometry)
    except Exception as exc:
        raise serializers.ValidationError({"geometry": "La géométrie GeoJSON ne peut pas être interprétée."}) from exc

    if shaped.is_empty:
        raise serializers.ValidationError({"geometry": "La géométrie ne doit pas être vide."})
    if not shaped.is_valid:
        raise serializers.ValidationError({"geometry": f"Géométrie invalide: {explain_validity(shaped)}"})
    return geometry


def normalize_geojson(geometry):
    """Normalise un GeoJSON en acceptant toutes les géométries usuelles.

    Types acceptés : Point, MultiPoint, LineString, MultiLineString, Polygon,
    MultiPolygon, GeometryCollection, Feature et FeatureCollection.
    """
    if geometry in (None, "", {}):
        return None

    if isinstance(geometry, str):
        try:
            geometry = json.loads(_sanitize_geojson_text(geometry))
        except json.JSONDecodeError as exc:
            raise serializers.ValidationError({"geometry": "Le GeoJSON fourni est invalide. Vérifiez le JSON et retirez les espaces de milliers dans les nombres."}) from exc

    if isinstance(geometry, (list, tuple)):
        geometry = _geometry_from_raw_coordinates(geometry)

    if not isinstance(geometry, dict):
        raise serializers.ValidationError({"geometry": "Le champ geometry doit être un objet GeoJSON."})

    geometry = _geometry_from_feature(geometry)
    if not isinstance(geometry, dict):
        raise serializers.ValidationError({"geometry": "La géométrie GeoJSON est invalide."})

    gtype = geometry.get("type")
    if gtype not in GEOJSON_GEOMETRY_TYPES:
        valid = ", ".join(sorted(GEOJSON_GEOMETRY_TYPES))
        raise serializers.ValidationError({"geometry": f"Type GeoJSON non supporté. Types acceptés : {valid}."})

    if gtype == "Point":
        normalized = {"type": "Point", "coordinates": _normalize_point(geometry.get("coordinates"))}
    elif gtype == "MultiPoint":
        coordinates = geometry.get("coordinates") or []
        normalized = {"type": "MultiPoint", "coordinates": [_normalize_point(point) for point in coordinates]}
        if not normalized["coordinates"]:
            raise serializers.ValidationError({"geometry": "Un MultiPoint doit contenir au moins un point."})
    elif gtype == "LineString":
        normalized = {"type": "LineString", "coordinates": _normalize_linestring(geometry.get("coordinates"))}
    elif gtype == "MultiLineString":
        coordinates = geometry.get("coordinates") or []
        normalized = {"type": "MultiLineString", "coordinates": [_normalize_linestring(line) for line in coordinates]}
        if not normalized["coordinates"]:
            raise serializers.ValidationError({"geometry": "Une MultiLineString doit contenir au moins une ligne."})
    elif gtype == "Polygon":
        normalized = {"type": "Polygon", "coordinates": _normalize_polygon(geometry.get("coordinates"))}
    elif gtype == "MultiPolygon":
        normalized = {"type": "MultiPolygon", "coordinates": _normalize_multipolygon(geometry.get("coordinates"))}
    else:
        geometries = geometry.get("geometries") or []
        if not geometries:
            raise serializers.ValidationError({"geometry": "Une GeometryCollection doit contenir au moins une géométrie."})
        normalized = {
            "type": "GeometryCollection",
            "geometries": [normalize_geojson(item) for item in geometries if item not in (None, {}, "")],
        }
        if not normalized["geometries"]:
            raise serializers.ValidationError({"geometry": "La GeometryCollection ne contient aucune géométrie valide."})

    # Validation topologique : si Shapely est disponible, on refuse les géométries
    # vides, invalides ou auto-intersectées avant d'écrire dans PostGIS.
    return _validate_with_shapely(normalized)


def to_multipolygon_geojson(geometry):
    """Compatibilité ancienne API.

    L'ancien code forçait tout en MultiPolygon. Maintenant l'application accepte
    toutes les géométries, donc cette fonction renvoie simplement le GeoJSON normalisé.
    """
    return normalize_geojson(geometry)


def _wkt_num(value):
    number = float(value)
    return (f"{number:.12f}".rstrip("0").rstrip("."))


def _wkt_pos(position):
    return f"{_wkt_num(position[0])} {_wkt_num(position[1])}"


def _wkt_linestring(coordinates):
    return ", ".join(_wkt_pos(point) for point in coordinates)


def _geojson_to_wkt(geometry):
    """Convertit un GeoJSON normalisé en WKT sans dépendre de Shapely."""
    gtype = geometry.get("type")

    if gtype == "Point":
        return f"POINT({_wkt_pos(geometry['coordinates'])})"

    if gtype == "MultiPoint":
        points = ", ".join(f"({_wkt_pos(point)})" for point in geometry["coordinates"])
        return f"MULTIPOINT({points})"

    if gtype == "LineString":
        return f"LINESTRING({_wkt_linestring(geometry['coordinates'])})"

    if gtype == "MultiLineString":
        lines = ", ".join(
            f"({_wkt_linestring(line)})"
            for line in geometry["coordinates"]
        )
        return f"MULTILINESTRING({lines})"

    if gtype == "Polygon":
        rings = ", ".join(
            f"({_wkt_linestring(ring)})"
            for ring in geometry["coordinates"]
        )
        return f"POLYGON({rings})"

    if gtype == "MultiPolygon":
        polygons = []
        for polygon in geometry["coordinates"]:
            rings = ", ".join(
                f"({_wkt_linestring(ring)})"
                for ring in polygon
            )
            polygons.append(f"({rings})")
        return f"MULTIPOLYGON({', '.join(polygons)})"

    if gtype == "GeometryCollection":
        parts = [_geojson_to_wkt(item) for item in geometry.get("geometries", [])]
        return f"GEOMETRYCOLLECTION({', '.join(parts)})"

    raise serializers.ValidationError({
        "geometry": f"Type GeoJSON non supporté pour conversion WKT : {gtype}."
    })


def geometry_to_geos(geometry):
    """Convertit tout GeoJSON supporté en GEOSGeometry EPSG:32628.

    Les coordonnées applicatives sont en mètres [x, y] dans EPSG:32628.
    On évite les calculs géodésiques en degrés et on conserve le SRID projeté.
    """
    normalized = normalize_geojson(geometry)
    if not normalized:
        return None

    if GEOSGeometry is None:
        raise serializers.ValidationError({
            "geometry": "GeoDjango nécessite les bibliothèques système GEOS/GDAL/PROJ pour utiliser PostGIS."
        })

    try:
        wkt = _geojson_to_wkt(normalized)
        geom = GEOSGeometry(wkt, srid=PROJECTED_SRID)
        geom.srid = PROJECTED_SRID
        if geom.empty:
            raise serializers.ValidationError({"geometry": "La géométrie ne doit pas être vide."})
        return geom
    except serializers.ValidationError:
        raise
    except Exception as exc:
        raise serializers.ValidationError({
            "geometry": [
                "La géométrie GeoJSON ne peut pas être interprétée.",
                f"Détail technique: {exc}",
                f"GeoJSON reçu: {json.dumps(normalized, ensure_ascii=False)[:800]}",
            ]
        }) from exc
def point_from_lon_lat(lon, lat):
    """Compatibilité historique : lon=x/easting, lat=y/northing."""
    if lon is None or lat is None:
        return None
    if Point is None:
        raise serializers.ValidationError({
            "geometry": "GeoDjango nécessite les bibliothèques système GEOS/GDAL/PROJ pour créer le centroïde PostGIS."
        })
    return Point(float(lon), float(lat), srid=PROJECTED_SRID)


def geos_to_geojson(geom):
    if not geom:
        return None
    if isinstance(geom, dict):
        return normalize_geojson(geom)
    if isinstance(geom, str):
        try:
            return normalize_geojson(json.loads(geom))
        except (json.JSONDecodeError, serializers.ValidationError):
            return None
    try:
        geom_for_output = geom
        if getattr(geom_for_output, "srid", None) and geom_for_output.srid != PROJECTED_SRID:
            geom_for_output = geom_for_output.clone()
            geom_for_output.transform(PROJECTED_SRID)
        geojson_text = geom_for_output.geojson
        geojson = json.loads(geojson_text) if isinstance(geojson_text, str) else geojson_text
        return normalize_geojson(geojson)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Calculs centroïde / surface / longueur
# ---------------------------------------------------------------------------


def _iter_positions_from_geojson(geometry):
    if not geometry:
        return
    gtype = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if gtype == "Point":
        yield coordinates
    elif gtype in {"MultiPoint", "LineString"}:
        for point in coordinates or []:
            yield point
    elif gtype == "MultiLineString":
        for line in coordinates or []:
            for point in line:
                yield point
    elif gtype == "Polygon":
        for ring in coordinates or []:
            for point in ring:
                yield point
    elif gtype == "MultiPolygon":
        for polygon in coordinates or []:
            for ring in polygon:
                for point in ring:
                    yield point
    elif gtype == "GeometryCollection":
        for item in geometry.get("geometries") or []:
            yield from _iter_positions_from_geojson(item)


def centroid_from_geometry(geometry=None, geom=None):
    if geom is not None and hasattr(geom, "centroid"):
        try:
            centroid = geom.centroid
            if centroid and not centroid.empty:
                return round(float(centroid.y), 7), round(float(centroid.x), 7)
        except Exception:
            pass

    target = geos_to_geojson(geom) or normalize_geojson(geometry)
    if not target:
        return None, None
    try:
        from shapely.geometry import shape  # type: ignore

        centroid = shape(target).centroid
        if centroid.is_empty:
            return None, None
        return round(float(centroid.y), 7), round(float(centroid.x), 7)
    except Exception:
        points = list(_iter_positions_from_geojson(target))
        if not points:
            return None, None
        lon = sum(float(p[0]) for p in points) / len(points)
        lat = sum(float(p[1]) for p in points) / len(points)
        return round(lat, 7), round(lon, 7)


def _meters_per_degree_lat(_lat):
    return 111132.92


def _meters_per_degree_lon(lat):
    from math import cos, radians

    return 111412.84 * cos(radians(lat))


def _project_lonlat_to_local_meters(lon, lat, ref_lat):
    base_lat = ref_lat if ref_lat is not None else float(lat)
    return float(lon) * _meters_per_degree_lon(base_lat), float(lat) * _meters_per_degree_lat(base_lat)


def _line_length_local(points):
    """
    Longueur plane en mètres pour coordonnées projetées EPSG:32628.
    Les points sont au format [x, y], pas [lon, lat].
    """
    clean = []
    for point in points or []:
        try:
            clean.append((float(point[0]), float(point[1])))
        except (TypeError, ValueError, IndexError):
            continue

    if len(clean) < 2:
        return 0.0

    total = 0.0
    for index in range(len(clean) - 1):
        x1, y1 = clean[index]
        x2, y2 = clean[index + 1]
        total += ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5

    return total

def _ring_area_perimeter_local(ring):
    """
    Surface/périmètre plans en mètres pour EPSG:32628.
    On n'applique aucune conversion degré -> mètre.
    """
    clean = []
    for point in ring or []:
        try:
            clean.append((float(point[0]), float(point[1])))
        except (TypeError, ValueError, IndexError):
            continue

    if len(clean) >= 2 and clean[0] == clean[-1]:
        clean = clean[:-1]

    if len(clean) < 3:
        return 0.0, _line_length_local(clean)

    closed = clean + [clean[0]]
    shoelace = 0.0
    perimeter = 0.0

    for index in range(len(clean)):
        x1, y1 = closed[index]
        x2, y2 = closed[index + 1]

        shoelace += x1 * y2 - x2 * y1

        dx = x2 - x1
        dy = y2 - y1
        perimeter += (dx ** 2 + dy ** 2) ** 0.5

    return abs(shoelace) / 2.0, perimeter

def _compute_area_perimeter_geod_geojson(geometry, geod):
    gtype = geometry.get("type")
    if gtype in {"Point", "MultiPoint"}:
        return 0.0, 0.0
    if gtype == "LineString":
        line = geometry.get("coordinates") or []
        if len(line) < 2:
            return 0.0, 0.0
        return 0.0, float(geod.line_length([p[0] for p in line], [p[1] for p in line]))
    if gtype == "MultiLineString":
        total = 0.0
        for line in geometry.get("coordinates") or []:
            if len(line) >= 2:
                total += float(geod.line_length([p[0] for p in line], [p[1] for p in line]))
        return 0.0, total
    if gtype == "Polygon":
        total_area = 0.0
        total_perimeter = 0.0
        polygon = geometry.get("coordinates") or []
        if not polygon:
            return 0.0, 0.0
        exterior, *holes = polygon
        area, perimeter = geod.polygon_area_perimeter([pt[0] for pt in exterior], [pt[1] for pt in exterior])
        total_area += abs(area)
        total_perimeter += perimeter
        for hole in holes:
            hole_area, hole_perimeter = geod.polygon_area_perimeter([pt[0] for pt in hole], [pt[1] for pt in hole])
            total_area -= abs(hole_area)
            total_perimeter += hole_perimeter
        return total_area, total_perimeter
    if gtype == "MultiPolygon":
        total_area = 0.0
        total_perimeter = 0.0
        for polygon in geometry.get("coordinates") or []:
            area, perimeter = _compute_area_perimeter_geod_geojson({"type": "Polygon", "coordinates": polygon}, geod)
            total_area += area
            total_perimeter += perimeter
        return total_area, total_perimeter
    if gtype == "GeometryCollection":
        total_area = 0.0
        total_perimeter = 0.0
        for item in geometry.get("geometries") or []:
            area, perimeter = _compute_area_perimeter_geod_geojson(item, geod)
            total_area += area
            total_perimeter += perimeter
        return total_area, total_perimeter
    return 0.0, 0.0


def _compute_area_perimeter_fallback_geojson(geometry):
    gtype = geometry.get("type")
    if gtype in {"Point", "MultiPoint"}:
        return Decimal("0.00"), Decimal("0.00")
    if gtype == "LineString":
        length = _line_length_local(geometry.get("coordinates") or [])
        return Decimal("0.00"), Decimal(str(length)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if gtype == "MultiLineString":
        length = sum(_line_length_local(line) for line in geometry.get("coordinates") or [])
        return Decimal("0.00"), Decimal(str(length)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if gtype == "Polygon":
        total_area = 0.0
        total_perimeter = 0.0
        polygon = geometry.get("coordinates") or []
        if polygon:
            exterior, *holes = polygon
            area, perimeter = _ring_area_perimeter_local(exterior)
            total_area += area
            total_perimeter += perimeter
            for hole in holes:
                hole_area, hole_perimeter = _ring_area_perimeter_local(hole)
                total_area -= hole_area
                total_perimeter += hole_perimeter
        return (
            Decimal(str(max(total_area, 0.0))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            Decimal(str(max(total_perimeter, 0.0))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        )
    if gtype == "MultiPolygon":
        total_area = 0.0
        total_perimeter = 0.0
        for polygon in geometry.get("coordinates") or []:
            area, perimeter = _compute_area_perimeter_fallback_geojson({"type": "Polygon", "coordinates": polygon})
            total_area += float(area)
            total_perimeter += float(perimeter)
        return (
            Decimal(str(max(total_area, 0.0))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            Decimal(str(max(total_perimeter, 0.0))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        )
    if gtype == "GeometryCollection":
        total_area = Decimal("0.00")
        total_perimeter = Decimal("0.00")
        for item in geometry.get("geometries") or []:
            area, perimeter = _compute_area_perimeter_fallback_geojson(item)
            total_area += area
            total_perimeter += perimeter
        return total_area, total_perimeter
    return Decimal("0.00"), Decimal("0.00")


def compute_area_perimeter_from_geometry(geometry=None, geom=None):
    """
    Calcule surface/périmètre en mètres sur EPSG:32628.

    Important :
    - On ne doit pas utiliser pyproj.Geod ici.
    - Geod attend des longitudes/latitudes en degrés.
    - Notre projet utilise des coordonnées projetées en mètres [x, y].
    """
    target_geom = geom or geometry_to_geos(geometry)

    if not target_geom:
        return None, None

    geojson = geos_to_geojson(target_geom)

    if not geojson:
        return None, None

    area, perimeter = _compute_area_perimeter_fallback_geojson(geojson)

    return area, perimeter

# ---------------------------------------------------------------------------
# Saisie texte / CSV
# ---------------------------------------------------------------------------


def polygon_from_coordinate_text(value):
    if not value:
        return None
    cleaned = value.replace("\n", ";").replace("|", ";")
    raw_parts = [part.strip() for part in cleaned.split(";") if part.strip()]
    pairs = []

    # Accepte aussi le format terrain/admin: x;y;x;y;x;y...
    # en plus des formats historiques lon,lat; lon,lat ou lon lat; lon lat.
    flat_numbers = []
    for part in raw_parts:
        if "," in part or len([piece for piece in part.split() if piece.strip()]) > 1:
            flat_numbers = []
            break
        try:
            flat_numbers.append(float(part.replace(",", ".")))
        except (TypeError, ValueError):
            flat_numbers = []
            break

    if flat_numbers:
        if len(flat_numbers) % 2 != 0:
            raise serializers.ValidationError({"coordinates_text": "Nombre impair de valeurs: format attendu x;y;x;y..."})
        for index in range(0, len(flat_numbers), 2):
            pairs.append([flat_numbers[index], flat_numbers[index + 1]])
        return {"type": "Polygon", "coordinates": [_normalize_ring(pairs)]}

    for part in raw_parts:
        pieces = [piece.strip() for piece in part.split(",") if piece.strip()]
        if len(pieces) != 2:
            pieces = [piece.strip() for piece in part.split() if piece.strip()]
        if len(pieces) != 2:
            raise serializers.ValidationError({"coordinates_text": "Format attendu: x,y; x,y; x,y ou x;y;x;y..."})
        try:
            lon = float(pieces[0].replace(",", "."))
            lat = float(pieces[1].replace(",", "."))
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError({"coordinates_text": "Les coordonnées doivent être numériques."}) from exc
        pairs.append([lon, lat])
    return {"type": "Polygon", "coordinates": [_normalize_ring(pairs)]}


def polygon_from_row_points(row):
    candidates = []
    index = 1
    while True:
        lon = row.get(f"lon{index}") or row.get(f"lng{index}") or row.get(f"x{index}")
        lat = row.get(f"lat{index}") or row.get(f"latitude{index}") or row.get(f"y{index}")
        if lon in (None, "") and lat in (None, ""):
            break
        if lon in (None, "") or lat in (None, ""):
            raise serializers.ValidationError(f"Coordonnées X/Y incomplètes pour le point {index}.")
        candidates.append([float(lon), float(lat)])
        index += 1
    if len(candidates) < 3:
        return None
    return {"type": "Polygon", "coordinates": [_normalize_ring(candidates)]}


def derive_organization_for_owner(owner):
    membership = OrganizationMembership.objects.filter(user=owner, is_active=True).select_related("organization").order_by("-is_primary", "id").first()
    if membership:
        return membership.organization
    code_seed = owner.client_code or owner.username or f"org-{owner.pk}"
    org, _created = Organization.objects.get_or_create(
        code=code_seed.upper()[:32],
        defaults={
            "name": owner.company_name or f"Client {owner.get_full_name().strip() or owner.username}",
            "organization_type": "client" if owner.role == "client" else "internal",
            "status": "active",
            "email": owner.email or None,
            "phone": owner.phone or None,
        },
    )
    OrganizationMembership.objects.get_or_create(
        organization=org,
        user=owner,
        defaults={"role": "owner" if owner.role == "client" else "manager", "is_primary": True, "is_active": True},
    )
    return org


def resolve_owner(row, default_owner=None):
    owner_id = row.get("owner_id")
    client_code = row.get("owner_client_code") or row.get("client_code")
    username = row.get("owner_username") or row.get("username")
    email = row.get("owner_email")
    if owner_id:
        owner = User.objects.filter(pk=owner_id).first()
        if owner:
            return owner
    if client_code:
        owner = User.objects.filter(client_code__iexact=client_code).first()
        if owner:
            return owner
    if username:
        owner = User.objects.filter(username__iexact=username).first()
        if owner:
            return owner
    if email:
        owner = User.objects.filter(email__iexact=email).first()
        if owner:
            return owner
    if default_owner:
        return default_owner
    raise serializers.ValidationError("Impossible de retrouver le propriétaire de la ligne CSV.")


def resolve_organization(row, owner=None, default_organization=None):
    org_id = row.get("organization_id") or row.get("org_id")
    org_code = row.get("organization_code") or row.get("org_code")
    org_name = row.get("organization") or row.get("organization_name")
    if org_id:
        organization = Organization.objects.filter(pk=org_id).first()
        if organization:
            return organization
    if org_code:
        organization = Organization.objects.filter(code__iexact=org_code).first()
        if organization:
            return organization
    if org_name:
        organization = Organization.objects.filter(name__iexact=org_name).first()
        if organization:
            return organization
    if default_organization:
        return default_organization
    if owner:
        return derive_organization_for_owner(owner)
    return None


def build_parcel_payload_from_row(row, default_owner=None, default_organization=None):
    reference = (row.get("reference") or row.get("ref") or row.get("parcel_reference") or "").strip()
    if not reference:
        raise serializers.ValidationError({"reference": "Référence de parcelle manquante."})
    owner = resolve_owner(row, default_owner=default_owner)
    organization = resolve_organization(row, owner=owner, default_organization=default_organization)
    if organization is None:
        raise serializers.ValidationError({"organization": "Organisation cliente obligatoire pour cette ligne CSV."})
    if not OrganizationMembership.objects.filter(user=owner, organization=organization, is_active=True).exists():
        raise serializers.ValidationError({
            "owner": "Le propriétaire CSV n'appartient pas à l'organisation sélectionnée."
        })
    geometry = None
    if row.get("geometry") or row.get("geometry_json"):
        geometry = normalize_geojson(row.get("geometry") or row.get("geometry_json"))
    elif row.get("coordinates") or row.get("coordinates_text") or row.get("polygon"):
        geometry = polygon_from_coordinate_text(row.get("coordinates") or row.get("coordinates_text") or row.get("polygon"))
    else:
        geometry = polygon_from_row_points(row)
    latitude = _to_decimal(row.get("y") or row.get("northing") or row.get("latitude") or row.get("lat"))
    longitude = _to_decimal(row.get("x") or row.get("easting") or row.get("longitude") or row.get("lon") or row.get("lng"))
    if geometry and (latitude is None or longitude is None):
        g_lat, g_lon = centroid_from_geometry(geometry=geometry)
        latitude = _to_decimal(g_lat)
        longitude = _to_decimal(g_lon)
    area = _to_decimal(row.get("area") or row.get("surface"))
    perimeter = _to_decimal(row.get("perimeter") or row.get("perimetre"))
    if geometry:
        geos = geometry_to_geos(geometry)
        computed_area, computed_perimeter = compute_area_perimeter_from_geometry(geom=geos)
        area = computed_area if computed_area is not None else area
        perimeter = computed_perimeter if computed_perimeter is not None else perimeter
    return {
        "reference": reference,
        "owner": owner.pk,
        "organization": organization.pk if organization else None,
        "title_number": row.get("title_number") or row.get("titre_foncier") or None,
        "parcel_number": row.get("parcel_number") or row.get("numero_parcelle") or None,
        "section": row.get("section") or None,
        "location": (row.get("location") or row.get("localisation") or row.get("address") or "Sans précision").strip(),
        "address": row.get("address") or None,
        "village": row.get("village") or None,
        "commune": row.get("commune") or None,
        "department": row.get("department") or row.get("departement") or None,
        "region": row.get("region") or None,
        "land_use": row.get("land_use") or row.get("usage") or None,
        "area": area if area is not None else Decimal("0"),
        "perimeter": perimeter if perimeter is not None else Decimal("0"),
        "status": normalize_parcel_status(row.get("status")) or "planned",
        "survey_date": row.get("survey_date") or None,
        "method": row.get("method") or None,
        "latitude": latitude,
        "longitude": longitude,
        "geometry": geometry,
        "orientation": row.get("orientation") or None,
        "access_info": row.get("access_info") or row.get("acces") or None,
        "risk_level": row.get("risk_level") or row.get("risque") or None,
        "notes": row.get("notes") or None,
    }


def _detect_csv_delimiter(content: str) -> str:
    """Détecte le délimiteur CSV via csv.Sniffer sur les 4 premières lignes non vides.

    Fallback sur ';' vs ',' si Sniffer échoue (fichiers trop courts ou uniformes).
    """
    sample_lines = [line for line in content.splitlines() if line.strip()][:4]
    sample = "\n".join(sample_lines)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        return dialect.delimiter
    except csv.Error:
        # Fallback : compte simple sur la première ligne non vide
        first = sample_lines[0] if sample_lines else ""
        return ";" if first.count(";") > first.count(",") else ","


CSV_BATCH_SIZE = 200


def parse_csv_import(
    uploaded_file,
    default_owner=None,
    default_organization=None,
    dry_run=False,
    skip_errors=False,
):
    """Importe un fichier CSV de parcelles.

    Paramètres
    ----------
    dry_run : bool
        Si True, valide sans écrire en base.
    skip_errors : bool
        Si True, importe les lignes valides et signale les erreurs sans bloquer.
        Si False (défaut, mode strict), bloque si la moindre ligne est invalide.
    """
    from .serializers import ParcelCreateUpdateSerializer

    if (getattr(uploaded_file, "size", 0) or 0) > 10 * 1024 * 1024:
        raise serializers.ValidationError("Le fichier CSV dépasse la limite de 10 Mo.")

    try:
        content = uploaded_file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        uploaded_file.seek(0)
        content = uploaded_file.read().decode("latin-1")

    if not content.strip():
        raise serializers.ValidationError("Le fichier CSV est vide.")

    delimiter = _detect_csv_delimiter(content)
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)

    # On lit les lignes via un itérateur pour éviter de charger tout en RAM d'un coup.
    # On borne néanmoins à 5 000 lignes comme avant.
    rows = []
    for i, row in enumerate(reader, start=1):
        if i > 5000:
            raise serializers.ValidationError("Le fichier CSV dépasse la limite de 5 000 lignes.")
        rows.append((i + 1, row))  # +1 car ligne 1 = en-tête

    if not rows:
        raise serializers.ValidationError("Le fichier CSV est vide ou ne contient que l'en-tête.")

    created, updated, errors, prepared = [], [], [], []

    for row_index, row in rows:
        try:
            payload = build_parcel_payload_from_row(
                row,
                default_owner=default_owner,
                default_organization=default_organization,
            )
            if default_organization and payload.get("organization") != default_organization.pk:
                raise serializers.ValidationError(
                    "La ligne CSV cible une organisation différente de l'organisation d'import autorisée."
                )
            existing_qs = Parcel.objects.filter(
                reference=payload["reference"],
                archived_at__isnull=True,
                organization_id=payload["organization"],
            )
            instance = existing_qs.first()
            if instance is not None and payload.get("geometry") and getattr(instance, "geometry_updated_at", None):
                payload = dict(payload)
                payload["expected_geometry_updated_at"] = instance.geometry_updated_at.isoformat()
            serializer = ParcelCreateUpdateSerializer(
                instance=instance,
                data=payload,
                partial=instance is not None,
            )
            serializer.is_valid(raise_exception=True)
            prepared.append((instance, serializer, payload))
        except Exception as exc:
            errors.append({
                "row": row_index,
                "reference": (
                    row.get("reference")
                    or row.get("ref")
                    or row.get("parcel_reference")
                ),
                "error": str(exc),
            })

    # Mode strict : on bloque si la moindre ligne est invalide
    if errors and not skip_errors:
        return {
            "created": [],
            "updated": [],
            "errors": errors,
            "dry_run": dry_run,
            "blocked": True,
            "detail": (
                f"Import bloqué : {len(errors)} ligne(s) en erreur sur {len(rows)}. "
                "Corrigez les erreurs ou relancez avec skip_errors=true pour ignorer les lignes invalides."
            ),
        }

    if dry_run:
        for instance, _serializer, payload in prepared:
            result = {"id": instance.id if instance else None, "reference": payload["reference"]}
            (updated if instance else created).append(result)
        return {
            "created": created,
            "updated": updated,
            "errors": errors,
            "dry_run": True,
            "blocked": False,
        }

    # Commit par batch pour limiter la taille des transactions et la mémoire
    for batch_start in range(0, len(prepared), CSV_BATCH_SIZE):
        batch = prepared[batch_start : batch_start + CSV_BATCH_SIZE]
        with transaction.atomic():
            for instance, serializer, payload in batch:
                parcel = serializer.save()
                result = {"id": parcel.id, "reference": parcel.reference}
                (updated if instance else created).append(result)

    return {
        "created": created,
        "updated": updated,
        "errors": errors,
        "dry_run": False,
        "blocked": False,
    }


def create_geometry_version_from_geom(parcel, geom, modified_by=None, reason=None):
    if not geom:
        return None
    geom_obj = geometry_to_geos(geom) if isinstance(geom, (dict, str, list, tuple)) else geom
    return ParcelGeometryVersion.objects.create(
        parcel=parcel,
        geom=geom_obj,
        geometry=geos_to_geojson(geom_obj),
        modified_by=modified_by,
        reason=reason or "snapshot",
    )


def create_geometry_version(parcel, modified_by=None, reason=None):
    return create_geometry_version_from_geom(parcel, parcel.geom, modified_by=modified_by, reason=reason)


def backfill_parcel_postgis(parcel):
    geom = parcel.geom
    if not geom and parcel.geometry:
        geom = geometry_to_geos(parcel.geometry)
    if not geom:
        return parcel
    lat, lon = centroid_from_geometry(geom=geom)
    area, perimeter = compute_area_perimeter_from_geometry(geom=geom)
    parcel.geom = geom
    parcel.geometry = geos_to_geojson(geom)
    parcel.centroid_geom = point_from_lon_lat(lon, lat) if lat is not None and lon is not None else None
    parcel.latitude = lat
    parcel.longitude = lon
    if area is not None:
        parcel.area = area
    if perimeter is not None:
        parcel.perimeter = perimeter
    if not parcel.organization_id and parcel.owner_id:
        parcel.organization = derive_organization_for_owner(parcel.owner)
    parcel.geometry_updated_at = timezone.now()
    parcel.save(update_fields=["geom", "geometry", "centroid_geom", "latitude", "longitude", "area", "perimeter", "organization", "geometry_updated_at", "updated_at"])
    return parcel
