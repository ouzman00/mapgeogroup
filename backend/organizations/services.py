from __future__ import annotations

import re
from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.crypto import get_random_string
from django.utils.text import slugify

from .models import Organization, OrganizationMembership

User = get_user_model()


@dataclass(frozen=True)
class ClientAccountBundle:
    organization: Organization
    user: User
    membership: OrganizationMembership
    temporary_password: str | None = None


def _clean_code(value: str | None, fallback: str = "CLIENT") -> str:
    base = slugify(value or "").replace("-", "_").upper()
    base = re.sub(r"[^A-Z0-9_]+", "", base).strip("_")
    return base or fallback


def make_unique_code(model, field_name: str, seed: str | None, *, fallback: str = "CLIENT", max_length: int = 32) -> str:
    base = _clean_code(seed, fallback=fallback)[:max_length]
    candidate = base
    counter = 2
    lookup = f"{field_name}__iexact"

    while model.objects.filter(**{lookup: candidate}).exists():
        suffix = f"_{counter}"
        candidate = f"{base[: max_length - len(suffix)]}{suffix}"
        counter += 1

    return candidate


def make_unique_username(seed: str | None) -> str:
    base = slugify(seed or "client").replace("-", ".").lower().strip(".") or "client"
    base = re.sub(r"[^a-z0-9_.]+", "", base)[:140] or "client"
    candidate = base
    counter = 2

    while User.objects.filter(username__iexact=candidate).exists():
        suffix = f".{counter}"
        candidate = f"{base[: 150 - len(suffix)]}{suffix}"
        counter += 1

    return candidate


@transaction.atomic
def create_client_account(
    *,
    name: str,
    code: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    address: str | None = None,
    status: str = "active",
    username: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    company_name: str | None = None,
    password: str | None = None,
    is_verified: bool = True,
    is_active: bool = True,
    generate_temporary_password: bool = False,
) -> ClientAccountBundle:
    """Crée le triplet métier Organization + User client + Membership actif.

    - Avec ``password`` : le mot de passe est appliqué directement.
    - Avec ``generate_temporary_password`` : un mot de passe temporaire est généré
      et renvoyé à l'appelant, utile lorsque l'admin ne souhaite pas envoyer
      d'invitation e-mail.
    - Sinon : le compte reçoit un mot de passe inutilisable et devra être activé
      via le lien d’invitation pour définir son mot de passe.
    """

    display_name = (name or company_name or username or "Client").strip()
    normalized_email = (email or "").strip().lower() or None
    org_code = make_unique_code(Organization, "code", code or display_name, fallback="CLIENT", max_length=32)
    client_code = make_unique_code(User, "client_code", code or org_code, fallback="CLIENT", max_length=32)
    resolved_username = username.strip() if username else make_unique_username(client_code.lower())

    organization = Organization.objects.create(
        name=display_name,
        code=org_code,
        organization_type="client",
        status=status or "active",
        email=normalized_email,
        phone=(phone or "").strip() or None,
        address=(address or "").strip() or None,
    )

    generated_password = None

    user = User(
        username=resolved_username,
        first_name=(first_name or "").strip(),
        last_name=(last_name or "").strip(),
        email=normalized_email or "",
        role="client",
        client=organization,
        client_code=client_code,
        company_name=(company_name or display_name).strip() or None,
        phone=(phone or "").strip() or None,
        is_verified=is_verified,
        is_active=is_active,
    )

    if password:
        user.set_password(password)
    elif generate_temporary_password:
        generated_password = get_random_string(14)
        user.set_password(generated_password)
    else:
        user.set_unusable_password()

    user.save()

    membership = OrganizationMembership.objects.create(
        organization=organization,
        user=user,
        role="owner",
        is_primary=True,
        is_active=True,
    )

    return ClientAccountBundle(
        organization=organization,
        user=user,
        membership=membership,
        temporary_password=generated_password,
    )
