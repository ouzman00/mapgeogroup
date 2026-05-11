from django.conf import settings
from django.db import models


class Organization(models.Model):
    TYPE_CHOICES = [
        ("client", "Client"),
        ("partner", "Partenaire"),
        ("internal", "Interne"),
    ]
    STATUS_CHOICES = [
        ("active", "Active"),
        ("prospect", "Prospect"),
        ("inactive", "Inactive"),
        ("archived", "Archivée"),
    ]

    name = models.CharField(max_length=255)
    code = models.CharField(max_length=32, unique=True)
    organization_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="client")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active", db_index=True)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=50, blank=True, null=True)
    address = models.CharField(max_length=255, blank=True, null=True)
    metadata = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["organization_type", "created_at"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.code})"


class OrganizationMembership(models.Model):
    ROLE_CHOICES = [
        ("owner", "Propriétaire de compte"),
        ("manager", "Manager organisation"),
        ("contact", "Contact client"),
        ("viewer", "Lecteur"),
    ]

    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="organization_memberships")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="viewer")
    is_primary = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("organization", "user")]
        ordering = ["organization__name", "user__username"]
        indexes = [
            models.Index(fields=["organization", "is_active"]),
            models.Index(fields=["user", "is_active"]),
        ]

    def __str__(self):
        return f"{self.organization} · {self.user}"
