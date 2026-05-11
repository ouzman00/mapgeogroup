from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.utils import timezone
from django.utils.deconstruct import deconstructible


@deconstructible
class PrivateMediaStorage(FileSystemStorage):
    """
    Stockage privé commun aux fichiers métiers.

    Les noms stockés en base conservent un préfixe métier explicite
    (documents/..., support/..., imports/...) afin de rester compatibles
    avec les anciens fichiers déjà référencés en base.

    Attention : ces fichiers ne doivent jamais être servis par /media/.
    La méthode url() lève volontairement une erreur pour éviter toute
    génération accidentelle d'URL publique.
    """

    def __init__(self, category: str):
        self.category = str(category).strip("/")
        super().__init__(
            location=getattr(settings, "PRIVATE_MEDIA_ROOT", settings.BASE_DIR / "private_media"),
            base_url=None,
        )

    def _normalize_name(self, name: str) -> str:
        clean_name = str(name or "").lstrip("/")
        if self.category and not clean_name.startswith(f"{self.category}/"):
            clean_name = f"{self.category}/{clean_name}"
        return clean_name

    def _save(self, name, content):
        return super()._save(self._normalize_name(name), content)

    def get_available_name(self, name, max_length=None):
        return super().get_available_name(self._normalize_name(name), max_length=max_length)

    def path(self, name):
        return super().path(self._normalize_name(name))

    def exists(self, name):
        return super().exists(self._normalize_name(name))

    def delete(self, name):
        return super().delete(self._normalize_name(name))

    def open(self, name, mode="rb"):
        return super().open(self._normalize_name(name), mode)

    def url(self, name):  # pragma: no cover - comportement de sécurité attendu
        raise ValueError("Ce fichier est privé et doit être servi par une route API authentifiée.")


def _safe_extension(filename: str, default: str = ".dat") -> str:
    suffix = Path(filename or "").suffix.lower()
    if not suffix or len(suffix) > 12:
        return default
    return "".join(ch for ch in suffix if ch.isalnum() or ch == ".") or default


def _dated_uuid_path(prefix: str, scope: str, filename: str) -> str:
    now = timezone.now()
    extension = _safe_extension(filename)
    return f"{prefix}/{scope}/{now:%Y/%m}/{uuid4()}{extension}"


def private_document_upload_to(instance, filename: str) -> str:
    parcel = getattr(instance, "parcel", None)
    organization_id = getattr(parcel, "organization_id", None) or "unknown"
    return _dated_uuid_path("documents", f"organization-{organization_id}", filename)


def private_support_attachment_upload_to(instance, filename: str) -> str:
    ticket_id = getattr(instance, "ticket_id", None) or "pending"
    return _dated_uuid_path("support", f"ticket-{ticket_id}", filename)


def private_import_upload_to(instance, filename: str) -> str:
    organization_id = getattr(instance, "organization_id", None) or "unknown"
    return _dated_uuid_path("imports", f"organization-{organization_id}", filename)


private_document_storage = PrivateMediaStorage("documents")
private_support_storage = PrivateMediaStorage("support")
private_import_storage = PrivateMediaStorage("imports")


PRIVATE_FILE_RESPONSE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
    "Vary": "Authorization",
}


def apply_private_file_response_headers(response):
    for header, value in PRIVATE_FILE_RESPONSE_HEADERS.items():
        response[header] = value
    return response


def migrate_public_media_prefix_to_private(prefix: str) -> None:
    """
    Copie idempotente des anciens fichiers MEDIA_ROOT/<prefix>/ vers
    PRIVATE_MEDIA_ROOT/<prefix>/ sans modifier les noms stockés en base.

    Exemple :
      MEDIA_ROOT/documents/2025/01/test.pdf
      -> PRIVATE_MEDIA_ROOT/documents/2025/01/test.pdf

    La suppression de l'ancien dossier public doit être faite au déploiement
    après sauvegarde et vérification.
    """

    source_root = Path(getattr(settings, "MEDIA_ROOT", settings.BASE_DIR / "media")) / prefix
    target_root = Path(getattr(settings, "PRIVATE_MEDIA_ROOT", settings.BASE_DIR / "private_media")) / prefix

    if not source_root.exists():
        return

    for source_path in source_root.rglob("*"):
        if not source_path.is_file():
            continue
        relative_path = source_path.relative_to(source_root)
        target_path = target_root / relative_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if not target_path.exists():
            shutil.copy2(source_path, target_path)
