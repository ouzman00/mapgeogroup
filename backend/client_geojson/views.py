from __future__ import annotations

import json

from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from organizations.models import Organization
from notifications.services import notify_client_users

from client_map_layers.geojson_utils import filter_feature_collection, normalize_geojson_for_leaflet, parse_wgs84_bbox

from .models import GeoJsonLayer
from accounts.permissions import get_client_organization_ids
from .permissions import HasClientScope, IsAdminRole, is_platform_admin, managed_client_ids_for_user, user_can_manage_client
from .serializers import (
    GeoJsonLayerAdminSerializer,
    GeoJsonLayerCreateSerializer,
    GeoJsonLayerListSerializer,
    GeoJsonLayerUpdateSerializer,
)


def client_geojson_queryset_for_user(user):
    qs = GeoJsonLayer.objects.filter(is_active=True)
    if is_platform_admin(user):
        return qs
    client_org_ids = get_client_organization_ids(user)
    if not client_org_ids:
        return qs.none()
    return qs.filter(client_id__in=client_org_ids)


def notify_geojson_layer_available(layer, action="created"):
    if not layer.is_active:
        return 0

    titles = {
        "created": "Nouvelle couche GeoJSON disponible",
        "activated": "Couche GeoJSON activée",
        "deleted": "Couche GeoJSON supprimée",
    }
    messages = {
        "created": f"La couche « {layer.name} » est maintenant disponible sur votre carte.",
        "activated": f"La couche « {layer.name} » vient d’être activée sur votre carte.",
        "deleted": f"La couche « {layer.name} » a été retirée de votre carte.",
    }
    return notify_client_users(
        layer.client_id,
        titles.get(action, titles["created"]),
        messages.get(action, messages["created"]),
        notification_type="info",
        severity="info",
        target_url="/parcels/carto",
        related_type="geojson_layer",
        related_id=layer.id,
    )


class ClientGeoJsonLayerListView(generics.ListAPIView):
    serializer_class = GeoJsonLayerListSerializer
    permission_classes = [HasClientScope]

    def get_queryset(self):
        if is_platform_admin(self.request.user):
            return GeoJsonLayer.objects.none()
        return (
            client_geojson_queryset_for_user(self.request.user)
            .only("id", "client_id", "name", "description", "layer_type", "is_active", "metadata", "created_at", "updated_at")
            .order_by("name", "id")
        )


class ClientGeoJsonLayerDetailView(APIView):
    permission_classes = [HasClientScope]

    def get(self, request, id):
        layer = get_object_or_404(
            client_geojson_queryset_for_user(request.user),
            id=id,
        )

        try:
            with layer.file.open("rb") as geojson_file:
                raw_data = json.load(geojson_file)
            normalized, metadata_patch = normalize_geojson_for_leaflet(raw_data, layer.metadata or {})
            bbox = parse_wgs84_bbox(request.query_params.get("bbox"))
            try:
                limit = min(20000, max(0, int(request.query_params.get("limit") or 2500)))
            except Exception:
                limit = 2500
            data = filter_feature_collection(normalized, bbox=bbox, limit=limit)
            data["metadata"] = {**metadata_patch, **(data.get("metadata") or {})}
        except Exception:
            return Response(
                {"detail": "Impossible de lire le fichier GeoJSON."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        response = JsonResponse(data, safe=False)
        response["Cache-Control"] = "private, no-store"
        response["Vary"] = "Authorization"
        return response


class AdminGeoJsonLayerListView(generics.ListAPIView):
    serializer_class = GeoJsonLayerAdminSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        queryset = GeoJsonLayer.objects.select_related("client").order_by("-created_at", "-id")
        managed_ids = managed_client_ids_for_user(self.request.user)
        if managed_ids is not None:
            queryset = queryset.filter(client_id__in=managed_ids)
        client_id = self.request.query_params.get("client_id")
        client_code = (self.request.query_params.get("client_code") or self.request.query_params.get("organization_code") or "").strip()
        if client_id:
            queryset = queryset.filter(client_id=client_id)
        elif client_code:
            queryset = queryset.filter(client__code__iexact=client_code)
        return queryset


class AdminClientGeoJsonLayerCreateView(generics.CreateAPIView):
    serializer_class = GeoJsonLayerCreateSerializer
    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser, FormParser]

    def perform_create(self, serializer):
        client = get_object_or_404(
            Organization,
            id=self.kwargs["client_id"],
            organization_type="client",
        )
        if not user_can_manage_client(self.request.user, client.id):
            raise Http404("Client introuvable dans votre périmètre.")
        self.created_layer = serializer.save(client=client, uploaded_by=self.request.user)
        notify_geojson_layer_available(self.created_layer, action="created")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        output_serializer = GeoJsonLayerAdminSerializer(self.created_layer, context=self.get_serializer_context())
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)


class AdminGeoJsonLayerUpdateDeleteView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        queryset = GeoJsonLayer.objects.select_related("client")
        managed_ids = managed_client_ids_for_user(self.request.user)
        if managed_ids is not None:
            queryset = queryset.filter(client_id__in=managed_ids)
        return queryset

    def get_serializer_class(self):
        if self.request.method in {"PATCH", "PUT"}:
            return GeoJsonLayerUpdateSerializer
        return GeoJsonLayerAdminSerializer

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        was_active = instance.is_active
        serializer = GeoJsonLayerUpdateSerializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        layer = serializer.save()
        if not was_active and layer.is_active:
            notify_geojson_layer_available(layer, action="activated")
        return Response(GeoJsonLayerAdminSerializer(layer, context=self.get_serializer_context()).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        layer = self.get_object()
        notify_deleted = layer.is_active
        if layer.file:
            layer.file.delete(save=False)
        if notify_deleted:
            notify_geojson_layer_available(layer, action="deleted")
        layer.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
