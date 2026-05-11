from __future__ import annotations

import uuid
from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models
from django.utils.deconstruct import deconstructible


@deconstructible
class PrivateGeoJsonStorage(FileSystemStorage):
    """Stockage privé pour les GeoJSON client."""

    def __init__(self):
        super().__init__(
            location=getattr(settings, "PRIVATE_GEOJSON_ROOT", settings.BASE_DIR / "private_media" / "geojson"),
            base_url=None,
        )


private_geojson_storage = PrivateGeoJsonStorage()


def geojson_upload_to(instance, filename):
    extension = Path(filename or "layer.geojson").suffix.lower()
    if extension not in {".geojson", ".json"}:
        extension = ".geojson"
    safe_type = str(instance.layer_type or "layer").strip().lower().replace(" ", "_").replace("-", "_")
    return f"client-{instance.client_id}/{safe_type}-{uuid.uuid4()}{extension}"


class GeoJsonLayer(models.Model):
    TYPE_OCCUPATION_SOL = "occupation_sol"
    TYPE_PARCELLES = "parcelles"
    TYPE_ZONES_PROTEGEES = "zones_protegees"
    TYPE_LIMITES_ADMIN = "limites_admin"
    TYPE_AUTRE = "autre"

    TYPE_CHOICES = [
        (TYPE_OCCUPATION_SOL, "Occupation du sol"),
        (TYPE_PARCELLES, "Parcelles"),
        (TYPE_ZONES_PROTEGEES, "Zones protégées"),
        (TYPE_LIMITES_ADMIN, "Limites administratives"),
        (TYPE_AUTRE, "Autre"),
    ]

    client = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.PROTECT,
        related_name="geojson_layers",
        limit_choices_to={"organization_type": "client"},
        db_index=True,
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    layer_type = models.CharField(max_length=50, choices=TYPE_CHOICES, db_index=True)
    file = models.FileField(storage=private_geojson_storage, upload_to=geojson_upload_to)
    is_active = models.BooleanField(default=True, db_index=True)
    original_filename = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_geojson_layers",
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        indexes = [
            models.Index(fields=["client", "is_active"]),
            models.Index(fields=["client", "layer_type"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self):
        return f"{self.name} · client={self.client_id}"
