-- Vue QGIS cohérente avec le schéma métier unique donnees_mapgeo.
-- À exécuter après les migrations si la vue doit être recréée manuellement.
CREATE SCHEMA IF NOT EXISTS donnees_mapgeo;

CREATE OR REPLACE VIEW donnees_mapgeo.parcels_parcel_qgis AS
SELECT
    p.id,
    p.reference,
    p.title_number,
    p.parcel_number,
    p.section,
    p.location,
    p.address,
    p.village,
    p.commune,
    p.department,
    p.region,
    p.land_use,
    p.area,
    p.perimeter,
    p.status,
    p.survey_date,
    p.method,
    p.latitude,
    p.longitude,
    p.geometry_updated_at,
    p.organization_id,
    p.owner_id,
    p.geom
FROM donnees_mapgeo.parcels_parcel p
WHERE p.archived_at IS NULL;
