from rest_framework import generics, permissions, status
from rest_framework.generics import GenericAPIView
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from accounts.permissions import MANAGER_ROLES, get_managed_organization_ids, user_can_manage_user
from organizations.models import Organization

from .models import ImportJob
from .serializers import ImportJobSerializer
from .services import process_import_job


class CanManageImports(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and getattr(request.user, "role", None) in MANAGER_ROLES)


class ImportJobQuerysetMixin:
    def get_queryset(self):
        queryset = ImportJob.objects.select_related("organization", "created_by", "default_owner").prefetch_related("rows")
        managed_org_ids = get_managed_organization_ids(self.request.user)
        if managed_org_ids is not None:
            if not managed_org_ids:
                return queryset.none()
            queryset = queryset.filter(organization_id__in=managed_org_ids)
        return queryset.order_by("-created_at")


class ImportJobListCreateView(ImportJobQuerysetMixin, generics.ListCreateAPIView):
    serializer_class = ImportJobSerializer
    permission_classes = [CanManageImports]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def perform_create(self, serializer):
        if getattr(self.request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les utilisateurs internes peuvent lancer un import métier.")
        managed_org_ids = get_managed_organization_ids(self.request.user)
        organization = None
        organization_id = self.request.data.get("organization")
        if organization_id:
            organization = Organization.objects.filter(pk=organization_id, organization_type="client").first()
            if not organization or (managed_org_ids is not None and organization.id not in managed_org_ids):
                raise PermissionDenied("Organisation d'import non autorisée pour votre périmètre.")
        else:
            raise PermissionDenied("Une organisation cliente est obligatoire pour importer des parcelles.")
        default_owner = None
        owner_id = self.request.data.get("default_owner") or self.request.data.get("default_owner_id")
        if owner_id:
            from django.contrib.auth import get_user_model
            User = get_user_model()
            default_owner = User.objects.filter(pk=owner_id, role="client").first()
            if not default_owner or not user_can_manage_user(self.request.user, default_owner):
                raise PermissionDenied("Propriétaire par défaut non autorisé pour votre périmètre.")
        if organization and default_owner and not default_owner.organization_memberships.filter(organization=organization, is_active=True).exists():
            raise PermissionDenied("Le propriétaire par défaut n'appartient pas à l'organisation sélectionnée.")
        skip_errors_raw = str(self.request.data.get("skip_errors", "false")).strip().lower()
        skip_errors = skip_errors_raw in {"true", "1", "yes", "on"}
        serializer.save(
            created_by=self.request.user,
            organization=organization,
            default_owner=default_owner,
            original_filename=getattr(self.request.FILES.get("file"), "name", None),
            skip_errors=skip_errors,
        )


class ImportJobDetailView(ImportJobQuerysetMixin, generics.RetrieveAPIView):
    serializer_class = ImportJobSerializer
    permission_classes = [CanManageImports]


class ImportJobExecuteView(ImportJobQuerysetMixin, GenericAPIView):
    serializer_class = ImportJobSerializer
    permission_classes = [CanManageImports]

    def post(self, request, pk):
        job = self.get_queryset().filter(pk=pk).first()
        if not job:
            return Response({"detail": "Import introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if getattr(request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les utilisateurs internes peuvent exécuter un import métier.")
        job.execute_on_process = True
        job.save(update_fields=["execute_on_process", "updated_at"])
        job = process_import_job(job)
        return Response(ImportJobSerializer(job, context={"request": request}).data)


class ImportJobValidateView(ImportJobQuerysetMixin, GenericAPIView):
    serializer_class = ImportJobSerializer
    permission_classes = [CanManageImports]

    def post(self, request, pk):
        job = self.get_queryset().filter(pk=pk).first()
        if not job:
            return Response({"detail": "Import introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if getattr(request.user, "role", None) not in MANAGER_ROLES:
            raise PermissionDenied("Seuls les utilisateurs internes peuvent valider un import métier.")
        job = process_import_job(job)
        return Response(ImportJobSerializer(job, context={"request": request}).data)
