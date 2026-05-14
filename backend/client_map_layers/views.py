from __future__ import annotations

import ipaddress
import json
import shutil
import socket
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

from django.conf import settings
from django.http import Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from organizations.models import Organization
from notifications.services import notify_client_users

from .geojson_utils import filter_feature_collection, normalize_geojson_for_leaflet, parse_wgs84_bbox
from .validators import validate_layer_payload
from .models import ClientMapLayer
from .services.vector_import import build_db_geojson
from .services.postgis_import import inspect_postgis_table_metadata, list_available_postgis_tables, normalize_postgis_options
from accounts.permissions import get_client_organization_ids
from .permissions import HasClientScope, IsAdminRole, is_platform_admin, managed_client_ids_for_user, user_can_manage_client
from .serializers import AdminMapLayerSerializer, ClientMapLayerListSerializer, MapLayerCreateSerializer, MapLayerUpdateSerializer, SUPPORTED_DATA_FORMATS, configured_wms_service_url, display_message_for, is_client_displayable_layer, is_database_layer, service_for, wfs_version, wms_tile_crs, wms_tile_version


def private_headers(response):
    response["Cache-Control"] = "private, no-store"
    response["Vary"] = "Authorization"
    return response


def client_layer_queryset_for_user(user):
    qs = ClientMapLayer.objects.filter(is_active=True)
    if is_platform_admin(user):
        # Compatibilité backoffice : l’admin peut utiliser le détail s’il connaît
        # explicitement l’id, mais la liste portail reste vide sans client lié.
        return qs
    client_org_ids = get_client_organization_ids(user)
    if not client_org_ids:
        return qs.none()
    return qs.filter(client_id__in=client_org_ids)


def client_layer(request, **filters):
    return get_object_or_404(client_layer_queryset_for_user(request.user), **filters)


def notify_layer_available(layer, action="created"):
    if action != "deleted" and not is_client_displayable_layer(layer):
        return 0
    if action == "deleted" and (not layer.is_active or layer.processing_status != ClientMapLayer.STATUS_READY):
        return 0

    action_labels = {
        "created": "Nouvelle couche cartographique disponible",
        "activated": "Couche cartographique activée",
        "deleted": "Couche cartographique supprimée",
    }
    messages = {
        "created": f"La couche « {layer.name} » est maintenant disponible sur votre carte.",
        "activated": f"La couche « {layer.name} » vient d’être activée sur votre carte.",
        "deleted": f"La couche « {layer.name} » a été retirée de votre carte.",
    }
    return notify_client_users(
        layer.client_id,
        action_labels.get(action, action_labels["created"]),
        messages.get(action, messages["created"]),
        notification_type="info",
        severity="info",
        target_url="/parcels/carto",
        related_type="map_layer",
        related_id=layer.id,
    )


def public_http_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False

    allowed_hosts = {host.lower() for host in getattr(settings, "EXTERNAL_MAP_PROXY_ALLOWED_HOSTS", [])}
    hostname = parsed.hostname.lower()

    # Production : allowlist obligatoire pour éviter qu'une couche WMS/WFS
    # transforme l'API en proxy HTTP général. GEOSERVER_WMS_URL doit aussi
    # avoir son hôte dans EXTERNAL_MAP_PROXY_ALLOWED_HOSTS.
    if not allowed_hosts and not getattr(settings, "DEBUG", False):
        return False
    if allowed_hosts and hostname not in allowed_hosts:
        return False

    try:
        addresses = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        return False

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
            return False
    return True


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _read_limited_response(resp):
    max_bytes = int(getattr(settings, "EXTERNAL_MAP_PROXY_MAX_BYTES", 20 * 1024 * 1024))
    payload = resp.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise Http404("Réponse externe trop volumineuse.")
    return payload


