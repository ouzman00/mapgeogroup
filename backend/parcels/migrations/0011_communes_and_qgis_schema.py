from django.contrib.gis.db import models as gis_models
from django.db import migrations, models


CREATE_COMMUNES_AND_QGIS_VIEW = r"""
SET search_path TO donnees_mapgeo, public;
CREATE SCHEMA IF NOT EXISTS donnees_mapgeo AUTHORIZATION mapgeo;

-- Table SIG des communes. Cette migration est volontairement idempotente :
-- elle fonctionne aussi si une ancienne table communes existe déjà dans le schéma.
CREATE TABLE IF NOT EXISTS communes (
    id bigserial PRIMARY KEY
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'donnees_mapgeo' AND table_name = 'communes' AND column_name = 'id'
    ) THEN
        ALTER TABLE donnees_mapgeo.communes ADD COLUMN id bigserial;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'donnees_mapgeo'
          AND t.relname = 'communes'
          AND c.contype = 'p'
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

-- Harmonise la géométrie en EPSG:32628 sans supprimer les données existantes.
ALTER TABLE donnees_mapgeo.communes
ALTER COLUMN geom TYPE geometry(Geometry, 32628)
USING CASE
    WHEN geom IS NULL THEN NULL
    WHEN ST_SRID(geom) = 32628 THEN geom
    WHEN ST_SRID(geom) = 0 THEN ST_SetSRID(geom, 32628)
    ELSE ST_Transform(geom, 32628)
END;

-- Essaie de renseigner nom/code depuis les colonnes historiques fréquentes.
DO $$
DECLARE
    candidate text;
BEGIN
    FOREACH candidate IN ARRAY ARRAY['CCRCA_1', 'ccrca_1', 'COMMUNE', 'commune', 'NOM', 'nom_commune', 'NAME', 'name']
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'donnees_mapgeo'
              AND table_name = 'communes'
              AND column_name = candidate
        ) THEN
            EXECUTE format(
                'UPDATE donnees_mapgeo.communes SET nom = NULLIF(%I::text, '''') WHERE nom IS NULL OR nom = ''''',
                candidate
            );
            EXIT WHEN EXISTS (SELECT 1 FROM donnees_mapgeo.communes WHERE nom IS NOT NULL AND nom <> '');
        END IF;
    END LOOP;

    FOREACH candidate IN ARRAY ARRAY['CODE', 'code_commune', 'CODE_COMMUNE', 'id_commune', 'ID_COMMUNE']
    LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'donnees_mapgeo'
              AND table_name = 'communes'
              AND column_name = candidate
        ) THEN
            EXECUTE format(
                'UPDATE donnees_mapgeo.communes SET code = NULLIF(%I::text, '''') WHERE code IS NULL OR code = ''''',
                candidate
            );
            EXIT WHEN EXISTS (SELECT 1 FROM donnees_mapgeo.communes WHERE code IS NOT NULL AND code <> '');
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
"""

DROP_QGIS_VIEW = r"""
DROP VIEW IF EXISTS donnees_mapgeo.parcels_parcel_qgis;
"""


class Migration(migrations.Migration):

    dependencies = [
        ("parcels", "0010_reference_unique_per_active_organization"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(CREATE_COMMUNES_AND_QGIS_VIEW, reverse_sql=DROP_QGIS_VIEW),
            ],
            state_operations=[
                migrations.CreateModel(
                    name="Commune",
                    fields=[
                        ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                        ("code", models.CharField(blank=True, db_index=True, max_length=64, null=True)),
                        ("nom", models.CharField(db_index=True, max_length=255)),
                        ("department", models.CharField(blank=True, max_length=255, null=True)),
                        ("region", models.CharField(blank=True, max_length=255, null=True)),
                        ("geom", gis_models.GeometryField(blank=True, null=True, srid=32628)),
                        ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                        ("updated_at", models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        "db_table": "communes",
                        "ordering": ["nom", "id"],
                        "indexes": [
                            models.Index(fields=["nom"], name="communes_nom_idx"),
                            models.Index(fields=["department", "nom"], name="communes_department_nom_idx"),
                        ],
                    },
                ),
            ],
        ),
    ]
