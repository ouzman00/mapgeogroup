from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import client_geojson.models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("organizations", "0003_limit_organization_code_length"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="GeoJsonLayer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True)),
                ("layer_type", models.CharField(choices=[("occupation_sol", "Occupation du sol"), ("parcelles", "Parcelles"), ("zones_protegees", "Zones protégées"), ("limites_admin", "Limites administratives"), ("autre", "Autre")], db_index=True, max_length=50)),
                ("file", models.FileField(storage=client_geojson.models.PrivateGeoJsonStorage(), upload_to=client_geojson.models.geojson_upload_to)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("original_filename", models.CharField(blank=True, max_length=255)),
                ("file_size", models.PositiveBigIntegerField(default=0)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("client", models.ForeignKey(db_index=True, limit_choices_to={"organization_type": "client"}, on_delete=django.db.models.deletion.PROTECT, related_name="geojson_layers", to="organizations.organization")),
                ("uploaded_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="uploaded_geojson_layers", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["name", "id"]},
        ),
        migrations.AddIndex(model_name="geojsonlayer", index=models.Index(fields=["client", "is_active"], name="client_geoj_client__1c0c2a_idx")),
        migrations.AddIndex(model_name="geojsonlayer", index=models.Index(fields=["client", "layer_type"], name="client_geoj_client__f2ec25_idx")),
        migrations.AddIndex(model_name="geojsonlayer", index=models.Index(fields=["created_at"], name="client_geoj_created_bf7e5b_idx")),
    ]
