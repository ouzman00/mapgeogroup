from django.conf import settings
from django.db import models


class FieldIntervention(models.Model):
    STATUS_SCHEDULED = "scheduled"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_DONE = "done"
    STATUS_CANCELLED = "cancelled"
    STATUS_BLOCKED = "blocked"

    STATUS_CHOICES = [
        (STATUS_SCHEDULED, "Programmée"),
        (STATUS_IN_PROGRESS, "En cours"),
        (STATUS_DONE, "Réalisée"),
        (STATUS_CANCELLED, "Annulée"),
        (STATUS_BLOCKED, "Bloquée"),
    ]

    parcel = models.ForeignKey(
        "parcels.Parcel",
        on_delete=models.CASCADE,
        related_name="field_interventions",
    )
    scheduled_date = models.DateField(blank=True, null=True, db_index=True)
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="field_interventions",
    )
    title = models.CharField(max_length=255, default="Intervention terrain")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_SCHEDULED, db_index=True)
    report = models.TextField(blank=True)
    visible_to_client = models.BooleanField(default=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="created_field_interventions",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-scheduled_date", "-created_at"]
        indexes = [
            models.Index(fields=["parcel", "status"]),
            models.Index(fields=["scheduled_date", "status"]),
            models.Index(fields=["visible_to_client", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.parcel.reference} · {self.title}"
