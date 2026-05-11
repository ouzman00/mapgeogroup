from django.conf import settings
from django.db import models
from parcels.models import Parcel
from config.storage import private_document_storage, private_document_upload_to


class ParcelDocument(models.Model):
    DOCUMENT_TYPE_CHOICES = [
        ("plan_pdf", "Plan PDF"),
        ("pv_bornage", "PV de bornage"),
        ("rapport_topo", "Rapport topographique"),
        ("orthophoto", "Orthophoto"),
        ("photo_terrain", "Photo terrain"),
        ("image_annotee", "Image annotée"),
        ("dxf", "DXF"),
        ("dwg", "DWG"),
        ("kml", "KML"),
        ("csv", "CSV"),
        ("excel", "Excel"),
        ("invoice", "Facture"),
        ("quote", "Devis"),
        ("other", "Autre"),
    ]

    STATUS_CHOICES = [
        ("draft", "Brouillon"),
        ("validated", "Validé"),
        ("final", "Final"),
        ("archived", "Archivé"),
    ]

    SOURCE_CHOICES = [
        ("internal", "Dépôt interne"),
        ("client_upload", "Dépôt client"),
    ]

    parcel = models.ForeignKey(
        Parcel,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    title = models.CharField(max_length=255)
    document_type = models.CharField(max_length=30, choices=DOCUMENT_TYPE_CHOICES, default="other")
    file = models.FileField(storage=private_document_storage, upload_to=private_document_upload_to)
    version = models.CharField(max_length=20, default="v1")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft", db_index=True)
    description = models.TextField(blank=True, null=True)
    is_public_for_client = models.BooleanField(default=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="uploaded_parcel_documents",
        blank=True,
        null=True,
    )
    source = models.CharField(max_length=30, choices=SOURCE_CHOICES, default="internal", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["parcel", "created_at"]),
            models.Index(fields=["parcel", "status"]),
            models.Index(fields=["source", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.parcel.reference} - {self.title}"