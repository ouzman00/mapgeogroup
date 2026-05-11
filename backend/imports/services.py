from __future__ import annotations

import csv
import io
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from parcels.models import Parcel
from parcels.serializers import ParcelCreateUpdateSerializer
from parcels.services import build_parcel_payload_from_row

from .models import ImportJob, ImportRowResult


def _json_safe(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


# Colonnes CSV explicitement acceptées dans l'historique d'import.
# Les colonnes inconnues sont ignorées et les colonnes au nom sensible sont
# masquées pour éviter de stocker/afficher accidentellement des secrets ou des
# données personnelles non prévues.
ALLOWED_IMPORT_RAW_COLUMNS = {
    "__ignored_columns__", "__redacted_columns__",
    "reference", "ref", "parcel_reference",
    "owner", "owner_id", "owner_email", "owner_username", "client_code",
    "organization", "organization_id", "organization_code", "client", "client_id",
    "geometry", "geometry_json", "coordinates", "coordinates_text", "polygon",
    "x", "y", "easting", "northing", "longitude", "lon", "lng", "latitude", "lat",
    "area", "surface", "perimeter", "perimetre",
    "title_number", "titre_foncier", "parcel_number", "numero_parcelle",
    "section", "location", "localisation", "address", "village", "commune",
    "department", "departement", "region", "land_use", "usage", "status",
    "survey_date", "method", "orientation", "access_info", "acces",
    "risk_level", "risque", "notes",
}

SENSITIVE_IMPORT_KEYWORDS = {
    "password", "passwd", "pwd", "secret", "token", "apikey", "api_key",
    "authorization", "auth", "credential", "cookie", "session", "jwt",
}

MAX_IMPORT_DISPLAY_VALUE_LENGTH = 500


def _is_sensitive_import_key(key) -> bool:
    normalized = str(key or "").strip().lower().replace("-", "_")
    return any(keyword in normalized for keyword in SENSITIVE_IMPORT_KEYWORDS)


def _compact_import_value(value):
    safe_value = _json_safe(value)
    if safe_value is None:
        return None
    if isinstance(safe_value, str):
        text = safe_value.strip()
        if len(text) > MAX_IMPORT_DISPLAY_VALUE_LENGTH:
            return f"{text[:MAX_IMPORT_DISPLAY_VALUE_LENGTH]}… [tronqué]"
        return text
    if isinstance(safe_value, (dict, list)):
        rendered = str(safe_value)
        if len(rendered) > MAX_IMPORT_DISPLAY_VALUE_LENGTH:
            return {"summary": f"{type(safe_value).__name__} tronqué", "length": len(rendered)}
    return safe_value


def _safe_import_raw_row(row):
    safe = {}
    ignored = []
    redacted = []
    for key, value in (row or {}).items():
        normalized_key = str(key or "").strip()
        lookup_key = normalized_key.lower()
        if _is_sensitive_import_key(lookup_key):
            redacted.append(normalized_key)
            continue
        if lookup_key not in ALLOWED_IMPORT_RAW_COLUMNS:
            ignored.append(normalized_key)
            continue
        safe[normalized_key] = _compact_import_value(value)
    if ignored:
        safe["__ignored_columns__"] = sorted(set(filter(None, ignored)))
    if redacted:
        safe["__redacted_columns__"] = sorted(set(filter(None, redacted)))
    return safe


def _geometry_summary(geometry):
    if not isinstance(geometry, dict):
        return None
    coordinates = geometry.get("coordinates")
    point_count = 0

    def walk(value):
        nonlocal point_count
        if isinstance(value, (list, tuple)):
            if len(value) >= 2 and not isinstance(value[0], (list, tuple, dict)):
                point_count += 1
                return
            for item in value:
                walk(item)

    walk(coordinates)
    return {
        "type": geometry.get("type"),
        "point_count": point_count,
    }


def _safe_import_payload(payload):
    safe = _json_safe(payload or {})
    if isinstance(safe, dict) and safe.get("geometry"):
        safe["geometry"] = _geometry_summary(safe["geometry"]) or "[géométrie masquée]"
    return safe



def _attach_expected_geometry_timestamp(payload, instance):
    if instance is not None and payload.get("geometry") and getattr(instance, "geometry_updated_at", None):
        payload = dict(payload)
        payload["expected_geometry_updated_at"] = instance.geometry_updated_at.isoformat()
    return payload

def _read_csv_rows(import_job: ImportJob):
    max_size_bytes = int(getattr(settings, "MAX_IMPORT_CSV_SIZE_BYTES", 10 * 1024 * 1024))
    max_size_mb = max_size_bytes // (1024 * 1024)
    if (getattr(import_job.file, "size", 0) or 0) > max_size_bytes:
        raise serializers.ValidationError(f"Le fichier CSV dépasse la limite de {max_size_mb} Mo.")
    import_job.file.open("rb")
    try:
        payload = import_job.file.read()
    finally:
        import_job.file.close()

    try:
        content = payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = payload.decode("latin-1")
    lines = content.splitlines()
    if not lines:
        raise serializers.ValidationError("Le fichier CSV est vide.")
    delimiter = ";" if lines[0].count(";") > lines[0].count(",") else ","
    rows = list(csv.DictReader(io.StringIO(content), delimiter=delimiter))
    if len(rows) > 5000:
        raise serializers.ValidationError("Le fichier CSV dépasse la limite de 5 000 lignes.")
    if not rows:
        raise serializers.ValidationError("Le fichier CSV est vide.")
    return rows


def process_import_job(import_job: ImportJob):
    if import_job.status in {"processing", "completed", "cancelled"}:
        return import_job

    import_job.status = "validating"
    import_job.error_message = ""
    import_job.started_at = timezone.now()
    import_job.save(update_fields=["status", "error_message", "started_at", "updated_at"])

    ImportRowResult.objects.filter(job=import_job).delete()
    created_count = 0
    updated_count = 0
    valid_count = 0
    error_count = 0

    try:
        rows = _read_csv_rows(import_job)
        prepared_rows = []
        for row_number, row in enumerate(rows, start=2):
            reference = row.get("reference") or row.get("ref") or row.get("parcel_reference")
            try:
                payload = build_parcel_payload_from_row(row, default_owner=import_job.default_owner, default_organization=import_job.organization)
                if import_job.organization_id and payload.get("organization") != import_job.organization_id:
                    raise serializers.ValidationError("La ligne CSV cible une organisation différente de l'organisation d'import autorisée.")
                prepared_rows.append((row_number, reference, row, payload))
                ImportRowResult.objects.create(
                    job=import_job,
                    row_number=row_number,
                    reference=reference,
                    status="valid",
                    raw_data=_safe_import_raw_row(row),
                    normalized_data=_safe_import_payload(payload),
                )
                valid_count += 1
            except Exception as exc:
                error_count += 1
                ImportRowResult.objects.create(
                    job=import_job,
                    row_number=row_number,
                    reference=reference,
                    status="error",
                    raw_data=_safe_import_raw_row(row),
                    error_message=str(exc),
                )

        if error_count > 0:
            import_job.status = "failed"
            import_job.error_message = "Import bloqué : corrigez toutes les lignes en erreur avant d'importer."
            import_job.finished_at = timezone.now()
            import_job.summary = {
                "validated_rows": valid_count,
                "error_rows": error_count,
                "created": created_count,
                "updated": updated_count,
                "processed_at": timezone.now().isoformat(),
                "strict_blocked": True,
            }
            import_job.save(update_fields=["status", "error_message", "finished_at", "summary", "updated_at"])
            return import_job

        import_job.status = "ready"
        import_job.summary = {
            "validated_rows": valid_count,
            "error_rows": error_count,
            "created": created_count,
            "updated": updated_count,
            "processed_at": timezone.now().isoformat(),
            "strict_blocked": False,
        }
        import_job.save(update_fields=["status", "summary", "updated_at"])

        if not import_job.execute_on_process:
            import_job.finished_at = timezone.now()
            import_job.save(update_fields=["finished_at", "updated_at"])
            return import_job

        import_job.status = "processing"
        import_job.save(update_fields=["status", "updated_at"])

        with transaction.atomic():
            for row_number, reference, row, payload in prepared_rows:
                existing = Parcel.objects.select_for_update().filter(
                    reference=payload["reference"],
                    organization_id=payload["organization"],
                    archived_at__isnull=True,
                ).first()
                payload = _attach_expected_geometry_timestamp(payload, existing)
                serializer = ParcelCreateUpdateSerializer(instance=existing, data=payload, partial=existing is not None)
                serializer.is_valid(raise_exception=True)
                parcel = serializer.save()
                row_result = ImportRowResult.objects.get(job=import_job, row_number=row_number)
                row_result.status = "updated" if existing else "created"
                row_result.reference = parcel.reference
                row_result.normalized_data = _safe_import_payload(payload)
                row_result.save(update_fields=["status", "reference", "normalized_data"])
                if existing:
                    updated_count += 1
                else:
                    created_count += 1

        import_job.status = "completed"
        import_job.finished_at = timezone.now()
        import_job.summary = {
            "validated_rows": valid_count,
            "error_rows": error_count,
            "created": created_count,
            "updated": updated_count,
            "processed_at": timezone.now().isoformat(),
        }
        import_job.save(update_fields=["status", "finished_at", "summary", "updated_at"])
        return import_job
    except Exception as exc:
        import_job.status = "failed"
        import_job.error_message = str(exc)
        import_job.finished_at = timezone.now()
        import_job.summary = {
            "validated_rows": valid_count,
            "error_rows": error_count,
            "created": created_count,
            "updated": updated_count,
            "failed_at": timezone.now().isoformat(),
        }
        import_job.save(update_fields=["status", "error_message", "finished_at", "summary", "updated_at"])
        return import_job
