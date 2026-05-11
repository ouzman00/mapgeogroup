import re

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection


IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAPGEO_TABLE_PATTERNS = (
    "accounts_%",
    "auth_%",
    "client_%",
    "dashboard_%",
    "django_%",
    "documents_%",
    "imports_%",
    "notifications_%",
    "organizations_%",
    "parcels_%",
    "support_%",
)


class Command(BaseCommand):
    help = "Prépare le schéma PostgreSQL/PostGIS donnees_mapgeo pour MapGeo."

    def add_arguments(self, parser):
        parser.add_argument(
            "--move-public",
            action="store_true",
            help=(
                "Déplace les tables MapGeo encore présentes dans public vers DB_SCHEMA. "
                "La commande ne peut déplacer que les tables appartenant à l'utilisateur courant ; "
                "sinon utiliser scripts/move_public_mapgeo_tables_to_donnees_mapgeo.sql avec postgres."
            ),
        )

    def handle(self, *args, **options):
        schema = getattr(settings, "DB_SCHEMA", "donnees_mapgeo")
        if not IDENTIFIER_RE.match(schema):
            raise CommandError("DB_SCHEMA invalide. Utilise un identifiant simple, ex: donnees_mapgeo.")

        user = connection.settings_dict.get("USER") or "mapgeo"
        if not IDENTIFIER_RE.match(user):
            raise CommandError("Utilisateur PostgreSQL invalide pour cette commande automatique.")

        qn = connection.ops.quote_name
        moved = []
        skipped = []

        with connection.cursor() as cursor:
            cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {qn(schema)} AUTHORIZATION {qn(user)};")
            cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;")
            cursor.execute(f"GRANT USAGE, CREATE ON SCHEMA {qn(schema)} TO {qn(user)};")
            cursor.execute(f"GRANT USAGE ON SCHEMA public TO {qn(user)};")
            cursor.execute(f"ALTER ROLE {qn(user)} SET search_path TO {qn(schema)}, public;")
            cursor.execute(f"SET search_path TO {qn(schema)}, public;")

            if options["move_public"]:
                cursor.execute(
                    """
                    SELECT tablename, tableowner
                    FROM pg_tables
                    WHERE schemaname = 'public'
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
                        OR tablename = 'communes'
                      )
                    ORDER BY tablename;
                    """
                )
                rows = cursor.fetchall()
                for table_name, owner in rows:
                    cursor.execute(
                        """
                        SELECT EXISTS (
                            SELECT 1 FROM pg_tables
                            WHERE schemaname = %s AND tablename = %s
                        )
                        """,
                        [schema, table_name],
                    )
                    already_exists = cursor.fetchone()[0]
                    if already_exists:
                        skipped.append(f"{table_name} : déjà dans {schema}")
                        continue
                    if owner != user:
                        skipped.append(f"{table_name} : propriétaire={owner}, courant={user}")
                        continue
                    cursor.execute(f"ALTER TABLE public.{qn(table_name)} SET SCHEMA {qn(schema)};")
                    moved.append(table_name)

        self.stdout.write(self.style.SUCCESS(f"Schéma PostgreSQL prêt : {schema}"))
        if moved:
            self.stdout.write(self.style.SUCCESS("Tables déplacées : " + ", ".join(moved)))
        if skipped:
            self.stdout.write(self.style.WARNING("Tables non déplacées :"))
            for item in skipped:
                self.stdout.write(f"  - {item}")
            self.stdout.write(
                self.style.WARNING(
                    "Si ces tables doivent être déplacées, lance scripts/move_public_mapgeo_tables_to_donnees_mapgeo.sql avec l'utilisateur postgres."
                )
            )
