-- Déplace les tables MapGeo déjà créées dans public vers donnees_mapgeo.
-- À lancer avec l'utilisateur PostgreSQL admin `postgres` dans la base mapgeo_db.
-- Le script évite spatial_ref_sys/PostGIS et ne remplace pas une table déjà présente dans donnees_mapgeo.

CREATE SCHEMA IF NOT EXISTS donnees_mapgeo AUTHORIZATION mapgeo;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

GRANT CONNECT ON DATABASE mapgeo_db TO mapgeo;
GRANT USAGE, CREATE ON SCHEMA donnees_mapgeo TO mapgeo;
GRANT USAGE ON SCHEMA public TO mapgeo;
ALTER ROLE mapgeo SET search_path TO donnees_mapgeo, public;
ALTER DATABASE mapgeo_db SET search_path TO donnees_mapgeo, public;

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename <> 'spatial_ref_sys'
          AND (
            tablename LIKE 'accounts_%'
            OR tablename LIKE 'auth_%'
            OR tablename LIKE 'client_%'
            OR tablename LIKE 'dashboard_%'
            OR tablename LIKE 'django_%'
            OR tablename LIKE 'documents_%'
            OR tablename LIKE 'imports_%'
            OR tablename LIKE 'notifications_%'
            OR tablename LIKE 'organizations_%'
            OR tablename LIKE 'parcels_%'
            OR tablename LIKE 'support_%'
            OR tablename IN (
                'communes', 'commune', 'limites_communales', 'sig_communes', 'gpkg_communes',
                'reseau_routier', 'réseau_routier', 'routes', 'roads', 'sig_routes', 'road_network', 'gpkg_routes',
                'infrastructures sanitaires', 'infrastructures_sanitaires', 'infrastructure_sanitaire',
                'sanitary_infrastructures', 'health_infrastructures', 'sig_infrastructures_sanitaires',
                'sante', 'sante_infrastructures',
                'infrastructures scolaires', 'infrastructures_scolaires', 'infrastructure_scolaire',
                'school_infrastructures', 'education_infrastructures', 'sig_infrastructures_scolaires',
                'ecoles', 'etablissements_scolaires'
            )
          )
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_tables
            WHERE schemaname = 'donnees_mapgeo'
              AND tablename = r.tablename
        ) THEN
            EXECUTE format('ALTER TABLE public.%I OWNER TO mapgeo', r.tablename);
            EXECUTE format('ALTER TABLE public.%I SET SCHEMA donnees_mapgeo', r.tablename);
            RAISE NOTICE 'Table déplacée : public.% -> donnees_mapgeo.%', r.tablename, r.tablename;
        ELSE
            RAISE NOTICE 'Ignoré public.% : existe déjà dans donnees_mapgeo', r.tablename;
        END IF;
    END LOOP;
END $$;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA donnees_mapgeo TO mapgeo;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA donnees_mapgeo TO mapgeo;
ALTER DEFAULT PRIVILEGES IN SCHEMA donnees_mapgeo GRANT ALL ON TABLES TO mapgeo;
ALTER DEFAULT PRIVILEGES IN SCHEMA donnees_mapgeo GRANT ALL ON SEQUENCES TO mapgeo;

DROP VIEW IF EXISTS public.parcels_parcel_qgis;
DROP VIEW IF EXISTS donnees_mapgeo.parcels_parcel_qgis;
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
GRANT SELECT ON donnees_mapgeo.parcels_parcel_qgis TO mapgeo;
