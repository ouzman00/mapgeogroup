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


def _clean_where_clause(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) > 1000 or FORBIDDEN_SQL_RE.search(raw):
        raise ValidationError({"postgis_where_clause": "Filtre SQL refusé. Utilisez une condition WHERE simple, sans point-virgule ni commande SQL."})
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
        "geometry_column": _clean_identifier(data.get("postgis_geometry_column") or "geom", "postgis_geometry_column"),
        "id_column": _optional_identifier(data.get("postgis_id_column") or "id", "postgis_id_column"),
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


def _build_query(options: dict[str, Any]):
    geom_expr = sql.SQL("ST_SetSRID(t.{geom}, {srid})").format(
        geom=sql.Identifier(options["geometry_column"]),
        srid=sql.Literal(options["source_srid"]),
    ) if options.get("source_srid") else sql.SQL("t.{geom}").format(geom=sql.Identifier(options["geometry_column"]))
    id_expr = sql.SQL("t.{id_col}::text").format(id_col=sql.Identifier(options["id_column"])) if options.get("id_column") else sql.SQL("NULL::text")
    where_parts = [sql.SQL("t.{geom} IS NOT NULL").format(geom=sql.Identifier(options["geometry_column"]))]
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



def inspect_postgis_table_metadata(options: dict[str, Any], *, sample_limit: int = 2000) -> dict[str, Any]:
    """Retourne un aperçu sûr des attributs PostGIS sans créer de couche.

    Utilisé par le backoffice pour préremplir la symbologie catégorisée dès
    qu'une table est choisie. Les secrets de connexion ne sont jamais renvoyés.
    """
    preview_options = {**options, "limit": max(1, min(int(sample_limit or 2000), int(options.get("limit") or sample_limit or 2000), 5000))}
    features_for_metadata: list[dict[str, Any]] = []
    positions: list[list[float]] = []
    try:
        with _connect(preview_options) as conn:
            conn.set_session(readonly=True, autocommit=True)
            with conn.cursor() as cursor:
                cursor.execute(_build_query(preview_options))
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
    return safe_postgis_metadata(preview_options, feature_count=len(features_for_metadata), extra={
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
    try:
        with _connect(options) as conn:
            conn.set_session(readonly=True, autocommit=True)
            with conn.cursor() as cursor:
                cursor.execute(_build_query(options))
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
    return safe_postgis_metadata(options, feature_count=len(objects), extra={
        "geojson_type": "FeatureCollection",
        "geometry_types": geometry_type_counts(collection),
        "bounds_wgs84": bounds_from_positions(positions),
        "attribute_fields": summarize_geojson_attributes(features_for_metadata),
    })
