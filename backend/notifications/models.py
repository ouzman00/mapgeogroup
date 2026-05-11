from django.conf import settings
from django.db import models


class Notification(models.Model):
    NOTIFICATION_TYPE_CHOICES = [
        ("info", "Information"),
        ("success", "Succès"),
        ("warning", "Alerte"),
        ("error", "Erreur"),
        ("appointment", "Rendez-vous"),
        ("document", "Document"),
        ("parcel", "Parcelle"),
        ("support", "Support"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    title = models.CharField(max_length=255)
    message = models.TextField()
    notification_type = models.CharField(max_length=20, choices=NOTIFICATION_TYPE_CHOICES, default="info")
    severity = models.CharField(max_length=20, blank=True, null=True)
    target_url = models.CharField(max_length=500, blank=True, null=True)
    related_type = models.CharField(max_length=80, blank=True, null=True)
    related_id = models.PositiveBigIntegerField(blank=True, null=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_read", "-created_at"], name="notificatio_user_id_0b3f1d_idx"),
            models.Index(fields=["notification_type", "-created_at"], name="notificatio_notific_9e7c8b_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} - {self.title}"