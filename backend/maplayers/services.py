from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db import DatabaseError, connection

logger = logging.getLogger(__name__)
_warned_unreadable_tables: set[tuple[str, str]] = set()

IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

GEOMETRY_COLUMNS = ("geom", "geometry", "the_geom", "wkb_geometry")
ID_COLUMNS = ("id", "gid", "fid", "ogc_fid", "objectid", "object_id")

LAYER_CONFIGS: dict[str, dict[str, Any]] = {
    "communes": {
        "name": "Communes",
        "group": "contexte",
        "geometry_type": "polygon",
        "endpoint": "/map/communes/",
        "table_candidates": ("communes", "commune", "limites_communales", "sig_communes", "gpkg_communes"),
        "label_candidates": ("CCRCA_1", "ccrca_1", "commune", "COMMUNE", "nom", "NOM", "name", "NAME"),
        "type_candidates": (),
        "commune_candidates": ("CCRCA_1", "ccrca_1", "commune", "COMMUNE"),
        "visible": False,
        "minZoom": 10,
        "labelMinZoom": 12,
        "legend": [
            {"label": "Limite communale", "symbol": "polygon-outline", "color": "#0EA5E9", "fillColor": "rgba(14,165,233,0.08)"},
        ],
    },
    "roads": {
        "name": "Réseau routier",
        "group": "contexte",
        "geometry_type": "line",
        "endpoint": "/map/roads/",
        "table_candidates": ("reseau_routier", "réseau_routier", "routes", "roads", "sig_routes", "road_network", "gpkg_routes"),
        "label_candidates": ("nom", "NOM", "name", "NAME", "route", "ROUTE", "axe", "AXE", "libelle", "LIBELLE"),
        "type_candidates": ("type", "TYPE", "classe", "CLASSE", "categorie", "CATEGORIE", "nature", "NATURE", "statut", "STATUT"),
        "commune_candidates": ("commune", "COMMUNE", "CCRCA_1", "ccrca_1"),
        "visible": False,
        "minZoom": 12,
        "labelMinZoom": 15,
        "legend": [
            {"label": "Route nationale", "symbol": "line", "color": "#EF4444", "weight": 5},
            {"label": "Route régionale", "symbol": "line", "color": "#F59E0B", "weight": 4},
            {"label": "Piste", "symbol": "line-dashed", "color": "#A16207", "weight": 3},
            {"label": "Voie urbaine / autre", "symbol": "line", "color": "#64748B", "weight": 3},
        ],
    },
    "sanitary-infrastructures": {
        "name": "Infrastructures sanitaires",
        "group": "contexte",
        "geometry_type": "point",
        "endpoint": "/map/sanitary-infrastructures/",
        "table_candidates": (
            "infrastructures sanitaires",
            "infrastructures_sanitaires",
            "infrastructure_sanitaire",
            "sanitary_infrastructures",
            "health_infrastructures",
            "sig_infrastructures_sanitaires",
            "sante",
            "sante_infrastructures",
        ),
        "label_candidates": ("nom", "NOM", "name", "NAME", "libelle", "LIBELLE", "designation", "DESIGNATION"),
        "type_candidates": ("type", "TYPE", "categorie", "CATEGORIE", "niveau", "NIVEAU", "nature", "NATURE", "classe", "CLASSE"),
        "commune_candidates": ("commune", "COMMUNE", "CCRCA_1", "ccrca_1"),
        "visible": False,
        "minZoom": 13,
        "labelMinZoom": 15,
        "legend": [
            {"label": "Hôpital", "symbol": "point", "color": "#991B1B", "fillColor": "#FCA5A5"},
            {"label": "Centre de santé", "symbol": "point", "color": "#B45309", "fillColor": "#FDBA74"},
            {"label": "Poste de santé", "symbol": "point", "color": "#BE123C", "fillColor": "#FDA4AF"},
            {"label": "Autre sanitaire", "symbol": "point", "color": "#7F1D1D", "fillColor": "#FECACA"},
        ],
    },
    "school-infrastructures": {
        "name": "Infrastructures scolaires",
        "group": "contexte",
        "geometry_type": "point",
        "endpoint": "/map/school-infrastructures/",
        "table_candidates": (
            "infrastructures scolaires",
            "infrastructures_scolaires",
            "infrastructure_scolaire",
            "school_infrastructures",
            "education_infrastructures",
            "sig_infrastructures_scolaires",
            "ecoles",
            "etablissements_scolaires",
        ),
        "label_candidates": ("nom", "NOM", "name", "NAME", "libelle", "LIBELLE", "designation", "DESIGNATION"),
        "type_candidates": ("type", "TYPE", "categorie", "CATEGORIE", "niveau", "NIVEAU", "nature", "NATURE", "classe", "CLASSE"),
        "commune_candidates": ("commune", "COMMUNE", "CCRCA_1", "ccrca_1"),
        "visible": False,
        "minZoom": 13,
        "labelMinZoom": 15,
        "legend": [
            {"label": "Université", "symbol": "point", "color": "#5B21B6", "fillColor": "#C4B5FD"},
            {"label": "Lycée", "symbol": "point", "color": "#1D4ED8", "fillColor": "#93C5FD"},
            {"label": "Collège", "symbol": "point", "color": "#0369A1", "fillColor": "#7DD3FC"},
            {"label": "École primaire / autre", "symbol": "point", "color": "#166534", "fillColor": "#86EFAC"},
        ],
    },
}


