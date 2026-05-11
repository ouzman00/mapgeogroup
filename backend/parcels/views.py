from django.contrib.auth import get_user_model
from django.db.models import Prefetch, Q
from django.contrib.gis.geos import Polygon

from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from config.pagination import MapViewportPagination

from accounts.permissions import MANAGER_ROLES, IsAdminOrManager, filter_parcels_for_user, get_managed_organization_ids, user_can_edit_parcel, user_can_manage_organization
from notifications.services import notify_user

from .filters import ParcelFilter
from .models import Parcel, ParcelTimelineEvent
from .serializers import (
    ParcelCreateUpdateSerializer,
    ParcelDetailSerializer,
    ParcelGeometryVersionSerializer,
    ParcelListSerializer,
    ParcelMapSerializer,
    ParcelOwnerOptionSerializer,
)
from .services import get_parcel_progress, parse_csv_import

User = get_user_model()


class CanManageParcels(permissions.BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        if request.method in permissions.SAFE_METHODS:
            return True

        role = getattr(request.user, "role", None)

        # Création, modification, archivage et correction géométrique sont réservés
        # au back-office admin/manager. Le portail client reste strictement en lecture.
        return role in MANAGER_ROLES


class ParcelQuerysetMixin:
    def _include_archived(self):
        value = str(self.request.query_params.get("include_archived", "")).strip().lower()
        return value in {"1", "true", "yes", "on"} and getattr(self.request.user, "role", None) in MANAGER_ROLES

    def _parcel_queryset(self):
        queryset = Parcel.objects.select_related("owner", "organization")
        if not self._include_archived():
            queryset = queryset.filter(archived_at__isnull=True)
        return queryset

    def get_base_queryset(self):
        return filter_parcels_for_user(self._parcel_queryset(), self.request.user)

    def get_write_queryset(self):
        return filter_parcels_for_user(self._parcel_queryset(), self.request.user, for_write=True)

    def get_queryset(self):
        return self.get_base_queryset()

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context


class ParcelListCreateView(ParcelQuerysetMixin, generics.ListCreateAPIView):
    permission_classes = [CanManageParcels]
    filterset_class = ParcelFilter

    def get_queryset(self):
        timeline_queryset = ParcelTimelineEvent.objects.only(
            "id", "parcel_id", "event_date", "progress"
        ).order_by("event_date", "id")
        return self.get_base_queryset().prefetch_related(
            Prefetch("timeline_events", queryset=timeline_queryset)
        ).order_by("-created_at")

    def perform_create(self, serializer):
        organization = serializer.validated_data.get("organization")

        if not organization:
            raise PermissionDenied("Une organisation cliente est obligatoire pour créer une parcelle.")

        if not user_can_manage_organization(self.request.user, organization.id):
            raise PermissionDenied("Vous ne pouvez créer une parcelle que dans une organisation que vous gérez.")

        parcel = serializer.save()
        notify_user(
            parcel.owner,
            "Nouvelle parcelle ajoutée",
            f"La parcelle {parcel.reference} a été créée dans votre espace.",
            notification_type="parcel",
            target_url=f"/parcels/{parcel.id}/carto",
            related_type="parcel",
            related_id=parcel.id,
        )

    def get_serializer_class(self):
        return (
            ParcelCreateUpdateSerializer
            if self.request.method == "POST"
            else ParcelListSerializer
        )


class ParcelDetailView(ParcelQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [CanManageParcels]

    def get_queryset(self):
        return self.get_base_queryset().prefetch_related("sides", "timeline_events", "documents", "geometry_versions")

    def get_serializer_class(self):
        return (
            ParcelCreateUpdateSerializer
            if self.request.method in ["PUT", "PATCH"]
            else ParcelDetailSerializer
        )

    def perform_update(self, serializer):
        target_organization = serializer.validated_data.get("organization", serializer.instance.organization)

        if not user_can_edit_parcel(self.request.user, serializer.instance):
            raise PermissionDenied("Vous ne pouvez modifier que les parcelles des organisations que vous gérez.")

        if target_organization and not user_can_manage_organization(self.request.user, target_organization.id):
            raise PermissionDenied("Organisation cible non autorisée pour votre périmètre.")

        parcel = serializer.save()
        notify_user(
            parcel.owner,
            "Parcelle mise à jour",
            f"La parcelle {parcel.reference} a été mise à jour.",
            notification_type="parcel",
            target_url=f"/parcels/{parcel.id}/carto",
            related_type="parcel",
            related_id=parcel.id,
        )

    def perform_destroy(self, instance):
        if not user_can_manage_organization(self.request.user, instance.organization_id):
            raise PermissionDenied("Vous ne pouvez archiver que les parcelles des organisations que vous gérez.")

        owner = instance.owner
        reference = instance.reference
        instance.archive(user=self.request.user)
        notify_user(
            owner,
            "Parcelle archivée",
            f"La parcelle {reference} a été archivée. Les géométries, documents et historiques sont conservés.",
            notification_type="parcel",
            severity="warning",
            target_url="/parcels",
            related_type="parcel",
            related_id=instance.id,
        )


class ParcelMapView(ParcelQuerysetMixin, generics.ListAPIView):
    """Endpoint cartographique léger avec filtrage spatial backend.

    bbox attendu : minX,minY,maxX,maxY en EPSG:32628. On filtre par
    intersection réelle avec geom afin de ne pas exclure les parcelles dont
    le centroïde est hors de l'écran mais dont la géométrie intersecte la vue.
    """

    serializer_class = ParcelMapSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = MapViewportPagination

    def get_serializer_context(self):
        context = super().get_serializer_context()
        raw_tolerance = self.request.query_params.get("simplify_tolerance")
        try:
            tolerance = max(0.0, min(float(raw_tolerance or 0), 100.0))
        except (TypeError, ValueError):
            tolerance = 0.0
        context["map_simplify_tolerance"] = tolerance
        return context

    def get_queryset(self):
        queryset = self.get_base_queryset().exclude(geom__isnull=True).select_related("owner", "organization").order_by("id")

        # La carte bbox doit respecter les mêmes filtres métier que la liste
        # (client, statut, commune, période, recherche, permissions).
        queryset = ParcelFilter(self.request.query_params, queryset=queryset, request=self.request).qs

        bbox = (self.request.query_params.get("bbox") or "").strip()
        if bbox:
            try:
                min_x, min_y, max_x, max_y = [float(value) for value in bbox.split(",")]
            except (TypeError, ValueError):
                return queryset.none()
            if min_x >= max_x or min_y >= max_y:
                return queryset.none()
            bbox_polygon = Polygon.from_bbox((min_x, min_y, max_x, max_y))
            bbox_polygon.srid = 32628
            queryset = queryset.filter(geom__intersects=bbox_polygon)
        return queryset


class ParcelProgressView(ParcelQuerysetMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        try:
            parcel = self.get_queryset().get(pk=pk)
        except Parcel.DoesNotExist as exc:
            raise NotFound("Parcelle introuvable.") from exc

        return Response(
            {
                "parcel_id": parcel.id,
                "reference": parcel.reference,
                "progress": get_parcel_progress(parcel),
                "status": parcel.status,
            }
        )


class ParcelGeometryHistoryView(ParcelQuerysetMixin, generics.ListAPIView):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ParcelGeometryVersionSerializer

    def get_queryset(self):
        parcel = self.get_base_queryset().filter(pk=self.kwargs["pk"]).first()
        if not parcel:
            raise NotFound("Parcelle introuvable.")
        return parcel.geometry_versions.select_related("modified_by")


class ParcelCsvImportView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        csv_file = request.FILES.get("file")
        if not csv_file:
            return Response(
                {"detail": "Aucun fichier CSV reçu."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        managed_org_ids = get_managed_organization_ids(request.user)

        default_owner = None
        owner_id = request.data.get("default_owner_id")
        if owner_id:
            default_owner = User.objects.filter(pk=owner_id, role="client").first()

        default_organization = None
        organization_id = request.data.get("organization_id") or request.data.get("organization")
        if organization_id:
            from organizations.models import Organization
            default_organization = Organization.objects.filter(pk=organization_id, organization_type="client").first()
            if not default_organization or (managed_org_ids is not None and default_organization.id not in managed_org_ids):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Organisation d'import non autorisée pour votre périmètre.")
        else:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Une organisation cliente est obligatoire pour importer des parcelles.")

        if default_owner and default_organization:
            if not default_owner.organization_memberships.filter(organization=default_organization, is_active=True).exists():
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"default_owner_id": "Le propriétaire par défaut n'appartient pas à l'organisation sélectionnée."})

        dry_run_value = str(request.data.get("dry_run", "")).strip().lower()
        dry_run = dry_run_value in {"1", "true", "yes", "on"}

        return Response(
            parse_csv_import(csv_file, default_owner=default_owner, default_organization=default_organization, dry_run=dry_run),
            status=status.HTTP_200_OK,
        )


class ParcelOwnerOptionsView(generics.ListAPIView):
    serializer_class = ParcelOwnerOptionSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]

    def get_queryset(self):
        query = (self.request.query_params.get("q") or "").strip()
        queryset = User.objects.filter(role="client")
        managed_org_ids = get_managed_organization_ids(self.request.user)
        if managed_org_ids is not None:
            queryset = queryset.filter(organization_memberships__organization_id__in=managed_org_ids, organization_memberships__is_active=True)

        if query:
            queryset = queryset.filter(
                Q(client_code__icontains=query)
                | Q(username__icontains=query)
                | Q(first_name__icontains=query)
                | Q(last_name__icontains=query)
                | Q(company_name__icontains=query)
                | Q(email__icontains=query)
                | Q(organization_memberships__organization__name__icontains=query)
                | Q(organization_memberships__organization__code__icontains=query)
            )

        return queryset.prefetch_related("organization_memberships", "organization_memberships__organization").order_by("first_name", "last_name", "username").distinct()
