from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Organization, OrganizationMembership

User = get_user_model()


class OrganizationMembershipSerializer(serializers.ModelSerializer):
    user_display = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationMembership
        fields = [
            "id",
            "user",
            "user_display",
            "role",
            "is_primary",
            "is_active",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "user_display",
        ]

    def get_user_display(self, obj):
        full_name = f"{obj.user.first_name} {obj.user.last_name}".strip()
        return full_name or obj.user.company_name or obj.user.username


class OrganizationSerializer(serializers.ModelSerializer):
    memberships = OrganizationMembershipSerializer(many=True, read_only=True)
    member_count = serializers.SerializerMethodField()
    parcels_count = serializers.SerializerMethodField()
    primary_user_id = serializers.SerializerMethodField()
    primary_user_name = serializers.SerializerMethodField()
    primary_user_email = serializers.SerializerMethodField()
    primary_user_client_code = serializers.SerializerMethodField()
    primary_user_is_active = serializers.SerializerMethodField()
    portal_access_status = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "code",
            "organization_type",
            "status",
            "email",
            "phone",
            "address",
            "metadata",
            "member_count",
            "parcels_count",
            "primary_user_id",
            "primary_user_name",
            "primary_user_email",
            "primary_user_client_code",
            "primary_user_is_active",
            "portal_access_status",
            "memberships",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "member_count",
            "parcels_count",
            "primary_user_id",
            "primary_user_name",
            "primary_user_email",
            "primary_user_client_code",
            "primary_user_is_active",
            "portal_access_status",
            "memberships",
        ]

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request and getattr(request.user, "role", None) == "client":
            fields.pop("memberships", None)
        return fields

    def validate_code(self, value):
        code = (value or "").strip().upper()

        if not code:
            raise serializers.ValidationError("Le code organisation est obligatoire.")

        queryset = Organization.objects.filter(code__iexact=code)

        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.exists():
            raise serializers.ValidationError("Ce code organisation existe déjà.")

        user_queryset = User.objects.filter(client_code__iexact=code)

        if self.instance:
            owner_ids = self.instance.memberships.filter(
                role="owner",
                is_active=True,
            ).values_list("user_id", flat=True)

            user_queryset = user_queryset.exclude(pk__in=owner_ids)

        if user_queryset.exists():
            raise serializers.ValidationError("Ce code est déjà utilisé comme code client.")

        return code

    def get_member_count(self, obj):
        prefetched = getattr(obj, "_prefetched_objects_cache", {}).get("memberships")

        if prefetched is not None:
            return len([item for item in prefetched if item.is_active])

        return obj.memberships.filter(is_active=True).count()

    def get_parcels_count(self, obj):
        if hasattr(obj, "parcels_count"):
            return obj.parcels_count

        if hasattr(obj, "parcels"):
            return obj.parcels.count()

        return 0
    def _primary_membership(self, obj):
        prefetched = getattr(obj, "_prefetched_objects_cache", {}).get("memberships")

        if prefetched is None:
            memberships = list(
                obj.memberships.filter(is_active=True)
                .select_related("user")
                .order_by("-is_primary", "id")
            )
        else:
            memberships = [membership for membership in prefetched if membership.is_active]

        owners = [membership for membership in memberships if membership.role == "owner"]
        candidates = owners or memberships

        if not candidates:
            return None

        return sorted(candidates, key=lambda item: (not item.is_primary, item.id))[0]

    def _primary_user(self, obj):
        membership = self._primary_membership(obj)
        return membership.user if membership else None

    def get_primary_user_id(self, obj):
        user = self._primary_user(obj)
        return user.id if user else None

    def get_primary_user_name(self, obj):
        user = self._primary_user(obj)
        if not user:
            return None

        full_name = f"{user.first_name} {user.last_name}".strip()
        return full_name or user.company_name or user.username

    def get_primary_user_email(self, obj):
        user = self._primary_user(obj)
        return user.email if user else None

    def get_primary_user_client_code(self, obj):
        user = self._primary_user(obj)
        return user.client_code if user else None

    def get_primary_user_is_active(self, obj):
        user = self._primary_user(obj)
        return bool(user and user.is_active)

    def get_portal_access_status(self, obj):
        user = self._primary_user(obj)

        if not user:
            return "no_account"

        if not user.is_active:
            return "disabled"

        if not user.is_verified:
            return "pending_activation"

        return "active"

class OrganizationLookupSerializer(serializers.ModelSerializer):
    label = serializers.SerializerMethodField()

    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "code",
            "organization_type",
            "status",
            "label",
        ]

    def get_label(self, obj):
        code = (getattr(obj, "code", "") or "").strip()
        name = (getattr(obj, "name", "") or "").strip()
        return f"{name} · {code}" if name and code else name or code or f"Client {obj.pk}"

