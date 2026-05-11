import logging

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import FileResponse
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import INTERNAL_ROLES, MANAGER_ROLES
from config.storage import apply_private_file_response_headers
from notifications.services import notify_user
from .models import ParcelDocument
from .serializers import ParcelDocumentSerializer
from .services import get_visible_documents_for_user


User = get_user_model()
logger = logging.getLogger(__name__)


def _ids_from_payload(data):
    raw_ids = data.get("ids") if isinstance(data, dict) else []
    if isinstance(raw_ids, str):
        raw_ids = [item.strip() for item in raw_ids.split(",") if item.strip()]
    if not isinstance(raw_ids, (list, tuple, set)):
        return []

    ids = []
    for value in raw_ids:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    return sorted(set(ids))


def _delete_file_from_storage(file_field):
    if not file_field or not getattr(file_field, "name", None):
        return
    try:
        storage = file_field.storage
        file_name = file_field.name
        if storage.exists(file_name):
            storage.delete(file_name)
    except Exception:  # pragma: no cover - dépend du backend de stockage configuré
        logger.exception("Impossible de supprimer le fichier GED %s", getattr(file_field, "name", ""))


def _notify_internal_users_for_document(document, *, actor=None):
    organization_id = getattr(document.parcel, "organization_id", None)
    visibility_filter = Q(role="admin")
    if organization_id:
        visibility_filter |= Q(
            organization_memberships__organization_id=organization_id,
            organization_memberships__is_active=True,
        )

    recipients = User.objects.filter(
        visibility_filter,
        role__in=INTERNAL_ROLES,
        is_active=True,
    ).distinct()
    if actor and getattr(actor, "pk", None):
        recipients = recipients.exclude(pk=actor.pk)

    for recipient in recipients:
        notify_user(
            recipient,
            "Nouveau document client",
            f"Un client a déposé le document « {document.title} » sur la parcelle {document.parcel.reference}.",
            notification_type="document",
            target_url=f"/documents/{document.id}",
            related_type="document",
            related_id=document.id,
        )


def _notify_client_for_published_document(document, *, actor=None):
    owner = getattr(document.parcel, "owner", None)
    if not owner or not owner.is_active or (actor and actor.pk == owner.pk):
        return
    if not document.is_public_for_client or document.status not in {"validated", "final"}:
        return
    notify_user(
        owner,
        "Nouveau document disponible",
        f"Le document « {document.title} » est disponible pour la parcelle {document.parcel.reference}.",
        notification_type="document",
        target_url=f"/documents/{document.id}",
        related_type="document",
        related_id=document.id,
    )


def _notify_client_for_deleted_document(document, *, actor=None):
    owner = getattr(document.parcel, "owner", None)
    if not owner or not owner.is_active or (actor and actor.pk == owner.pk):
        return
    if not document.is_public_for_client or document.status not in {"validated", "final"}:
        return
    notify_user(
        owner,
        "Document retiré",
        f"Le document « {document.title} » n’est plus disponible pour la parcelle {document.parcel.reference}.",
        notification_type="document",
        severity="info",
        target_url="/documents",
        related_type="document",
        related_id=document.id,
    )


