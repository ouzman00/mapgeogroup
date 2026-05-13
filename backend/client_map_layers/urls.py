from django.urls import path
from .views import AdminClientMapLayerCreateView, AdminMapLayerListView, AdminMapLayerUpdateDeleteView, AdminPostgisLayerPreviewView, AdminPostgisTablesView, AdminServiceCapabilitiesView, AdminWfsLayerPreviewView, ClientMapLayerDetailView, ClientMapLayerGeoJsonView, ClientMapLayerLegendView, ClientMapLayerListView, ClientMapLayerTileView

urlpatterns = [
    path("map-layers/", ClientMapLayerListView.as_view()),
    path("map-layers/<int:layer_id>/", ClientMapLayerDetailView.as_view()),
    path("map-layers/<int:layer_id>/geojson/", ClientMapLayerGeoJsonView.as_view()),
    path("map-layers/<int:layer_id>/tiles/<int:z>/<int:x>/<int:y>/", ClientMapLayerTileView.as_view()),
    path("map-layers/<int:layer_id>/legend/", ClientMapLayerLegendView.as_view()),
    path("admin/map-layers/", AdminMapLayerListView.as_view()),
    path("admin/clients/<int:client_id>/map-layers/capabilities/", AdminServiceCapabilitiesView.as_view()),
    path("admin/clients/<int:client_id>/map-layers/postgis-tables/", AdminPostgisTablesView.as_view()),
    path("admin/clients/<int:client_id>/map-layers/postgis-preview/", AdminPostgisLayerPreviewView.as_view()),
    path("admin/clients/<int:client_id>/map-layers/wfs-preview/", AdminWfsLayerPreviewView.as_view()),
    path("admin/clients/<int:client_id>/map-layers/", AdminClientMapLayerCreateView.as_view()),
    path("admin/map-layers/<int:pk>/", AdminMapLayerUpdateDeleteView.as_view()),
]
