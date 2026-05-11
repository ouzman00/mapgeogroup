from __future__ import annotations

import uuid
from pathlib import Path
from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models
from django.contrib.gis.db import models as gis_models
from django.utils.deconstruct import deconstructible

@deconstructible
class PrivateMapLayerStorage(FileSystemStorage):
    def __init__(self):
        super().__init__(location=getattr(settings, "PRIVATE_MAP_LAYERS_ROOT", settings.BASE_DIR / "private_media" / "map_layers"), base_url=None)

private_map_layer_storage = PrivateMapLayerStorage()

def _safe(value, default="layer"):
    value = str(value or default).strip().lower().replace(" ", "_").replace("-", "_")
    return "".join(c for c in value if c.isalnum() or c == "_") or default

def map_layer_upload_to(instance, filename):
    extension = Path(filename or "layer.dat").suffix.lower() or ".dat"
    return f"client-{instance.client_id}/{_safe(instance.data_format, 'format')}/{_safe(instance.layer_type)}-{uuid.uuid4()}{extension}"

class ClientMapLayer(models.Model):
    LAYER_GEOJSON = "geojson"
    LAYER_ORTHOPHOTO = "orthophoto"
    LAYER_DRONE_IMAGE = "drone_image"
    LAYER_DEM = "dem"
    LAYER_HILLSHADE = "hillshade"
    LAYER_SLOPE = "slope"
    LAYER_TILES = "tiles"
    LAYER_WMS = "wms"
    LAYER_WFS = "wfs"
    LAYER_WMTS = "wmts"
    LAYER_OTHER = "other"
    LAYER_TYPE_CHOICES = [
        (LAYER_GEOJSON, "GeoJSON"), (LAYER_ORTHOPHOTO, "Orthophoto"), (LAYER_DRONE_IMAGE, "Image drone"),
        (LAYER_DEM, "MNT / DEM"), (LAYER_HILLSHADE, "Ombrage relief"), (LAYER_SLOPE, "Pente"),
        (LAYER_TILES, "Tuiles XYZ"), (LAYER_WMS, "WMS"), (LAYER_WFS, "WFS"), (LAYER_WMTS, "WMTS"), (LAYER_OTHER, "Autre"),
    ]
    FORMAT_GEOJSON = "geojson"
    FORMAT_GEOTIFF = "geotiff"
    FORMAT_COG = "cog"
    FORMAT_MBTILES = "mbtiles"
    FORMAT_XYZ = "xyz"
    FORMAT_WMS = "wms"
    FORMAT_WFS = "wfs"
    FORMAT_WMTS = "wmts"
    FORMAT_POSTGIS = "postgis"
    FORMAT_PNG = "png"
    FORMAT_JPG = "jpg"
    FORMAT_OTHER = "other"
    DATA_FORMAT_CHOICES = [
        (FORMAT_GEOJSON, "GeoJSON"), (FORMAT_GEOTIFF, "GeoTIFF"), (FORMAT_COG, "Cloud Optimized GeoTIFF"),
        (FORMAT_MBTILES, "MBTiles"), (FORMAT_XYZ, "Tuiles XYZ"), (FORMAT_WMS, "WMS"), (FORMAT_WFS, "WFS"), (FORMAT_WMTS, "WMTS"),
        (FORMAT_POSTGIS, "PostGIS"), (FORMAT_PNG, "PNG"), (FORMAT_JPG, "JPEG"), (FORMAT_OTHER, "Autre"),
    ]
    SOURCE_FILE = "file"
    SOURCE_DATABASE = "database"
    SOURCE_SERVICE = "service"
    SOURCE_KIND_CHOICES = [
        (SOURCE_FILE, "Fichier privé"),
        (SOURCE_DATABASE, "Base de données PostGIS"),
        (SOURCE_SERVICE, "Service externe / GeoServer"),
    ]

    STATUS_PENDING = "pending"
    STATUS_PROCESSING = "processing"
    STATUS_READY = "ready"
    STATUS_FAILED = "failed"
    PROCESSING_STATUS_CHOICES = [(STATUS_PENDING, "En attente"), (STATUS_PROCESSING, "Traitement en cours"), (STATUS_READY, "Prêt"), (STATUS_FAILED, "Échec")]

    RASTER_TILING_REQUIRED_MESSAGE = "Fichier stocké, génération de tuiles nécessaire avant affichage client."
    RASTER_PENDING_MESSAGE = "Raster stocké, en attente de génération de tuiles avant affichage client."
    CRS_REQUIRED_MESSAGE = "CRS source requis : les coordonnées GeoJSON semblent projetées et ne peuvent pas être supposées en EPSG:4326."
    MBTILES_VECTOR_UNSUPPORTED_MESSAGE = "MBTiles vectoriel non supporté par le portail client actuel : seules les tuiles raster image sont affichables."

    client = models.ForeignKey("organizations.Organization", on_delete=models.PROTECT, related_name="map_layers", limit_choices_to={"organization_type": "client"}, db_index=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    layer_type = models.CharField(max_length=50, choices=LAYER_TYPE_CHOICES, db_index=True)
    data_format = models.CharField(max_length=50, choices=DATA_FORMAT_CHOICES, db_index=True)
    file = models.FileField(storage=private_map_layer_storage, upload_to=map_layer_upload_to, null=True, blank=True)
    # Compatibilité : le champ file reste présent pour les anciennes couches,
    # mais les nouveaux imports vectoriels sont stockés dans ClientMapLayerFeature.
    source_kind = models.CharField(max_length=30, choices=SOURCE_KIND_CHOICES, default=SOURCE_FILE, db_index=True)
    tile_url = models.TextField(blank=True)
    service_url = models.TextField(blank=True)
    service_layers = models.CharField(max_length=255, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    bounds = models.JSONField(default=dict, blank=True)
    center = models.JSONField(default=dict, blank=True)
    min_zoom = models.PositiveSmallIntegerField(default=0)
    max_zoom = models.PositiveSmallIntegerField(default=22)
    opacity = models.FloatField(default=1.0)
    z_index = models.IntegerField(default=1)
    processing_status = models.CharField(max_length=20, choices=PROCESSING_STATUS_CHOICES, default=STATUS_READY, db_index=True)
    processing_error = models.TextField(blank=True)
    original_filename = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveBigIntegerField(default=0)
    metadata = models.JSONField(default=dict, blank=True)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="uploaded_map_layers")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["z_index", "name", "id"]
        indexes = [
            models.Index(fields=["client", "is_active"]), models.Index(fields=["client", "processing_status"]),
            models.Index(fields=["client", "layer_type"]), models.Index(fields=["client", "data_format"]), models.Index(fields=["client", "source_kind"]), models.Index(fields=["created_at"]),
        ]

    def __str__(self):
        return f"{self.name} · {self.layer_type} · client={self.client_id}"


class ClientMapLayerFeature(models.Model):
    layer = models.ForeignKey(ClientMapLayer, on_delete=models.CASCADE, related_name="features", db_index=True)
    geometry = gis_models.GeometryField(srid=4326, spatial_index=True)
    properties = models.JSONField(default=dict, blank=True)
    source_feature_id = models.CharField(max_length=255, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["layer"]),
            models.Index(fields=["source_feature_id"]),
        ]

    def __str__(self):
        return f"Feature layer={self.layer_id} id={self.id}"