@dataclass(frozen=True)
class LayerSchema:
    layer_id: str
    table_name: str
    geometry_column: str
    id_column: str | None
    label_column: str | None
    type_column: str | None
    commune_column: str | None
    available_columns: tuple[str, ...]


def _read_table_overrides() -> dict[str, str]:
    raw = getattr(settings, "MAP_LAYER_TABLES", None)
    if raw is None:
        raw = getattr(settings, "MAP_LAYER_TABLES_RAW", "")
    if isinstance(raw, dict):
        return {str(key): str(value) for key, value in raw.items() if value}
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return {str(key): str(value) for key, value in data.items() if value}
    except json.JSONDecodeError:
        logger.warning("MAP_LAYER_TABLES n'est pas un JSON valide.")
    return {}


def _safe_identifier(identifier: str | None) -> str | None:
    if not identifier:
        return None
    identifier = str(identifier).strip()
    return identifier if IDENTIFIER_RE.match(identifier) else None


def _quote(identifier: str) -> str:
    return connection.ops.quote_name(identifier)


def _available_tables() -> set[str]:
    # Utilise pg_catalog au lieu de l’introspection Django classique afin de
    # respecter le search_path PostgreSQL sans déclencher de SELECT sur les
    # tables métier. Certaines tables SIG importées peuvent exister mais ne pas
    # encore être lisibles par l’utilisateur applicatif.
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT DISTINCT c.relname
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND pg_catalog.pg_table_is_visible(c.oid)
              AND n.nspname <> 'pg_catalog'
            """
        )
        return {row[0] for row in cursor.fetchall()}


def _readable_visible_table(table_name: str) -> tuple[str, str] | None:
    """Retourne (schema, table) si la relation visible est lisible.

    `pg_table_is_visible` reproduit la résolution d’un nom de table non qualifié
    via le search_path configuré (`donnees_mapgeo, public`). Le test SELECT évite
    qu’une table SIG détectée mais sans privilèges fasse planter le catalogue.
    """
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT n.nspname, c.relname, pg_catalog.has_table_privilege(c.oid, 'SELECT') AS can_select
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND c.relname = %s
              AND pg_catalog.pg_table_is_visible(c.oid)
            ORDER BY array_position(pg_catalog.current_schemas(true), n.nspname) NULLS LAST
            LIMIT 1
            """,
            [table_name],
        )
        row = cursor.fetchone()

    if not row:
        return None

    schema_name, resolved_table, can_select = row
    if not can_select:
        warning_key = (str(schema_name), str(resolved_table))
        if warning_key not in _warned_unreadable_tables:
            _warned_unreadable_tables.add(warning_key)
            logger.warning(
                "Table SIG détectée mais non lisible par l'utilisateur PostgreSQL courant: %s.%s. "
                "Exécutez scripts/repair_map_layer_table_privileges.sql avec un rôle admin.",
                schema_name,
                resolved_table,
            )
        return None
    return str(schema_name), str(resolved_table)


