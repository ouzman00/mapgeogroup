from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("organizations", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="ImportJob",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("job_type", models.CharField(choices=[("parcel_csv", "Import CSV parcelles")], default="parcel_csv", max_length=32)),
                ("status", models.CharField(choices=[("pending", "En attente"), ("validating", "Validation"), ("ready", "Prêt"), ("processing", "Traitement"), ("completed", "Terminé"), ("failed", "Échec"), ("cancelled", "Annulé")], db_index=True, default="pending", max_length=20)),
                ("file", models.FileField(upload_to="imports/%Y/%m/")),
                ("original_filename", models.CharField(blank=True, max_length=255, null=True)),
                ("execute_on_process", models.BooleanField(default=False)),
                ("summary", models.JSONField(blank=True, null=True)),
                ("error_message", models.TextField(blank=True, null=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="import_jobs", to=settings.AUTH_USER_MODEL)),
                ("default_owner", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="default_owner_import_jobs", to=settings.AUTH_USER_MODEL)),
                ("organization", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="import_jobs", to="organizations.organization")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="ImportRowResult",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("row_number", models.PositiveIntegerField()),
                ("reference", models.CharField(blank=True, max_length=100, null=True)),
                ("status", models.CharField(choices=[("valid", "Valide"), ("created", "Créée"), ("updated", "Mise à jour"), ("error", "Erreur"), ("skipped", "Ignorée")], default="valid", max_length=20)),
                ("raw_data", models.JSONField(blank=True, null=True)),
                ("normalized_data", models.JSONField(blank=True, null=True)),
                ("error_message", models.TextField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("job", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="rows", to="imports.importjob")),
            ],
            options={"ordering": ["row_number", "id"]},
        ),
        migrations.AddIndex(model_name="importjob", index=models.Index(fields=["status", "created_at"], name="imports_imp_status_1dd98f_idx")),
        migrations.AddIndex(model_name="importjob", index=models.Index(fields=["created_by", "created_at"], name="imports_imp_created_4ff5b4_idx")),
        migrations.AddIndex(model_name="importrowresult", index=models.Index(fields=["job", "status"], name="imports_imp_job_id_38365d_idx")),
        migrations.AddIndex(model_name="importrowresult", index=models.Index(fields=["job", "row_number"], name="imports_imp_job_id_0a840f_idx")),
    ]
