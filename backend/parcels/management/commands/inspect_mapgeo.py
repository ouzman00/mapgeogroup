from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder


class Command(BaseCommand):
    help = "Inspection globale MapGeo : base, schéma, tables SIG, SRID, vue QGIS, migrations et SQLite."

    def add_arguments(self, parser):
        parser.add_argument("--fail-on-warning", action="store_true", help="Retourne une erreur si des avertissements sont détectés.")

    def handle(self, *args, **options):
        schema = getattr(settings, "DB_SCHEMA", "donnees_mapgeo")
        errors: list[str] = []
        warnings: list[str] = []

        def ok(message: str):
            self.stdout.write(self.style.SUCCESS(f"OK  {message}"))

        def warn(message: str):
            warnings.append(message)
            self.stdout.write(self.style.WARNING(f"WARN {message}"))

        def err(message: str):
            errors.append(message)
            self.stdout.write(self.style.ERROR(f"ERR {message}"))

        db = settings.DATABASES["default"]
        engine = db.get("ENGINE", "")
        self.stdout.write("\n=== Configuration Django ===")
        self.stdout.write(f"ENGINE     : {engine}")
        self.stdout.write(f"NAME       : {db.get('NAME')}")
        self.stdout.write(f"USER       : {db.get('USER')}")
        self.stdout.write(f"HOST       : {db.get('HOST')}")
        self.stdout.write(f"PORT       : {db.get('PORT')}")
        self.stdout.write(f"DB_SCHEMA  : {schema}")

        if "sqlite" in engine.lower():
            err("SQLite est actif : MapGeo doit utiliser PostgreSQL/PostGIS.")
        elif "postgis" in engine.lower():
            ok("Backend PostgreSQL/PostGIS actif")
        else:
            warn("Le moteur n'est pas explicitement PostGIS.")

        sqlite_files = sorted(Path(settings.BASE_DIR).glob("*.sqlite3"))
        if sqlite_files:
            warn("Fichiers SQLite présents dans le backend : " + ", ".join(path.name for path in sqlite_files))
        else:
            ok("Aucun fichier .sqlite3 dans le dossier backend")

        self.stdout.write("\n=== Connexion et extensions ===")
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_database(), current_user, current_setting('search_path')")
                database_name, user, search_path = cursor.fetchone()
                self.stdout.write(f"Base       : {database_name}")
                self.stdout.write(f"Utilisateur: {user}")
                self.stdout.write(f"search_path: {search_path}")
                if schema not in str(search_path):
                    warn(f"Le search_path ne contient pas {schema}.")
                else:
                    ok(f"search_path contient {schema}")

                cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='postgis')")
                if cursor.fetchone()[0]:
                    cursor.execute("SELECT postgis_full_version()")
                    self.stdout.write("PostGIS    : " + cursor.fetchone()[0].split()[0])
                    ok("Extension PostGIS disponible")
                else:
                    err("Extension PostGIS absente")
        except Exception as exc:
            err(f"Connexion PostgreSQL impossible : {exc}")
            self._finish(errors, warnings, options["fail_on_warning"])
            return

        self.stdout.write("\n=== Schéma et tables ===")
        required_tables = [
            "communes",
            "parcels_parcel",
            "parcels_parcelgeometryversion",
            "django_migrations",
            "accounts_user",
            "organizations_organization",
        ]
        table_exists = {}
        with connection.cursor() as cursor:
            cursor.execute("SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name=%s)", [schema])
            if cursor.fetchone()[0]:
                ok(f"Schéma {schema} présent")
            else:
                err(f"Schéma {schema} absent")

            for table in required_tables:
                cursor.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema=%s AND table_name=%s
                    )
                    """,
                    [schema, table],
                )
                table_exists[table] = cursor.fetchone()[0]
                if table_exists[table]:
                    ok(f"Table {schema}.{table} présente")
                else:
                    err(f"Table {schema}.{table} absente")

            cursor.execute(
                """
                SELECT tablename
                FROM pg_tables
                WHERE schemaname='public'
                  AND tablename <> 'spatial_ref_sys'
                  AND (
                    tablename LIKE 'accounts_%%'
                    OR tablename LIKE 'auth_%%'
                    OR tablename LIKE 'client_%%'
                    OR tablename LIKE 'dashboard_%%'
                    OR tablename LIKE 'django_%%'
                    OR tablename LIKE 'documents_%%'
                    OR tablename LIKE 'imports_%%'
                    OR tablename LIKE 'notifications_%%'
                    OR tablename LIKE 'organizations_%%'
                    OR tablename LIKE 'parcels_%%'
                    OR tablename LIKE 'support_%%'
                    OR tablename='communes'
                  )
                ORDER BY tablename;
                """
            )
            public_leftovers = [row[0] for row in cursor.fetchall()]
            if public_leftovers:
                warn("Tables MapGeo encore dans public : " + ", ".join(public_leftovers))
            else:
                ok("Aucune table métier MapGeo restante dans public")

        self.stdout.write("\n=== Données SIG ===")
        with connection.cursor() as cursor:
            self._table_count(cursor, schema, "communes", table_exists.get("communes"), warnings, errors)
            self._table_count(cursor, schema, "parcels_parcel", table_exists.get("parcels_parcel"), warnings, errors)
            self._geom_report(cursor, schema, "communes", "geom", expected_srid=32628, exists=table_exists.get("communes"), warnings=warnings, errors=errors)
            self._geom_report(cursor, schema, "parcels_parcel", "geom", expected_srid=32628, exists=table_exists.get("parcels_parcel"), warnings=warnings, errors=errors)

        self.stdout.write("\n=== Vue QGIS ===")
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.views
                    WHERE table_schema=%s AND table_name='parcels_parcel_qgis'
                )
                """,
                [schema],
            )
            if cursor.fetchone()[0]:
                ok(f"Vue {schema}.parcels_parcel_qgis présente")
                try:
                    cursor.execute(f'SELECT COUNT(*) FROM "{schema}"."parcels_parcel_qgis"')
                    self.stdout.write(f"Vue QGIS lignes : {cursor.fetchone()[0]}")
                except Exception as exc:
                    err(f"Vue QGIS présente mais non lisible : {exc}")
            else:
                warn(f"Vue {schema}.parcels_parcel_qgis absente")

        self.stdout.write("\n=== Migrations Django ===")
        try:
            applied = set(MigrationRecorder(connection).applied_migrations())
            if ("parcels", "0011_communes_and_qgis_schema") in applied:
                ok("Migration parcels.0011 appliquée")
            else:
                warn("Migration parcels.0011 non appliquée")
        except Exception as exc:
            warn(f"Impossible de lire django_migrations : {exc}")

        self._finish(errors, warnings, options["fail_on_warning"])

    def _table_count(self, cursor, schema, table, exists, warnings, errors):
        if not exists:
            return
        try:
            cursor.execute(f'SELECT COUNT(*) FROM "{schema}"."{table}"')
            count = cursor.fetchone()[0]
            self.stdout.write(f"{schema}.{table}: {count} lignes")
            if table in {"communes", "parcels_parcel"} and count == 0:
                warnings.append(f"{schema}.{table} est vide.")
                self.stdout.write(self.style.WARNING(f"WARN {schema}.{table} est vide."))
        except Exception as exc:
            errors.append(f"Impossible de compter {schema}.{table}: {exc}")
            self.stdout.write(self.style.ERROR(f"ERR Impossible de compter {schema}.{table}: {exc}"))

    def _geom_report(self, cursor, schema, table, column, expected_srid, exists, warnings, errors):
        if not exists:
            return
        cursor.execute(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema=%s AND table_name=%s AND column_name=%s
            )
            """,
            [schema, table, column],
        )
        if not cursor.fetchone()[0]:
            errors.append(f"{schema}.{table}.{column} absent")
            self.stdout.write(self.style.ERROR(f"ERR {schema}.{table}.{column} absent"))
            return
        try:
            cursor.execute(
                f'''
                SELECT
                    COUNT(*) FILTER (WHERE "{column}" IS NOT NULL) AS with_geom,
                    COUNT(*) FILTER (WHERE "{column}" IS NOT NULL AND ST_IsEmpty("{column}")) AS empty_geom,
                    ARRAY_REMOVE(ARRAY_AGG(DISTINCT ST_SRID("{column}")) FILTER (WHERE "{column}" IS NOT NULL), NULL) AS srids
                FROM "{schema}"."{table}"
                '''
            )
            with_geom, empty_geom, srids = cursor.fetchone()
            self.stdout.write(f"{schema}.{table}.{column}: {with_geom} géométries, {empty_geom} vides, SRID={srids or []}")
            if with_geom == 0:
                warnings.append(f"{schema}.{table}.{column} ne contient aucune géométrie.")
                self.stdout.write(self.style.WARNING(f"WARN {schema}.{table}.{column} ne contient aucune géométrie."))
            if srids and any(int(srid) != expected_srid for srid in srids):
                warnings.append(f"{schema}.{table}.{column} contient des SRID différents de EPSG:{expected_srid}: {srids}")
                self.stdout.write(self.style.WARNING(f"WARN SRID inattendu pour {schema}.{table}.{column}: {srids}"))
        except Exception as exc:
            errors.append(f"Impossible d'inspecter {schema}.{table}.{column}: {exc}")
            self.stdout.write(self.style.ERROR(f"ERR Impossible d'inspecter {schema}.{table}.{column}: {exc}"))

    def _finish(self, errors, warnings, fail_on_warning):
        self.stdout.write("\n=== Résultat ===")
        if errors:
            self.stdout.write(self.style.ERROR(f"Inspection échouée : {len(errors)} erreur(s), {len(warnings)} avertissement(s)."))
            raise SystemExit(1)
        if warnings:
            self.stdout.write(self.style.WARNING(f"Inspection terminée avec {len(warnings)} avertissement(s)."))
            if fail_on_warning:
                raise SystemExit(2)
            return
        self.stdout.write(self.style.SUCCESS("Inspection réussie : configuration cohérente."))
