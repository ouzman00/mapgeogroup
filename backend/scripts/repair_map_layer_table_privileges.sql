-- Répare les droits de lecture des tables SIG utilisées par /api/map/layers/.
-- À lancer avec un rôle PostgreSQL admin dans la base mapgeo_db, par exemple :
-- & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d mapgeo_db -f scripts/repair_map_layer_table_privileges.sql
--
-- Le script est idempotent : il peut être relancé sans casser les données.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mapgeo') THEN
        CREATE ROLE mapgeo LOGIN PASSWORD 'mapgeo';
    END IF;
END $$;

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
        SELECT n.nspname AS schema_name, c.relname AS table_name
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND n.nspname IN ('donnees_mapgeo', 'public')
          AND c.relname IN (
              'communes', 'commune', 'limites_communales', 'sig_communes', 'gpkg_communes',
              'reseau_routier', 'réseau_routier', 'routes', 'roads', 'sig_routes', 'road_network', 'gpkg_routes',
              'infrastructures sanitaires', 'infrastructures_sanitaires', 'infrastructure_sanitaire',
              'sanitary_infrastructures', 'health_infrastructures', 'sig_infrastructures_sanitaires',
              'sante', 'sante_infrastructures',
              'infrastructures scolaires', 'infrastructures_scolaires', 'infrastructure_scolaire',
              'school_infrastructures', 'education_infrastructures', 'sig_infrastructures_scolaires',
              'ecoles', 'etablissements_scolaires'
          )
        ORDER BY n.nspname, c.relname
    LOOP
        EXECUTE format('GRANT SELECT ON TABLE %I.%I TO mapgeo', r.schema_name, r.table_name);
        RAISE NOTICE 'GRANT SELECT appliqué sur %.% pour mapgeo', r.schema_name, r.table_name;
    END LOOP;
END $$;

-- Les nouvelles tables créées dans donnees_mapgeo par mapgeo restent automatiquement lisibles par mapgeo.
ALTER DEFAULT PRIVILEGES IN SCHEMA donnees_mapgeo GRANT SELECT ON TABLES TO mapgeo;
