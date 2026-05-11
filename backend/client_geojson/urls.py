from django.urls import path

from .views import (
    AdminClientGeoJsonLayerCreateView,
    AdminGeoJsonLayerListView,
    AdminGeoJsonLayerUpdateDeleteView,
    ClientGeoJsonLayerDetailView,
    ClientGeoJsonLayerListView,
)

urlpatterns = [
    path("geojson-layers/", ClientGeoJsonLayerListView.as_view(), name="client-geojson-layer-list"),
    path("geojson-layers/<int:id>/", ClientGeoJsonLayerDetailView.as_view(), name="client-geojson-layer-detail"),
    path("admin/geojson-layers/", AdminGeoJsonLayerListView.as_view(), name="admin-geojson-layer-list"),
    path("admin/clients/<int:client_id>/geojson-layers/", AdminClientGeoJsonLayerCreateView.as_view(), name="admin-client-geojson-layer-create"),
    path("admin/geojson-layers/<int:pk>/", AdminGeoJsonLayerUpdateDeleteView.as_view(), name="admin-geojson-layer-update-delete"),
]
