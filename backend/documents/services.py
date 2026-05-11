from django.db.models import Q

from accounts.permissions import get_client_organization_ids, get_readable_organization_ids, is_admin_user

from .models import ParcelDocument


def get_visible_documents_for_user(user, queryset=None):
    qs = queryset if queryset is not None else ParcelDocument.objects.all()
    if is_admin_user(user):
        return qs

    role = getattr(user, "role", None)
    org_ids = get_readable_organization_ids(user)

    if role == "client":
        org_ids = set(get_client_organization_ids(user))

        parcel_scope = Q(parcel__owner=user)
        if org_ids:
            parcel_scope |= Q(parcel__organization_id__in=org_ids)

        return qs.filter(
            Q(
                is_public_for_client=True,
                status__in=["validated", "final"],
            )
            & parcel_scope
            | Q(
                source="client_upload",
                uploaded_by=user,
            )
            & parcel_scope
        ).distinct()

    if not org_ids:
        return qs.none()
    return qs.filter(parcel__organization_id__in=org_ids).distinct()


def get_document_stats_for_user(user):
    qs = get_visible_documents_for_user(user)
    return {
        "total_documents": qs.count(),
        "final_documents": qs.filter(status="final").count(),
        "validated_documents": qs.filter(status="validated").count(),
    }
