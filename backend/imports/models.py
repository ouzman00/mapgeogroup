from django.conf import settings
from django.db import models

from organizations.models import Organization
from config.storage import private_import_storage, private_import_upload_to


class ImportJob(models.Model):
    TYPE_CHOICES = [("parcel_csv", "Import CSV parcelles")]
    STATUS_CHOICES = [
        ("pending", "En attente"),
        ("validating", "Validation"),
        ("ready", "Prêt"),
        ("processing", "Traitement"),
        ("completed", "Terminé"),
        ("failed", "Échec"),
        ("cancelled", "Annulé"),
    ]

    job_type = models.CharField(max_length=32, choices=TYPE_CHOICES, default="parcel_csv")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending", db_index=True)
    file = models.FileField(storage=private_import_storage, upload_to=private_import_upload_to)
    original_filename = models.CharField(max_length=255, blank=True, null=True)
    organization = models.ForeignKey(Organization, on_delete=models.SET_NULL, related_name="import_jobs", blank=True, null=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="import_jobs")
    default_owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, related_name="default_owner_import_jobs", blank=True, null=True)
    execute_on_process = models.BooleanField(default=False)
    skip_errors = models.BooleanField(default=False, help_text="Si True, importe les lignes valides même en présence d'erreurs.")
    summary = models.JSONField(blank=True, null=True)
    error_message = models.TextField(blank=True, null=True)
    started_at = models.DateTimeField(blank=True, null=True)
    finished_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["created_by", "created_at"]),
        ]


class ImportRowResult(models.Model):
    STATUS_CHOICES = [
        ("valid", "Valide"),
        ("created", "Créée"),
        ("updated", "Mise à jour"),
        ("error", "Erreur"),
        ("skipped", "Ignorée"),
    ]

    job = models.ForeignKey(ImportJob, on_delete=models.CASCADE, related_name="rows")
    row_number = models.PositiveIntegerField()
    reference = models.CharField(max_length=100, blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="valid")
    raw_data = models.JSONField(blank=True, null=True)
    normalized_data = models.JSONField(blank=True, null=True)
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["row_number", "id"]
        indexes = [
            models.Index(fields=["job", "status"]),
            models.Index(fields=["job", "row_number"]),
        ]
