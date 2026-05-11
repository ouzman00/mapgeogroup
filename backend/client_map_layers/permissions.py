from rest_framework.permissions import BasePermission

from accounts.permissions import get_client_organization_ids, get_managed_organization_ids, is_admin_user


def is_platform_admin(user) -> bool:
    # Ne pas utiliser is_staff comme accès métier : un compte staff Django peut
    # exister pour l'administration technique sans devoir voir les données
    # client. Le rôle applicatif admin reste la source d'autorité métier ;
    # is_superuser est conservé pour les comptes de secours créés par Django.
    return bool(
        user
        and user.is_authenticated
        and (is_admin_user(user) or getattr(user, "is_superuser", False))
    )


def is_layer_manager(user) -> bool:
    return bool(user and user.is_authenticated and getattr(user, "role", None) == "manager")


def can_manage_client_map_layers(user) -> bool:
    return is_platform_admin(user) or is_layer_manager(user)


def managed_client_ids_for_user(user):
    if is_platform_admin(user):
        return None
    if is_layer_manager(user):
        return set(get_managed_organization_ids(user) or [])
    return set()


def user_can_manage_client(user, client_id) -> bool:
    if is_platform_admin(user):
        return True
    managed_ids = managed_client_ids_for_user(user)
    return bool(client_id and managed_ids and int(client_id) in managed_ids)


class IsAdminRole(BasePermission):
    """Backoffice cartographique : admin global ou manager dans son périmètre."""

    def has_permission(self, request, view):
        return can_manage_client_map_layers(getattr(request, "user", None))


class HasClientScope(BasePermission):
    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        if is_platform_admin(user):
            return True
        return bool(get_client_organization_ids(user))
