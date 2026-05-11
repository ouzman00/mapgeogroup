from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import Iterable

from rest_framework.exceptions import ValidationError

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None

SUSPICIOUS_FILENAME_RE = re.compile(r"[\x00-\x1f\x7f]")
GENERIC_MIME_TYPES = {"", None, "application/octet-stream", "binary/octet-stream"}

COMMON_MIME_TYPES = {
    ".pdf": {"application/pdf"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".tif": {"image/tiff", "image/geotiff", "application/geotiff", "application/octet-stream"},
    ".tiff": {"image/tiff", "image/geotiff", "application/geotiff", "application/octet-stream"},
    ".doc": {"application/msword", "application/octet-stream"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"},
    ".xls": {"application/vnd.ms-excel", "application/octet-stream"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"},
    ".csv": {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"},
    ".txt": {"text/plain", "application/octet-stream"},
    ".zip": {"application/zip", "application/x-zip-compressed", "application/octet-stream"},
    ".kmz": {"application/vnd.google-earth.kmz", "application/zip", "application/octet-stream"},
    ".kml": {"application/vnd.google-earth.kml+xml", "application/xml", "text/xml", "text/plain", "application/octet-stream"},
    ".dxf": {"image/vnd.dxf", "application/dxf", "application/octet-stream", "text/plain"},
    ".dwg": {"image/vnd.dwg", "application/acad", "application/octet-stream"},
    ".geojson": {"application/geo+json", "application/json", "text/json", "text/plain", "application/octet-stream"},
    ".json": {"application/json", "text/json", "text/plain", "application/octet-stream"},
    ".mbtiles": {"application/octet-stream", "application/x-sqlite3", "application/vnd.sqlite3"},
}

SIGNATURES = {
    ".pdf": (b"%PDF-",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".tif": (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"),
    ".tiff": (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+"),
    ".zip": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    ".docx": (b"PK\x03\x04",),
    ".xlsx": (b"PK\x03\x04",),
    ".kmz": (b"PK\x03\x04",),
    ".doc": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    ".xls": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    ".dwg": (b"AC10",),
    ".mbtiles": (b"SQLite format 3\x00",),
}

TEXT_LIKE_EXTENSIONS = {".csv", ".txt", ".kml", ".dxf", ".geojson", ".json"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
OFFICE_ZIP_MARKERS = {".docx": "word/", ".xlsx": "xl/"}


def _remember_position(file):
    if hasattr(file, "tell") and hasattr(file, "seek"):
        try:
            return file.tell()
        except Exception:
            return None
    return None


def _restore_position(file, position):
    if position is not None and hasattr(file, "seek"):
        try:
            file.seek(position)
        except Exception:
            pass


def get_upload_extension(file) -> str:
    return Path(getattr(file, "name", "") or "").suffix.lower()


def validate_safe_filename(file) -> str:
    raw_name = str(getattr(file, "name", "") or "").strip()
    filename = Path(raw_name).name
    if not raw_name or not filename:
        raise ValidationError("Le fichier doit avoir un nom explicite.")
    if SUSPICIOUS_FILENAME_RE.search(raw_name):
        raise ValidationError("Le nom du fichier contient des caractères non autorisés.")
    if "/" in raw_name or "\\" in raw_name or raw_name != filename:
        raise ValidationError("Le nom du fichier ne doit pas contenir de chemin.")
    if filename in {".", ".."}:
        raise ValidationError("Le nom du fichier est invalide.")
    if len(filename) > 180:
        raise ValidationError("Le nom du fichier est trop long.")
    return filename


def validate_file_size(file, max_size: int, *, allow_empty: bool = False, label: str = "fichier"):
    size = getattr(file, "size", 0) or 0
    if not allow_empty and size <= 0:
        raise ValidationError(f"Le {label} est vide.")
    if size > max_size:
        max_mb = max_size // (1024 * 1024)
        raise ValidationError(f"Le {label} dépasse la limite de {max_mb} Mo.")
    return size


def validate_extension(file, allowed_extensions: Iterable[str]) -> str:
    suffix = get_upload_extension(file)
    allowed = {ext.lower() for ext in allowed_extensions}
    if not suffix:
        raise ValidationError("Le fichier doit avoir une extension explicite.")
    if suffix not in allowed:
        raise ValidationError("Type de fichier non autorisé.")
    return suffix


def validate_declared_mime(file, suffix: str, allowed_mime_types: dict[str, set[str]] | None = None):
    content_type = (getattr(file, "content_type", "") or "").strip().lower()
    if content_type in GENERIC_MIME_TYPES:
        return
    allowed = (allowed_mime_types or COMMON_MIME_TYPES).get(suffix, set())
    if allowed and content_type not in allowed:
        raise ValidationError("Le type MIME déclaré ne correspond pas au type de fichier autorisé.")


def read_header(file, length: int = 512) -> bytes:
    position = _remember_position(file)
    try:
        header = file.read(length)
    finally:
        _restore_position(file, position)
    return header or b""


def validate_magic_signature(file, suffix: str):
    signatures = SIGNATURES.get(suffix)
    if not signatures:
        return
    header = read_header(file, max(len(signature) for signature in signatures))
    if not any(header.startswith(signature) for signature in signatures):
        raise ValidationError("Le contenu du fichier ne correspond pas à son extension.")


def validate_text_decodable(file, *, encoding: str = "utf-8", label: str = "fichier") -> str:
    position = _remember_position(file)
    try:
        payload = file.read()
    finally:
        _restore_position(file, position)
    if not payload:
        raise ValidationError(f"Le {label} est vide.")
    if payload.startswith(b"\xef\xbb\xbf"):
        payload = payload[3:]
    try:
        text = payload.decode(encoding)
    except UnicodeDecodeError as exc:
        raise ValidationError(f"Le {label} doit être encodé en UTF-8.") from exc
    if "\x00" in text:
        raise ValidationError(f"Le {label} contient des octets nuls et ne semble pas être un fichier texte valide.")
    return text


def validate_image_file(file, suffix: str):
    validate_magic_signature(file, suffix)
    if Image is None:
        return
    position = _remember_position(file)
    try:
        with Image.open(file) as image:
            image.verify()
    except Exception as exc:
        raise ValidationError(f"Image invalide : {exc}") from exc
    finally:
        _restore_position(file, position)


def validate_zip_file(file, *, max_entries: int = 250, max_uncompressed_bytes: int = 100 * 1024 * 1024, required_prefix: str | None = None):
    position = _remember_position(file)
    try:
        try:
            with zipfile.ZipFile(file) as archive:
                entries = archive.infolist()
                if len(entries) > max_entries:
                    raise ValidationError("Archive ZIP trop volumineuse en nombre de fichiers.")
                total_size = 0
                names = []
                for entry in entries:
                    names.append(entry.filename)
                    normalized = Path(entry.filename)
                    if entry.filename.startswith(("/", "\\")) or ".." in normalized.parts:
                        raise ValidationError("Archive ZIP contenant un chemin dangereux.")
                    total_size += entry.file_size
                    if total_size > max_uncompressed_bytes:
                        raise ValidationError("Archive ZIP trop volumineuse après extraction.")
                    if entry.compress_size and entry.file_size / max(entry.compress_size, 1) > 100:
                        raise ValidationError("Archive ZIP avec taux de compression suspect.")
                if required_prefix and not any(name.startswith(required_prefix) for name in names):
                    raise ValidationError("Le contenu de l'archive ne correspond pas au format bureautique attendu.")
        except zipfile.BadZipFile as exc:
            raise ValidationError("Archive ZIP invalide.") from exc
    finally:
        _restore_position(file, position)


def validate_uploaded_file_basics(file, *, allowed_extensions: Iterable[str], max_size: int, allowed_mime_types: dict[str, set[str]] | None = None, label: str = "fichier") -> str:
    validate_safe_filename(file)
    validate_file_size(file, max_size, label=label)
    suffix = validate_extension(file, allowed_extensions)
    validate_declared_mime(file, suffix, allowed_mime_types)
    return suffix


def validate_office_or_common_file(file, *, allowed_extensions: Iterable[str], max_size: int, label: str = "fichier") -> str:
    suffix = validate_uploaded_file_basics(file, allowed_extensions=allowed_extensions, max_size=max_size, label=label)
    if suffix in IMAGE_EXTENSIONS:
        validate_image_file(file, suffix)
    elif suffix in {".pdf", ".tif", ".tiff", ".dwg", ".doc", ".xls", ".zip", ".docx", ".xlsx", ".kmz", ".mbtiles"}:
        validate_magic_signature(file, suffix)
        if suffix in {".zip", ".kmz"}:
            validate_zip_file(file)
        elif suffix in OFFICE_ZIP_MARKERS:
            validate_zip_file(file, required_prefix=OFFICE_ZIP_MARKERS[suffix])
    elif suffix in TEXT_LIKE_EXTENSIONS:
        validate_text_decodable(file, label=label)
    return suffix


def validate_csv_file(file, *, max_size: int, max_rows: int, required_any_columns: Iterable[str], allowed_extensions: Iterable[str] = (".csv",)) -> dict:
    suffix = validate_uploaded_file_basics(file, allowed_extensions=allowed_extensions, max_size=max_size, label="fichier CSV")
    if suffix != ".csv":
        raise ValidationError("Seuls les fichiers CSV sont autorisés.")
    content = validate_text_decodable(file, label="fichier CSV")
    lines = content.splitlines()
    if not lines:
        raise ValidationError("Le CSV est vide.")
    try:
        dialect = csv.Sniffer().sniff(content[:4096], delimiters=",;\t")
    except csv.Error:
        class Fallback(csv.excel):
            delimiter = ";" if lines[0].count(";") > lines[0].count(",") else ","
        dialect = Fallback
    reader = csv.DictReader(io.StringIO(content), dialect=dialect)
    if not reader.fieldnames:
        raise ValidationError("Le CSV doit contenir une ligne d'en-tête.")
    fieldnames = [str(name or "").strip() for name in reader.fieldnames]
    normalized = {name.lower() for name in fieldnames if name}
    required_any = {name.lower() for name in required_any_columns}
    if not normalized.intersection(required_any):
        expected = ", ".join(sorted(required_any_columns))
        raise ValidationError(f"Le CSV doit contenir au moins une colonne d'identifiant parmi : {expected}.")
    rows = 0
    for rows, _row in enumerate(reader, start=1):
        if rows > max_rows:
            raise ValidationError(f"Le CSV dépasse la limite de {max_rows} lignes.")
    if rows == 0:
        raise ValidationError("Le CSV ne contient aucune ligne de données.")
    return {"rows": rows, "columns": fieldnames, "delimiter": getattr(dialect, "delimiter", ",")}


def json_depth(value, *, _depth: int = 0) -> int:
    if isinstance(value, dict):
        if not value:
            return _depth + 1
        return max(json_depth(item, _depth=_depth + 1) for item in value.values())
    if isinstance(value, list):
        if not value:
            return _depth + 1
        return max(json_depth(item, _depth=_depth + 1) for item in value)
    return _depth + 1


def json_string_size(value) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def validate_mbtiles_sqlite(file) -> dict:
    validate_uploaded_file_basics(file, allowed_extensions={".mbtiles"}, max_size=10**12, label="fichier MBTiles")
    validate_magic_signature(file, ".mbtiles")
    if hasattr(file, "temporary_file_path"):
        with sqlite3.connect(file.temporary_file_path()) as conn:
            return _validate_mbtiles_connection(conn)
    position = _remember_position(file)
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mbtiles", delete=False) as tmp:
            tmp_path = tmp.name
            tmp.write(file.read())
        with sqlite3.connect(tmp_path) as conn:
            return _validate_mbtiles_connection(conn)
    finally:
        _restore_position(file, position)
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass


def _validate_mbtiles_connection(conn) -> dict:
    try:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    except sqlite3.DatabaseError as exc:
        raise ValidationError(f"MBTiles invalide : {exc}") from exc
    if "tiles" not in tables:
        raise ValidationError("MBTiles sans table tiles.")
    columns = {row[1] for row in conn.execute("PRAGMA table_info(tiles)")}
    required = {"zoom_level", "tile_column", "tile_row", "tile_data"}
    if not required.issubset(columns):
        raise ValidationError("Table tiles MBTiles incomplète.")
    return {"tables": sorted(tables)}
