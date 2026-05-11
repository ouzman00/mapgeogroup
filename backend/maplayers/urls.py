from django.urls import path

from .views import MapLayerCatalogView, MapLayerGeoJsonView


class CommunesLayerView(MapLayerGeoJsonView):
    layer_id = "communes"


class RoadsLayerView(MapLayerGeoJsonView):
    layer_id = "roads"


class SanitaryInfrastructuresLayerView(MapLayerGeoJsonView):
    layer_id = "sanitary-infrastructures"


class SchoolInfrastructuresLayerView(MapLayerGeoJsonView):
    layer_id = "school-infrastructures"


urlpatterns = [
    path("layers/", MapLayerCatalogView.as_view(), name="map-layer-catalog"),
    path("communes/", CommunesLayerView.as_view(), name="map-layer-communes"),
    path("roads/", RoadsLayerView.as_view(), name="map-layer-roads"),
    path("sanitary-infrastructures/", SanitaryInfrastructuresLayerView.as_view(), name="map-layer-sanitary"),
    path("school-infrastructures/", SchoolInfrastructuresLayerView.as_view(), name="map-layer-school"),
]
