from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import client_map_layers.models

class Migration(migrations.Migration):
    initial = True
    dependencies = [("organizations", "0003_limit_organization_code_length"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name="ClientMapLayer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)), ("description", models.TextField(blank=True)),
                ("layer_type", models.CharField(choices=[("geojson", "GeoJSON"), ("orthophoto", "Orthophoto"), ("drone_image", "Image drone"), ("dem", "MNT / DEM"), ("hillshade", "Ombrage relief"), ("slope", "Pente"), ("tiles", "Tuiles XYZ"), ("wms", "WMS"), ("wmts", "WMTS"), ("other", "Autre")], db_index=True, max_length=50)),
                ("data_format", models.CharField(choices=[("geojson", "GeoJSON"), ("geotiff", "GeoTIFF"), ("cog", "Cloud Optimized GeoTIFF"), ("mbtiles", "MBTiles"), ("xyz", "Tuiles XYZ"), ("wms", "WMS"), ("wmts", "WMTS"), ("png", "PNG"), ("jpg", "JPEG"), ("other", "Autre")], db_index=True, max_length=50)),
                ("file", models.FileField(blank=True, null=True, storage=client_map_layers.models.PrivateMapLayerStorage(), upload_to=client_map_layers.models.map_layer_upload_to)),
                ("tile_url", models.TextField(blank=True)), ("service_url", models.TextField(blank=True)), ("service_layers", models.CharField(blank=True, max_length=255)),
                ("is_active", models.BooleanField(db_index=True, default=True)), ("bounds", models.JSONField(blank=True, default=dict)), ("center", models.JSONField(blank=True, default=dict)),
                ("min_zoom", models.PositiveSmallIntegerField(default=0)), ("max_zoom", models.PositiveSmallIntegerField(default=22)), ("opacity", models.FloatField(default=1.0)), ("z_index", models.IntegerField(default=1)),
                ("processing_status", models.CharField(choices=[("pending", "En attente"), ("processing", "Traitement en cours"), ("ready", "Prêt"), ("failed", "Échec")], db_index=True, default="ready", max_length=20)),
                ("processing_error", models.TextField(blank=True)), ("original_filename", models.CharField(blank=True, max_length=255)), ("file_size", models.PositiveBigIntegerField(default=0)), ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)), ("updated_at", models.DateTimeField(auto_now=True)),
                ("client", models.ForeignKey(db_index=True, limit_choices_to={"organization_type": "client"}, on_delete=django.db.models.deletion.PROTECT, related_name="map_layers", to="organizations.organization")),
                ("uploaded_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="uploaded_map_layers", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["z_index", "name", "id"]},
        ),
        migrations.AddIndex(model_name="clientmaplayer", index=models.Index(fields=["client", "is_active"], name="client_map_client__active_idx")),
        migrations.AddIndex(model_name="clientmaplayer", index=models.Index(fields=["client", "processing_status"], name="client_map_client__status_idx")),
        migrations.AddIndex(model_name="clientmaplayer", index=models.Index(fields=["client", "layer_type"], name="client_map_client__type_idx")),
        migrations.AddIndex(model_name="clientmaplayer", index=models.Index(fields=["client", "data_format"], name="client_map_client__format_idx")),
        migrations.AddIndex(model_name="clientmaplayer", index=models.Index(fields=["created_at"], name="client_map_created_idx")),
    ]