def fetch_url(url, fallback_content_type="image/png"):
    if not public_http_url(url):
        raise Http404("URL externe non autorisée")

    req = urllib.request.Request(url, headers={"User-Agent": "MAPGEO/1.0"})
    opener = urllib.request.build_opener(NoRedirectHandler())

    try:
        with opener.open(req, timeout=10) as resp:  # nosec - URL filtrée ci-dessus, redirects refusés
            final_url = resp.geturl()
            if final_url and final_url != url and not public_http_url(final_url):
                raise Http404("URL externe finale non autorisée")
            return _read_limited_response(resp), resp.headers.get("Content-Type") or fallback_content_type
    except urllib.error.HTTPError as exc:
        if 300 <= exc.code < 400:
            raise Http404("Redirection externe non autorisée") from exc
        raise Http404("Service cartographique externe indisponible") from exc
    except Http404:
        raise
    except Exception as exc:
        raise Http404("Service cartographique externe indisponible") from exc



def xyz_web_mercator_bbox(z, x, y):
    z = int(z)
    x = int(x)
    y = int(y)
    tile_count = 2 ** z
    world_extent = 20037508.342789244 * 2
    tile_size = world_extent / tile_count
    minx = -20037508.342789244 + x * tile_size
    maxx = minx + tile_size
    maxy = 20037508.342789244 - y * tile_size
    miny = maxy - tile_size
    return minx, miny, maxx, maxy


def append_query_params(url, params):
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update({key: value for key, value in params.items() if value is not None})
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


def selected_wms_layer_names(layer):
    return [name.strip() for name in str(getattr(layer, "service_layers", "") or "").split(",") if name.strip()]


def fetch_wms_tile(layer, z, x, y):
    wms_url = configured_wms_service_url(layer)
    if not wms_url or not layer.service_layers:
        raise Http404("WMS GeoServer non configuré")
    wms_version = wms_tile_version(layer)
    wms_crs = wms_tile_crs(layer)
    if wms_crs != "EPSG:3857":
        raise Http404(f"WMS CRS non supporté par le proxy de tuiles actuel : {wms_crs}")
    bbox = xyz_web_mercator_bbox(z, x, y)
    crs_param = "SRS" if wms_version.startswith("1.1") else "CRS"
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetMap",
        "VERSION": wms_version,
        "LAYERS": layer.service_layers,
        "STYLES": "",
        crs_param: wms_crs,
        "BBOX": ",".join(f"{value:.6f}" for value in bbox),
        "WIDTH": "256",
        "HEIGHT": "256",
        "FORMAT": "image/png",
        "TRANSPARENT": "true",
    }
    return fetch_url(append_query_params(wms_url, params), "image/png")





def build_wms_get_legend_graphic_url(layer, layer_name, style_name=""):
    wms_url = configured_wms_service_url(layer)
    params = {
        "SERVICE": "WMS",
        "REQUEST": "GetLegendGraphic",
        "VERSION": wms_tile_version(layer),
        "FORMAT": "image/png",
        "LAYER": layer_name,
        "TRANSPARENT": "true",
    }
    if style_name:
        params["STYLE"] = style_name
    return append_query_params(wms_url, params)


def _ensure_wms_legend_payload(data, content_type):
    ctype = str(content_type or "").lower()
    sample = (data or b"").lstrip()[:200].lower()
    if not data:
        raise Http404("Légende WMS vide.")
    if ("xml" in ctype and "svg" not in ctype) or (sample.startswith(b"<") and b"<svg" not in sample):
        raise Http404("Le serveur WMS ne renvoie pas une image de légende exploitable.")
    return data, content_type or "image/png"


