import logging

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import FileResponse
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import INTERNAL_ROLES, MANAGER_ROLES, get_readable_organization_ids, is_admin_user
from config.storage import apply_private_file_response_headers
from notifications.services import notify_user
from .models import SupportMessage, SupportTicket
from .serializers import SupportMessageSerializer, SupportTicketSerializer


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


def _delete_support_attachment_from_storage(file_field):
    if not file_field or not getattr(file_field, "name", None):
        return
    try:
        storage = file_field.storage
        file_name = file_field.name
        if storage.exists(file_name):
            storage.delete(file_name)
    except Exception:  # pragma: no cover - dépend du backend de stockage configuré
        logger.exception("Impossible de supprimer la pièce jointe support %s", getattr(file_field, "name", ""))


def _ticket_organization_ids(ticket):
    organization_ids = set()
    parcel_org_id = getattr(ticket, "parcel", None) and ticket.parcel.organization_id
    if parcel_org_id:
        organization_ids.add(parcel_org_id)
    if getattr(ticket, "user_id", None):
        organization_ids.update(
            ticket.user.organization_memberships.filter(is_active=True)
            .values_list("organization_id", flat=True)
        )
    return organization_ids


def _notify_internal_users_for_ticket(ticket, title, message, *, actor=None):
    organization_ids = _ticket_organization_ids(ticket)
    visibility_filter = Q(role="admin")
    if organization_ids:
        visibility_filter |= Q(
            organization_memberships__organization_id__in=organization_ids,
            organization_memberships__is_active=True,
        )
    recipients = User.objects.filter(
        visibility_filter, role__in=INTERNAL_ROLES, is_active=True,
    ).distinct()
    if actor and getattr(actor, "pk", None):
        recipients = recipients.exclude(pk=actor.pk)
    for recipient in recipients:
        notify_user(
            recipient, title, message, notification_type="support",
            target_url=f"/support/{ticket.id}", related_type="support_ticket", related_id=ticket.id,
        )


