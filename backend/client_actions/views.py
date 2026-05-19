from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import MANAGER_ROLES, filter_parcels_for_user

from .models import ClientAction
from .serializers import ClientActionCreateUpdateSerializer, ClientActionSerializer


class ClientActionViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        from parcels.models import Parcel
        visible_parcels = filter_parcels_for_user(Parcel.objects.all(), user)

        queryset = (
            ClientAction.objects
            .select_related("parcel", "parcel__owner", "parcel__organization")
            .filter(parcel__in=visible_parcels)
        )

        status_filter = self.request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        parcel_id = self.request.query_params.get("parcel")
        if parcel_id:
            queryset = queryset.filter(parcel_id=parcel_id)

        return queryset.order_by("status", "due_date", "-created_at")

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return ClientActionCreateUpdateSerializer
        return ClientActionSerializer

    def perform_create(self, serializer):
        user = self.request.user
        if getattr(user, "role", None) not in MANAGER_ROLES:
            self.permission_denied(self.request, message="Seul le back-office peut créer une action attendue.")
        serializer.save(created_by=user)

    def perform_update(self, serializer):
        user = self.request.user
        if getattr(user, "role", None) not in MANAGER_ROLES:
            self.permission_denied(self.request, message="Seul le back-office peut modifier une action attendue.")
        serializer.save()

    def perform_destroy(self, instance):
        user = self.request.user
        if getattr(user, "role", None) not in MANAGER_ROLES:
            self.permission_denied(self.request, message="Seul le back-office peut supprimer une action attendue.")
        instance.delete()

    @action(detail=True, methods=["patch"])
    def complete(self, request, pk=None):
        action_item = self.get_object()

        if action_item.status == ClientAction.STATUS_DONE:
            serializer = ClientActionSerializer(action_item, context=self.get_serializer_context())
            return Response(serializer.data)

        action_item.status = ClientAction.STATUS_DONE
        action_item.completed_at = timezone.now()
        action_item.save(update_fields=["status", "completed_at", "updated_at"])

        serializer = ClientActionSerializer(action_item, context=self.get_serializer_context())
        return Response(serializer.data, status=status.HTTP_200_OK)
