-- Préparation PostgreSQL/PostGIS locale pour MapGeo.
-- À lancer en utilisateur postgres dans la base mapgeo_db :
-- & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -d mapgeo_db -f scripts/setup_schema_donnees_mapgeo.sql

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mapgeo') THEN
        CREATE ROLE mapgeo LOGIN PASSWORD 'mapgeo';
    ELSE
        ALTER ROLE mapgeo WITH LOGIN PASSWORD 'mapgeo';
    END IF;
END $$;

ALTER DATABASE mapgeo_db OWNER TO mapgeo;
CREATE SCHEMA IF NOT EXISTS donnees_mapgeo AUTHORIZATION mapgeo;

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

GRANT CONNECT ON DATABASE mapgeo_db TO mapgeo;
GRANT USAGE, CREATE ON SCHEMA donnees_mapgeo TO mapgeo;
GRANT USAGE ON SCHEMA public TO mapgeo;
ALTER ROLE mapgeo SET search_path TO donnees_mapgeo, public;
ALTER DATABASE mapgeo_db SET search_path TO donnees_mapgeo, public;
