from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("client_map_layers", "0003_vector_storage_and_source_kind"),
    ]

    operations = [
        migrations.AlterField(
            model_name="clientmaplayer",
            name="data_format",
            field=models.CharField(
                choices=[
                    ("geojson", "GeoJSON"),
                    ("geotiff", "GeoTIFF"),
                    ("cog", "Cloud Optimized GeoTIFF"),
                    ("mbtiles", "MBTiles"),
                    ("xyz", "Tuiles XYZ"),
                    ("wms", "WMS"),
                    ("wfs", "WFS"),
                    ("wmts", "WMTS"),
                    ("postgis", "PostGIS"),
                    ("png", "PNG"),
                    ("jpg", "JPEG"),
                    ("other", "Autre"),
                ],
                db_index=True,
                max_length=50,
            ),
        ),
    ]
