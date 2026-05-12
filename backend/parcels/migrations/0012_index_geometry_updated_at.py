from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("parcels", "0011_communes_and_qgis_schema"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="parcel",
            index=models.Index(
                fields=["geometry_updated_at"],
                name="parcel_geom_updated_at_idx",
            ),
        ),
    ]
