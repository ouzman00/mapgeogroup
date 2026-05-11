from __future__ import annotations

import ipaddress
import json
import socket
import sqlite3
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry
from rest_framework.exceptions import ValidationError

from config.file_validation import (
    validate_image_file,
    validate_mbtiles_sqlite,
    validate_office_or_common_file,
    validate_text_decodable,
    validate_uploaded_file_basics,
)

from .geojson_utils import normalize_geojson_for_leaflet
from .models import ClientMapLayer
from .raster_processing import build_pending_raster_metadata

try:
    from PIL import Image
except Exception:
    Image = None

SUPPORTED_IMPORT_LAYER_TYPES = {ClientMapLayer.LAYER_GEOJSON, ClientMapLayer.LAYER_WMS, ClientMapLayer.LAYER_WFS}
SUPPORTED_IMPORT_FORMATS = {ClientMapLayer.FORMAT_WMS, ClientMapLayer.FORMAT_WFS, ClientMapLayer.FORMAT_POSTGIS}
SUPPORTED_IMPORT_MESSAGE = "Sources de données supportées : PostGIS, WMS ou WFS uniquement."


def _normalise_source_kind(value):
    return str(value or "").strip().lower()

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


def _size(name, default):
    return int(getattr(settings, name, default))


def _ext(file):
    return Path(file.name or "").suffix.lower()


def parse_json_object(value, field_name="value"):
    if value in (None, "", {}):
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            raise ValidationError({field_name: "JSON invalide."})
    if not isinstance(value, dict):
        raise ValidationError({field_name: "La valeur doit être un objet JSON."})
    return value


def validate_bounds(value, required=False):
    value = parse_json_object(value, "bounds")
    if not value:
        if required:
            raise ValidationError("Les bounds sont obligatoires pour ce type de couche.")
        return {}
    try:
        south, west, north, east = float(value["south"]), float(value["west"]), float(value["north"]), float(value["east"])
    except Exception:
        raise ValidationError("Bounds invalides : fournir south, west, north et east numériques.")
    if south >= north or west >= east or not (-90 <= south <= 90 and -90 <= north <= 90) or not (-180 <= west <= 180 and -180 <= east <= 180):
        raise ValidationError("Bounds géographiques invalides.")
    return {"south": south, "west": west, "north": north, "east": east}


