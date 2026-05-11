from django.urls import reverse
from rest_framework import serializers

from config.file_validation import validate_office_or_common_file

from accounts.permissions import INTERNAL_ROLES, user_can_access_organization, user_can_manage_user
from parcels.models import Parcel
from .models import SupportMessage, SupportTicket
from django.contrib.auth import get_user_model

User = get_user_model()


ALLOWED_SUPPORT_ATTACHMENT_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".zip"
}
MAX_SUPPORT_ATTACHMENT_SIZE_BYTES = 15 * 1024 * 1024


def validate_support_attachment_file(file):
    validate_office_or_common_file(
        file,
        allowed_extensions=ALLOWED_SUPPORT_ATTACHMENT_EXTENSIONS,
        max_size=MAX_SUPPORT_ATTACHMENT_SIZE_BYTES,
        label="pièce jointe support",
    )
    return file


class SupportMessageSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_role = serializers.SerializerMethodField()
    attachment_url = serializers.SerializerMethodField()
    attachment_name = serializers.SerializerMethodField()
    attachment_size = serializers.SerializerMethodField()

    class Meta:
        model = SupportMessage
        fields = [
            "id", "ticket", "author", "author_name", "author_role", "body", "attachment", "attachment_url",
            "attachment_name", "attachment_size", "is_internal_note", "created_at",
        ]
        read_only_fields = ["id", "ticket", "author", "author_name", "author_role", "attachment_url", "attachment_name", "attachment_size", "created_at"]
        extra_kwargs = {"attachment": {"write_only": True, "required": False}}

    def get_author_name(self, obj):
        if not obj.author_id:
            return "Système"
        full_name = f"{obj.author.first_name} {obj.author.last_name}".strip()
        return full_name or obj.author.company_name or obj.author.username

    def get_author_role(self, obj):
        if not obj.author_id:
            return "Système"
        return "Équipe MAPGEO" if obj.author.role in INTERNAL_ROLES else "Client"

    def get_attachment_url(self, obj):
        request = self.context.get("request")
        if not obj.attachment:
            return None
        url = reverse("support-attachment-download", kwargs={"message_id": obj.pk})
        return request.build_absolute_uri(url) if request else url

    def get_attachment_name(self, obj):
        if not obj.attachment:
            return ""
        return obj.attachment.name.rsplit("/", 1)[-1]

    def get_attachment_size(self, obj):
        if not obj.attachment:
            return 0
        try:
            return obj.attachment.size
        except Exception:
            return 0

    def validate_attachment(self, file):
        return validate_support_attachment_file(file)

    def validate(self, attrs):
        request = self.context.get("request")
        if attrs.get("is_internal_note") and request and request.user.role not in INTERNAL_ROLES:
            raise serializers.ValidationError({"is_internal_note": "Les notes internes sont réservées à l'équipe MAPGEO."})
        if not (attrs.get("body") or "").strip():
            raise serializers.ValidationError({"body": "Le message est obligatoire."})
        return attrs


