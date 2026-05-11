DO $$
DECLARE
    r record;
BEGIN
    CREATE SCHEMA IF NOT EXISTS donnees_mapgeo AUTHORIZATION mapgeo;
    CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

    GRANT CONNECT ON DATABASE mapgeo_db TO mapgeo;
    GRANT USAGE, CREATE ON SCHEMA donnees_mapgeo TO mapgeo;
    GRANT USAGE ON SCHEMA public TO mapgeo;

    ALTER ROLE mapgeo SET search_path TO donnees_mapgeo, public;
    ALTER DATABASE mapgeo_db SET search_path TO donnees_mapgeo, public;

    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('spatial_ref_sys')
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
            OR tablename = 'communes'
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
            RAISE NOTICE 'Table deplacee : public.% -> donnees_mapgeo.%', r.tablename, r.tablename;
        ELSE
            RAISE NOTICE 'Deja presente dans donnees_mapgeo : %', r.tablename;
        END IF;
    END LOOP;
END $$;