# Generated to allow Point, MultiPoint, LineString, MultiLineString, Polygon,
# MultiPolygon and GeometryCollection in PostGIS.

from django.contrib.gis.db import models as gis_models
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("parcels", "0004_rename_parcels_par_owner_i_1e7ff7_idx_parcels_par_owner_i_4b6958_idx_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="parcel",
            name="geom",
            field=gis_models.GeometryField(blank=True, null=True, srid=4326),
        ),
        migrations.AlterField(
            model_name="parcelgeometryversion",
            name="geom",
            field=gis_models.GeometryField(blank=True, null=True, srid=4326),
        ),
    ]
