from django.db import migrations


SQL = r"""
CREATE OR REPLACE FUNCTION parcels_sync_geom_fields()
RETURNS trigger AS $$
BEGIN
  IF NEW.geom IS NOT NULL THEN
    IF ST_SRID(NEW.geom) = 0 THEN
      NEW.geom := ST_SetSRID(NEW.geom, 32628);
    ELSIF ST_SRID(NEW.geom) <> 32628 THEN
      NEW.geom := ST_Transform(NEW.geom, 32628);
    END IF;

    NEW.geometry := ST_AsGeoJSON(NEW.geom)::jsonb;
    NEW.centroid_geom := ST_Centroid(NEW.geom);
    NEW.longitude := ROUND(ST_X(ST_Centroid(NEW.geom))::numeric, 3);
    NEW.latitude := ROUND(ST_Y(ST_Centroid(NEW.geom))::numeric, 3);
    NEW.area := ROUND(ST_Area(NEW.geom)::numeric, 2);
    NEW.perimeter := ROUND(ST_Perimeter(NEW.geom)::numeric, 2);

    IF TG_OP = 'INSERT' THEN
      NEW.geometry_updated_at := COALESCE(NEW.geometry_updated_at, NOW());
    ELSIF NEW.geom IS DISTINCT FROM OLD.geom THEN
      NEW.geometry_updated_at := NOW();
    END IF;
  ELSE
    NEW.geometry := NULL;
    NEW.centroid_geom := NULL;
    NEW.longitude := NULL;
    NEW.latitude := NULL;
    NEW.area := 0;
    NEW.perimeter := 0;
    NEW.geometry_updated_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION parcels_track_direct_geom_update()
RETURNS trigger AS $$
BEGIN
  IF current_setting('mapgeo.skip_geom_history', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.geom IS NOT NULL AND NEW.geom IS DISTINCT FROM OLD.geom THEN
    INSERT INTO parcels_parcelgeometryversion (
      parcel_id,
      geom,
      geometry,
      reason,
      created_at,
      modified_by_id
    ) VALUES (
      OLD.id,
      OLD.geom,
      ST_AsGeoJSON(OLD.geom)::jsonb,
      'Avant modification directe PostGIS/QGIS',
      NOW(),
      NULL
    );
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.geom IS NOT NULL AND NEW.geom IS DISTINCT FROM OLD.geom THEN
    INSERT INTO parcels_parcelgeometryversion (
      parcel_id,
      geom,
      geometry,
      reason,
      created_at,
      modified_by_id
    ) VALUES (
      NEW.id,
      NEW.geom,
      ST_AsGeoJSON(NEW.geom)::jsonb,
      'Modification directe PostGIS/QGIS',
      NOW(),
      NULL
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS parcels_sync_geom_fields_trigger ON parcels_parcel;
CREATE TRIGGER parcels_sync_geom_fields_trigger
BEFORE INSERT OR UPDATE OF geom ON parcels_parcel
FOR EACH ROW
EXECUTE FUNCTION parcels_sync_geom_fields();

DROP TRIGGER IF EXISTS parcels_track_direct_geom_update_trigger ON parcels_parcel;
CREATE TRIGGER parcels_track_direct_geom_update_trigger
AFTER UPDATE OF geom ON parcels_parcel
FOR EACH ROW
WHEN (OLD.geom IS DISTINCT FROM NEW.geom)
EXECUTE FUNCTION parcels_track_direct_geom_update();
"""

REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS parcels_track_direct_geom_update_trigger ON parcels_parcel;
DROP TRIGGER IF EXISTS parcels_sync_geom_fields_trigger ON parcels_parcel;
DROP FUNCTION IF EXISTS parcels_track_direct_geom_update();
DROP FUNCTION IF EXISTS parcels_sync_geom_fields();
"""


class Migration(migrations.Migration):

    dependencies = [
        ("parcels", "0007_soft_archive_parcels"),
    ]

    operations = [
        migrations.RunSQL(SQL, REVERSE_SQL),
    ]
