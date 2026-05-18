from __future__ import annotations

import json
import re
from typing import Any

import psycopg2
from psycopg2 import sql
from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry
from django.db import transaction
from rest_framework.exceptions import ValidationError

from client_map_layers.geojson_utils import (
    bounds_from_positions,
    collect_positions,
    geometry_type_counts,
    summarize_geojson_attributes,
)
from client_map_layers.models import ClientMapLayer, ClientMapLayerFeature

IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
FORBIDDEN_SQL_RE = re.compile(r"(;|--|/\*|\*/|\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|call|do)\b)", re.IGNORECASE)
GEOMETRY_COLUMN_CANDIDATES = ("geom", "geometry", "the_geom", "wkb_geometry")
ID_COLUMN_CANDIDATES = ("id", "gid", "fid", "ogc_fid")

POSTGIS_DASHBOARD_EXCLUDED_TABLE_PREFIXES = (
    "auth_",
    "django_",
    "sessions_",
    "accounts_",
    "admin_",
    "client_map_layers_",
    "parcels_parcelgeometry",
)

POSTGIS_DASHBOARD_EXCLUDED_TABLES = {
    "client_map_layers_clientmaplayerfeature",
    "parcels_parcelgeometryversion",
}


def _clean_identifier(value: Any, field_name: str) -> str:
    raw = str(value or "").strip()
    if not raw or not IDENTIFIER_RE.match(raw):
        raise ValidationError({field_name: "Identifiant PostgreSQL invalide. Utilisez uniquement lettres, chiffres et underscore, sans espace."})
    return raw


def _optional_identifier(value: Any, field_name: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return _clean_identifier(raw, field_name)


_ALLOWED_WHERE_TOKEN_RE = re.compile(
    r"""
    (?:
        '(?:[^'\\]|\\.)*'      # chaine SQL standard
        | "(?:[^"\\]|\\.)*"        # identifiant entre guillemets
        | [A-Za-z_][A-Za-z0-9_\.]*    # identifiant ou mot cle (table.colonne)
        | -?\d+(?:\.\d+)?           # nombre signe ou decimal
        | <=|>=|<>|!=|=|<|>             # operateurs de comparaison
        | \(|\)|,                     # parentheses et virgule
        | \s+                         # espaces
    )
    """,
    re.VERBOSE | re.IGNORECASE,
)

_ALLOWED_WHERE_KEYWORDS = {
    "and", "or", "not", "in", "between", "is", "null",
    "true", "false", "like", "ilike",
}

_FORBIDDEN_WHERE_KEYWORDS = {
    "select", "from", "where", "join", "union", "having",
    "insert", "update", "delete", "drop", "alter", "create",
    "truncate", "grant", "revoke", "copy", "execute", "call",
    "do", "with", "returning", "fetch", "lateral", "case",
}


def _clean_where_clause(value: Any) -> str:
    """Whitelist stricte pour la clause WHERE PostGIS.

    On refuse :
      - tout token hors identifiants, nombres, chaines, operateurs simples ;
      - tout appel de fonction (parenthese precedee d un identifiant) ;
      - tout point-virgule et commentaire SQL ;
      - tout mot-cle SQL dangereux meme s il passe la tokenisation.
    """
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) > 1000:
        raise ValidationError({"postgis_where_clause": "Filtre WHERE trop long. Limitez-vous a 1000 caracteres."})

    forbidden_chars = (";", "--", "/*", "*/", "::", "@@", "->", "->>", "#>", "#>>")
    for marker in forbidden_chars:
        if marker in raw:
            raise ValidationError({"postgis_where_clause": "Filtre WHERE refuse : caracteres SQL avances interdits."})

    # Tokenisation par whitelist : tout caractere non couvert est rejete.
    reconstructed = []
    position = 0
    for match in _ALLOWED_WHERE_TOKEN_RE.finditer(raw):
        if match.start() != position:
            raise ValidationError({"postgis_where_clause": f"Filtre WHERE refuse : caractere invalide a la position {position}."})
        reconstructed.append(match.group(0))
        position = match.end()
    if position != len(raw):
        raise ValidationError({"postgis_where_clause": f"Filtre WHERE refuse : caractere invalide a la position {position}."})

    # Pas d appel de fonction : identifiant immediatement suivi de "(".
    if re.search(r"[A-Za-z_][A-Za-z0-9_\.]*\s*\(", raw):
        raise ValidationError({"postgis_where_clause": "Filtre WHERE refuse : aucun appel de fonction autorise."})

    # Mots-cles interdits, meme isoles.
    for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", raw):
        lowered = token.lower()
        if lowered in _FORBIDDEN_WHERE_KEYWORDS:
            raise ValidationError({"postgis_where_clause": f"Filtre WHERE refuse : mot-cle SQL interdit ({token})."})

    return raw


