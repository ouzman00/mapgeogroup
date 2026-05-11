from django.conf import settings
from django.contrib.gis.db import models
from django.db.models import Q
from django.utils import timezone

from organizations.models import Organization


class Commune(models.Model):
    """Référentiel SIG des communes visible dans QGIS.

    La table physique est `communes`. Avec DB_SCHEMA=donnees_mapgeo et le
    search_path PostgreSQL configuré, elle est créée comme
    `donnees_mapgeo.communes`.
    """

    code = models.CharField(max_length=64, blank=True, null=True, db_index=True)
    nom = models.CharField(max_length=255, db_index=True)
    department = models.CharField(max_length=255, blank=True, null=True)
    region = models.CharField(max_length=255, blank=True, null=True)
    geom = models.GeometryField(srid=32628, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "communes"
        ordering = ["nom", "id"]
        indexes = [
            models.Index(fields=["nom"], name="communes_nom_idx"),
            models.Index(fields=["department", "nom"], name="communes_department_nom_idx"),
        ]

    def __str__(self) -> str:
        return self.nom


class Parcel(models.Model):
    STATUS_CHOICES = [
        ("planned", "Mission planifiée"),
        ("surveying", "Levé en cours"),
        ("processing", "Traitement en cours"),
        ("draft", "Plan en préparation"),
        ("ready", "Dossier prêt"),
        ("completed", "Bornage réalisé"),
        ("disputed", "Litigieuse"),
        ("to_verify", "À vérifier"),
    ]

    reference = models.CharField(max_length=100, db_index=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="parcels",
    )
    organization = models.ForeignKey(
        Organization,
        on_delete=models.SET_NULL,
        related_name="parcels",
        blank=True,
        null=True,
    )

    title_number = models.CharField(max_length=120, blank=True, null=True)
    parcel_number = models.CharField(max_length=120, blank=True, null=True)
    section = models.CharField(max_length=120, blank=True, null=True)
    location = models.CharField(max_length=255)
    address = models.CharField(max_length=255, blank=True, null=True)
    village = models.CharField(max_length=255, blank=True, null=True)
    commune = models.CharField(max_length=255, blank=True, null=True)
    department = models.CharField(max_length=255, blank=True, null=True)
    region = models.CharField(max_length=255, blank=True, null=True)
    land_use = models.CharField(max_length=255, blank=True, null=True)

    area = models.DecimalField(max_digits=12, decimal_places=2)
    perimeter = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="planned", db_index=True)
    survey_date = models.DateField(blank=True, null=True)
    method = models.CharField(max_length=100, blank=True, null=True)

    latitude = models.DecimalField(max_digits=14, decimal_places=3, blank=True, null=True, help_text="Y / Northing EPSG:32628 en mètres")
    longitude = models.DecimalField(max_digits=14, decimal_places=3, blank=True, null=True, help_text="X / Easting EPSG:32628 en mètres")
    geometry = models.JSONField(blank=True, null=True, help_text="GeoJSON projeté EPSG:32628 [x, y] en mètres")
    geom = models.GeometryField(srid=32628, blank=True, null=True)
    centroid_geom = models.PointField(srid=32628, blank=True, null=True)
    geometry_updated_at = models.DateTimeField(blank=True, null=True)
    archived_at = models.DateTimeField(blank=True, null=True, db_index=True)
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="archived_parcels",
        blank=True,
        null=True,
    )

    orientation = models.CharField(max_length=50, blank=True, null=True)
    access_info = models.CharField(max_length=255, blank=True, null=True)
    risk_level = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "reference"],
                condition=Q(archived_at__isnull=True),
                name="uniq_active_parcel_reference_per_org",
            ),
        ]
        indexes = [
            models.Index(fields=["owner", "created_at"]),
            models.Index(fields=["owner", "status"]),
            models.Index(fields=["organization", "created_at"]),
            models.Index(fields=["organization", "status"]),
            models.Index(fields=["commune", "created_at"]),
            models.Index(fields=["archived_at", "created_at"]),
        ]

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None

    def archive(self, *, user=None):
        if self.archived_at is None:
            self.archived_at = timezone.now()
            if user and getattr(user, "is_authenticated", False):
                self.archived_by = user
            self.save(update_fields=["archived_at", "archived_by", "updated_at"])
        return self

    def __str__(self) -> str:
        label = self.reference
        if self.organization_id:
            return f"{label} · {self.organization.name}"
        if self.owner_id:
            return f"{label} · {self.owner}"
        return label


class ParcelGeometryVersion(models.Model):
    parcel = models.ForeignKey(Parcel, on_delete=models.CASCADE, related_name="geometry_versions")
    geom = models.GeometryField(srid=32628, blank=True, null=True)
    geometry = models.JSONField(blank=True, null=True)
    modified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name="parcel_geometry_versions", blank=True, null=True)
    reason = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class ParcelSide(models.Model):
    parcel = models.ForeignKey(
        Parcel,
        on_delete=models.CASCADE,
        related_name="sides",
    )
    label = models.CharField(max_length=20)
    length = models.DecimalField(max_digits=10, decimal_places=2)
    point_a = models.CharField(max_length=100, blank=True, null=True)
    point_b = models.CharField(max_length=100, blank=True, null=True)
    boundary_state = models.CharField(max_length=100, blank=True, null=True)
    verification_date = models.DateField(blank=True, null=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.parcel.reference} - {self.label}"


class ParcelTimelineEvent(models.Model):
    parcel = models.ForeignKey(
        Parcel,
        on_delete=models.CASCADE,
        related_name="timeline_events",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    event_date = models.DateField()
    progress = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["event_date", "id"]

    def __str__(self) -> str:
        return f"{self.parcel.reference} - {self.title}"
