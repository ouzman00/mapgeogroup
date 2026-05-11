from django.conf import settings
from django.db import models
from parcels.models import Parcel
from config.storage import private_support_storage, private_support_attachment_upload_to


class SupportTicket(models.Model):
    STATUS_CHOICES = [
        ("open", "Ouvert"),
        ("in_progress", "En cours"),
        ("resolved", "Résolu"),
        ("closed", "Fermé"),
    ]

    PRIORITY_CHOICES = [
        ("low", "Faible"),
        ("medium", "Moyenne"),
        ("high", "Élevée"),
        ("urgent", "Urgente"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="support_tickets",
    )
    parcel = models.ForeignKey(
        Parcel,
        on_delete=models.SET_NULL,
        related_name="support_tickets",
        blank=True,
        null=True,
    )
    subject = models.CharField(max_length=255)
    category = models.CharField(max_length=100, blank=True, default="")
    message = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open", db_index=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="medium", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "created_at"]),
            models.Index(fields=["status", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.subject} - {self.user.username}"

class SupportMessage(models.Model):
    ticket = models.ForeignKey(
        SupportTicket,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="support_messages",
        blank=True,
        null=True,
    )
    body = models.TextField()
    attachment = models.FileField(storage=private_support_storage, upload_to=private_support_attachment_upload_to, blank=True, null=True)
    is_internal_note = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["ticket", "created_at"]),
            models.Index(fields=["author", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.ticket_id} · {self.author or 'Système'} · {self.created_at:%Y-%m-%d}"