def _default_postgis_connection() -> dict[str, str]:
    """Connexion PostGIS utilisée pour les imports portefeuille.

    En production, on utilise exclusivement la connexion Django DATABASE_URL/DB_SCHEMA.
    Les variables POSTGIS_IMPORT_DEFAULT_* ne sont prises en compte que si
    POSTGIS_IMPORT_ALLOW_CONNECTION_OVERRIDE est explicitement activé.
    """
    default_db = getattr(settings, "DATABASES", {}).get("default", {}) or {}
    allow_connection_override = getattr(settings, "POSTGIS_IMPORT_ALLOW_CONNECTION_OVERRIDE", False)
    override = {
        "host": getattr(settings, "POSTGIS_IMPORT_DEFAULT_HOST", "") if allow_connection_override else "",
        "port": getattr(settings, "POSTGIS_IMPORT_DEFAULT_PORT", "") if allow_connection_override else "",
        "database": getattr(settings, "POSTGIS_IMPORT_DEFAULT_DATABASE", "") if allow_connection_override else "",
        "username": getattr(settings, "POSTGIS_IMPORT_DEFAULT_USER", "") if allow_connection_override else "",
        "password": getattr(settings, "POSTGIS_IMPORT_DEFAULT_PASSWORD", "") if allow_connection_override else "",
        "schema": getattr(settings, "POSTGIS_IMPORT_DEFAULT_SCHEMA", "") if allow_connection_override else "",
    }
    return {
        "host": str(override["host"] or default_db.get("HOST") or "127.0.0.1"),
        "port": str(override["port"] or default_db.get("PORT") or "5432"),
        "database": str(override["database"] or default_db.get("NAME") or "mapgeo_db"),
        "username": str(override["username"] or default_db.get("USER") or "mapgeo"),
        "password": str(override["password"] or default_db.get("PASSWORD") or ""),
        "schema": str(override["schema"] or getattr(settings, "DB_SCHEMA", "donnees_mapgeo") or "donnees_mapgeo"),
    }