def fetch_wms_legend(layer, requested_layer="", style_name=""):
    wms_url = configured_wms_service_url(layer)
    selected_layers = selected_wms_layer_names(layer)
    if not wms_url or not selected_layers:
        raise Http404("WMS non configuré")

    layer_name = str(requested_layer or "").strip() or selected_layers[0]
    if layer_name not in selected_layers:
        raise Http404("Couche WMS non autorisée pour cette légende.")

    capabilities_url = append_query_params(wms_url, {
        "SERVICE": "WMS",
        "REQUEST": "GetCapabilities",
        "VERSION": wms_tile_version(layer),
    })
    try:
        capabilities_payload, _ = fetch_url(capabilities_url, "text/xml")
        legend_url = find_wms_capabilities_legend_url(capabilities_payload, layer_name, style_name)
        if legend_url:
            data, content_type = fetch_url(urljoin(wms_url, legend_url), "image/png")
            return _ensure_wms_legend_payload(data, content_type)
    except Http404:
        pass

    data, content_type = fetch_url(build_wms_get_legend_graphic_url(layer, layer_name, style_name), "image/png")
    return _ensure_wms_legend_payload(data, content_type)


def fetch_wfs_geojson(layer, bbox=None, limit=2500):
    if not layer.service_url or not layer.service_layers:
        raise Http404("WFS non configuré")

    version = wfs_version(layer)
    type_name_key = "typeNames" if version.startswith("2") else "typeName"
    params = {
        "SERVICE": "WFS",
        "REQUEST": "GetFeature",
        "VERSION": version,
        type_name_key: layer.service_layers,
        "OUTPUTFORMAT": "application/json",
        "SRSNAME": "EPSG:4326",
        "COUNT": str(limit),
        "MAXFEATURES": str(limit),
    }
    if bbox:
        west, south, east, north = bbox
        params["BBOX"] = f"{west:.6f},{south:.6f},{east:.6f},{north:.6f},EPSG:4326"

    data, content_type = fetch_url(append_query_params(layer.service_url, params), "application/json")
    if "json" not in str(content_type).lower() and not data.lstrip().startswith((b"{", b"[")):
        raise Http404("Le WFS ne renvoie pas de GeoJSON exploitable.")
    try:
        payload = json.loads(data.decode("utf-8"))
    except Exception as exc:
        raise Http404("Réponse WFS GeoJSON invalide.") from exc
    normalized, metadata_patch = normalize_geojson_for_leaflet(payload, layer.metadata or {})
    normalized["metadata"] = {
        **(normalized.get("metadata") or {}),
        **metadata_patch,
        "source_format": "wfs",
        "service_layers": layer.service_layers,
        "wfs_version": version,
    }
    return normalized

def _xml_local_name(tag):
    return str(tag or "").split("}", 1)[-1].lower()


def _xml_attribute(element, attr_name):
    wanted = str(attr_name or "").lower()
    for key, value in element.attrib.items():
        if _xml_local_name(key) == wanted:
            return str(value or "").strip()
    return ""


def _xml_child_elements(element, child_name):
    wanted = child_name.lower()
    return [child for child in list(element) if _xml_local_name(child.tag) == wanted]


def _xml_child_text(element, child_name):
    wanted = child_name.lower()
    for child in list(element):
        if _xml_local_name(child.tag) == wanted:
            return (child.text or "").strip()
    return ""


def _xml_child_texts(element, names):
    wanted = {name.lower() for name in names}
    values = []
    for child in list(element):
        if _xml_local_name(child.tag) in wanted:
            value = (child.text or "").strip()
            if value:
                values.append(value)
    return values


def _capability_label(name, title):
    title = str(title or "").strip()
    name = str(name or "").strip()
    return title if title and title != name else name


def _wms_style_legends(layer_element):
    styles = []
    for style_element in _xml_child_elements(layer_element, "Style"):
        style_name = _xml_child_text(style_element, "Name")
        style_title = _xml_child_text(style_element, "Title")
        legend_urls = []
        for legend_element in _xml_child_elements(style_element, "LegendURL"):
            href = ""
            for resource in _xml_child_elements(legend_element, "OnlineResource"):
                href = _xml_attribute(resource, "href")
                if href:
                    break
            if href:
                legend_urls.append({
                    "url": href,
                    "format": _xml_child_text(legend_element, "Format") or "image/png",
                    "width": legend_element.attrib.get("width") or "",
                    "height": legend_element.attrib.get("height") or "",
                })
        if style_name or style_title or legend_urls:
            styles.append({
                "name": style_name,
                "title": style_title or style_name,
                "label": _capability_label(style_name, style_title),
                "legend_urls": legend_urls,
            })
    return styles


