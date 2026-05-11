import json
import logging
import urllib.parse
import urllib.request

from django.conf import settings
from django.contrib.auth import get_user_model, password_validation
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import generics, permissions, serializers, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .permissions import INTERNAL_ROLES, IsAdminOrManager, filter_users_for_user, user_can_manage_organization, user_can_manage_user
from .security import (
    get_public_action_throttle_state,
    register_public_action_attempt,
    reset_public_action_throttle,
    retry_after_label,
)
from .serializers import (
    AdminClientCreateSerializer,
    ClientCodeTokenObtainPairSerializer,
    RegisterSerializer,
    UserSerializer,
)

User = get_user_model()
logger = logging.getLogger(__name__)


def public_rate_limit_response(state):
    return Response(
        {
            "detail": f"Trop de tentatives. Réessayez dans {retry_after_label(state.retry_after_seconds)}.",
            "retry_after_seconds": state.retry_after_seconds,
        },
        status=429,
    )


def refresh_cookie_enabled() -> bool:
    return bool(getattr(settings, "JWT_REFRESH_COOKIE_ENABLED", True))


def refresh_token_body_enabled() -> bool:
    return bool(getattr(settings, "JWT_REFRESH_COOKIE_BODY_ENABLED", settings.DEBUG))


def strip_refresh_from_body_when_cookie_mode(response):
    if refresh_cookie_enabled() and not refresh_token_body_enabled() and hasattr(response, "data") and isinstance(response.data, dict):
        response.data.pop("refresh", None)
    return response


def _refresh_cookie_base_kwargs():
    cookie_kwargs = {
        "path": getattr(settings, "JWT_REFRESH_COOKIE_PATH", "/api/auth/refresh/"),
        "samesite": getattr(settings, "JWT_REFRESH_COOKIE_SAMESITE", "Lax"),
    }
    cookie_domain = getattr(settings, "JWT_REFRESH_COOKIE_DOMAIN", None)
    if cookie_domain:
        cookie_kwargs["domain"] = cookie_domain
    return cookie_kwargs


def set_refresh_cookie(response, refresh_token):
    if not refresh_cookie_enabled():
        return response
    max_age = int(getattr(settings, "SIMPLE_JWT", {}).get("REFRESH_TOKEN_LIFETIME").total_seconds())
    cookie_kwargs = {
        "key": getattr(settings, "JWT_REFRESH_COOKIE_NAME", "mapgeo_refresh"),
        "value": str(refresh_token),
        "max_age": max_age,
        "httponly": True,
        "secure": bool(getattr(settings, "JWT_REFRESH_COOKIE_SECURE", not settings.DEBUG)),
        **_refresh_cookie_base_kwargs(),
    }
    response.set_cookie(**cookie_kwargs)
    return response


def delete_refresh_cookie(response):
    if not refresh_cookie_enabled():
        return response
    response.delete_cookie(
        getattr(settings, "JWT_REFRESH_COOKIE_NAME", "mapgeo_refresh"),
        **_refresh_cookie_base_kwargs(),
    )
    return response


class LogoutView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        response = Response({"detail": "Déconnexion effectuée."}, status=status.HTTP_200_OK)
        return delete_refresh_cookie(response)


class CookieTokenRefreshView(TokenRefreshView):
    serializer_class = TokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data or {})
        if not data.get("refresh"):
            cookie_name = getattr(settings, "JWT_REFRESH_COOKIE_NAME", "mapgeo_refresh")
            cookie_refresh = request.COOKIES.get(cookie_name)
            if cookie_refresh:
                data["refresh"] = cookie_refresh

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        response = Response(serializer.validated_data, status=status.HTTP_200_OK)
        if serializer.validated_data.get("refresh"):
            set_refresh_cookie(response, serializer.validated_data["refresh"])
        return strip_refresh_from_body_when_cookie_mode(response)

from organizations.models import Organization, OrganizationMembership


class LoginView(TokenObtainPairView):
    permission_classes = [permissions.AllowAny]
    serializer_class = ClientCodeTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        refresh = response.data.get("refresh") if hasattr(response, "data") else None
        if refresh:
            set_refresh_cookie(response, refresh)
        return strip_refresh_from_body_when_cookie_mode(response)


