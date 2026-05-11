-- Répare/normalise donnees_mapgeo.communes sans supprimer les données.
-- À lancer avec postgres si une table communes existante a une structure ancienne.

SET search_path TO donnees_mapgeo, public;
CREATE SCHEMA IF NOT EXISTS donnees_mapgeo AUTHORIZATION mapgeo;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;

CREATE TABLE IF NOT EXISTS donnees_mapgeo.communes (id bigserial PRIMARY KEY);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='donnees_mapgeo' AND table_name='communes' AND column_name='id'
    ) THEN
        ALTER TABLE donnees_mapgeo.communes ADD COLUMN id bigserial;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='donnees_mapgeo' AND t.relname='communes' AND c.contype='p'
    ) THEN
        ALTER TABLE donnees_mapgeo.communes ADD PRIMARY KEY (id);
    END IF;
END $$;

ALTER TABLE donnees_mapgeo.communes ADD COLUMN IF NOT EXISTS code varchar(64);
ALTER TABLE donnees_mapgeo.communes ADD COLUMN IF NOT EXISTS nom varchar(255);
ALTER TABLE donnees_mapgeo.communes ADD COLUMN IF NOT EXISTS department varchar(255);
ALTER TABLE donnees_mapgeo.communes ADD COLUMN IF NOT EXISTS region varchar(255);
ALTER TABLE donnees_mapgeo.communes ADD COLUMN IF NOT EXISTS geom geometry(Geometry, 32628);
ALTER TABLE donnees_mapgeo.communes ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT NOW();
ALTER TABLE donnees_mapgeo.communes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

ALTER TABLE donnees_mapgeo.communes
ALTER COLUMN geom TYPE geometry(Geometry, 32628)
USING CASE
    WHEN geom IS NULL THEN NULL
    WHEN ST_SRID(geom) = 32628 THEN geom
    WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 32628)
    ELSE ST_Transform(geom, 32628)
END;

DO $$
DECLARE
    candidate text;
BEGIN
    FOREACH candidate IN ARRAY ARRAY['CCRCA_1', 'ccrca_1', 'COMMUNE', 'commune', 'NOM', 'nom_commune', 'NAME', 'name']
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='donnees_mapgeo' AND table_name='communes' AND column_name=candidate
        ) THEN
            EXECUTE format('UPDATE donnees_mapgeo.communes SET nom = NULLIF(%I::text, '''') WHERE nom IS NULL OR nom = ''''', candidate);
            EXIT WHEN EXISTS (SELECT 1 FROM donnees_mapgeo.communes WHERE nom IS NOT NULL AND nom <> '');
        END IF;
    END LOOP;
END $$;

UPDATE donnees_mapgeo.communes
SET nom = COALESCE(NULLIF(nom, ''), NULLIF(code, ''), CONCAT('Commune ', id))
WHERE nom IS NULL OR nom = '';
ALTER TABLE donnees_mapgeo.communes ALTER COLUMN nom SET NOT NULL;

CREATE INDEX IF NOT EXISTS communes_code_idx ON donnees_mapgeo.communes (code);
CREATE INDEX IF NOT EXISTS communes_nom_idx ON donnees_mapgeo.communes (nom);
CREATE INDEX IF NOT EXISTS communes_department_nom_idx ON donnees_mapgeo.communes (department, nom);
CREATE INDEX IF NOT EXISTS communes_geom_gix ON donnees_mapgeo.communes USING GIST (geom);

ALTER TABLE donnees_mapgeo.communes OWNER TO mapgeo;
GRANT ALL ON TABLE donnees_mapgeo.communes TO mapgeo;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA donnees_mapgeo TO mapgeo;
