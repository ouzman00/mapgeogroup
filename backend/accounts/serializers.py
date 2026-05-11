from django.contrib.auth import authenticate, get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from organizations.models import Organization
from organizations.serializers import OrganizationSerializer
from organizations.services import create_client_account
from .security import get_login_throttle_state, register_login_failure, reset_login_failures, retry_after_label

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    portal_type = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    client_id = serializers.IntegerField(source="client.id", read_only=True)
    client_name = serializers.CharField(source="client.name", read_only=True)
    organizations = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "email",
            "role",
            "client_id",
            "client_name",
            "client_code",
            "company_name",
            "phone",
            "is_verified",
            "is_active",
            "last_login",
            "portal_type",
            "display_name",
            "organizations",
        ]
        read_only_fields = [
            "id",
            "role",
            "client_id",
            "client_name",
            "client_code",
            "is_verified",
            "portal_type",
            "display_name",
            "organizations",
        ]

    def get_portal_type(self, obj):
        return "client" if obj.role == "client" else "internal"

    def get_display_name(self, obj):
        full_name = f"{obj.first_name} {obj.last_name}".strip()
        return full_name or obj.company_name or obj.username

    def get_organizations(self, obj):
        memberships = (
            obj.organization_memberships
            .filter(is_active=True)
            .select_related("organization")
            .order_by("-is_primary", "id")
        )
        return [
            {
                "id": membership.organization_id,
                "name": membership.organization.name,
                "code": membership.organization.code,
                "role": membership.role,
                "is_primary": membership.is_primary,
            }
            for membership in memberships
        ]

    def validate_email(self, value):
        if value in (None, ""):
            return value

        email = value.strip().lower()
        queryset = User.objects.filter(email__iexact=email)

        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.exists():
            raise serializers.ValidationError("Cette adresse e-mail est déjà utilisée.")

        return email


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = [
            "username",
            "first_name",
            "last_name",
            "email",
            "password",
            "password_confirm",
            "company_name",
            "phone",
        ]

    def validate_email(self, value):
        email = value.strip().lower()

        if email and User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("Cette adresse e-mail est déjà utilisée.")

        return email

    def validate_username(self, value):
        username = value.strip()

        if User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError("Ce nom d'utilisateur existe déjà.")

        return username

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({
                "password_confirm": "Les mots de passe ne correspondent pas."
            })

        password_validation.validate_password(attrs["password"])

        return attrs

    def create(self, validated_data):
        validated_data.pop("password_confirm", None)
        password = validated_data.pop("password")

        first_name = validated_data.get("first_name", "")
        last_name = validated_data.get("last_name", "")
        full_name = f"{first_name} {last_name}".strip()
        company_name = validated_data.get("company_name")

        bundle = create_client_account(
            name=company_name or full_name or validated_data["username"],
            username=validated_data["username"],
            first_name=first_name,
            last_name=last_name,
            email=validated_data.get("email"),
            company_name=company_name,
            phone=validated_data.get("phone"),
            password=password,
            is_verified=False,
            is_active=True,
        )

        return bundle.user


class AdminClientCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    code = serializers.CharField(max_length=32, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=Organization.STATUS_CHOICES, default="active")
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    phone = serializers.CharField(max_length=50, required=False, allow_blank=True, allow_null=True)
    address = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    username = serializers.CharField(max_length=150, required=False, allow_blank=True)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    company_name = serializers.CharField(max_length=255, required=False, allow_blank=True, allow_null=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, min_length=8)

    portal_access = serializers.BooleanField(required=False, default=True)
    send_invitation = serializers.BooleanField(required=False, default=True)

    generated_password = serializers.CharField(read_only=True)
    activation_url = serializers.CharField(read_only=True)
    invitation_sent = serializers.BooleanField(read_only=True)
    organization = OrganizationSerializer(read_only=True)
    user = UserSerializer(read_only=True)

    def validate_email(self, value):
        email = (value or "").strip().lower()

        if email and User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("Cette adresse e-mail est déjà utilisée par un utilisateur.")

        return email or None

    def validate_username(self, value):
        username = (value or "").strip()

        if username and User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError("Ce nom d'utilisateur existe déjà.")

        return username

    def validate_code(self, value):
        code = (value or "").strip().upper()

        if not code:
            return ""

        if Organization.objects.filter(code__iexact=code).exists():
            raise serializers.ValidationError("Ce code organisation existe déjà.")

        if User.objects.filter(client_code__iexact=code).exists():
            raise serializers.ValidationError("Ce code client existe déjà.")

        return code

    def validate_password(self, value):
        password = (value or "").strip()

        if password:
            try:
                password_validation.validate_password(password)
            except DjangoValidationError as exc:
                raise serializers.ValidationError(list(exc.messages)) from exc

        return password

    def validate(self, attrs):
        send_invitation = bool(attrs.get("send_invitation", True))
        portal_access = bool(attrs.get("portal_access", True))
        email = attrs.get("email")

        if portal_access and send_invitation and not email:
            raise serializers.ValidationError({
                "email": "L’adresse e-mail est obligatoire pour envoyer une invitation d’activation."
            })

        if portal_access and not send_invitation and not attrs.get("password"):
            raise serializers.ValidationError({
                "password": "Définissez un mot de passe initial ou activez l’envoi d’une invitation sécurisée."
            })

        return attrs

    def create(self, validated_data):
        send_invitation = bool(validated_data.get("send_invitation", True))
        portal_access = bool(validated_data.get("portal_access", True))
        password = validated_data.get("password") or None

        # Si invitation activée : le client définira son mot de passe via le lien e-mail.
        if send_invitation:
            password = None

        generate_temporary_password = False

        bundle = create_client_account(
            name=validated_data["name"],
            code=validated_data.get("code"),
            email=validated_data.get("email"),
            phone=validated_data.get("phone"),
            address=validated_data.get("address"),
            status=validated_data.get("status") or "active",
            username=validated_data.get("username"),
            first_name=validated_data.get("first_name"),
            last_name=validated_data.get("last_name"),
            company_name=validated_data.get("company_name") or validated_data["name"],
            password=password,
            is_verified=bool(portal_access and not send_invitation),
            is_active=portal_access,
            generate_temporary_password=generate_temporary_password,
        )

        return {
            "organization": bundle.organization,
            "user": bundle.user,
            # Ne jamais exposer un mot de passe temporaire via l'API.
            "generated_password": None,
            "send_invitation": send_invitation,
            "portal_access": portal_access,
            "activation_url": None,
            "invitation_sent": False,
        }

    def to_representation(self, instance):
        return {
            "organization": OrganizationSerializer(instance["organization"], context=self.context).data,
            "user": UserSerializer(instance["user"], context=self.context).data,
            "generated_password": None,
            "activation_url": instance.get("activation_url"),
            "invitation_sent": instance.get("invitation_sent", False),
        }


class ClientCodeTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = "login"
    login = serializers.CharField(required=True)
    password = serializers.CharField(required=True, write_only=True)

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["client_code"] = user.client_code or ""
        token["client_id"] = user.client_id or ""
        token["portal_type"] = "client" if user.role == "client" else "internal"
        return token

    def validate(self, attrs):
        request = self.context.get("request")
        login = (attrs.get("login") or "").strip()
        password = attrs.get("password")

        if not login or not password:
            raise serializers.ValidationError({
                "detail": "Identifiant ou mot de passe manquant."
            })

        throttle_state = get_login_throttle_state(login, request) if request else None
        if throttle_state and throttle_state.is_locked:
            raise serializers.ValidationError({
                "detail": f"Trop de tentatives échouées. Réessayez dans {retry_after_label(throttle_state.retry_after_seconds)}."
            })

        candidate = (
            User.objects
            .filter(
                Q(username__iexact=login)
                | Q(email__iexact=login)
                | Q(client_code__iexact=login)
            )
            .order_by("id")
            .first()
        )

        if not candidate:
            if request:
                state = register_login_failure(login, request)
                if state.is_locked:
                    raise serializers.ValidationError({
                        "detail": f"Trop de tentatives échouées. Réessayez dans {retry_after_label(state.retry_after_seconds)}."
                    })
            raise serializers.ValidationError({
                "detail": "Connexion impossible avec cet identifiant."
            })

        user = authenticate(
            request=request,
            username=candidate.username,
            password=password,
        )

        if not user or not user.is_active:
            if request:
                state = register_login_failure(login, request, user=candidate)
                if state.is_locked:
                    raise serializers.ValidationError({
                        "detail": f"Trop de tentatives échouées. Réessayez dans {retry_after_label(state.retry_after_seconds)}."
                    })
            raise serializers.ValidationError({
                "detail": "Connexion impossible avec cet identifiant."
            })

        if user.role == "client" and not user.is_verified:
            raise serializers.ValidationError({
                "detail": "Votre compte client n'est pas encore validé. Vérifiez votre e-mail d'activation."
            })

        if request:
            reset_login_failures(login, request)

        refresh = self.get_token(user)

        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
            "user": UserSerializer(user).data,
        }
