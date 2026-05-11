from django.contrib.gis.db import models as gis_models
from django.db import migrations, models


GEOMETRY_TRANSFORM_SQL = r"""
-- Les colonnes PostGIS passent en EPSG:32628 sans supprimer de données.
-- Si les coordonnées ressemblent à des degrés WGS84, on les transforme.
-- Si elles ressemblent déjà à des mètres, on fixe simplement le SRID.
ALTER TABLE parcels_parcel
ALTER COLUMN geom TYPE geometry(Geometry, 32628)
USING CASE
    WHEN geom IS NULL THEN NULL
    WHEN ST_SRID(geom) = 32628 THEN geom
    WHEN ST_XMin(Box2D(geom)) BETWEEN -180 AND 180
     AND ST_XMax(Box2D(geom)) BETWEEN -180 AND 180
     AND ST_YMin(Box2D(geom)) BETWEEN -90 AND 90
     AND ST_YMax(Box2D(geom)) BETWEEN -90 AND 90
        THEN ST_Transform(ST_SetSRID(geom, 4326), 32628)
    ELSE ST_SetSRID(geom, 32628)
END;

ALTER TABLE parcels_parcel
ALTER COLUMN centroid_geom TYPE geometry(Point, 32628)
USING CASE
    WHEN centroid_geom IS NULL THEN NULL
    WHEN ST_SRID(centroid_geom) = 32628 THEN centroid_geom
    WHEN ST_X(centroid_geom) BETWEEN -180 AND 180
     AND ST_Y(centroid_geom) BETWEEN -90 AND 90
        THEN ST_Transform(ST_SetSRID(centroid_geom, 4326), 32628)
    ELSE ST_SetSRID(centroid_geom, 32628)
END;

ALTER TABLE parcels_parcelgeometryversion
ALTER COLUMN geom TYPE geometry(Geometry, 32628)
USING CASE
    WHEN geom IS NULL THEN NULL
    WHEN ST_SRID(geom) = 32628 THEN geom
    WHEN ST_XMin(Box2D(geom)) BETWEEN -180 AND 180
     AND ST_XMax(Box2D(geom)) BETWEEN -180 AND 180
     AND ST_YMin(Box2D(geom)) BETWEEN -90 AND 90
     AND ST_YMax(Box2D(geom)) BETWEEN -90 AND 90
        THEN ST_Transform(ST_SetSRID(geom, 4326), 32628)
    ELSE ST_SetSRID(geom, 32628)
END;

UPDATE parcels_parcel
SET
    geometry = ST_AsGeoJSON(geom)::jsonb,
    centroid_geom = ST_Centroid(geom),
    longitude = ROUND(ST_X(ST_Centroid(geom))::numeric, 3),
    latitude = ROUND(ST_Y(ST_Centroid(geom))::numeric, 3)
WHERE geom IS NOT NULL;

UPDATE parcels_parcelgeometryversion
SET geometry = ST_AsGeoJSON(geom)::jsonb
WHERE geom IS NOT NULL;
"""

GEOMETRY_REVERSE_SQL = r"""
ALTER TABLE parcels_parcel
ALTER COLUMN geom TYPE geometry(Geometry, 4326)
USING CASE
    WHEN geom IS NULL THEN NULL
    WHEN ST_SRID(geom) = 4326 THEN geom
    ELSE ST_Transform(ST_SetSRID(geom, 32628), 4326)
END;

ALTER TABLE parcels_parcel
ALTER COLUMN centroid_geom TYPE geometry(Point, 4326)
USING CASE
    WHEN centroid_geom IS NULL THEN NULL
    WHEN ST_SRID(centroid_geom) = 4326 THEN centroid_geom
    ELSE ST_Transform(ST_SetSRID(centroid_geom, 32628), 4326)
END;

ALTER TABLE parcels_parcelgeometryversion
ALTER COLUMN geom TYPE geometry(Geometry, 4326)
USING CASE
    WHEN geom IS NULL THEN NULL
    WHEN ST_SRID(geom) = 4326 THEN geom
    ELSE ST_Transform(ST_SetSRID(geom, 32628), 4326)
END;

UPDATE parcels_parcel
SET
    geometry = ST_AsGeoJSON(geom)::jsonb,
    centroid_geom = ST_Centroid(geom),
    longitude = ROUND(ST_X(ST_Centroid(geom))::numeric, 7),
    latitude = ROUND(ST_Y(ST_Centroid(geom))::numeric, 7)
WHERE geom IS NOT NULL;

UPDATE parcels_parcelgeometryversion
SET geometry = ST_AsGeoJSON(geom)::jsonb
WHERE geom IS NOT NULL;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("parcels", "0005_allow_all_geometry_types"),
    ]

    operations = [
        migrations.AlterField(
            model_name="parcel",
            name="latitude",
            field=models.DecimalField(
                blank=True,
                null=True,
                max_digits=14,
                decimal_places=3,
                help_text="Y / Northing EPSG:32628 en mètres",
            ),
        ),
        migrations.AlterField(
            model_name="parcel",
            name="longitude",
            field=models.DecimalField(
                blank=True,
                null=True,
                max_digits=14,
                decimal_places=3,
                help_text="X / Easting EPSG:32628 en mètres",
            ),
        ),
        migrations.AlterField(
            model_name="parcel",
            name="geometry",
            field=models.JSONField(
                blank=True,
                null=True,
                help_text="GeoJSON projeté EPSG:32628 [x, y] en mètres",
            ),
        ),
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(GEOMETRY_TRANSFORM_SQL, reverse_sql=GEOMETRY_REVERSE_SQL),
            ],
            state_operations=[
                migrations.AlterField(
                    model_name="parcel",
                    name="geom",
                    field=gis_models.GeometryField(blank=True, null=True, srid=32628),
                ),
                migrations.AlterField(
                    model_name="parcel",
                    name="centroid_geom",
                    field=gis_models.PointField(blank=True, null=True, srid=32628),
                ),
                migrations.AlterField(
                    model_name="parcelgeometryversion",
                    name="geom",
                    field=gis_models.GeometryField(blank=True, null=True, srid=32628),
                ),
            ],
        ),
    ]
