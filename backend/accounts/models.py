from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    ROLE_CHOICES = [
        ("client", "Client"),
        ("agent", "Agent"),
        ("surveyor", "Géomètre"),
        ("manager", "Manager"),
        ("admin", "Administrateur"),
    ]

    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="client")
    client = models.ForeignKey(
        "organizations.Organization",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="client_users",
        limit_choices_to={"organization_type": "client"},
        db_index=True,
        help_text="Client auquel l'utilisateur est rattaché pour l'isolation des données privées.",
    )
    client_code = models.CharField(
        max_length=32,
        unique=True,
        blank=True,
        null=True,
        help_text="Identifiant client communiqué au client pour accéder à son espace privé.",
    )
    company_name = models.CharField(max_length=255, blank=True, null=True)
    phone = models.CharField(max_length=50, blank=True, null=True)
    is_verified = models.BooleanField(default=False)

    avatar = models.ImageField(
        upload_to="avatars/",
        blank=True,
        null=True,
        help_text="Photo de profil utilisateur, max 2 Mo.",
    )

    def __str__(self) -> str:
        identity = self.client_code or self.username
        return f"{identity} ({self.role})"

    def save(self, *args, **kwargs):
        if self.client_code == "":
            self.client_code = None

        # Harmonisation prudente rôle métier / droits Django :
        # - un superuser Django est forcément admin applicatif ;
        # - un admin applicatif peut accéder au Django admin ;
        # - is_staff seul ne donne plus d'accès aux données métier.
        touched_fields = set()
        if self.is_superuser and self.role != "admin":
            self.role = "admin"
            touched_fields.add("role")
        if self.role == "admin" and not self.is_staff:
            self.is_staff = True
            touched_fields.add("is_staff")

        update_fields = kwargs.get("update_fields")
        if update_fields is not None and touched_fields:
            kwargs["update_fields"] = set(update_fields) | touched_fields

        super().save(*args, **kwargs)
