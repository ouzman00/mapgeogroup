from rest_framework import permissions, viewsets

from accounts.permissions import MANAGER_ROLES, filter_parcels_for_user

from .models import FieldIntervention
from .serializers import FieldInterventionCreateUpdateSerializer, FieldInterventionSerializer


class FieldInterventionViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        visible_parcels = filter_parcels_for_user(user)

        queryset = (
            FieldIntervention.objects
            .select_related("parcel", "parcel__owner", "parcel__organization", "agent")
            .filter(parcel__in=visible_parcels)
        )

        if getattr(user, "role", None) == "client":
            queryset = queryset.filter(visible_to_client=True)

        parcel_id = self.request.query_params.get("parcel")
        if parcel_id:
            queryset = queryset.filter(parcel_id=parcel_id)

        status_filter = self.request.query_params.get("status")
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        return queryset.order_by("-scheduled_date", "-created_at")

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return FieldInterventionCreateUpdateSerializer
        return FieldInterventionSerializer

    def _ensure_backoffice(self):
        if getattr(self.request.user, "role", None) not in MANAGER_ROLES:
            self.permission_denied(
                self.request,
                message="Seul le back-office peut gérer les interventions terrain.",
            )

    def perform_create(self, serializer):
        self._ensure_backoffice()
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        self._ensure_backoffice()
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_backoffice()
        instance.delete()
