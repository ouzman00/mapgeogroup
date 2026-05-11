from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Organization",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("code", models.CharField(max_length=64, unique=True)),
                ("organization_type", models.CharField(choices=[("client", "Client"), ("partner", "Partenaire"), ("internal", "Interne")], default="client", max_length=20)),
                ("status", models.CharField(choices=[("active", "Active"), ("prospect", "Prospect"), ("inactive", "Inactive"), ("archived", "Archivée")], db_index=True, default="active", max_length=20)),
                ("email", models.EmailField(blank=True, max_length=254, null=True)),
                ("phone", models.CharField(blank=True, max_length=50, null=True)),
                ("address", models.CharField(blank=True, max_length=255, null=True)),
                ("metadata", models.JSONField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["name", "id"]},
        ),
        migrations.CreateModel(
            name="OrganizationMembership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(choices=[("owner", "Propriétaire de compte"), ("manager", "Manager organisation"), ("contact", "Contact client"), ("viewer", "Lecteur")], default="viewer", max_length=20)),
                ("is_primary", models.BooleanField(default=False)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="memberships", to="organizations.organization")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="organization_memberships", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["organization__name", "user__username"], "unique_together": {("organization", "user")}},
        ),
        migrations.AddIndex(model_name="organization", index=models.Index(fields=["status", "created_at"], name="organizatio_status_d8710f_idx")),
        migrations.AddIndex(model_name="organization", index=models.Index(fields=["organization_type", "created_at"], name="organizatio_organiz_eafab5_idx")),
        migrations.AddIndex(model_name="organizationmembership", index=models.Index(fields=["organization", "is_active"], name="organizatio_organiz_26fc17_idx")),
        migrations.AddIndex(model_name="organizationmembership", index=models.Index(fields=["user", "is_active"], name="organizatio_user_id_1da8b7_idx")),
    ]