def _table_columns(table_name: str) -> tuple[str, ...]:
    # Ne pas utiliser connection.introspection.get_table_description(): sur
    # PostgreSQL, Django exécute SELECT * FROM table LIMIT 1, ce qui échoue avec
    # “permission denied” et transforme /api/map/layers/ en erreur 500.
    with connection.cursor() as cursor:
        cursor.execute(
            """
            WITH visible_relation AS (
                SELECT c.oid
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
                  AND c.relname = %s
                  AND pg_catalog.pg_table_is_visible(c.oid)
                ORDER BY array_position(pg_catalog.current_schemas(true), n.nspname) NULLS LAST
                LIMIT 1
            )
            SELECT a.attname
            FROM pg_catalog.pg_attribute a
            JOIN visible_relation r ON r.oid = a.attrelid
            WHERE a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
            """,
            [table_name],
        )
        return tuple(row[0] for row in cursor.fetchall())


def _pick_column(columns: tuple[str, ...], candidates: tuple[str, ...]) -> str | None:
    lower_map = {column.lower(): column for column in columns}
    for candidate in candidates:
        if candidate in columns:
            return candidate
        match = lower_map.get(str(candidate).lower())
        if match:
            return match
    return None


def get_layer_schema(layer_id: str) -> LayerSchema | None:
    config = LAYER_CONFIGS.get(layer_id)
    if not config:
        return None

    overrides = _read_table_overrides()
    table_candidates = []
    override = str(overrides.get(layer_id) or "").strip()
    if override:
        table_candidates.append(override)
    table_candidates.extend(str(table).strip() for table in config["table_candidates"] if table)

    tables = _available_tables()
    tables_lower = {table.lower(): table for table in tables}
    table_name = None
    for candidate in table_candidates:
        matched_table = None
        if candidate in tables:
            matched_table = candidate
        else:
            matched_table = tables_lower.get(candidate.lower())

        if not matched_table:
            continue

        readable_table = _readable_visible_table(matched_table)
        if readable_table:
            table_name = matched_table
            break

    if not table_name:
        return None

    columns = _table_columns(table_name)
    if not columns:
        return None

    geometry_column = _pick_column(columns, GEOMETRY_COLUMNS)
    if not geometry_column:
        return None

    return LayerSchema(
        layer_id=layer_id,
        table_name=table_name,
        geometry_column=geometry_column,
        id_column=_pick_column(columns, ID_COLUMNS),
        label_column=_pick_column(columns, config.get("label_candidates", ())),
        type_column=_pick_column(columns, config.get("type_candidates", ())),
        commune_column=_pick_column(columns, config.get("commune_candidates", ())),
        available_columns=columns,
    )


def layer_info(layer_id: str) -> dict[str, Any]:
    config = LAYER_CONFIGS[layer_id]
    schema = get_layer_schema(layer_id)
    return {
        "id": layer_id,
        "name": config["name"],
        "group": config["group"],
        "type": "geojson",
        "endpoint": config["endpoint"],
        "visible": config.get("visible", False),
        "minZoom": config.get("minZoom"),
        "maxZoom": config.get("maxZoom", 22),
        "labelMinZoom": config.get("labelMinZoom"),
        "geometry_type": config.get("geometry_type", ""),
        "available": schema is not None,
        "table": schema.table_name if schema else None,
        "fields": {
            "id": schema.id_column if schema else None,
            "geometry": schema.geometry_column if schema else None,
            "label": schema.label_column if schema else None,
            "type": schema.type_column if schema else None,
            "commune": schema.commune_column if schema else None,
        },
        "legend": config.get("legend", []),
        "metadata": {
            "source": schema.table_name if schema else "Table SIG non détectée",
            "projection": "EPSG:4326 affichage Leaflet",
            "owner": "Référentiel SIG",
            "licence": "Interne",
        },
    }


