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
            name="Parcel",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("reference", models.CharField(max_length=100, unique=True)),
                ("title_number", models.CharField(blank=True, max_length=120, null=True)),
                ("parcel_number", models.CharField(blank=True, max_length=120, null=True)),
                ("section", models.CharField(blank=True, max_length=120, null=True)),
                ("location", models.CharField(max_length=255)),
                ("address", models.CharField(blank=True, max_length=255, null=True)),
                ("village", models.CharField(blank=True, max_length=255, null=True)),
                ("commune", models.CharField(blank=True, max_length=255, null=True)),
                ("department", models.CharField(blank=True, max_length=255, null=True)),
                ("region", models.CharField(blank=True, max_length=255, null=True)),
                ("land_use", models.CharField(blank=True, max_length=255, null=True)),
                ("area", models.DecimalField(decimal_places=2, max_digits=12)),
                ("perimeter", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("status", models.CharField(choices=[("planned", "Mission planifiée"), ("surveying", "Levé en cours"), ("processing", "Traitement en cours"), ("draft", "Plan en préparation"), ("ready", "Dossier prêt"), ("completed", "Bornage réalisé"), ("disputed", "Litigieuse"), ("to_verify", "À vérifier")], default="planned", max_length=20)),
                ("survey_date", models.DateField(blank=True, null=True)),
                ("method", models.CharField(blank=True, max_length=100, null=True)),
                ("latitude", models.DecimalField(blank=True, decimal_places=7, max_digits=10, null=True)),
                ("longitude", models.DecimalField(blank=True, decimal_places=7, max_digits=10, null=True)),
                ("geometry", models.JSONField(blank=True, null=True)),
                ("orientation", models.CharField(blank=True, max_length=50, null=True)),
                ("access_info", models.CharField(blank=True, max_length=255, null=True)),
                ("risk_level", models.CharField(blank=True, max_length=100, null=True)),
                ("notes", models.TextField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="parcels", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="ParcelSide",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("label", models.CharField(max_length=20)),
                ("length", models.DecimalField(decimal_places=2, max_digits=10)),
                ("point_a", models.CharField(blank=True, max_length=100, null=True)),
                ("point_b", models.CharField(blank=True, max_length=100, null=True)),
                ("boundary_state", models.CharField(blank=True, max_length=100, null=True)),
                ("verification_date", models.DateField(blank=True, null=True)),
                ("parcel", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sides", to="parcels.parcel")),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.CreateModel(
            name="ParcelTimelineEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True, null=True)),
                ("event_date", models.DateField()),
                ("progress", models.PositiveIntegerField(default=0)),
                ("parcel", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="timeline_events", to="parcels.parcel")),
            ],
            options={"ordering": ["event_date", "id"]},
        ),
    ]
