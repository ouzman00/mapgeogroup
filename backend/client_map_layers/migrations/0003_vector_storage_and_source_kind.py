# Generated manually to keep vector imports in PostGIS while preserving legacy file layers.
from django.db import migrations, models
import django.db.models.deletion
import django.contrib.gis.db.models.fields


class Migration(migrations.Migration):

    dependencies = [
        ("client_map_layers", "0002_rename_client_map_client__active_idx_client_map__client__097a27_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="clientmaplayer",
            name="source_kind",
            field=models.CharField(
                choices=[
                    ("file", "Fichier privé"),
                    ("database", "Base de données PostGIS"),
                    ("service", "Service externe / GeoServer"),
                ],
                db_index=True,
                default="file",
                max_length=30,
            ),
        ),
        migrations.CreateModel(
            name="ClientMapLayerFeature",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("geometry", django.contrib.gis.db.models.fields.GeometryField(srid=4326, spatial_index=True)),
                ("properties", models.JSONField(blank=True, default=dict)),
                ("source_feature_id", models.CharField(blank=True, db_index=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("layer", models.ForeignKey(db_index=True, on_delete=models.deletion.CASCADE, related_name="features", to="client_map_layers.clientmaplayer")),
            ],
            options={
                "ordering": ["id"],
            },
        ),
        migrations.AddIndex(
            model_name="clientmaplayer",
            index=models.Index(fields=["client", "source_kind"], name="client_map__client__source__idx"),
        ),
        migrations.AddIndex(
            model_name="clientmaplayerfeature",
            index=models.Index(fields=["layer"], name="client_map__layer_i_idx"),
        ),
        migrations.AddIndex(
            model_name="clientmaplayerfeature",
            index=models.Index(fields=["source_feature_id"], name="client_map__source__idx"),
        ),
    ]
