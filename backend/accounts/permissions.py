from django.db.models import Q
from rest_framework.permissions import BasePermission

# Rôles globaux / métiers.
# Important : un utilisateur « interne » n'est pas automatiquement hors périmètre.
# Seul admin est global. Les managers, agents et surveyors sont filtrés par
# organisations/missions accessibles via OrganizationMembership.
ADMIN_ROLES = {"admin"}
MANAGER_ROLES = {"admin", "manager"}
GLOBAL_INTERNAL_ROLES = {"admin", "manager"}
FIELD_ROLES = {"agent", "surveyor"}
INTERNAL_ROLES = GLOBAL_INTERNAL_ROLES | FIELD_ROLES
MANAGED_ORG_MEMBERSHIP_ROLES = {"owner", "manager"}


def _is_authenticated(user) -> bool:
    return bool(user and user.is_authenticated)


def is_admin_user(user) -> bool:
    return bool(_is_authenticated(user) and getattr(user, "role", None) in ADMIN_ROLES)


def is_internal_user(user) -> bool:
    """Utilisateur MAPGEO au sens fonctionnel, pas au sens « accès global »."""
    return bool(_is_authenticated(user) and getattr(user, "role", None) in INTERNAL_ROLES)


def is_field_user(user) -> bool:
    return bool(_is_authenticated(user) and getattr(user, "role", None) in FIELD_ROLES)


def is_manager_user(user) -> bool:
    return bool(_is_authenticated(user) and getattr(user, "role", None) in MANAGER_ROLES)


def is_scoped_manager_user(user) -> bool:
    return bool(_is_authenticated(user) and getattr(user, "role", None) == "manager")


def get_user_organization_ids(user, *, managed_only: bool = False):
    """Retourne les organisations explicitement rattachées à l'utilisateur.

    managed_only=True limite aux memberships permettant l'administration métier.
    Admin est traité ailleurs comme global et ne passe pas par cette liste.
    """
    if not _is_authenticated(user):
        return []
    memberships = user.organization_memberships.filter(is_active=True)
    if managed_only:
        memberships = memberships.filter(role__in=MANAGED_ORG_MEMBERSHIP_ROLES)
    return list(memberships.values_list("organization_id", flat=True))


def get_readable_organization_ids(user):
    if is_admin_user(user):
        return None  # accès global explicite
    role = getattr(user, "role", None)
    if role == "manager":
        return get_user_organization_ids(user, managed_only=True)
    return get_user_organization_ids(user, managed_only=False)


def get_client_organization_ids(user):
    """Périmètre client normalisé.

    Un accès client peut provenir du champ legacy ``user.client`` ou des
    memberships actifs vers une organisation cliente. Cette fonction évite les
    divergences entre parcelles, documents, couches cartographiques et GED.
    """
    if not _is_authenticated(user):
        return []
    org_ids = set(get_user_organization_ids(user, managed_only=False) or [])
    if getattr(user, "client_id", None):
        org_ids.add(user.client_id)
    return sorted(org_ids)


def get_managed_organization_ids(user):
    if is_admin_user(user):
        return None  # accès global explicite
    if getattr(user, "role", None) == "manager":
        return get_user_organization_ids(user, managed_only=True)
    return []


def filter_organizations_for_user(queryset, user, *, for_write: bool = False):
    if is_admin_user(user):
        return queryset
    org_ids = get_managed_organization_ids(user) if for_write else get_readable_organization_ids(user)
    if not org_ids:
        return queryset.none()
    return queryset.filter(id__in=org_ids).distinct()


def filter_parcels_for_user(queryset, user, *, for_write: bool = False):
    if is_admin_user(user):
        return queryset

    role = getattr(user, "role", None)
    if for_write:
        if role == "client":
            return queryset.none()
        org_ids = get_managed_organization_ids(user)
        if not org_ids:
            return queryset.none()
        return queryset.filter(organization_id__in=org_ids).distinct()

    if role == "client":
        # Isolation client professionnelle : le client lit les parcelles de ses
        # organisations actives, avec compatibilité legacy sur owner=user.
        # Cela évite qu'un second contact d'une même organisation soit bloqué
        # alors que documents, support et clients utilisent déjà le périmètre
        # organisation/membership.
        org_ids = set(get_readable_organization_ids(user) or [])
        if getattr(user, "client_id", None):
            org_ids.add(user.client_id)
        visibility = Q(owner=user)
        if org_ids:
            visibility |= Q(organization_id__in=org_ids)
        return queryset.filter(visibility).distinct()

    org_ids = get_readable_organization_ids(user)
    if not org_ids:
        return queryset.none()
    return queryset.filter(organization_id__in=org_ids).distinct()


def filter_users_for_user(queryset, user):
    if is_admin_user(user):
        return queryset
    if getattr(user, "role", None) == "manager":
        org_ids = get_managed_organization_ids(user)
        if not org_ids:
            return queryset.none()
        return queryset.filter(organization_memberships__organization_id__in=org_ids).distinct()
    return queryset.filter(pk=getattr(user, "pk", None))


def user_can_access_organization(user, organization_id) -> bool:
    if is_admin_user(user):
        return True
    if not organization_id:
        return False
    org_ids = get_readable_organization_ids(user)
    return bool(org_ids and int(organization_id) in set(org_ids))


def user_can_manage_organization(user, organization_id) -> bool:
    if is_admin_user(user):
        return True
    if not organization_id:
        return False
    org_ids = get_managed_organization_ids(user)
    return bool(org_ids and int(organization_id) in set(org_ids))


def user_can_manage_user(actor, target) -> bool:
    if is_admin_user(actor):
        return True
    if getattr(actor, "role", None) != "manager" or getattr(target, "role", None) != "client":
        return False
    managed_org_ids = set(get_managed_organization_ids(actor))
    if not managed_org_ids:
        return False
    target_org_ids = set(get_user_organization_ids(target, managed_only=False))
    return bool(managed_org_ids & target_org_ids)


def user_can_manage_parcel(user, parcel) -> bool:
    if is_admin_user(user):
        return True
    return user_can_manage_organization(user, getattr(parcel, "organization_id", None))


def user_can_edit_parcel(user, parcel) -> bool:
    if is_admin_user(user):
        return True
    if getattr(user, "role", None) == "manager":
        return user_can_manage_organization(user, getattr(parcel, "organization_id", None))
    return False


class IsAdminOrManager(BasePermission):
    def has_permission(self, request, view):
        return is_manager_user(request.user)


class IsAdminOnly(BasePermission):
    def has_permission(self, request, view):
        return is_admin_user(request.user)


class IsInternalUser(BasePermission):
    def has_permission(self, request, view):
        return is_internal_user(request.user)