def parse_wms_capabilities_layers(xml_payload):
    try:
        root = ET.fromstring(xml_payload)
    except ET.ParseError as exc:
        raise ValidationError({"capabilities": "Document GetCapabilities WMS invalide."}) from exc

    layers = []
    seen = set()
    for element in root.iter():
        if _xml_local_name(element.tag) != "layer":
            continue
        name = _xml_child_text(element, "Name")
        if not name or name in seen:
            continue
        title = _xml_child_text(element, "Title")
        crs_values = _xml_child_texts(element, {"CRS", "SRS"})
        styles = _wms_style_legends(element)
        default_legend = ""
        for style in styles:
            if style.get("legend_urls"):
                default_legend = style["legend_urls"][0].get("url") or ""
                if default_legend:
                    break
        layers.append({
            "name": name,
            "title": title or name,
            "label": _capability_label(name, title),
            "crs": crs_values,
            "styles": styles,
            "legend_url": default_legend,
        })
        seen.add(name)
    return layers


def find_wms_capabilities_legend_url(xml_payload, layer_name, style_name=""):
    requested_layer = str(layer_name or "").strip()
    requested_style = str(style_name or "").strip()
    if not requested_layer:
        return ""
    try:
        root = ET.fromstring(xml_payload)
    except ET.ParseError:
        return ""
    for element in root.iter():
        if _xml_local_name(element.tag) != "layer" or _xml_child_text(element, "Name") != requested_layer:
            continue
        styles = _wms_style_legends(element)
        if requested_style:
            styles = [style for style in styles if style.get("name") == requested_style]
        for style in styles:
            for legend in style.get("legend_urls") or []:
                legend_url = str(legend.get("url") or "").strip()
                if legend_url:
                    return legend_url
        return ""
    return ""



def parse_wfs_capabilities_layers(xml_payload):
    try:
        root = ET.fromstring(xml_payload)
    except ET.ParseError as exc:
        raise ValidationError({"capabilities": "Document GetCapabilities WFS invalide."}) from exc

    layers = []
    seen = set()
    for element in root.iter():
        if _xml_local_name(element.tag) != "featuretype":
            continue
        name = _xml_child_text(element, "Name")
        if not name or name in seen:
            continue
        title = _xml_child_text(element, "Title")
        crs_values = _xml_child_texts(element, {"DefaultSRS", "DefaultCRS", "OtherSRS", "OtherCRS", "SRS"})
        layers.append({
            "name": name,
            "title": title or name,
            "label": _capability_label(name, title),
            "crs": crs_values,
        })
        seen.add(name)
    return layers


def fetch_service_capabilities(service_type, service_url, version):
    service = str(service_type or "").strip().lower()
    if service not in {"wms", "wfs"}:
        raise ValidationError({"service_type": "Service GetCapabilities supporté : WMS ou WFS."})

    resolved_url = str(service_url or "").strip()
    if service == "wms" and not resolved_url:
        resolved_url = str(getattr(settings, "GEOSERVER_WMS_URL", "") or "").strip()
    if not resolved_url:
        raise ValidationError({"service_url": "URL du service obligatoire pour interroger GetCapabilities."})

    capability_version = str(version or ("1.3.0" if service == "wms" else "2.0.0")).strip()
    params = {
        "SERVICE": service.upper(),
        "REQUEST": "GetCapabilities",
        "VERSION": capability_version,
    }

    capabilities_url = append_query_params(resolved_url, params)

    try:
        data, content_type = fetch_url(capabilities_url, "text/xml")
    except Http404 as exc:
        message = str(exc) or "Service cartographique externe indisponible."
        raise ValidationError({
            "capabilities": message,
            "service_url": resolved_url,
            "capabilities_url": capabilities_url,
        }) from exc

    if not data.lstrip().startswith(b"<"):
        raise ValidationError({
            "capabilities": "Le service ne renvoie pas un document XML GetCapabilities.",
            "service_url": resolved_url,
            "capabilities_url": capabilities_url,
        })

    layers = parse_wms_capabilities_layers(data) if service == "wms" else parse_wfs_capabilities_layers(data)
    return {
        "service_type": service,
        "service_url_configured": True,
        "version": capability_version,
        "content_type": content_type,
        "layers": layers,
        "count": len(layers),
        "capabilities_url": capabilities_url,
    }