def list_map_layers() -> list[dict[str, Any]]:
    # Ne renvoyer au portail que les couches réellement raccordées à une table SIG.
    # Les anciennes entrées de configuration sans table détectée ne doivent pas
    # apparaître dans la légende comme des couches fantômes indisponibles.
    layers = []
    for layer_id in LAYER_CONFIGS:
        info = layer_info(layer_id)
        if info.get("available"):
            layers.append(info)
    return layers


def parse_bbox(value: str | None) -> tuple[float, float, float, float] | None:
    if not value:
        return None
    try:
        parts = [float(part.strip()) for part in str(value).split(",")]
    except (TypeError, ValueError):
        return None
    if len(parts) != 4:
        return None
    minx, miny, maxx, maxy = parts
    if minx >= maxx or miny >= maxy:
        return None
    return minx, miny, maxx, maxy


def _normalize_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = "".join(
        char for char in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(char)
    )
    return text


def classify_road(value: Any) -> str:
    text = _normalize_text(value)
    if any(token in text for token in ("route nationale", "nationale", "national", "rn ", " rn", "rn-", "rn_", "route n")):
        return "route_nationale"
    if any(token in text for token in ("route regionale", "regionale", "regional", "rr ", " rr", "route r")):
        return "route_regionale"
    if any(token in text for token in ("piste", "track", "terre", "laterite", "lat?rite", "non revetu", "non rev?tu")):
        return "piste"
    if any(token in text for token in ("urbain", "urbaine", "rue", "voirie", "voie", "avenue", "boulevard")):
        return "voie_urbaine"
    return "autre"


def classify_sanitary(value: Any) -> str:
    text = _normalize_text(value)
    if any(token in text for token in ("hopital", "hospital", "chu", "chr")):
        return "hopital"
    if "centre" in text and "sante" in text:
        return "centre_sante"
    if any(token in text for token in ("poste", "poste de sante", "ps ", "case de sante")):
        return "poste_sante"
    return "autre"


def classify_school(value: Any) -> str:
    text = _normalize_text(value)
    if any(token in text for token in ("universite", "university", "faculte", "facult?", "ucad")):
        return "universite"
    if any(token in text for token in ("lycee", "lyc?e")):
        return "lycee"
    if any(token in text for token in ("college", "coll?ge", "cem", "moyen")):
        return "college"
    if any(token in text for token in ("primaire", "elementaire", "?l?mentaire", "ecole", "?cole", "prescolaire", "maternelle")):
        return "ecole_primaire"
    return "autre"


def classify_feature(layer_id: str, raw_type: Any) -> str:
    if layer_id == "roads":
        return classify_road(raw_type)
    if layer_id == "sanitary-infrastructures":
        return classify_sanitary(raw_type)
    if layer_id == "school-infrastructures":
        return classify_school(raw_type)
    return "commune"


def _feature_properties(layer_id: str, row: dict[str, Any], schema: LayerSchema) -> dict[str, Any]:
    raw_id = row.get("feature_id")
    raw_label = row.get("label")
    raw_type = row.get("type")
    raw_commune = row.get("commune")
    raw_context = row.get("classification_source") or ""
    classification_input = " ".join(str(value or "") for value in (raw_type, raw_label, raw_context))
    classification = classify_feature(layer_id, classification_input)

    properties = {
        "id": raw_id,
        "label": raw_label or raw_type or f"{LAYER_CONFIGS[layer_id]['name']} {raw_id or ''}".strip(),
        "name": raw_label or "",
        "type": raw_type or "",
        "classification": classification,
        "commune": raw_commune or "",
        "layer_id": layer_id,
        "layer_name": LAYER_CONFIGS[layer_id]["name"],
    }
    if layer_id == "communes":
        properties["CCRCA_1"] = raw_label or ""
    return properties