def normalize_postgis_options(data: dict[str, Any]) -> dict[str, Any]:
    """Valide les paramètres d'import PostGIS sans exposer les secrets au client."""
    defaults = _default_postgis_connection()

    # En production, ne jamais laisser le navigateur écraser la connexion PostGIS.
    # Le backend utilise DATABASE_URL / DB_SCHEMA de Render, ce qui évite qu'un
    # ancien formulaire force 127.0.0.1, mapgeo_db ou mapgeo en production.
    connection_data = data if getattr(settings, "POSTGIS_IMPORT_ALLOW_CONNECTION_OVERRIDE", False) else {}

    host = str(connection_data.get("postgis_host") or defaults["host"]).strip()
    database = str(connection_data.get("postgis_database") or defaults["database"]).strip()
    username = str(connection_data.get("postgis_username") or defaults["username"]).strip()
    password = str(connection_data.get("postgis_password") or defaults["password"]).strip()
    if not host:
        raise ValidationError({"postgis_host": "Hôte PostGIS obligatoire. Vérifiez DATABASE_URL ou DB_HOST dans .env."})
    if not database:
        raise ValidationError({"postgis_database": "Base de données PostGIS obligatoire. Vérifiez DATABASE_URL ou DB_NAME dans .env."})
    if not username:
        raise ValidationError({"postgis_username": "Utilisateur PostGIS obligatoire. Vérifiez DATABASE_URL ou DB_USER dans .env."})
    if not password:
        raise ValidationError({"postgis_password": "Mot de passe PostGIS introuvable. Renseignez DATABASE_URL ou DB_PASSWORD dans .env."})

    try:
        port = int(connection_data.get("postgis_port") or defaults["port"] or 5432)
    except Exception as exc:
        raise ValidationError({"postgis_port": "Port PostGIS invalide."}) from exc
    if port <= 0 or port > 65535:
        raise ValidationError({"postgis_port": "Port PostGIS invalide."})

    try:
        limit = int(data.get("postgis_limit") or getattr(settings, "MAX_POSTGIS_IMPORT_FEATURES", 20000))
    except Exception as exc:
        raise ValidationError({"postgis_limit": "Limite d'import invalide."}) from exc
    limit = max(1, min(limit, int(getattr(settings, "MAX_POSTGIS_IMPORT_FEATURES", 20000))))

    source_srid_raw = str(data.get("postgis_source_srid") or "auto").strip().lower()
    try:
        source_srid = None if source_srid_raw in {"", "auto"} else int(source_srid_raw.replace("epsg:", ""))
    except Exception as exc:
        raise ValidationError({"postgis_source_srid": "SRID source invalide."}) from exc
    if source_srid is not None and (source_srid <= 0 or source_srid > 999999):
        raise ValidationError({"postgis_source_srid": "SRID source invalide."})

    return {
        "host": host,
        "port": port,
        "database": database,
        "username": username,
        "password": password,
        "schema": _clean_identifier(data.get("postgis_schema") or defaults["schema"], "postgis_schema"),
        "table": _clean_identifier(data.get("postgis_table"), "postgis_table"),
        "geometry_column": _optional_identifier(data.get("postgis_geometry_column"), "postgis_geometry_column") or "geom",
        "id_column": _optional_identifier(data.get("postgis_id_column"), "postgis_id_column"),
        "source_srid": source_srid,
        "where_clause": _clean_where_clause(data.get("postgis_where_clause")),
        "limit": limit,
    }


def safe_postgis_metadata(options: dict[str, Any], *, feature_count: int = 0, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "source_format": "postgis",
        "source_origin": "postgis",
        "storage": "database",
        "source_kind": ClientMapLayer.SOURCE_DATABASE,
        "postgis_schema": options.get("schema"),
        "postgis_table": options.get("table"),
        "postgis_geometry_column": options.get("geometry_column"),
        "postgis_id_column": options.get("id_column"),
        "postgis_host_configured": bool(options.get("host")),
        "postgis_database_configured": bool(options.get("database")),
        "source_srid": options.get("source_srid") or "auto",
        "served_crs": "EPSG:4326",
        "feature_count": feature_count,
        **(extra or {}),
    }


def _connect(options: dict[str, Any]):
    return psycopg2.connect(
        host=options["host"],
        port=options["port"],
        dbname=options["database"],
        user=options["username"],
        password=options["password"],
        connect_timeout=int(getattr(settings, "POSTGIS_IMPORT_CONNECT_TIMEOUT", 10)),
        options="-c statement_timeout={}".format(int(getattr(settings, "POSTGIS_IMPORT_STATEMENT_TIMEOUT_MS", 30000))),
    )


def _relation_matches(cursor, table: str) -> list[tuple[str, str]]:
    cursor.execute(
        """
        SELECT n.nspname, c.relname
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
          AND c.relname = %s
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY CASE WHEN n.nspname = 'donnees_mapgeo' THEN 0 WHEN n.nspname = 'public' THEN 1 ELSE 2 END, n.nspname
        """,
        [table],
    )
    return [(str(schema), str(name)) for schema, name in cursor.fetchall()]