def parse_positive_int(value, default, maximum=None):
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    parsed = max(0, parsed)
    if maximum is not None:
        parsed = min(maximum, parsed)
    return parsed


class ClientMapLayerListView(generics.ListAPIView):
    serializer_class = ClientMapLayerListSerializer
    permission_classes = [HasClientScope]

    def get_queryset(self):
        if is_platform_admin(self.request.user):
            # Endpoint portail client : l’admin garde un accès technique au détail
            # mais ne reçoit pas toutes les couches privées par défaut.
            return ClientMapLayer.objects.none()
        return client_layer_queryset_for_user(self.request.user).filter(
            processing_status=ClientMapLayer.STATUS_READY,
            data_format__in=SUPPORTED_DATA_FORMATS,
        ).order_by("z_index", "name", "id")

    def list(self, request, *args, **kwargs):
        queryset = [layer for layer in self.get_queryset() if is_client_displayable_layer(layer)]
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


class ClientMapLayerDetailView(generics.RetrieveAPIView):
    serializer_class = ClientMapLayerListSerializer
    permission_classes = [HasClientScope]
    lookup_url_kwarg = "layer_id"

    def get_queryset(self):
        return client_layer_queryset_for_user(self.request.user).filter(
            processing_status=ClientMapLayer.STATUS_READY,
            data_format__in=SUPPORTED_DATA_FORMATS,
        )

    def get_object(self):
        layer = super().get_object()
        if not is_client_displayable_layer(layer):
            raise Http404(display_message_for(layer) or "Couche non disponible")
        return layer