class SupportTicketSerializer(serializers.ModelSerializer):
    initial_attachment = serializers.FileField(write_only=True, required=False, allow_empty_file=False)
    client = serializers.PrimaryKeyRelatedField(
        source="user",
        queryset=User.objects.filter(role="client"),
        write_only=True,
        required=False,
    )
    reference = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()
    user_client_code = serializers.CharField(source="user.client_code", read_only=True)
    client_code = serializers.CharField(source="user.client_code", read_only=True)
    parcel = serializers.PrimaryKeyRelatedField(queryset=Parcel.objects.select_related("owner", "organization").all(), allow_null=True, required=False)
    parcel_reference = serializers.CharField(source="parcel.reference", read_only=True)
    organization = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    organization_code = serializers.SerializerMethodField()
    last_reply_at = serializers.SerializerMethodField()
    last_reply_at_label = serializers.SerializerMethodField()
    messages = serializers.SerializerMethodField()
    has_attachment = serializers.SerializerMethodField()
    attachment_count = serializers.SerializerMethodField()

    class Meta:
        model = SupportTicket
        fields = [
                "id", "reference", "user", "client", "user_name", "client_name", "user_client_code", "client_code",
                "parcel", "parcel_reference", "organization", "organization_name", "organization_code",
                "subject", "category", "message", "messages", "has_attachment", "attachment_count", "initial_attachment",
                "status", "priority", "last_reply_at", "last_reply_at_label", "created_at", "updated_at",
            ]
        read_only_fields = [
                "id", "reference", "user", "created_at", "updated_at", "user_name", "client_name", "user_client_code", "client_code",
                "parcel_reference", "organization", "organization_name", "organization_code", "last_reply_at", "last_reply_at_label", "messages", "has_attachment", "attachment_count",
            ]

    def get_reference(self, obj):
        return f"SUP-{obj.pk:06d}" if obj.pk else None

    def get_user_name(self, obj):
        full_name = f"{obj.user.first_name} {obj.user.last_name}".strip()
        return full_name or obj.user.company_name or obj.user.username

    def get_client_name(self, obj):
        return self.get_user_name(obj)

    def _client_primary_membership(self, obj):
        if not getattr(obj, "user_id", None):
            return None
        prefetched = getattr(obj.user, "_prefetched_objects_cache", {}).get("organization_memberships")
        if prefetched is None:
            memberships = list(obj.user.organization_memberships.filter(is_active=True).select_related("organization").order_by("-is_primary", "id"))
        else:
            memberships = [membership for membership in prefetched if membership.is_active]
        owners = [membership for membership in memberships if membership.role == "owner"]
        candidates = owners or memberships
        if not candidates:
            return None
        return sorted(candidates, key=lambda item: (not item.is_primary, item.id))[0]

    def _ticket_organization(self, obj):
        if getattr(obj, "parcel_id", None) and getattr(obj.parcel, "organization_id", None):
            return obj.parcel.organization
        membership = self._client_primary_membership(obj)
        return membership.organization if membership else None

    def get_organization(self, obj):
        organization = self._ticket_organization(obj)
        return organization.id if organization else None

    def get_organization_name(self, obj):
        organization = self._ticket_organization(obj)
        return organization.name if organization else None

    def get_organization_code(self, obj):
        organization = self._ticket_organization(obj)
        return organization.code if organization else None

    def _last_message_created_at(self, obj):
        messages = list(obj.messages.all())
        if not messages:
            return obj.updated_at or obj.created_at
        return messages[-1].created_at

    def get_last_reply_at(self, obj):
        return self._last_message_created_at(obj)

    def get_last_reply_at_label(self, obj):
        value = self._last_message_created_at(obj)
        return value.strftime("%d/%m/%Y") if value else None

    def _visible_messages(self, obj):
        request = self.context.get("request")
        queryset = obj.messages.select_related("author").all()
        if request and request.user.role not in INTERNAL_ROLES:
            queryset = queryset.filter(is_internal_note=False)
        return queryset

    def get_messages(self, obj):
        return SupportMessageSerializer(self._visible_messages(obj), many=True, context=self.context).data

    def get_has_attachment(self, obj):
        return self._visible_messages(obj).filter(attachment__isnull=False).exclude(attachment="").exists()

    def get_attachment_count(self, obj):
        return self._visible_messages(obj).filter(attachment__isnull=False).exclude(attachment="").count()

    def validate_parcel(self, parcel):
        request = self.context.get("request")
        if not parcel or not request:
            return parcel
        if request.user.role in INTERNAL_ROLES:
            if parcel.organization_id and user_can_access_organization(request.user, parcel.organization_id):
                return parcel
            raise serializers.ValidationError("Cette parcelle n'est pas accessible depuis le compte connecté.")
        org_ids = request.user.organization_memberships.filter(is_active=True).values_list("organization_id", flat=True)
        if parcel.owner_id != request.user.id and parcel.organization_id not in org_ids:
            raise serializers.ValidationError("Cette parcelle n'appartient pas au compte connecté.")
        return parcel

    def validate_initial_attachment(self, file):
        return validate_support_attachment_file(file)

    def validate(self, attrs):
        request = self.context.get("request")
        parcel = attrs.get("parcel") or getattr(self.instance, "parcel", None)
        target_user = attrs.get("user")

        if request and request.user.role in INTERNAL_ROLES:
            if not target_user and parcel and getattr(parcel, "owner_id", None):
                attrs["user"] = parcel.owner
                target_user = parcel.owner

            if target_user and target_user != request.user:
                target_org_ids = target_user.organization_memberships.filter(is_active=True).values_list("organization_id", flat=True)
                target_is_visible_client = target_user.role == "client" and any(
                    user_can_access_organization(request.user, org_id) for org_id in target_org_ids
                )
                if not target_is_visible_client and not user_can_manage_user(request.user, target_user):
                    raise serializers.ValidationError({"client": "Ce client n'est pas accessible dans votre périmètre."})

            if request.method == "POST" and not target_user:
                if parcel:
                    raise serializers.ValidationError({"client": "Cette parcelle n'a pas de client propriétaire : sélectionnez un client."})
                raise serializers.ValidationError({"client": "Sélectionnez un client ou rattachez une parcelle au ticket."})

        if request and request.user.role not in INTERNAL_ROLES:
            if attrs.get("priority") == "urgent":
                raise serializers.ValidationError({"priority": "Le niveau urgent est réservé au support interne."})
            # Un client peut créer un ticket ouvert, mais ne pilote pas le workflow interne.
            if request.method in {"POST", "PUT", "PATCH"}:
                attrs["status"] = getattr(self.instance, "status", "open") if self.instance else "open"
        return attrs

    def create(self, validated_data):
        request = self.context["request"]
        initial_attachment = validated_data.pop("initial_attachment", None)

        if "user" not in validated_data:
            validated_data["user"] = request.user

        if request.user.role not in INTERNAL_ROLES:
            validated_data["user"] = request.user

        validated_data.setdefault("status", "open")

        ticket = super().create(validated_data)

        SupportMessage.objects.create(
            ticket=ticket,
            author=request.user,
            body=ticket.message,
            attachment=initial_attachment,
        )

        return ticket
