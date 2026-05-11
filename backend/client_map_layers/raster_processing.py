from __future__ import annotations

import importlib.util
import re
from typing import Any

from rest_framework.exceptions import ValidationError

from .models import ClientMapLayer

try:
    from PIL import Image
except Exception:  # pragma: no cover - depends on optional runtime install
    Image = None

SUPPORTED_RASTER_SOURCE_CRS = {"EPSG:4326", "EPSG:32628", "EPSG:3857"}
RASTER_TILING_BACKEND_REQUIREMENT = "Installer un backend raster déclaré (rasterio/rio-cogeo/rio-tiler ou GDAL CLI dans un worker) pour générer des tuiles XYZ EPSG:3857."


def _module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except Exception:
        return False


def raster_backend_capabilities() -> dict[str, Any]:
    """Describe raster capabilities without making them implicit requirements.

    The project requirements currently declare Pillow/pyproj/shapely, but no
    raster tiling stack. This function is intentionally informational: it never
    enables tiling by itself and it never marks tiles_ready=true.
    """
    return {
        "pillow": Image is not None,
        "rasterio_declared": _module_available("rasterio"),
        "rio_cogeo_declared": _module_available("rio_cogeo"),
        "rio_tiler_declared": _module_available("rio_tiler"),
        "mercantile_declared": _module_available("mercantile"),
        "tiling_available": False,
        "tiling_backend": None,
        "note": RASTER_TILING_BACKEND_REQUIREMENT,
    }


def normalize_crs(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, int):
        value = f"EPSG:{value}"
    raw = str(value or "").strip().upper().replace(" ", "")
    if not raw:
        return None
    if raw.isdigit():
        raw = f"EPSG:{raw}"
    match = re.match(r"^EPSG:(\d+)$", raw)
    if not match:
        raise ValidationError("CRS raster invalide : utilisez un identifiant de type EPSG:4326, EPSG:32628 ou EPSG:3857.")
    normalized = f"EPSG:{match.group(1)}"
    if normalized not in SUPPORTED_RASTER_SOURCE_CRS:
        raise ValidationError(f"CRS raster non supporté pour cette préparation : {normalized}.")
    return normalized


def read_basic_raster_metadata(file) -> dict[str, Any]:
    metadata = {"width": None, "height": None, "mode": None, "nodata": None, "resolution": None}
    if not Image:
        return metadata
    try:
        file.seek(0)
        with Image.open(file) as img:
            metadata.update({"width": img.width, "height": img.height, "mode": getattr(img, "mode", None)})
    except Exception as exc:
        metadata["metadata_error"] = f"Métadonnées image basiques non lisibles avec Pillow : {exc}"
    finally:
        try:
            file.seek(0)
        except Exception:
            pass
    return metadata


def build_pending_raster_metadata(file, *, data_format: str, source_crs: Any = None, bounds: dict[str, Any] | None = None) -> dict[str, Any]:
    source_format = "cog" if str(data_format or "").lower() == ClientMapLayer.FORMAT_COG else "geotiff"
    capabilities = raster_backend_capabilities()
    basic_metadata = read_basic_raster_metadata(file)
    normalized_source_crs = normalize_crs(source_crs)

    processing_status = ClientMapLayer.STATUS_PENDING
    processing_error = ClientMapLayer.RASTER_TILING_REQUIRED_MESSAGE
    needs_crs = False

    if not normalized_source_crs:
        processing_status = ClientMapLayer.STATUS_FAILED
        processing_error = ClientMapLayer.CRS_REQUIRED_MESSAGE
        needs_crs = True

    metadata = {
        "source_format": source_format,
        "source_crs": normalized_source_crs,
        "detected_crs": None,
        "display_crs": None,
        "served_crs": None,
        "tile_crs": "EPSG:3857",
        "bounds_wgs84": bounds or None,
        "width": basic_metadata.get("width"),
        "height": basic_metadata.get("height"),
        "mode": basic_metadata.get("mode"),
        "resolution": basic_metadata.get("resolution"),
        "nodata": basic_metadata.get("nodata"),
        "requires_tiling": True,
        "tiles_ready": False,
        "needs_crs": needs_crs,
        "crs_required": needs_crs,
        "processing_status": processing_status,
        "processing_error": processing_error,
        "note": processing_error,
        "raster_processing": {
            "phase": "metadata_only",
            "metadata_reader": "pillow" if capabilities.get("pillow") else None,
            "tiling_available": False,
            "tiling_backend": None,
            "tiling_requirement": RASTER_TILING_BACKEND_REQUIREMENT,
            "heavy_processing_started": False,
        },
        "cog": {
            "claimed_format": source_format == "cog",
            "is_cog": None,
            "checked": False,
            "reason": "Validation COG indisponible sans rasterio/rio-cogeo déclaré dans le projet.",
        },
        "raster_capabilities": capabilities,
    }
    if basic_metadata.get("metadata_error"):
        metadata["metadata_error"] = basic_metadata["metadata_error"]
    return metadata