class ClientMapLayerGeoJsonView(APIView):
    permission_classes = [HasClientScope]

    def get(self, request, layer_id):
        layer = client_layer(request, id=layer_id, processing_status=ClientMapLayer.STATUS_READY)
        service = service_for(layer)
        if service not in {"geojson", "wfs"}:
            raise Http404("Couche vectorielle introuvable")
        if not is_client_displayable_layer(layer):
            raise Http404(display_message_for(layer) or "Couche vectorielle non disponible")

        bbox = parse_wgs84_bbox(request.query_params.get("bbox"))
        limit = parse_positive_int(request.query_params.get("limit"), default=2500, maximum=20000)
        try:
            if is_database_layer(layer):
                normalized = build_db_geojson(layer, bbox=bbox, limit=limit)
                metadata_patch = normalized.get("metadata") or {}
            elif service == "wfs":
                normalized = fetch_wfs_geojson(layer, bbox=bbox, limit=limit)
                metadata_patch = normalized.get("metadata") or {}
            else:
                with layer.file.open("rb") as f:
                    raw_data = json.load(f)
                normalized, metadata_patch = normalize_geojson_for_leaflet(raw_data, layer.metadata or {})
        except ValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Http404:
            raise
        except Exception:
            return Response({"detail": "Impossible de lire la couche vectorielle."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        data = filter_feature_collection(normalized, bbox=bbox, limit=limit)
        data["metadata"] = {**metadata_patch, **(data.get("metadata") or {})}
        return private_headers(JsonResponse(data, safe=False))


class ClientMapLayerTileView(APIView):
    permission_classes = [HasClientScope]

    def get(self, request, layer_id, z, x, y):
        layer = client_layer(request, id=layer_id, processing_status=ClientMapLayer.STATUS_READY)
        if service_for(layer) != "wms":
            raise Http404("Seules les tuiles WMS sécurisées sont supportées par le portail client.")
        if not is_client_displayable_layer(layer):
            raise Http404(display_message_for(layer) or "WMS non disponible")
        data, ctype = fetch_wms_tile(layer, z, x, y)
        response = HttpResponse(data, content_type=ctype)
        response["Cache-Control"] = "private, max-age=300"
        response["Vary"] = "Authorization"
        return response


class ClientMapLayerLegendView(APIView):
    permission_classes = [HasClientScope]

    def get(self, request, layer_id):
        layer = client_layer(request, id=layer_id, processing_status=ClientMapLayer.STATUS_READY)
        if service_for(layer) != "wms":
            raise Http404("Seules les légendes WMS sont servies par ce proxy.")
        if not is_client_displayable_layer(layer):
            raise Http404(display_message_for(layer) or "WMS non disponible")
        data, ctype = fetch_wms_legend(
            layer,
            requested_layer=request.query_params.get("layer") or "",
            style_name=request.query_params.get("style") or "",
        )
        response = HttpResponse(data, content_type=ctype)
        response["Cache-Control"] = "private, max-age=600"
        response["Vary"] = "Authorization"
        return response


class AdminMapLayerListView(generics.ListAPIView):
    serializer_class = AdminMapLayerSerializer
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        qs = ClientMapLayer.objects.select_related("client").filter(data_format__in=SUPPORTED_DATA_FORMATS).order_by("-created_at", "-id")
        managed_ids = managed_client_ids_for_user(self.request.user)
        if managed_ids is not None:
            qs = qs.filter(client_id__in=managed_ids)
        client_id = self.request.query_params.get("client_id")
        client_code = (self.request.query_params.get("client_code") or self.request.query_params.get("organization_code") or "").strip()
        if client_id:
            return qs.filter(client_id=client_id)
        if client_code:
            return qs.filter(client__code__iexact=client_code)
        return qs



class AdminServiceCapabilitiesView(APIView):
    permission_classes = [IsAdminRole]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def post(self, request, client_id):
        client = get_object_or_404(Organization, id=client_id, organization_type="client")
        if not user_can_manage_client(request.user, client.id):
            raise Http404("Client introuvable dans votre périmètre.")

        service_type = str(request.data.get("service_type") or request.data.get("data_format") or "").strip().lower()
        service_url = str(request.data.get("service_url") or "").strip()
        version = str(request.data.get("version") or request.data.get("wms_version") or request.data.get("wfs_version") or "").strip()

        try:
            return Response(fetch_service_capabilities(service_type, service_url, version))
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)



class AdminPostgisTablesView(APIView):
    permission_classes = [IsAdminRole]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get(self, request, client_id):
        client = get_object_or_404(Organization, id=client_id, organization_type="client")
        if not user_can_manage_client(request.user, client.id):
            raise Http404("Client introuvable dans votre périmètre.")

        try:
            return Response(list_available_postgis_tables({key: request.query_params.get(key) for key in request.query_params.keys()}))
        except ValidationError as exc:
            return Response(exc.detail, status=status.HTTP_400_BAD_REQUEST)


class AdminPostgisLayerPreviewView(APIView):
    permission_classes = [IsAdminRole]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def post(self, request, client_id):
        client = get_object_or_404(Organization, id=client_id, organization_type="client")
        if not user_can_manage_client(request.user, client.id):
            raise Http404("Client introuvable dans votre périmètre.")
        try:
            options = normalize_postgis_options({key: request.data.get(key) for key in request.data.keys()})
            metadata = inspect_postgis_table_metadata(options)
        except ValidationError as exc:
            raise exc
        return Response(metadata)


class AdminWfsLayerPreviewView(APIView):
    permission_classes = [IsAdminRole]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def post(self, request, client_id):
        client = get_object_or_404(Organization, id=client_id, organization_type="client")
        if not user_can_manage_client(request.user, client.id):
            raise Http404("Client introuvable dans votre périmètre.")

        service_url = str(request.data.get("service_url") or "").strip()
        service_layers = str(request.data.get("service_layers") or "").strip()
        version = str(request.data.get("wfs_version") or "2.0.0").strip()
        limit = parse_positive_int(request.data.get("limit"), default=5000, maximum=getattr(settings, "MAX_WFS_IMPORT_FEATURES", 20000))

        metadata = validate_layer_payload(
            ClientMapLayer.LAYER_WFS,
            ClientMapLayer.FORMAT_WFS,
            service_url=service_url,
            service_layers=service_layers,
            wfs_version=version,
        )
        preview_layer = ClientMapLayer(
            client=client,
            name="Aperçu WFS",
            layer_type=ClientMapLayer.LAYER_WFS,
            data_format=ClientMapLayer.FORMAT_WFS,
            source_kind=ClientMapLayer.SOURCE_DATABASE,
            service_url=service_url,
            service_layers=service_layers,
            metadata={**metadata, "wfs_version": version},
        )
        try:
            normalized = fetch_wfs_geojson(preview_layer, bbox=None, limit=limit)
        except Http404 as exc:
            raise ValidationError({"wfs": str(exc)}) from exc
        preview_metadata = normalized.get("metadata") or {}
        return Response({**preview_metadata, "preview": True, "sample_limit": limit})


class AdminClientMapLayerCreateView(generics.CreateAPIView):
    serializer_class = MapLayerCreateSerializer
    permission_classes = [IsAdminRole]
    parser_classes = [MultiPartParser, FormParser]

    def perform_create(self, serializer):
        client = get_object_or_404(Organization, id=self.kwargs["client_id"], organization_type="client")
        if not user_can_manage_client(self.request.user, client.id):
            raise Http404("Client introuvable dans votre périmètre.")
        self.created_layer = serializer.save(client=client, uploaded_by=self.request.user)
        notify_layer_available(self.created_layer, action="created")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(AdminMapLayerSerializer(self.created_layer, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)


class AdminMapLayerUpdateDeleteView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAdminRole]

    def get_queryset(self):
        qs = ClientMapLayer.objects.select_related("client").filter(data_format__in=SUPPORTED_DATA_FORMATS)
        managed_ids = managed_client_ids_for_user(self.request.user)
        if managed_ids is not None:
            qs = qs.filter(client_id__in=managed_ids)
        return qs

    def get_serializer_class(self):
        return MapLayerUpdateSerializer if self.request.method in {"PATCH", "PUT"} else AdminMapLayerSerializer

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        was_client_visible = is_client_displayable_layer(instance)
        serializer = MapLayerUpdateSerializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        layer = serializer.save()
        is_client_visible = is_client_displayable_layer(layer)
        if not was_client_visible and is_client_visible:
            notify_layer_available(layer, action="activated")
        return Response(AdminMapLayerSerializer(layer, context=self.get_serializer_context()).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        layer = self.get_object()
        notify_deleted = is_client_displayable_layer(layer)
        if layer.file:
            layer.file.delete(save=False)
        tile_root = Path(getattr(settings, "PRIVATE_MAP_LAYERS_ROOT", settings.BASE_DIR / "private_media" / "map_layers")) / f"client-{layer.client_id}" / "tiles" / str(layer.id)
        if notify_deleted:
            notify_layer_available(layer, action="deleted")
        if tile_root.exists():
            shutil.rmtree(tile_root, ignore_errors=True)
        layer.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