def _validate_public_url(value, label="URL"):
    url = str(value or "").strip()
    if not url:
        raise ValidationError(f"{label} obligatoire.")
    parsed = urlparse(url.replace("{z}", "0").replace("{x}", "0").replace("{y}", "0"))
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValidationError(f"{label} invalide : utiliser une URL HTTP(S).")
    allowed_hosts = {host.lower() for host in getattr(settings, "EXTERNAL_MAP_PROXY_ALLOWED_HOSTS", [])}
    hostname = parsed.hostname.lower()
    # En production, toute source externe WMS/WFS/XYZ doit être explicitement
    # autorisée. Cela évite de transformer le backend en proxy HTTP général.
    if not allowed_hosts and not getattr(settings, "DEBUG", False):
        raise ValidationError(f"{label} non autorisée : configurer EXTERNAL_MAP_PROXY_ALLOWED_HOSTS en production.")
    if allowed_hosts and hostname not in allowed_hosts:
        raise ValidationError(f"{label} non autorisée : hôte absent de l’allowlist de production.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as exc:
        raise ValidationError(f"{label} invalide : hôte introuvable.") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            raise ValidationError(f"{label} non autorisée : adresse privée ou locale.")
    return url


def _validate_configured_geoserver_url(url, label="URL WMS GeoServer"):
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValidationError(f"{label} invalide : utiliser une URL HTTP(S).")
    return str(url or "").strip()


def _validate_tile_template(tile_url):
    url = _validate_public_url(tile_url, "Template de tuiles")
    missing = [token for token in ("{z}", "{x}", "{y}") if token not in url]
    if missing:
        raise ValidationError(f"Le template de tuiles doit contenir {', '.join(missing)}.")
    return url


def validate_geojson_upload(file, source_crs=None):
    max_size = _size("MAX_VECTOR_UPLOAD_SIZE", getattr(settings, "MAX_GEOJSON_UPLOAD_SIZE", 20 * 1024 * 1024))
    validate_uploaded_file_basics(
        file,
        allowed_extensions={".geojson", ".json"},
        max_size=max_size,
        label="GeoJSON",
    )
    try:
        data = json.loads(validate_text_decodable(file, label="GeoJSON"))
    except json.JSONDecodeError:
        raise ValidationError("JSON invalide.")
    if not isinstance(data, dict):
        raise ValidationError("Le GeoJSON doit être un objet JSON.")
    if data.get("type") not in ALLOWED_GEOJSON_TYPES:
        raise ValidationError("Type GeoJSON invalide.")

    normalized, metadata = normalize_geojson_for_leaflet(data, source_crs=source_crs)
    max_features = _size("MAX_GEOJSON_FEATURES", 50000)
    features = normalized.get("features") or []
    if len(features) > max_features:
        raise ValidationError(f"Trop d'objets. Maximum : {max_features}.")

    for index, feature in enumerate(features):
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not geometry:
            raise ValidationError(f"Géométrie manquante sur l'objet #{index + 1}.")
        try:
            GEOSGeometry(json.dumps(geometry), srid=4326)
        except Exception as exc:
            raise ValidationError(f"Géométrie invalide #{index + 1}: {exc}") from exc

    return {"source_format": "geojson", "geojson_type": "FeatureCollection", **metadata}


def validate_image_upload(file):
    max_size = _size("MAX_IMAGE_OVERLAY_UPLOAD_SIZE", 100 * 1024 * 1024)
    suffix = validate_uploaded_file_basics(
        file,
        allowed_extensions={".png", ".jpg", ".jpeg"},
        max_size=max_size,
        label="image",
    )
    validate_image_file(file, suffix)
    meta = {"source_format": "image", "extension": suffix.lstrip(".")}
    if Image:
        try:
            file.seek(0)
            with Image.open(file) as img:
                meta.update({"width": img.width, "height": img.height, "mode": img.mode})
        except Exception as exc:
            raise ValidationError(f"Image invalide : {exc}") from exc
        finally:
            file.seek(0)
    return meta


def validate_raster_upload(file, source_crs=None, bounds=None, data_format=None):
    max_size = _size("MAX_RASTER_UPLOAD_SIZE", 500 * 1024 * 1024)
    validate_office_or_common_file(
        file,
        allowed_extensions={".tif", ".tiff"},
        max_size=max_size,
        label="GeoTIFF",
    )

    # Préparation sûre uniquement : métadonnées basiques, statuts cohérents,
    # aucun tuilage réel et jamais de tiles_ready=true ici.
    return build_pending_raster_metadata(
        file,
        data_format=data_format or ClientMapLayer.FORMAT_GEOTIFF,
        source_crs=source_crs,
        bounds=bounds,
    )

def _inspect_mbtiles_path(path):
    with sqlite3.connect(path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "tiles" not in tables:
            raise ValidationError("MBTiles sans table tiles.")
        metadata = {}
        if "metadata" in tables:
            for name, value in conn.execute("SELECT name, value FROM metadata"):
                metadata[str(name)] = value
        fmt = str(metadata.get("format") or "png").strip().lower().replace("jpg", "jpeg")
        if fmt in {"pbf", "mvt"}:
            raise ValidationError(ClientMapLayer.MBTILES_VECTOR_UNSUPPORTED_MESSAGE)
        if fmt and fmt not in {"png", "jpeg", "webp"}:
            raise ValidationError(f"Format MBTiles non supporté côté client : {fmt}.")
        return fmt, metadata


def validate_mbtiles_upload(file):
    max_size = _size("MAX_MBTILES_UPLOAD_SIZE", 1024 * 1024 * 1024)
    if (getattr(file, "size", 0) or 0) > max_size:
        raise ValidationError("MBTiles trop volumineux.")
    validate_mbtiles_sqlite(file)

    try:
        if hasattr(file, "temporary_file_path"):
            fmt, metadata = _inspect_mbtiles_path(file.temporary_file_path())
        else:
            file.seek(0)
            with tempfile.NamedTemporaryFile(suffix=".mbtiles") as tmp:
                for chunk in file.chunks() if hasattr(file, "chunks") else [file.read()]:
                    tmp.write(chunk)
                tmp.flush()
                fmt, metadata = _inspect_mbtiles_path(tmp.name)
            file.seek(0)
    except ValidationError:
        raise
    except Exception as exc:
        raise ValidationError(f"MBTiles invalide : {exc}") from exc

    return {
        "source_format": "mbtiles",
        "mbtiles_format": fmt,
        "tile_crs": "EPSG:3857",
        "tiles_ready": True,
        "metadata": metadata,
    }

def validate_layer_payload(layer_type, data_format, uploaded_file=None, bounds=None, service_url="", tile_url="", service_layers="", source_crs=None, wms_crs=None, wms_version=None, wfs_version=None, postgis_options=None):
    layer_type = _normalise_source_kind(layer_type)
    data_format = _normalise_source_kind(data_format)

    if layer_type not in SUPPORTED_IMPORT_LAYER_TYPES or data_format not in SUPPORTED_IMPORT_FORMATS:
        raise ValidationError(SUPPORTED_IMPORT_MESSAGE)

    if data_format == ClientMapLayer.FORMAT_GEOJSON:
        raise ValidationError("L’import GeoJSON local est désactivé en production. Utilisez PostGIS, WFS ou WMS GeoServer.")

    if data_format == ClientMapLayer.FORMAT_POSTGIS:
        if layer_type != ClientMapLayer.LAYER_GEOJSON:
            raise ValidationError("Une source PostGIS doit créer une couche vectorielle GeoJSON.")
    elif data_format != layer_type:
        raise ValidationError("Le type et le format doivent être cohérents : PostGIS, WMS/WMS ou WFS/WFS.")


    if data_format == ClientMapLayer.FORMAT_POSTGIS:
        if not postgis_options:
            raise ValidationError("Paramètres PostGIS obligatoires.")
        return {
            "source_format": "postgis",
            "source_origin": "postgis",
            "storage": "database",
            "source_kind": ClientMapLayer.SOURCE_DATABASE,
            "served_crs": "EPSG:4326",
            "postgis_schema": postgis_options.get("schema"),
            "postgis_table": postgis_options.get("table"),
            "postgis_geometry_column": postgis_options.get("geometry_column"),
            "postgis_id_column": postgis_options.get("id_column"),
            "postgis_host_configured": bool(postgis_options.get("host")),
            "postgis_database_configured": bool(postgis_options.get("database")),
        }

    if data_format == ClientMapLayer.FORMAT_WMS:
        configured_geoserver_url = str(getattr(settings, "GEOSERVER_WMS_URL", "") or "").strip()
        resolved_wms_url = str(service_url or configured_geoserver_url).strip()
        if service_url:
            _validate_public_url(resolved_wms_url, "URL WMS GeoServer")
        else:
            _validate_configured_geoserver_url(resolved_wms_url, "URL WMS GeoServer")
        if not str(service_layers or "").strip():
            raise ValidationError("Nom de couche WMS GeoServer obligatoire.")
        meta = {"source_format": data_format, "service_url_configured": True, "service_layers_configured": True, "wms_provider": "geoserver"}
        meta["wms_crs"] = str(wms_crs or "EPSG:3857").strip().upper()
        meta["wms_version"] = str(wms_version or "1.3.0").strip()
        return meta

    if data_format == ClientMapLayer.FORMAT_WFS:
        _validate_public_url(service_url, "URL WFS")
        if not str(service_layers or "").strip():
            raise ValidationError("Nom de couche WFS obligatoire.")
        return {
            "source_format": data_format,
            "service_url_configured": True,
            "service_layers_configured": True,
            "wfs_version": str(wfs_version or "2.0.0").strip(),
            "served_crs": "EPSG:4326",
        }

    raise ValidationError(SUPPORTED_IMPORT_MESSAGE)