class RegisterView(generics.CreateAPIView):
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        if not getattr(settings, "PUBLIC_REGISTRATION_ENABLED", settings.DEBUG):
            return Response(
                {
                    "detail": "L'inscription libre est désactivée. Demandez la création du compte à un administrateur."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        return super().create(request, *args, **kwargs)


class ProfileView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        allowed_fields = {"first_name", "last_name", "email", "phone", "company_name"}
        payload = {}

        for key, value in request.data.items():
            if key not in allowed_fields:
                continue

            if isinstance(value, str):
                value = value.strip()
                if key == "email":
                    value = value.lower()

            payload[key] = value

        serializer = UserSerializer(request.user, data=payload, partial=True)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        return Response(UserSerializer(user).data)


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        current_password = request.data.get("current_password", "")
        new_password = request.data.get("new_password", "")
        confirm_password = request.data.get("confirm_password", "")

        if not current_password or not new_password or not confirm_password:
            return Response(
                {"detail": "Renseignez le mot de passe actuel, le nouveau mot de passe et sa confirmation."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not request.user.check_password(current_password):
            return Response(
                {"detail": "Le mot de passe actuel est incorrect."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if new_password != confirm_password:
            return Response(
                {"detail": "La confirmation du mot de passe ne correspond pas."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if current_password == new_password:
            return Response(
                {"detail": "Le nouveau mot de passe doit être différent du mot de passe actuel."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            password_validation.validate_password(new_password, request.user)
        except DjangoValidationError as exc:
            raise ValidationError({"new_password": list(exc.messages)}) from exc

        request.user.set_password(new_password)
        request.user.save(update_fields=["password"])

        return Response({"detail": "Mot de passe mis à jour avec succès."})


class UserListView(generics.ListAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]

    def get_queryset(self):
        queryset = filter_users_for_user(
            User.objects.all().prefetch_related("organization_memberships__organization").order_by("-id"),
            self.request.user,
        )
        params = self.request.query_params
        q = (params.get("q") or params.get("search") or "").strip()
        role = (params.get("role") or "").strip().lower()
        status_filter = (params.get("status") or "").strip().lower()
        portal = (params.get("portal") or params.get("portal_type") or "").strip().lower()
        organization = (params.get("organization") or params.get("organization_id") or params.get("client") or "").strip()

        if q:
            queryset = queryset.filter(
                Q(username__icontains=q)
                | Q(email__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(company_name__icontains=q)
                | Q(client_code__icontains=q)
                | Q(organization_memberships__organization__name__icontains=q)
                | Q(organization_memberships__organization__code__icontains=q)
            )

        if role:
            queryset = queryset.filter(role=role)

        if portal in {"client", "clients"}:
            queryset = queryset.filter(role="client")
        elif portal in {"internal", "interne", "backoffice"}:
            queryset = queryset.exclude(role="client")

        if status_filter in {"active", "actif"}:
            queryset = queryset.filter(is_active=True)
        elif status_filter in {"inactive", "inactif"}:
            queryset = queryset.filter(is_active=False).exclude(role="client", is_verified=False)
        elif status_filter in {"pending", "invitation", "invited"}:
            queryset = queryset.filter(role="client", is_active=False, is_verified=False)

        if organization:
            organization_filter = Q(organization_memberships__organization__code__iexact=organization)
            if organization.isdigit():
                organization_filter |= Q(organization_memberships__organization_id=int(organization))
            queryset = queryset.filter(organization_filter)

        return queryset.distinct()


def build_client_activation_url(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)

    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")

    return f"{frontend_url}/activate-client/{uid}/{token}"


def send_client_activation_email(user):
    if not user.email:
        return None, False

    activation_url = build_client_activation_url(user)

    subject = "Activation de votre espace client MAPGEO"
    message = (
        "Bonjour,\n\n"
        "Votre espace client MAPGEO a été créé.\n"
        "Cliquez sur le lien suivant pour valider votre compte et définir votre mot de passe :\n\n"
        f"{activation_url}\n\n"
        "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.\n"
    )

    send_mail(
        subject,
        message,
        getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@mapgeo.local"),
        [user.email],
        fail_silently=False,
    )

    return activation_url, True


def build_password_reset_url(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
    return f"{frontend_url}/reset-password/{uid}/{token}"




def reactivate_client_organization_for_user(user):
    """Réactive l'organisation cliente principale quand l'accès portail client est rétabli."""
    if getattr(user, "role", None) != "client" or not getattr(user, "client_id", None):
        return None

    organization = Organization.objects.filter(pk=user.client_id, organization_type="client").first()
    if organization and organization.status != "active":
        organization.status = "active"
        organization.save(update_fields=["status", "updated_at"])
    return organization

def send_password_reset_email(user):
    reset_url = build_password_reset_url(user)
    subject = "Réinitialisation de votre mot de passe MAPGEO"
    message = (
        "Bonjour,\n\n"
        "Une demande de réinitialisation de mot de passe a été reçue pour votre compte MAPGEO.\n"
        "Cliquez sur le lien suivant pour définir un nouveau mot de passe :\n\n"
        f"{reset_url}\n\n"
        "Ce lien est temporaire. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.\n"
    )
    send_mail(
        subject,
        message,
        getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@mapgeo.local"),
        [user.email],
        fail_silently=False,
    )
    return reset_url


def build_jwt_payload_for_user(user):
    refresh = RefreshToken.for_user(user)
    refresh["role"] = user.role
    refresh["client_code"] = user.client_code or ""
    refresh["client_id"] = user.client_id or ""
    refresh["portal_type"] = "client" if user.role == "client" else "internal"
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
        "user": UserSerializer(user).data,
    }


def verify_google_id_token(id_token):
    client_id = getattr(settings, "GOOGLE_OAUTH_CLIENT_ID", "")
    if not client_id:
        raise ValidationError({"detail": "Connexion Google non configurée côté serveur."})

    url = "https://oauth2.googleapis.com/tokeninfo?" + urllib.parse.urlencode({"id_token": id_token})
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise ValidationError({"detail": "Jeton Google invalide ou impossible à vérifier."}) from exc

    if payload.get("aud") != client_id:
        raise ValidationError({"detail": "Jeton Google destiné à une autre application."})

    email = (payload.get("email") or "").strip().lower()
    if not email or str(payload.get("email_verified")).lower() not in {"true", "1"}:
        raise ValidationError({"detail": "Adresse e-mail Google non vérifiée."})

    return payload


class ForgotPasswordView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        identifier = (
            request.data.get("identifier")
            or request.data.get("login")
            or request.data.get("email")
            or ""
        ).strip()
        throttle_identifier = identifier or "anonymous"
        throttle_state = get_public_action_throttle_state("password_reset", throttle_identifier, request)
        if throttle_state.is_locked:
            return public_rate_limit_response(throttle_state)

        if identifier:
            user = (
                User.objects
                .filter(
                    Q(email__iexact=identifier)
                    | Q(username__iexact=identifier)
                    | Q(client_code__iexact=identifier),
                    is_active=True,
                )
                .order_by("id")
                .first()
            )
            if user and user.email:
                try:
                    send_password_reset_email(user)
                except Exception:
                    logger.exception("Impossible d'envoyer l'e-mail de réinitialisation de mot de passe pour l'utilisateur %s", user.pk)

        register_public_action_attempt("password_reset", throttle_identifier, request)
        return Response({
            "detail": "Si un compte actif correspond à cet identifiant, un e-mail de réinitialisation vient d'être envoyé."
        })


class ResetPasswordValidateView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, uid, token):
        throttle_state = get_public_action_throttle_state("password_reset", uid, request)
        if throttle_state.is_locked:
            return public_rate_limit_response(throttle_state)

        user = self._get_user(uid)
        if not user or not default_token_generator.check_token(user, token):
            register_public_action_attempt("password_reset", uid, request)
            raise NotFound("Lien de réinitialisation invalide ou expiré.")

        return Response({
            "uid": uid,
            "token": token,
            "email": user.email,
            "username": user.username,
            "display_name": UserSerializer(user).data.get("display_name"),
        })

    def _get_user(self, uid):
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            return User.objects.filter(pk=user_id, is_active=True).first()
        except Exception:
            return None


class ResetPasswordConfirmView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        uid = request.data.get("uid")
        token = request.data.get("token")
        password = request.data.get("password") or ""
        password_confirm = request.data.get("password_confirm") or ""

        throttle_identifier = uid or "anonymous"
        throttle_state = get_public_action_throttle_state("password_reset", throttle_identifier, request)
        if throttle_state.is_locked:
            return public_rate_limit_response(throttle_state)

        user = self._get_user(uid)
        if not user or not default_token_generator.check_token(user, token):
            register_public_action_attempt("password_reset", throttle_identifier, request)
            raise NotFound("Lien de réinitialisation invalide ou expiré.")

        if password != password_confirm:
            raise ValidationError({"password_confirm": "Les mots de passe ne correspondent pas."})

        try:
            password_validation.validate_password(password, user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)}) from exc

        user.set_password(password)
        update_fields = ["password"]
        if user.role == "client":
            user.is_verified = True
            update_fields.append("is_verified")
        user.save(update_fields=update_fields)
        reset_public_action_throttle("password_reset", throttle_identifier, request)

        return Response({"detail": "Mot de passe réinitialisé. Vous pouvez maintenant vous connecter."})

    def _get_user(self, uid):
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            return User.objects.filter(pk=user_id, is_active=True).first()
        except Exception:
            return None


class GoogleLoginView(APIView):
    permission_classes = [permissions.AllowAny]

    @transaction.atomic
    def post(self, request):
        credential = (request.data.get("credential") or request.data.get("id_token") or "").strip()
        if not credential:
            raise ValidationError({"credential": "Le jeton Google est obligatoire."})

        google_payload = verify_google_id_token(credential)
        email = google_payload["email"]

        user = User.objects.filter(email__iexact=email, is_active=True).order_by("id").first()

        if not user:
            raise ValidationError({
                "detail": "Aucun compte client MAPGEO actif n'est associé à cette adresse Google."
            })

        if user.role != "client":
            raise ValidationError({
                "detail": "La connexion Google est réservée aux comptes clients MAPGEO."
            })

        if not user.is_verified:
            raise ValidationError({
                "detail": "Votre compte client n'est pas encore validé. Vérifiez votre e-mail d'activation."
            })

        response = Response(build_jwt_payload_for_user(user))
        refresh = response.data.get("refresh") if hasattr(response, "data") else None
        if refresh:
            set_refresh_cookie(response, refresh)
        return strip_refresh_from_body_when_cookie_mode(response)


class AdminClientCreateView(generics.CreateAPIView):
    serializer_class = AdminClientCreateSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]

    def create(self, request, *args, **kwargs):
        if getattr(request.user, "role", None) != "admin":
            raise PermissionDenied("Seul un administrateur peut créer une nouvelle organisation cliente.")

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        instance = serializer.save()

        activation_url = None
        invitation_sent = False
        user = instance.get("user")
        send_invitation = bool(serializer.validated_data.get("send_invitation", True)) and bool(serializer.validated_data.get("portal_access", True))

        if send_invitation and user:
            try:
                activation_url, invitation_sent = send_client_activation_email(user)
            except Exception:
                logger.exception("Impossible d’envoyer l’e-mail d’activation client %s", getattr(user, "pk", None))

        # En dev seulement, on renvoie le lien pour faciliter les tests.
        instance["activation_url"] = activation_url if settings.DEBUG else None
        instance["invitation_sent"] = invitation_sent

        return Response(
            AdminClientCreateSerializer(
                instance,
                context=self.get_serializer_context(),
            ).data,
            status=status.HTTP_201_CREATED,
        )


class ClientActivationValidateView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, uid, token):
        throttle_state = get_public_action_throttle_state("activation", uid, request)
        if throttle_state.is_locked:
            return public_rate_limit_response(throttle_state)

        user = self._get_user(uid)

        if not user or not default_token_generator.check_token(user, token):
            register_public_action_attempt("activation", uid, request)
            raise NotFound("Lien d'activation invalide ou expiré.")

        return Response({
            "uid": uid,
            "token": token,
            "email": user.email,
            "username": user.username,
            "client_code": user.client_code,
            "display_name": UserSerializer(user).data.get("display_name"),
            "is_verified": user.is_verified,
        })

    def _get_user(self, uid):
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            return User.objects.filter(pk=user_id, role="client").first()
        except Exception:
            return None


class ClientActivationConfirmView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        uid = request.data.get("uid")
        token = request.data.get("token")
        password = request.data.get("password") or ""
        password_confirm = request.data.get("password_confirm") or ""

        throttle_identifier = uid or "anonymous"
        throttle_state = get_public_action_throttle_state("activation", throttle_identifier, request)
        if throttle_state.is_locked:
            return public_rate_limit_response(throttle_state)

        user = self._get_user(uid)

        if not user or not default_token_generator.check_token(user, token):
            register_public_action_attempt("activation", throttle_identifier, request)
            raise NotFound("Lien d'activation invalide ou expiré.")

        if password != password_confirm:
            raise ValidationError({
                "password_confirm": "Les mots de passe ne correspondent pas."
            })

        try:
            password_validation.validate_password(password, user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)}) from exc

        user.set_password(password)
        user.is_active = True
        user.is_verified = True
        user.save(update_fields=["password", "is_active", "is_verified"])
        reset_public_action_throttle("activation", throttle_identifier, request)

        return Response({
            "detail": "Compte client activé. Vous pouvez maintenant vous connecter."
        })

    def _get_user(self, uid):
        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            return User.objects.filter(pk=user_id, role="client").first()
        except Exception:
            return None


class UserDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]

    def get_queryset(self):
        return filter_users_for_user(User.objects.all().order_by("-id"), self.request.user)

    def patch(self, request, *args, **kwargs):
        user = self.get_object()
        if not user_can_manage_user(request.user, user):
            raise PermissionDenied("Vous ne pouvez gérer que les utilisateurs de votre périmètre.")

        allowed_fields = {
            "first_name",
            "last_name",
            "email",
            "phone",
            "company_name",
            "is_verified",
            "is_active",
        }

        if "role" in request.data and request.user.role != "admin":
            raise PermissionDenied("Seul un administrateur peut modifier le rôle d’un utilisateur.")

        if user.role in INTERNAL_ROLES and request.user.role != "admin":
            raise PermissionDenied("Seul un administrateur peut modifier un utilisateur interne.")

        if request.user.role == "admin":
            allowed_fields.add("role")

        payload = {
            key: value
            for key, value in request.data.items()
            if key in allowed_fields
        }

        if not payload:
            raise serializers.ValidationError({
                "detail": "Aucun champ modifiable fourni."
            })

        if "role" in payload and payload["role"] not in {choice[0] for choice in User.ROLE_CHOICES}:
            raise serializers.ValidationError({
                "role": "Rôle utilisateur invalide."
            })

        for field, value in payload.items():
            setattr(user, field, value)

        if "email" in payload and user.email:
            user.email = user.email.lower()

        user.save(update_fields=list(payload.keys()))

        return Response(UserSerializer(user).data)


class UserAccessActionView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]

    def post(self, request, pk, action):
        user = filter_users_for_user(User.objects.filter(pk=pk), request.user).first()

        if not user:
            raise NotFound("Utilisateur introuvable.")

        if user == request.user and action in {"deactivate", "disable"}:
            raise PermissionDenied("Vous ne pouvez pas désactiver votre propre compte.")

        if user.role in INTERNAL_ROLES and request.user.role != "admin":
            raise PermissionDenied("Seul un administrateur peut gérer les accès des utilisateurs internes.")

        if action in {"deactivate", "disable"}:
            user.is_active = False
            user.save(update_fields=["is_active"])

            return Response({
                "detail": "Utilisateur désactivé.",
                "user": UserSerializer(user).data,
            })

        if action in {"activate", "enable"}:
            user.is_active = True
            user.save(update_fields=["is_active"])
            organization = reactivate_client_organization_for_user(user)

            return Response({
                "detail": "Utilisateur activé.",
                "user": UserSerializer(user).data,
                "organization": {"id": organization.id, "status": organization.status} if organization else None,
            })

        if action in {"reset-access", "reset_password", "reset-password"}:
            user.is_active = True
            user.save(update_fields=["is_active"])
            organization = reactivate_client_organization_for_user(user)

            reset_url = None
            reset_sent = False
            if user.email:
                try:
                    reset_url = send_password_reset_email(user)
                    reset_sent = True
                except Exception:
                    logger.exception("Impossible d'envoyer l'e-mail de réinitialisation d'accès pour l'utilisateur %s", user.pk)

            return Response({
                "detail": "Accès réinitialisé. Un lien sécurisé de réinitialisation a été envoyé si une adresse e-mail est associée au compte.",
                "reset_sent": reset_sent,
                "reset_url": reset_url if settings.DEBUG else None,
                "user": UserSerializer(user).data,
                "organization": {"id": organization.id, "status": organization.status} if organization else None,
            })

        return Response(
            {"detail": "Action utilisateur inconnue."},
            status=status.HTTP_400_BAD_REQUEST,
        )


class UserInviteView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]

    @transaction.atomic
    def post(self, request):
        email = (request.data.get("email") or "").strip().lower()
        first_name = (request.data.get("first_name") or "").strip()
        last_name = (request.data.get("last_name") or "").strip()
        company_name = (
            request.data.get("company_name")
            or request.data.get("company")
            or ""
        ).strip()
        role = (request.data.get("role") or "client").strip().lower()
        organization_id = request.data.get("organization") or request.data.get("organization_id")
        organization = None
        if role == "client":
            if not organization_id:
                raise serializers.ValidationError({"organization": "Une organisation client est obligatoire pour inviter un client."})
            organization = Organization.objects.filter(pk=organization_id, organization_type="client").first()
            if not organization:
                raise serializers.ValidationError({"organization": "Organisation client introuvable."})
            if not user_can_manage_organization(request.user, organization.id):
                raise PermissionDenied("Vous ne pouvez inviter un client que dans une organisation que vous gérez.")

        valid_roles = {choice[0] for choice in User.ROLE_CHOICES}

        if role not in valid_roles:
            raise serializers.ValidationError({
                "role": "Rôle utilisateur invalide."
            })

        if role != "client" and request.user.role != "admin":
            raise PermissionDenied("Seul un administrateur peut inviter un utilisateur interne.")

        if not email:
            raise serializers.ValidationError({
                "email": "L’adresse e-mail est obligatoire."
            })

        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError({
                "email": "Cette adresse e-mail est déjà utilisée."
            })

        username = request.data.get("username") or email.split("@")[0]
        base_username = username
        counter = 1

        while User.objects.filter(username__iexact=username).exists():
            counter += 1
            username = f"{base_username}{counter}"

        is_primary_client_contact = False
        invite_client_code = None
        if organization and role == "client":
            is_primary_client_contact = not OrganizationMembership.objects.filter(
                organization=organization,
                is_primary=True,
                is_active=True,
            ).exists()
            if is_primary_client_contact and not User.objects.filter(client_code__iexact=organization.code).exists():
                invite_client_code = organization.code

        user = User.objects.create_user(
            username=username,
            email=email,
            password=None,
            first_name=first_name,
            last_name=last_name,
            company_name=company_name,
            role=role,
            client=organization if organization and role == "client" else None,
            client_code=invite_client_code,
            is_active=(role != "client"),
            is_verified=(role != "client"),
        )

        if organization and role == "client":
            OrganizationMembership.objects.update_or_create(
                organization=organization,
                user=user,
                defaults={"role": "owner" if is_primary_client_contact else "contact", "is_primary": is_primary_client_contact, "is_active": True},
            )

        activation_url = None
        reset_url = None
        invitation_sent = False

        if role == "client":
            try:
                activation_url, invitation_sent = send_client_activation_email(user)
            except Exception:
                logger.exception("Impossible d'envoyer l'e-mail d'activation pour l'utilisateur invité %s", user.pk)
        elif user.email:
            try:
                reset_url = send_password_reset_email(user)
                invitation_sent = True
            except Exception:
                logger.exception("Impossible d'envoyer l'e-mail d'initialisation pour l'utilisateur invité %s", user.pk)

        return Response(
            {
                "detail": "Utilisateur invité. Un e-mail sécurisé a été envoyé pour définir le mot de passe." if invitation_sent else "Utilisateur créé. Aucun e-mail n'a pu être envoyé.",
                "activation_url": activation_url if settings.DEBUG else None,
                "reset_url": reset_url if settings.DEBUG else None,
                "invitation_sent": invitation_sent,
                "user": UserSerializer(user).data,
            },
            status=status.HTTP_201_CREATED,
        )