def _column_metadata(cursor, schema: str, table: str) -> dict[str, dict[str, str]]:
    cursor.execute(
        """
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        [schema, table],
    )
    return {
        str(name): {"data_type": str(data_type or ""), "udt_name": str(udt_name or "")}
        for name, data_type, udt_name in cursor.fetchall()
    }


def _resolve_postgis_table_options(conn, options: dict[str, object]) -> dict[str, object]:
    resolved = {**options}
    requested_schema = str(resolved.get("schema") or "").strip()
    table = str(resolved.get("table") or "").strip()

    with conn.cursor() as cursor:
        matches = _relation_matches(cursor, table)
        requested_match = next((schema for schema, name in matches if schema == requested_schema), None)
        if requested_match:
            resolved["schema"] = requested_match
        elif len(matches) == 1:
            resolved["schema"] = matches[0][0]
        elif matches:
            schemas = ", ".join(schema for schema, _name in matches)
            raise ValidationError({"postgis_schema": f"La table `{table}` existe dans plusieurs schémas ({schemas}). Renseignez le schéma exact."})
        else:
            raise ValidationError({"postgis_table": f"Table ou vue PostGIS introuvable : `{requested_schema}.{table}`."})

        columns = _column_metadata(cursor, resolved["schema"], table)
        if not columns:
            raise ValidationError({"postgis_table": f"Impossible de lire les colonnes de `{resolved['schema']}.{table}`."})

        column_names = set(columns.keys())
        geometry_columns = [name for name, meta in columns.items() if meta.get("udt_name") == "geometry"]
        requested_geom = str(resolved.get("geometry_column") or "").strip()
        if requested_geom not in geometry_columns:
            preferred_geom = next((name for name in GEOMETRY_COLUMN_CANDIDATES if name in geometry_columns), None)
            preferred_geom = preferred_geom or (geometry_columns[0] if geometry_columns else "")
            if not preferred_geom:
                available = ", ".join(columns.keys())
                raise ValidationError({"postgis_geometry_column": f"Aucune colonne géométrique PostGIS trouvée dans `{resolved['schema']}.{table}`. Colonnes disponibles : {available}"})
            resolved["geometry_column"] = preferred_geom

        requested_id = str(resolved.get("id_column") or "").strip()
        if requested_id and requested_id in column_names:
            resolved["id_column"] = requested_id
        else:
            resolved["id_column"] = next((name for name in ID_COLUMN_CANDIDATES if name in column_names), "")

    return resolved


def _build_query(options: dict[str, Any]):
    fallback_srid = int(getattr(settings, "POSTGIS_IMPORT_FALLBACK_SRID", 32628))
    geom_identifier = sql.Identifier(options["geometry_column"])
    if options.get("source_srid"):
        geom_expr = sql.SQL("ST_SetSRID(t.{geom}, {srid})").format(
            geom=geom_identifier,
            srid=sql.Literal(options["source_srid"]),
        )
    else:
        geom_expr = sql.SQL(
            "CASE WHEN ST_SRID(t.{geom}) = 0 THEN ST_SetSRID(t.{geom}, {fallback_srid}) ELSE t.{geom} END"
        ).format(
            geom=geom_identifier,
            fallback_srid=sql.Literal(fallback_srid),
        )
    id_expr = sql.SQL("t.{id_col}::text").format(id_col=sql.Identifier(options["id_column"])) if options.get("id_column") else sql.SQL("NULL::text")
    where_parts = [sql.SQL("t.{geom} IS NOT NULL").format(geom=geom_identifier)]
    if options.get("where_clause"):
        # Le filtre a déjà été limité à une clause simple sans commande destructive.
        where_parts.append(sql.SQL("({})").format(sql.SQL(options["where_clause"])))
    where_sql = sql.SQL(" AND ").join(where_parts)
    return sql.SQL("""
        SELECT
            {id_expr} AS source_feature_id,
            ST_AsGeoJSON(ST_Transform({geom_expr}, 4326)) AS geometry_json,
            (to_jsonb(t) - {geom_name}) AS properties
        FROM {schema}.{table} AS t
        WHERE {where_sql}
        LIMIT {limit}
    """).format(
        id_expr=id_expr,
        geom_expr=geom_expr,
        geom_name=sql.Literal(options["geometry_column"]),
        schema=sql.Identifier(options["schema"]),
        table=sql.Identifier(options["table"]),
        where_sql=where_sql,
        limit=sql.Literal(options["limit"]),
    )




def _is_dashboard_postgis_table(table_name: str) -> bool:
    normalized = str(table_name or "").strip().lower()
    if not normalized:
        return False
    if normalized in POSTGIS_DASHBOARD_EXCLUDED_TABLES:
        return False
    return not any(normalized.startswith(prefix) for prefix in POSTGIS_DASHBOARD_EXCLUDED_TABLE_PREFIXES)


def list_available_postgis_tables(data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Liste les vraies tables/vues PostGIS disponibles via la connexion Django active.

    Important Render :
    on ne recrée pas une connexion psycopg2 manuelle ici. Django est déjà connecté
    à DATABASE_URL, donc on réutilise cette connexion pour éviter les erreurs de
    parsing/connexion côté hébergement.
    """
    preferred_schema = str(getattr(settings, "DB_SCHEMA", "donnees_mapgeo") or "donnees_mapgeo")

    query = """
        SELECT
            n.nspname AS schema_name,
            c.relname AS table_name,
            CASE c.relkind
                WHEN 'v' THEN 'view'
                WHEN 'm' THEN 'materialized_view'
                WHEN 'f' THEN 'foreign_table'
                WHEN 'p' THEN 'partitioned_table'
                ELSE 'table'
            END AS relation_type,
            ARRAY_AGG(a.attname ORDER BY a.attnum) FILTER (WHERE t.typname = 'geometry') AS geometry_columns,
            ARRAY_AGG(a.attname ORDER BY a.attnum) AS columns
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
        WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%%'
        GROUP BY n.nspname, c.relname, c.relkind
        HAVING COUNT(*) FILTER (WHERE t.typname = 'geometry') > 0
        ORDER BY
          CASE WHEN n.nspname = %s THEN 0 WHEN n.nspname = 'public' THEN 1 ELSE 2 END,
          n.nspname,
          c.relname
    """

    try:
        from django.db import connection as django_connection

        with django_connection.cursor() as cursor:
            cursor.execute(query, [preferred_schema])
            rows = cursor.fetchall()
    except Exception as exc:
        raise ValidationError({"postgis": f"Impossible de lister les tables PostGIS : {exc}"}) from exc

    tables: list[dict[str, Any]] = []

    for schema_name, table_name, relation_type, geometry_columns, columns in rows:
        if not _is_dashboard_postgis_table(table_name):
            continue
        geometry_columns = [str(item) for item in (geometry_columns or [])]
        columns = [str(item) for item in (columns or [])]

        geometry_column = next(
            (name for name in GEOMETRY_COLUMN_CANDIDATES if name in geometry_columns),
            geometry_columns[0] if geometry_columns else "",
        )
        id_column = next((name for name in ID_COLUMN_CANDIDATES if name in columns), "")

        table_label = str(table_name).replace("_", " ").strip().title() or str(table_name)
        if str(schema_name) != preferred_schema:
            table_label = f"{table_label} ({schema_name})"

        tables.append({
            "schema": str(schema_name),
            "table": str(table_name),
            "value": str(table_name),
            "qualified_name": f"{schema_name}.{table_name}",
            "label": table_label,
            "relation_type": str(relation_type),
            "geometry_column": geometry_column,
            "id_column": id_column,
        })

    return {
        "tables": tables,
        "count": len(tables),
        "preferred_schema": preferred_schema,
    }


def inspect_postgis_table_metadata(options: dict[str, Any], *, sample_limit: int = 2000) -> dict[str, Any]:
    """Retourne un aperçu sûr des attributs PostGIS sans créer de couche.

    Utilisé par le backoffice pour préremplir la symbologie catégorisée dès
    qu'une table est choisie. Les secrets de connexion ne sont jamais renvoyés.
    """
    preview_options = {**options, "limit": max(1, min(int(sample_limit or 2000), int(options.get("limit") or sample_limit or 2000), 5000))}
    features_for_metadata: list[dict[str, Any]] = []
    positions: list[list[float]] = []
    resolved_options = preview_options
    try:
        with _connect(preview_options) as conn:
            conn.set_session(readonly=True, autocommit=True)
            resolved_options = _resolve_postgis_table_options(conn, preview_options)
            with conn.cursor() as cursor:
                cursor.execute(_build_query(resolved_options))
                for index, (_source_feature_id, geometry_json, properties) in enumerate(cursor.fetchall(), start=1):
                    if not geometry_json:
                        continue
                    try:
                        geometry = json.loads(geometry_json)
                    except Exception as exc:
                        raise ValidationError({"postgis": f"Géométrie PostGIS invalide à la ligne #{index}: {exc}"}) from exc
                    props = properties if isinstance(properties, dict) else {}
                    feature = {"type": "Feature", "geometry": geometry, "properties": props}
                    features_for_metadata.append(feature)
                    positions.extend(collect_positions(feature))
    except ValidationError:
        raise
    except Exception as exc:
        raise ValidationError({"postgis": f"Impossible d’analyser la table PostGIS : {exc}"}) from exc

    collection = {"type": "FeatureCollection", "features": features_for_metadata}
    return safe_postgis_metadata(resolved_options, feature_count=len(features_for_metadata), extra={
        "preview": True,
        "sample_limit": preview_options["limit"],
        "geojson_type": "FeatureCollection",
        "geometry_types": geometry_type_counts(collection),
        "bounds_wgs84": bounds_from_positions(positions),
        "attribute_fields": summarize_geojson_attributes(features_for_metadata),
    })

def import_postgis_features_to_db(layer: ClientMapLayer, options: dict[str, Any], *, replace: bool = True) -> dict[str, Any]:
    objects: list[ClientMapLayerFeature] = []
    features_for_metadata: list[dict[str, Any]] = []
    positions: list[list[float]] = []
    resolved_options = options
    try:
        with _connect(options) as conn:
            conn.set_session(readonly=True, autocommit=True)
            resolved_options = _resolve_postgis_table_options(conn, options)
            with conn.cursor() as cursor:
                cursor.execute(_build_query(resolved_options))
                for index, (source_feature_id, geometry_json, properties) in enumerate(cursor.fetchall(), start=1):
                    if not geometry_json:
                        continue
                    try:
                        geometry = json.loads(geometry_json)
                        geom = GEOSGeometry(json.dumps(geometry), srid=4326)
                    except Exception as exc:
                        raise ValidationError(f"Géométrie PostGIS invalide à la ligne #{index}: {exc}") from exc
                    if geom.empty:
                        continue
                    props = properties if isinstance(properties, dict) else {}
                    source_id = str(source_feature_id or props.get("id") or index)[:255]
                    objects.append(ClientMapLayerFeature(layer=layer, geometry=geom, properties=props, source_feature_id=source_id))
                    feature = {"type": "Feature", "geometry": geometry, "properties": props}
                    features_for_metadata.append(feature)
                    positions.extend(collect_positions(feature))
    except ValidationError:
        raise
    except Exception as exc:
        raise ValidationError({"postgis": f"Impossible d'importer la table PostGIS : {exc}"}) from exc

    if not objects:
        raise ValidationError({"postgis": "La table PostGIS ne contient aucune géométrie exploitable."})

    with transaction.atomic():
        if replace:
            ClientMapLayerFeature.objects.filter(layer=layer).delete()
        ClientMapLayerFeature.objects.bulk_create(objects, batch_size=1000)

    collection = {"type": "FeatureCollection", "features": features_for_metadata}
    return safe_postgis_metadata(resolved_options, feature_count=len(objects), extra={
        "geojson_type": "FeatureCollection",
        "geometry_types": geometry_type_counts(collection),
        "bounds_wgs84": bounds_from_positions(positions),
        "attribute_fields": summarize_geojson_attributes(features_for_metadata),
    })