class CanManageDocuments(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        if request.method == "POST" and getattr(request.user, "role", None) == "client":
            return True
        return request.user.role in MANAGER_ROLES


class DocumentQuerysetMixin:
    def get_queryset(self):
        queryset = ParcelDocument.objects.select_related(
            "parcel",
            "parcel__owner",
            "parcel__organization",
        )

        queryset = get_visible_documents_for_user(self.request.user, queryset).distinct()

        params = self.request.query_params
        parcel_id = params.get("parcel")
        status = params.get("status")
        document_type = params.get("document_type")

        # client / owner peuvent être un ID utilisateur, un code client, un nom client
        # ou un code/nom d'organisation selon la page qui appelle l'API.
        # organization reste prioritairement l'ID organisation.
        client_token = (params.get("client") or params.get("owner") or "").strip()
        owner_client_code = (params.get("owner_client_code") or params.get("client_code") or "").strip()

        organization_id = (params.get("organization_id") or params.get("organization") or "").strip()
        organization_code = (params.get("organization_code") or "").strip()
        visibility = (params.get("visibility") or "").strip().lower()
        source = (params.get("source") or "").strip()

        parcel_reference = (params.get("parcel_reference") or "").strip()
        query = (params.get("q") or "").strip()

        if parcel_id:
            queryset = queryset.filter(parcel_id=parcel_id)

        if status:
            queryset = queryset.filter(status=status)

        if document_type:
            queryset = queryset.filter(document_type=document_type)

        if client_token:
            client_filter = (
                Q(parcel__owner__client_code__iexact=client_token)
                | Q(parcel__owner__username__iexact=client_token)
                | Q(parcel__owner__email__iexact=client_token)
                | Q(parcel__owner__first_name__icontains=client_token)
                | Q(parcel__owner__last_name__icontains=client_token)
                | Q(parcel__owner__company_name__icontains=client_token)
                | Q(parcel__organization__code__iexact=client_token)
                | Q(parcel__organization__name__icontains=client_token)
            )
            if client_token.isdigit():
                client_filter |= Q(parcel__owner_id=int(client_token)) | Q(parcel__organization_id=int(client_token))
            queryset = queryset.filter(client_filter)

        if owner_client_code:
            queryset = queryset.filter(parcel__owner__client_code__iexact=owner_client_code)

        if organization_id:
            if organization_id.isdigit():
                queryset = queryset.filter(parcel__organization_id=int(organization_id))
            else:
                queryset = queryset.filter(
                    Q(parcel__organization__code__iexact=organization_id)
                    | Q(parcel__organization__name__icontains=organization_id)
                )

        if organization_code:
            queryset = queryset.filter(parcel__organization__code__iexact=organization_code)

        if visibility == "client":
            queryset = queryset.filter(is_public_for_client=True, status__in=["validated", "final"])
        elif visibility in {"internal", "private"}:
            queryset = queryset.exclude(is_public_for_client=True, status__in=["validated", "final"])

        if source:
            queryset = queryset.filter(source=source)

        if parcel_reference:
            queryset = queryset.filter(parcel__reference__icontains=parcel_reference)

        if query:
            queryset = queryset.filter(
                Q(title__icontains=query)
                | Q(description__icontains=query)
                | Q(parcel__reference__icontains=query)
                | Q(parcel__location__icontains=query)
                | Q(parcel__commune__icontains=query)
                | Q(parcel__region__icontains=query)
                | Q(parcel__owner__client_code__icontains=query)
                | Q(parcel__owner__username__icontains=query)
                | Q(parcel__owner__first_name__icontains=query)
                | Q(parcel__owner__last_name__icontains=query)
                | Q(parcel__owner__company_name__icontains=query)
                | Q(parcel__organization__name__icontains=query)
                | Q(parcel__organization__code__icontains=query)
            )

        return queryset.order_by("-created_at")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context


class DocumentListCreateView(DocumentQuerysetMixin, generics.ListCreateAPIView):
    serializer_class = ParcelDocumentSerializer
    permission_classes = [CanManageDocuments]

    def perform_create(self, serializer):
        document = serializer.save()
        if getattr(self.request.user, "role", None) == "client":
            _notify_internal_users_for_document(document, actor=self.request.user)
        else:
            _notify_client_for_published_document(document, actor=self.request.user)


class DocumentDetailView(DocumentQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ParcelDocumentSerializer
    permission_classes = [CanManageDocuments]

    def perform_update(self, serializer):
        previous = self.get_object()
        previous_file_name = previous.file.name if previous.file else None
        previous_file_storage = previous.file.storage if previous.file else None
        was_visible = previous.is_public_for_client and previous.status in {"validated", "final"}

        document = serializer.save()

        if (
            previous_file_name
            and previous_file_storage
            and document.file
            and previous_file_name != document.file.name
        ):
            try:
                if previous_file_storage.exists(previous_file_name):
                    previous_file_storage.delete(previous_file_name)
            except Exception:  # pragma: no cover - dépend du backend de stockage configuré
                logger.exception("Impossible de supprimer l'ancien fichier GED %s", previous_file_name)

        is_visible = document.is_public_for_client and document.status in {"validated", "final"}
        if is_visible and not was_visible:
            _notify_client_for_published_document(document, actor=self.request.user)

    def perform_destroy(self, instance):
        file_field = instance.file
        _notify_client_for_deleted_document(instance, actor=self.request.user)
        instance.delete()
        _delete_file_from_storage(file_field)


class DocumentBulkDeleteView(DocumentQuerysetMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if getattr(request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les administrateurs et managers peuvent supprimer des documents.")

        ids = _ids_from_payload(request.data or {})
        if not ids:
            return Response(
                {"detail": "Sélectionnez au moins un document à supprimer."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        documents = list(self.get_queryset().filter(pk__in=ids))
        deleted_ids = []
        for document in documents:
            file_field = document.file
            document_id = document.pk
            _notify_client_for_deleted_document(document, actor=request.user)
            document.delete()
            _delete_file_from_storage(file_field)
            deleted_ids.append(document_id)

        return Response(
            {
                "detail": f"{len(deleted_ids)} document(s) supprimé(s).",
                "deleted": len(deleted_ids),
                "ids": deleted_ids,
            }
        )


class DocumentDownloadView(DocumentQuerysetMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        document = self.get_queryset().filter(pk=pk).first()

        if not document or not document.file:
            raise NotFound("Document introuvable.")

        filename = document.file.name.rsplit("/", 1)[-1]
        response = FileResponse(document.file.open("rb"), as_attachment=True, filename=filename)
        return apply_private_file_response_headers(response)