class CanManageSupportTickets(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        # Lecture et création de ticket : clients et équipe interne authentifiés.
        # Modifications globales de ticket (PUT/PATCH/DELETE) : admin/manager seulement.
        # Les agents/surveyors doivent passer par les actions dédiées (reply/start),
        # pas par un PATCH libre du ticket.
        if request.method in permissions.SAFE_METHODS or request.method == "POST":
            return True

        return request.user.role in MANAGER_ROLES


class SupportQuerysetMixin:
    def get_queryset(self):
        queryset = SupportTicket.objects.select_related(
            "user",
            "parcel",
            "parcel__owner",
            "parcel__organization",
        ).prefetch_related(
            "messages",
            "messages__author",
            "user__organization_memberships",
            "user__organization_memberships__organization",
        )

        if is_admin_user(self.request.user):
            queryset = queryset.order_by("-created_at")
        else:
            org_ids = get_readable_organization_ids(self.request.user) or []
            visibility_filter = Q(user=self.request.user)

            if getattr(self.request.user, "role", None) == "client":
                # Un client ne voit que ses propres tickets.
                pass
            else:
                if org_ids:
                    visibility_filter |= (
                        Q(parcel__organization_id__in=org_ids)
                        | Q(
                            user__organization_memberships__organization_id__in=org_ids,
                            user__organization_memberships__is_active=True,
                        )
                    )

            queryset = queryset.filter(visibility_filter).distinct().order_by("-created_at")

        params = self.request.query_params

        status_value = (params.get("status") or "").strip()
        priority = (params.get("priority") or "").strip()
        category = (params.get("category") or "").strip()
        query = (params.get("q") or "").strip()

        # Important :
        # client / user / owner acceptent un ID utilisateur, un code client,
        # un nom de client ou une organisation selon la page appelante.
        client_value = (params.get("client") or params.get("user") or params.get("owner") or "").strip()
        owner_client_code = (params.get("owner_client_code") or params.get("client_code") or "").strip()

        parcel_value = (params.get("parcel") or "").strip()
        organization_id = (params.get("organization_id") or params.get("organization") or "").strip()
        organization_code = (params.get("organization_code") or "").strip()

        if status_value:
            if status_value == "resolved_or_closed":
                queryset = queryset.filter(status__in=["resolved", "closed"])
            else:
                queryset = queryset.filter(status=status_value)

        if priority:
            queryset = queryset.filter(priority=priority)

        if category:
            queryset = queryset.filter(category__iexact=category)

        if client_value:
            client_filter = (
                Q(user__client_code__iexact=client_value)
                | Q(user__username__iexact=client_value)
                | Q(user__email__iexact=client_value)
                | Q(user__first_name__icontains=client_value)
                | Q(user__last_name__icontains=client_value)
                | Q(user__company_name__icontains=client_value)
                | Q(parcel__organization__code__iexact=client_value)
                | Q(parcel__organization__name__icontains=client_value)
                | Q(user__organization_memberships__organization__code__iexact=client_value, user__organization_memberships__is_active=True)
                | Q(user__organization_memberships__organization__name__icontains=client_value, user__organization_memberships__is_active=True)
            )
            if client_value.isdigit():
                client_filter |= Q(user_id=int(client_value)) | Q(parcel__organization_id=int(client_value)) | Q(user__organization_memberships__organization_id=int(client_value), user__organization_memberships__is_active=True)
            queryset = queryset.filter(client_filter).distinct()

        if owner_client_code:
            queryset = queryset.filter(user__client_code__iexact=owner_client_code)

        if parcel_value:
            if parcel_value.isdigit():
                queryset = queryset.filter(parcel_id=int(parcel_value))
            else:
                queryset = queryset.filter(parcel__reference__iexact=parcel_value)

        if organization_id:
            queryset = queryset.filter(
                Q(parcel__organization_id=organization_id)
                | Q(user__organization_memberships__organization_id=organization_id, user__organization_memberships__is_active=True)
            )

        if organization_code:
            queryset = queryset.filter(
                Q(parcel__organization__code__iexact=organization_code)
                | Q(user__organization_memberships__organization__code__iexact=organization_code, user__organization_memberships__is_active=True)
            )

        if query:
            queryset = queryset.filter(
                Q(subject__icontains=query)
                | Q(message__icontains=query)
                | Q(parcel__reference__icontains=query)
                | Q(user__client_code__icontains=query)
                | Q(user__username__icontains=query)
                | Q(user__first_name__icontains=query)
                | Q(user__last_name__icontains=query)
                | Q(user__company_name__icontains=query)
                | Q(parcel__organization__name__icontains=query)
                | Q(parcel__organization__code__icontains=query)
                | Q(user__organization_memberships__organization__name__icontains=query)
                | Q(user__organization_memberships__organization__code__icontains=query)
            )

        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context


class SupportTicketListCreateView(SupportQuerysetMixin, generics.ListCreateAPIView):
    serializer_class = SupportTicketSerializer
    permission_classes = [CanManageSupportTickets]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def perform_create(self, serializer):
        ticket = serializer.save()

        if ticket.user_id:
            notify_user(
                ticket.user,
                "Ticket support créé",
                f"Votre ticket « {ticket.subject} » a bien été enregistré.",
                notification_type="support",
                target_url=f"/support/{ticket.id}",
                related_type="support_ticket",
                related_id=ticket.id,
            )

        if self.request.user.role not in INTERNAL_ROLES:
            has_attachment = ticket.messages.filter(attachment__isnull=False).exclude(attachment="").exists()
            _notify_internal_users_for_ticket(
                ticket,
                "Nouvelle demande client avec pièce jointe" if has_attachment else "Nouvelle demande client",
                (
                    f"Un client a créé la demande « {ticket.subject} » avec une pièce jointe."
                    if has_attachment
                    else f"Un client a créé la demande « {ticket.subject} »."
                ),
                actor=self.request.user,
            )


class SupportTicketDetailView(SupportQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SupportTicketSerializer
    permission_classes = [CanManageSupportTickets]

    def perform_update(self, serializer):
        if getattr(self.request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les administrateurs et managers peuvent modifier un ticket support.")
        serializer.save()

    def perform_destroy(self, instance):
        if getattr(self.request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les administrateurs et managers peuvent supprimer un ticket support.")
        attachments = list(
            instance.messages.filter(attachment__isnull=False)
            .exclude(attachment="")
            .values_list("attachment", flat=True)
        )
        storage = None
        sample_message = instance.messages.filter(attachment__isnull=False).exclude(attachment="").first()
        if sample_message and sample_message.attachment:
            storage = sample_message.attachment.storage
        instance.delete()
        if storage:
            for file_name in attachments:
                try:
                    if storage.exists(file_name):
                        storage.delete(file_name)
                except Exception:  # pragma: no cover - dépend du backend de stockage configuré
                    logger.exception("Impossible de supprimer la pièce jointe support %s", file_name)


class SupportTicketBulkDeleteView(SupportQuerysetMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if getattr(request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les administrateurs et managers peuvent supprimer des tickets support.")

        ids = _ids_from_payload(request.data or {})
        if not ids:
            return Response(
                {"detail": "Sélectionnez au moins un ticket support à supprimer."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tickets = list(self.get_queryset().filter(pk__in=ids))
        deleted_ids = []
        for ticket in tickets:
            attachments = list(
                ticket.messages.filter(attachment__isnull=False)
                .exclude(attachment="")
                .values_list("attachment", flat=True)
            )
            storage = None
            sample_message = ticket.messages.filter(attachment__isnull=False).exclude(attachment="").first()
            if sample_message and sample_message.attachment:
                storage = sample_message.attachment.storage
            ticket_id = ticket.pk
            ticket.delete()
            deleted_ids.append(ticket_id)
            if storage:
                for file_name in attachments:
                    try:
                        if storage.exists(file_name):
                            storage.delete(file_name)
                    except Exception:  # pragma: no cover - dépend du backend de stockage configuré
                        logger.exception("Impossible de supprimer la pièce jointe support %s", file_name)

        return Response(
            {
                "detail": f"{len(deleted_ids)} ticket(s) supprimé(s).",
                "deleted": len(deleted_ids),
                "ids": deleted_ids,
            }
        )


class SupportTicketReplyView(SupportQuerysetMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, pk):
        ticket = self.get_queryset().filter(pk=pk).first()

        if not ticket:
            raise NotFound("Ticket support introuvable.")

        if ticket.status == "closed":
            return Response(
                {"detail": "Ce ticket est fermé. Rouvrez-le avant d’ajouter une réponse."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = SupportMessageSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        message = serializer.save(ticket=ticket, author=request.user)

        if request.user.role in INTERNAL_ROLES and ticket.status == "open":
            ticket.status = "in_progress"
            ticket.save(update_fields=["status", "updated_at"])

        if message.is_internal_note:
            pass
        elif ticket.user_id and request.user.id != ticket.user_id:
            notify_user(
                ticket.user,
                "Nouvelle réponse support",
                f"Une réponse a été ajoutée au ticket « {ticket.subject} ».",
                notification_type="support",
                target_url=f"/support/{ticket.id}",
                related_type="support_ticket",
                related_id=ticket.id,
            )
        elif request.user.role not in INTERNAL_ROLES:
            has_attachment = bool(message.attachment)
            _notify_internal_users_for_ticket(
                ticket,
                "Nouvelle réponse client avec pièce jointe" if has_attachment else "Nouvelle réponse client",
                (
                    f"Le client a répondu à la demande « {ticket.subject} » avec une pièce jointe."
                    if has_attachment
                    else f"Le client a répondu à la demande « {ticket.subject} »."
                ),
                actor=request.user,
            )

        return Response(
            SupportMessageSerializer(message, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )




class SupportMessageDeleteView(SupportQuerysetMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, message_id):
        visible_ticket_ids = self.get_queryset().values_list("id", flat=True)
        message = (
            SupportMessage.objects
            .filter(pk=message_id, ticket_id__in=visible_ticket_ids)
            .select_related("ticket", "author")
            .first()
        )

        if not message:
            raise NotFound("Message support introuvable.")

        can_manage = getattr(request.user, "role", None) in MANAGER_ROLES
        is_author = bool(message.author_id and message.author_id == request.user.id)
        if not can_manage and not is_author:
            raise PermissionDenied("Vous ne pouvez supprimer que vos propres messages support.")
        if message.is_internal_note and getattr(request.user, "role", None) not in INTERNAL_ROLES:
            raise PermissionDenied("Les notes internes sont réservées à l’équipe MAPGEO.")

        attachment = message.attachment
        message.delete()
        _delete_support_attachment_from_storage(attachment)
        return Response({"detail": "Message support supprimé.", "deleted": 1, "id": message_id})

class SupportTicketActionView(SupportQuerysetMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    ACTIONS = {
        "close": "closed",
        "resolve": "resolved",
        "reopen": "open",
        "start": "in_progress",
        "escalate": "in_progress",
    }

    def post(self, request, pk, action):
        ticket = self.get_queryset().filter(pk=pk).first()

        if not ticket:
            raise NotFound("Ticket support introuvable.")

        if action not in self.ACTIONS:
            return Response(
                {"detail": "Action support inconnue."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if action in {"close", "resolve", "escalate"} and request.user.role not in MANAGER_ROLES:
            return Response(
                {"detail": "Action réservée aux administrateurs et managers."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if action == "start" and request.user.role not in INTERNAL_ROLES:
            return Response(
                {"detail": "Action réservée à l'équipe MAPGEO."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if action == "reopen" and request.user.role not in INTERNAL_ROLES and ticket.user_id != request.user.id:
            return Response(
                {"detail": "Vous ne pouvez rouvrir que vos propres tickets."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if action == "escalate":
            ticket.priority = "urgent"

        previous_status = ticket.status
        ticket.status = self.ACTIONS[action]
        ticket.save(update_fields=["status", "priority", "updated_at"])

        if ticket.user_id and request.user.id != ticket.user_id and previous_status != ticket.status:
            status_label = dict(SupportTicket.STATUS_CHOICES).get(ticket.status, ticket.status)
            notify_user(
                ticket.user,
                "Statut du ticket mis à jour",
                f"Le ticket « {ticket.subject} » est maintenant : {status_label}.",
                notification_type="support",
                target_url=f"/support/{ticket.id}",
                related_type="support_ticket",
                related_id=ticket.id,
            )

        return Response(SupportTicketSerializer(ticket, context={"request": request}).data)

class SupportAttachmentDownloadView(SupportQuerysetMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, message_id):
        visible_ticket_ids = self.get_queryset().values_list("id", flat=True)
        message = (
            SupportMessage.objects
            .filter(pk=message_id, ticket_id__in=visible_ticket_ids)
            .select_related("ticket")
            .first()
        )

        if not message or not message.attachment:
            raise NotFound("Pièce jointe introuvable.")

        if getattr(request.user, "role", None) == "client" and message.is_internal_note:
            # Ne pas révéler l'existence d'une note interne ou de sa pièce jointe.
            raise NotFound("Pièce jointe introuvable.")

        filename = message.attachment.name.rsplit("/", 1)[-1]
        response = FileResponse(message.attachment.open("rb"), as_attachment=True, filename=filename)
        return apply_private_file_response_headers(response)