def _row_to_dict(cursor, row) -> dict[str, Any]:
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row))


def fetch_layer_geojson(layer_id: str, bbox: tuple[float, float, float, float] | None = None, limit: int = 1500) -> dict[str, Any]:
    schema = get_layer_schema(layer_id)
    if not schema:
        return {"type": "FeatureCollection", "features": [], "metadata": {"available": False, "layer": layer_info(layer_id)}}

    limit = min(max(int(limit or 1500), 1), 5000)
    geom = _quote(schema.geometry_column)
    table = _quote(schema.table_name)

    select_parts = []
    if schema.id_column:
        select_parts.append(f"{_quote(schema.id_column)} AS feature_id")
    else:
        select_parts.append("NULL AS feature_id")
    if schema.label_column:
        select_parts.append(f"{_quote(schema.label_column)} AS label")
    else:
        select_parts.append("NULL AS label")
    if schema.type_column:
        select_parts.append(f"{_quote(schema.type_column)} AS type")
    else:
        select_parts.append("NULL AS type")
    if schema.commune_column:
        select_parts.append(f"{_quote(schema.commune_column)} AS commune")
    else:
        select_parts.append("NULL AS commune")

    context_columns = [
        column for column in schema.available_columns
        if column != schema.geometry_column
    ][:40]
    if context_columns:
        select_parts.append(
            "CONCAT_WS(' ', " + ", ".join(f"CAST({_quote(column)} AS text)" for column in context_columns) + ") AS classification_source"
        )
    else:
        select_parts.append("NULL AS classification_source")

    geom_4326_sql = (
        f"ST_AsGeoJSON("
        f"CASE "
        f"WHEN ST_SRID({geom}) = 4326 THEN {geom} "
        f"WHEN ST_SRID({geom}) = 0 THEN ST_SetSRID({geom}, 4326) "
        f"ELSE ST_Transform({geom}, 4326) END"
        f") AS geometry_json"
    )
    select_parts.append(geom_4326_sql)

    where = [f"{geom} IS NOT NULL", f"NOT ST_IsEmpty({geom})"]
    params: list[Any] = []
    if bbox:
        where.append(
            f"ST_Intersects("
            f"CASE WHEN ST_SRID({geom}) = 0 THEN ST_SetSRID({geom}, 4326) ELSE {geom} END, "
            f"CASE "
            f"WHEN ST_SRID({geom}) = 0 THEN ST_MakeEnvelope(%s, %s, %s, %s, 4326) "
            f"WHEN ST_SRID({geom}) = 4326 THEN ST_MakeEnvelope(%s, %s, %s, %s, 4326) "
            f"ELSE ST_Transform(ST_MakeEnvelope(%s, %s, %s, %s, 4326), ST_SRID({geom})) END"
            f")"
        )
        params.extend([*bbox, *bbox, *bbox])

    sql = f"SELECT {', '.join(select_parts)} FROM {table} WHERE {' AND '.join(where)} LIMIT %s"
    params.append(limit)

    features = []
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            for raw_row in cursor.fetchall():
                row = _row_to_dict(cursor, raw_row)
                geometry_json = row.pop("geometry_json", None)
                if not geometry_json:
                    continue
                try:
                    geometry = json.loads(geometry_json)
                except (TypeError, json.JSONDecodeError):
                    continue
                features.append({
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": _feature_properties(layer_id, row, schema),
                })
    except DatabaseError as exc:
        logger.warning("Lecture impossible de la couche SIG %s (%s): %s", layer_id, schema.table_name, exc)
        return {
            "type": "FeatureCollection",
            "features": [],
            "metadata": {
                "available": False,
                "count": 0,
                "limit": limit,
                "error": "Couche SIG détectée mais non lisible par l'utilisateur PostgreSQL courant.",
                "layer": layer_info(layer_id),
            },
        }

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "available": True,
            "count": len(features),
            "limit": limit,
            "layer": layer_info(layer_id),
        },
    }
