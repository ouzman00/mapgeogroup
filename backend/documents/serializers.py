from pathlib import Path

from django.urls import reverse
from rest_framework import serializers

from accounts.permissions import is_internal_user, user_can_access_organization, user_can_manage_organization
from organizations.models import OrganizationMembership
from parcels.models import Parcel
from .models import ParcelDocument
from config.file_validation import validate_office_or_common_file

ALLOWED_DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".csv",
    ".kml",
    ".kmz",
    ".dxf",
    ".dwg",
    ".zip",
    ".txt",
}

MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024

MAGIC_SIGNATURES = {
    ".pdf": (b"%PDF",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".zip": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    ".docx": (b"PK\x03\x04",),
    ".xlsx": (b"PK\x03\x04",),
    ".kmz": (b"PK\x03\x04",),
}


def _validate_magic_signature(file, suffix):
    signatures = MAGIC_SIGNATURES.get(suffix)
    if not signatures or not hasattr(file, "read"):
        return
    current_position = file.tell() if hasattr(file, "tell") else None
    header = file.read(16)
    if current_position is not None and hasattr(file, "seek"):
        file.seek(current_position)
    if header and not any(header.startswith(signature) for signature in signatures):
        raise serializers.ValidationError("Le contenu du fichier ne correspond pas à son extension.")


class ParcelDocumentSerializer(serializers.ModelSerializer):
    parcel = serializers.PrimaryKeyRelatedField(
        queryset=Parcel.objects.select_related("owner", "organization").all()
    )
    parcel_reference = serializers.CharField(source="parcel.reference", read_only=True)

    owner_name = serializers.SerializerMethodField()
    owner_client_code = serializers.CharField(source="parcel.owner.client_code", read_only=True)
    organization_name = serializers.CharField(source="parcel.organization.name", read_only=True, allow_null=True)
    organization_code = serializers.CharField(source="parcel.organization.code", read_only=True, allow_null=True)

    file_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    file_extension = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    document_type_label = serializers.CharField(source="get_document_type_display", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    versions = serializers.SerializerMethodField()

    class Meta:
        model = ParcelDocument
        fields = [
            "id",
            "parcel",
            "parcel_reference",
            "owner_name",
            "owner_client_code",
            "organization_name",
            "organization_code",
            "title",
            "document_type",
            "file",
            "file_url",
            "file_name",
            "file_extension",
            "file_size",
            "document_type_label",
            "status_label",
            "version",
            "status",
            "description",
            "is_public_for_client",
            "uploaded_by",
            "uploaded_by_name",
            "source",
            "created_at",
            "updated_at",
            "versions",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "file_url",
            "file_name",
            "file_extension",
            "file_size",
            "document_type_label",
            "status_label",
            "parcel_reference",
            "owner_name",
            "owner_client_code",
            "organization_name",
            "organization_code",
            "uploaded_by",
            "uploaded_by_name",
            "source",
            "versions",
        ]
        extra_kwargs = {
            "file": {
                "write_only": True,
                "required": False,
            }
        }

    def get_owner_name(self, obj):
        if not obj.parcel_id or not obj.parcel.owner_id:
            return None

        owner = obj.parcel.owner
        full_name = f"{owner.first_name} {owner.last_name}".strip()
        return full_name or owner.company_name or owner.username

    def get_uploaded_by_name(self, obj):
        uploader = getattr(obj, "uploaded_by", None)
        if not uploader:
            return None
        full_name = f"{uploader.first_name} {uploader.last_name}".strip()
        return full_name or uploader.company_name or uploader.username

    def get_versions(self, obj):
        return [
            {
                "id": obj.pk,
                "version": obj.version or "v1",
                "status": obj.status,
                "status_label": obj.get_status_display(),
                "created_at": obj.created_at,
                "updated_at": obj.updated_at,
                "uploaded_by_name": self.get_uploaded_by_name(obj),
                "file_name": self.get_file_name(obj),
                "file_size": self.get_file_size(obj),
            }
        ]

    def get_file_url(self, obj):
        request = self.context.get("request")

        if not obj.file:
            return None

        url = reverse("document-download", kwargs={"pk": obj.pk})
        return request.build_absolute_uri(url) if request else url

    def get_file_name(self, obj):
        if not obj.file:
            return None
        return Path(obj.file.name).name

    def get_file_extension(self, obj):
        if not obj.file:
            return None
        return Path(obj.file.name).suffix.lower().lstrip(".")

    def get_file_size(self, obj):
        if not obj.file:
            return None
        try:
            return obj.file.size
        except (OSError, ValueError):
            return None

    def validate_parcel(self, parcel):
        request = self.context.get("request")

        if not request:
            return parcel

        if request.method in {"POST", "PUT", "PATCH"}:
            if is_internal_user(request.user):
                if not user_can_manage_organization(request.user, parcel.organization_id):
                    raise serializers.ValidationError("Vous ne pouvez rattacher un document qu'à une parcelle de votre périmètre.")
                return parcel

            if request.method == "POST" and getattr(request.user, "role", None) == "client" and parcel.owner_id == request.user.id:
                return parcel

            raise serializers.ValidationError("Vous ne pouvez déposer un document que sur l'une de vos propres parcelles.")

        if is_internal_user(request.user):
            if parcel.organization_id and user_can_access_organization(request.user, parcel.organization_id):
                return parcel
            raise serializers.ValidationError("Cette parcelle n'est pas accessible depuis le compte connecté.")

        has_org_access = False

        if parcel.organization_id:
            has_org_access = OrganizationMembership.objects.filter(
                user=request.user,
                organization_id=parcel.organization_id,
                is_active=True,
            ).exists()

        if parcel.owner_id != request.user.id and not has_org_access:
            raise serializers.ValidationError(
                "Cette parcelle n'est pas accessible depuis le compte connecté."
            )

        return parcel

    def validate_file(self, file):
        validate_office_or_common_file(
            file,
            allowed_extensions=ALLOWED_DOCUMENT_EXTENSIONS,
            max_size=MAX_DOCUMENT_SIZE_BYTES,
            label="document",
        )
        return file

    def validate(self, attrs):
        request = self.context.get("request")

        if request and request.method in {"PUT", "PATCH"} and not is_internal_user(request.user):
            raise serializers.ValidationError("Seuls les utilisateurs internes peuvent modifier les documents existants.")

        is_client_upload = bool(
            request
            and request.method == "POST"
            and getattr(request.user, "role", None) == "client"
        )

        if is_client_upload:
            attrs["status"] = "draft"
            attrs["is_public_for_client"] = False
            attrs["source"] = "client_upload"
            attrs["uploaded_by"] = request.user
        elif request and request.method == "POST":
            attrs.setdefault("source", "internal")
            attrs["uploaded_by"] = request.user

        status = attrs.get("status", getattr(self.instance, "status", None) or "draft")

        # Dès qu’un document sort des statuts publiables, on le retire côté client.
        # Cela permet notamment d’archiver un document public sans validation contradictoire.
        if status not in {"validated", "final"}:
            attrs["is_public_for_client"] = False

        is_public = attrs.get("is_public_for_client", getattr(self.instance, "is_public_for_client", False))

        if is_public and status not in {"validated", "final"}:
            raise serializers.ValidationError({
                "is_public_for_client": "Seuls les documents validés ou finaux peuvent être visibles côté client."
            })

        if request and request.method == "POST" and not attrs.get("file"):
            raise serializers.ValidationError({"file": "Un fichier est obligatoire."})

        return attrs