from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from rest_framework import generics, permissions
from rest_framework.exceptions import PermissionDenied, ValidationError

from accounts.permissions import MANAGER_ROLES, IsAdminOrManager, filter_organizations_for_user, user_can_manage_organization
from .models import Organization, OrganizationMembership
from .serializers import OrganizationSerializer

User = get_user_model()


class OrganizationQuerysetMixin:
    def get_queryset(self):
        queryset = Organization.objects.prefetch_related(
            "memberships",
            "memberships__user",
        ).annotate(
            parcels_count=Count("parcels", distinct=True),
        )

        queryset = filter_organizations_for_user(queryset, self.request.user)

        query = (self.request.query_params.get("q") or "").strip()
        status_value = (self.request.query_params.get("status") or "").strip()
        organization_type = (self.request.query_params.get("organization_type") or "").strip()
        ordering = (self.request.query_params.get("ordering") or "name").strip()

        allowed_ordering = {
            "name",
            "-name",
            "created_at",
            "-created_at",
            "status",
            "-status",
            "parcels_count",
            "-parcels_count",
        }

        if query:
            queryset = queryset.filter(
                Q(name__icontains=query)
                | Q(code__icontains=query)
                | Q(email__icontains=query)
            )

        if status_value:
            queryset = queryset.filter(status=status_value)

        if organization_type:
            queryset = queryset.filter(organization_type=organization_type)

        if ordering not in allowed_ordering:
            ordering = "name"

        return queryset.order_by(ordering, "id").distinct()


class OrganizationListCreateView(OrganizationQuerysetMixin, generics.ListCreateAPIView):
    serializer_class = OrganizationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.request.method == "POST":
            return [permissions.IsAuthenticated(), IsAdminOrManager()]

        return super().get_permissions()

    def perform_create(self, serializer):
        if getattr(self.request.user, "role", None) != "admin":
            raise PermissionDenied("Seul un administrateur peut créer une organisation.")

        serializer.save()


class OrganizationDetailView(OrganizationQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = OrganizationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_update(self, serializer):
        if getattr(self.request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les administrateurs et managers peuvent modifier une organisation.")
        if not user_can_manage_organization(self.request.user, self.get_object().id):
            raise PermissionDenied("Vous ne pouvez modifier que les organisations que vous gérez.")

        previous_code = self.get_object().code
        organization = serializer.save()

        if organization.organization_type == "client" and organization.code != previous_code:
            owner_membership = organization.memberships.filter(
                role="owner",
                is_active=True,
            ).select_related("user").first()

            if owner_membership and owner_membership.user.role == "client":
                conflict = User.objects.filter(
                    client_code__iexact=organization.code,
                ).exclude(
                    pk=owner_membership.user_id,
                ).exists()

                if conflict:
                    raise ValidationError({"code": "Ce code est déjà utilisé comme code client."})

                owner_membership.user.client_code = organization.code
                owner_membership.user.save(update_fields=["client_code"])

    def perform_destroy(self, instance):
        if getattr(self.request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les administrateurs et managers peuvent supprimer une organisation.")
        if not user_can_manage_organization(self.request.user, instance.id):
            raise PermissionDenied("Vous ne pouvez supprimer que les organisations que vous gérez.")
        if instance.parcels.exists() or instance.memberships.exists():
            raise ValidationError({"detail": "Cette organisation contient encore des parcelles ou des membres. Archivez-la plutôt que de la supprimer."})

        instance.delete()
