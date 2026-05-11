from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import CanViewMapContextLayers
from .services import fetch_layer_geojson, list_map_layers, parse_bbox


class MapLayerCatalogView(APIView):
    permission_classes = [CanViewMapContextLayers]

    def get(self, request):
        return Response({"results": list_map_layers()})


class MapLayerGeoJsonView(APIView):
    permission_classes = [CanViewMapContextLayers]
    layer_id = ""

    def get(self, request):
        bbox = parse_bbox(request.query_params.get("bbox"))
        limit = request.query_params.get("limit") or request.query_params.get("page_size") or 1500
        return Response(fetch_layer_geojson(self.layer_id, bbox=bbox, limit=limit))
