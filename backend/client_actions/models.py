from django.conf import settings
from django.db import models
from django.utils import timezone


class ClientAction(models.Model):
    STATUS_OPEN = "open"
    STATUS_DONE = "done"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = [
        (STATUS_OPEN, "À faire"),
        (STATUS_DONE, "Terminé"),
        (STATUS_CANCELLED, "Annulé"),
    ]

    TYPE_DOCUMENT = "document"
    TYPE_VALIDATION = "validation"
    TYPE_PAYMENT = "payment"
    TYPE_APPOINTMENT = "appointment"
    TYPE_OTHER = "other"

    ACTION_TYPES = [
        (TYPE_DOCUMENT, "Fournir un document"),
        (TYPE_VALIDATION, "Valider une information"),
        (TYPE_PAYMENT, "Effectuer un paiement"),
        (TYPE_APPOINTMENT, "Confirmer un rendez-vous"),
        (TYPE_OTHER, "Autre"),
    ]

    parcel = models.ForeignKey(
        "parcels.Parcel",
        on_delete=models.CASCADE,
        related_name="client_actions",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    action_type = models.CharField(max_length=30, choices=ACTION_TYPES, default=TYPE_OTHER)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_OPEN, db_index=True)
    due_date = models.DateField(blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_client_actions",
    )
    completed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["status", "due_date", "-created_at"]
        indexes = [
            models.Index(fields=["parcel", "status"]),
            models.Index(fields=["status", "due_date"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.parcel.reference} · {self.title}"

    def mark_done(self):
        self.status = self.STATUS_DONE
        self.completed_at = timezone.now()
        self.save(update_fields=["status", "completed_at", "updated_at"])
