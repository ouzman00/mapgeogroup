import json
import sqlite3
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from client_map_layers.models import ClientMapLayer
from client_map_layers.geojson_utils import normalize_geojson_for_leaflet
from client_map_layers.serializers import ClientMapLayerListSerializer, is_client_displayable_layer
from client_map_layers.views import fetch_wms_tile
from organizations.models import Organization, OrganizationMembership

from client_map_layers.validators import validate_geojson_upload, validate_layer_payload


class ClientMapLayerPrivateSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Client A", code="CLIENT_A_MAP", organization_type="client")
        self.org_b = Organization.objects.create(name="Client B", code="CLIENT_B_MAP", organization_type="client")
        self.client_a = User.objects.create_user(username="map-client-a", password="pass12345", role="client", client=self.org_a, client_code="CLIENT_A_MAP")
        self.client_b = User.objects.create_user(username="map-client-b", password="pass12345", role="client", client=self.org_b, client_code="CLIENT_B_MAP")
        self.admin = User.objects.create_user(username="map-admin", password="pass12345", role="admin")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True)
        self.layer_a = ClientMapLayer.objects.create(
            client=self.org_a,
            name="Couche privée A",
            layer_type=ClientMapLayer.LAYER_GEOJSON,
            data_format=ClientMapLayer.FORMAT_GEOJSON,
            file=SimpleUploadedFile("layer-a.geojson", b'{"type":"FeatureCollection","features":[]}'),
            service_url="https://tiles.example.test/private-token",
            tile_url="https://tiles.example.test/{z}/{x}/{y}.png?token=secret",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
        )

    def test_client_b_cannot_access_client_a_private_layer(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/map-layers/{self.layer_a.id}/geojson/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_anonymous_user_receives_401_on_private_layer(self):
        response = self.client.get("/api/map-layers/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_client_cannot_call_admin_map_layer_route(self):
        self.client.force_authenticate(self.client_a)
        response = self.client.get("/api/admin/map-layers/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_client_serializer_never_returns_sensitive_urls(self):
        data = ClientMapLayerListSerializer(self.layer_a).data
        self.assertNotIn("service_url", data)
        self.assertNotIn("tile_url", data)

    def test_client_api_never_returns_sensitive_urls(self):
        self.client.force_authenticate(self.client_a)
        response = self.client.get("/api/map-layers/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data["results"][0] if isinstance(response.data, dict) and "results" in response.data else response.data[0]
        self.assertNotIn("service_url", payload)
        self.assertNotIn("tile_url", payload)
        self.assertIn("tile_endpoint", payload)


class ClientMapLayerFileValidationTests(APITestCase):
    def test_rejects_invalid_geotiff_signature(self):
        file = SimpleUploadedFile("raster.tif", b"not tiff", content_type="image/tiff")
        with self.assertRaises(Exception):
            validate_layer_payload(ClientMapLayer.LAYER_ORTHOPHOTO, ClientMapLayer.FORMAT_GEOTIFF, uploaded_file=file)

    def test_rejects_xyz_without_tile_template(self):
        with self.assertRaises(Exception):
            validate_layer_payload(ClientMapLayer.LAYER_TILES, ClientMapLayer.FORMAT_XYZ, uploaded_file=None, tile_url="https://tiles.example.com/static.png")

    def test_rejects_wms_private_url(self):
        with self.assertRaises(Exception):
            validate_layer_payload(ClientMapLayer.LAYER_WMS, ClientMapLayer.FORMAT_WMS, uploaded_file=None, service_url="http://127.0.0.1/wms", service_layers="private")

    def test_rejects_invalid_mbtiles(self):
        file = SimpleUploadedFile("bad.mbtiles", b"not sqlite", content_type="application/octet-stream")
        with self.assertRaises(Exception):
            validate_layer_payload(ClientMapLayer.LAYER_TILES, ClientMapLayer.FORMAT_MBTILES, uploaded_file=file)

    def test_rejects_projected_geojson_without_explicit_crs(self):
        payload = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [230000, 1627000]},
            "properties": {},
        }
        file = SimpleUploadedFile("projected.geojson", json.dumps(payload).encode("utf-8"), content_type="application/geo+json")
        with self.assertRaises(Exception):
            validate_geojson_upload(file)

    def test_accepts_and_reprojects_geojson_with_explicit_epsg_32628(self):
        payload = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [230000, 1627000]},
            "properties": {},
        }
        normalized, metadata = normalize_geojson_for_leaflet(payload, source_crs="EPSG:32628")
        lon, lat = normalized["features"][0]["geometry"]["coordinates"]
        self.assertTrue(-180 <= lon <= 180)
        self.assertTrue(-90 <= lat <= 90)
        self.assertEqual(metadata["source_crs"], "EPSG:32628")
        self.assertEqual(metadata["display_crs"], "EPSG:4326")

    def test_accepts_plain_wgs84_geojson_without_crs(self):
        payload = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [-17.4, 14.7]},
            "properties": {},
        }
        file = SimpleUploadedFile("wgs84.geojson", json.dumps(payload).encode("utf-8"), content_type="application/geo+json")
        metadata = validate_geojson_upload(file)
        self.assertEqual(metadata["source_crs"], "EPSG:4326")
        self.assertEqual(metadata["crs_source"], "wgs84_coordinates")

    def test_geotiff_with_explicit_crs_stores_metadata_but_not_tiles(self):
        bounds = {"south": 14.6, "west": -17.5, "north": 14.8, "east": -17.3}
        file = SimpleUploadedFile("raster.tif", b"II*\x00" + b"\x00" * 128, content_type="image/tiff")
        metadata = validate_layer_payload(
            ClientMapLayer.LAYER_ORTHOPHOTO,
            ClientMapLayer.FORMAT_GEOTIFF,
            uploaded_file=file,
            bounds=bounds,
            source_crs="EPSG:4326",
        )
        self.assertEqual(metadata["source_crs"], "EPSG:4326")
        self.assertEqual(metadata["tile_crs"], "EPSG:3857")
        self.assertEqual(metadata["bounds_wgs84"], bounds)
        self.assertTrue(metadata["requires_tiling"])
        self.assertFalse(metadata["tiles_ready"])
        self.assertEqual(metadata["processing_status"], ClientMapLayer.STATUS_PENDING)
        self.assertEqual(metadata["raster_processing"]["phase"], "metadata_only")

    def test_geotiff_without_crs_marks_needs_crs_metadata(self):
        file = SimpleUploadedFile("raster.tif", b"II*\x00" + b"\x00" * 128, content_type="image/tiff")
        metadata = validate_layer_payload(ClientMapLayer.LAYER_ORTHOPHOTO, ClientMapLayer.FORMAT_GEOTIFF, uploaded_file=file)
        self.assertTrue(metadata["needs_crs"])
        self.assertEqual(metadata["processing_status"], ClientMapLayer.STATUS_FAILED)
        self.assertEqual(metadata["processing_error"], ClientMapLayer.CRS_REQUIRED_MESSAGE)
        self.assertFalse(metadata["tiles_ready"])

    def _mbtiles_file(self, fmt="png"):
        with tempfile.NamedTemporaryFile(suffix=".mbtiles") as tmp:
            with sqlite3.connect(tmp.name) as conn:
                conn.execute("CREATE TABLE metadata (name text, value text)")
                conn.execute("CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob)")
                conn.execute("INSERT INTO metadata (name, value) VALUES ('format', ?)", (fmt,))
                conn.execute("INSERT INTO tiles VALUES (0, 0, 0, ?)", (b"tile",))
                conn.commit()
            tmp.seek(0)
            return SimpleUploadedFile(f"{fmt}.mbtiles", tmp.read(), content_type="application/octet-stream")

    def test_rejects_vector_mbtiles(self):
        with self.assertRaises(Exception):
            validate_layer_payload(ClientMapLayer.LAYER_TILES, ClientMapLayer.FORMAT_MBTILES, uploaded_file=self._mbtiles_file("pbf"))

    def test_accepts_raster_mbtiles(self):
        metadata = validate_layer_payload(ClientMapLayer.LAYER_TILES, ClientMapLayer.FORMAT_MBTILES, uploaded_file=self._mbtiles_file("png"))
        self.assertEqual(metadata["mbtiles_format"], "png")
        self.assertTrue(metadata["tiles_ready"])


class ClientMapLayerDisplayPipelineTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Client Pipeline", code="PIPELINE_CLIENT", organization_type="client")
        self.client_user = User.objects.create_user(
            username="pipeline-client",
            password="pass12345",
            role="client",
            client=self.org,
            client_code="PIPELINE_CLIENT",
        )
        self.admin = User.objects.create_user(username="pipeline-admin", password="pass12345", role="admin")
        OrganizationMembership.objects.create(organization=self.org, user=self.client_user, role="owner", is_primary=True)

    def _client_layer_ids(self):
        self.client.force_authenticate(self.client_user)
        response = self.client.get("/api/map-layers/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        return {item["id"] for item in payload}

    def test_geotiff_upload_without_crs_is_failed_and_not_client_visible(self):
        self.client.force_authenticate(self.admin)
        file = SimpleUploadedFile("orthophoto.tif", b"II*\x00" + b"\x00" * 64, content_type="image/tiff")
        response = self.client.post(
            f"/api/admin/clients/{self.org.id}/map-layers/",
            {
                "name": "Orthophoto GeoTIFF",
                "layer_type": ClientMapLayer.LAYER_ORTHOPHOTO,
                "data_format": ClientMapLayer.FORMAT_GEOTIFF,
                "file": file,
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["processing_status"], ClientMapLayer.STATUS_FAILED)
        self.assertEqual(response.data["display_message"], ClientMapLayer.CRS_REQUIRED_MESSAGE)
        self.assertTrue(response.data["requires_tiling"])

        layer_id = response.data["id"]
        self.assertNotIn(layer_id, self._client_layer_ids())

    def test_ready_geotiff_without_generated_tiles_is_not_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="GeoTIFF marqué prêt sans tuiles",
            layer_type=ClientMapLayer.LAYER_ORTHOPHOTO,
            data_format=ClientMapLayer.FORMAT_GEOTIFF,
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"requires_tiling": True},
        )
        self.assertNotIn(layer.id, self._client_layer_ids())

    def test_ready_geotiff_with_tiles_ready_but_no_real_tiles_is_not_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="GeoTIFF tuilé",
            layer_type=ClientMapLayer.LAYER_ORTHOPHOTO,
            data_format=ClientMapLayer.FORMAT_GEOTIFF,
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"requires_tiling": True, "tiles_ready": True},
        )
        self.assertNotIn(layer.id, self._client_layer_ids())

    def test_ready_geotiff_with_real_generated_tiles_is_client_visible(self):
        with tempfile.TemporaryDirectory() as tmpdir, self.settings(PRIVATE_MAP_LAYERS_ROOT=Path(tmpdir)):
            layer = ClientMapLayer.objects.create(
                client=self.org,
                name="GeoTIFF réellement tuilé",
                layer_type=ClientMapLayer.LAYER_ORTHOPHOTO,
                data_format=ClientMapLayer.FORMAT_GEOTIFF,
                processing_status=ClientMapLayer.STATUS_READY,
                is_active=True,
                metadata={"requires_tiling": True, "tiles_ready": True, "tile_crs": "EPSG:3857"},
            )
            tile = Path(tmpdir) / f"client-{self.org.id}" / "tiles" / str(layer.id) / "0" / "0" / "0.png"
            tile.parent.mkdir(parents=True, exist_ok=True)
            tile.write_bytes(b"\x89PNG\r\n\x1a\n")

            self.assertTrue(is_client_displayable_layer(layer))
            self.assertIn(layer.id, self._client_layer_ids())

    def test_ready_geotiff_with_tile_url_but_tiles_not_ready_is_not_displayable(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="GeoTIFF URL prématurée",
            layer_type=ClientMapLayer.LAYER_ORTHOPHOTO,
            data_format=ClientMapLayer.FORMAT_GEOTIFF,
            tile_url="https://tiles.example.com/{z}/{x}/{y}.png",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"requires_tiling": True, "tiles_ready": False},
        )
        self.assertFalse(is_client_displayable_layer(layer))
        self.assertNotIn(layer.id, self._client_layer_ids())

    def test_failed_geotiff_is_not_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="GeoTIFF échoué",
            layer_type=ClientMapLayer.LAYER_ORTHOPHOTO,
            data_format=ClientMapLayer.FORMAT_GEOTIFF,
            processing_status=ClientMapLayer.STATUS_FAILED,
            processing_error="CRS source manquant.",
            is_active=True,
            metadata={"requires_tiling": True, "tiles_ready": False, "processing_error": "CRS source manquant."},
        )
        self.assertFalse(is_client_displayable_layer(layer))
        self.assertNotIn(layer.id, self._client_layer_ids())

    def test_geotiff_with_bounds_but_without_tiles_is_not_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="GeoTIFF borné sans tuiles",
            layer_type=ClientMapLayer.LAYER_ORTHOPHOTO,
            data_format=ClientMapLayer.FORMAT_GEOTIFF,
            bounds={"south": 14.6, "west": -17.5, "north": 14.8, "east": -17.3},
            processing_status=ClientMapLayer.STATUS_PENDING,
            is_active=True,
            metadata={
                "requires_tiling": True,
                "tiles_ready": False,
                "bounds_wgs84": {"south": 14.6, "west": -17.5, "north": 14.8, "east": -17.3},
            },
        )
        self.assertFalse(is_client_displayable_layer(layer))
        self.assertNotIn(layer.id, self._client_layer_ids())

    def test_wms_without_service_layers_is_not_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="WMS incomplet",
            layer_type=ClientMapLayer.LAYER_WMS,
            data_format=ClientMapLayer.FORMAT_WMS,
            service_url="https://wms.example.com/service",
            service_layers="",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
        )
        self.assertNotIn(layer.id, self._client_layer_ids())

    def test_xyz_without_tile_template_is_not_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="XYZ incomplet",
            layer_type=ClientMapLayer.LAYER_TILES,
            data_format=ClientMapLayer.FORMAT_XYZ,
            tile_url="https://tiles.example.com/static.png",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
        )
        self.assertNotIn(layer.id, self._client_layer_ids())

    def test_vector_mbtiles_is_not_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="MBTiles vectoriel",
            layer_type=ClientMapLayer.LAYER_TILES,
            data_format=ClientMapLayer.FORMAT_MBTILES,
            file=SimpleUploadedFile("vector.mbtiles", b"placeholder"),
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"mbtiles_format": "pbf", "tiles_ready": True},
        )
        self.assertFalse(is_client_displayable_layer(layer))
        self.assertNotIn(layer.id, self._client_layer_ids())

    def test_raster_mbtiles_is_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="MBTiles raster",
            layer_type=ClientMapLayer.LAYER_TILES,
            data_format=ClientMapLayer.FORMAT_MBTILES,
            file=SimpleUploadedFile("raster.mbtiles", b"placeholder"),
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"mbtiles_format": "png", "tiles_ready": True},
        )
        self.assertTrue(is_client_displayable_layer(layer))
        self.assertIn(layer.id, self._client_layer_ids())

    def test_wms_legacy_defaults_still_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="WMS legacy",
            layer_type=ClientMapLayer.LAYER_WMS,
            data_format=ClientMapLayer.FORMAT_WMS,
            service_url="https://wms.example.com/service",
            service_layers="public_layer",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={},
        )
        self.assertTrue(is_client_displayable_layer(layer))
        self.assertIn(layer.id, self._client_layer_ids())

    def test_wms_metadata_version_and_crs_are_used_for_proxy_request(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="WMS 1.1.1",
            layer_type=ClientMapLayer.LAYER_WMS,
            data_format=ClientMapLayer.FORMAT_WMS,
            service_url="https://wms.example.com/service",
            service_layers="public_layer",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"wms_version": "1.1.1", "wms_crs": "EPSG:3857"},
        )
        with patch("client_map_layers.views.fetch_url", return_value=(b"ok", "image/png")) as mocked_fetch:
            fetch_wms_tile(layer, 0, 0, 0)
        called_url = mocked_fetch.call_args.args[0]
        query = parse_qs(urlparse(called_url).query)
        self.assertEqual(query["VERSION"][0], "1.1.1")
        self.assertEqual(query["SRS"][0], "EPSG:3857")

    def test_wms_unsupported_crs_is_not_client_visible(self):
        layer = ClientMapLayer.objects.create(
            client=self.org,
            name="WMS EPSG4326",
            layer_type=ClientMapLayer.LAYER_WMS,
            data_format=ClientMapLayer.FORMAT_WMS,
            service_url="https://wms.example.com/service",
            service_layers="public_layer",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"wms_version": "1.3.0", "wms_crs": "EPSG:4326"},
        )
        self.assertFalse(is_client_displayable_layer(layer))
        self.assertNotIn(layer.id, self._client_layer_ids())


class ClientMapLayerExpandedLeakageSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Tenant Map A", code="TENANT_MAP_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Tenant Map B", code="TENANT_MAP_B", organization_type="client")
        self.client_a = User.objects.create_user(username="map-leak-client-a", password="pass12345", role="client", client=self.org_a, client_code="TENANT_MAP_A")
        self.client_b = User.objects.create_user(username="map-leak-client-b", password="pass12345", role="client", client=self.org_b, client_code="TENANT_MAP_B")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True, is_active=True)
        self.geojson_layer_a = ClientMapLayer.objects.create(
            client=self.org_a,
            name="Map GeoJSON A",
            layer_type=ClientMapLayer.LAYER_GEOJSON,
            data_format=ClientMapLayer.FORMAT_GEOJSON,
            file=SimpleUploadedFile("map-a.geojson", b'{"type":"FeatureCollection","features":[]}'),
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"geometry_types": {}, "private_path": "/srv/private/map-a.geojson"},
        )
        self.image_layer_a = ClientMapLayer.objects.create(
            client=self.org_a,
            name="Image A",
            layer_type=ClientMapLayer.LAYER_ORTHOPHOTO,
            data_format=ClientMapLayer.FORMAT_PNG,
            file=SimpleUploadedFile("image-a.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, content_type="image/png"),
            bounds={"west": -17.5, "south": 14.6, "east": -17.3, "north": 14.8},
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
        )
        self.tile_layer_a = ClientMapLayer.objects.create(
            client=self.org_a,
            name="Tiles A",
            layer_type=ClientMapLayer.LAYER_TILES,
            data_format=ClientMapLayer.FORMAT_XYZ,
            tile_url="https://tiles.example.com/{z}/{x}/{y}.png?token=secret",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={
                "tiles_ready": True,
                "tiles_path": "client-1/layer-1/private",
                "tile_url": "https://tiles.example.com/{z}/{x}/{y}.png?token=secret",
            },
        )

    def test_client_b_cannot_list_client_a_map_layers(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get("/api/map-layers/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        returned_ids = {item["id"] for item in payload}
        self.assertNotIn(self.geojson_layer_a.id, returned_ids)
        self.assertNotIn(self.image_layer_a.id, returned_ids)
        self.assertNotIn(self.tile_layer_a.id, returned_ids)

    def test_client_b_cannot_retrieve_client_a_map_layer_detail(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/map-layers/{self.geojson_layer_a.id}/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_client_b_cannot_access_client_a_map_layer_geojson(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/map-layers/{self.geojson_layer_a.id}/geojson/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_client_b_cannot_access_client_a_map_layer_image(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/map-layers/{self.image_layer_a.id}/image/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_client_b_cannot_access_client_a_map_layer_tile(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/map-layers/{self.tile_layer_a.id}/tiles/0/0/0/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_anonymous_user_receives_401_on_map_layer_private_routes(self):
        urls = [
            "/api/map-layers/",
            f"/api/map-layers/{self.geojson_layer_a.id}/",
            f"/api/map-layers/{self.geojson_layer_a.id}/geojson/",
            f"/api/map-layers/{self.image_layer_a.id}/image/",
            f"/api/map-layers/{self.tile_layer_a.id}/tiles/0/0/0/",
        ]
        for url in urls:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_client_cannot_call_map_layer_admin_routes(self):
        self.client.force_authenticate(self.client_a)
        list_response = self.client.get("/api/admin/map-layers/")
        create_response = self.client.post(f"/api/admin/clients/{self.org_a.id}/map-layers/", {}, format="multipart")
        detail_response = self.client.get(f"/api/admin/map-layers/{self.geojson_layer_a.id}/")
        self.assertEqual(list_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(create_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(detail_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_client_map_layer_serializer_does_not_expose_sensitive_fields(self):
        data = ClientMapLayerListSerializer(self.tile_layer_a).data
        self.assertNotIn("service_url", data)
        self.assertNotIn("tile_url", data)
        self.assertNotIn("file", data)
        self.assertNotIn("original_filename", data)
        self.assertNotIn("service_url", data.get("metadata", {}))
        self.assertNotIn("tile_url", data.get("metadata", {}))
        self.assertNotIn("tiles_path", data.get("metadata", {}))

    def test_client_map_layer_api_does_not_expose_sensitive_fields(self):
        self.client.force_authenticate(self.client_a)
        response = self.client.get("/api/map-layers/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        serialized = {item["id"]: item for item in payload}
        data = serialized[self.tile_layer_a.id]
        self.assertNotIn("service_url", data)
        self.assertNotIn("tile_url", data)
        self.assertNotIn("file", data)
        self.assertNotIn("original_filename", data)
        self.assertNotIn("service_url", data.get("metadata", {}))
        self.assertNotIn("tile_url", data.get("metadata", {}))
        self.assertNotIn("tiles_path", data.get("metadata", {}))


@override_settings(EXTERNAL_MAP_PROXY_ALLOWED_HOSTS=["example.com", "tiles.example.com", "wms.example.com"])
class ClientMapLayerManagerScopedPermissionTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Manager Map A", code="MANAGER_MAP_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Manager Map B", code="MANAGER_MAP_B", organization_type="client")
        self.manager = User.objects.create_user(username="map-layer-manager", password="pass12345", role="manager")
        self.client_a = User.objects.create_user(username="map-layer-manager-client-a", password="pass12345", role="client", client=self.org_a, client_code="MANAGER_MAP_A")
        self.client_b = User.objects.create_user(username="map-layer-manager-client-b", password="pass12345", role="client", client=self.org_b, client_code="MANAGER_MAP_B")

        OrganizationMembership.objects.create(organization=self.org_a, user=self.manager, role="manager", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True, is_active=True)

        self.layer_a = ClientMapLayer.objects.create(
            client=self.org_a,
            name="Map layer A",
            layer_type=ClientMapLayer.LAYER_WMS,
            data_format=ClientMapLayer.FORMAT_WMS,
            service_url="https://example.com/wms?token=secret-a",
            tile_url="https://tiles.example.com/{z}/{x}/{y}.png?token=secret-a",
            service_layers="a",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"tiles_path": "client-a/private", "private_path": "/srv/private/map/a"},
        )
        self.layer_b = ClientMapLayer.objects.create(
            client=self.org_b,
            name="Map layer B",
            layer_type=ClientMapLayer.LAYER_WMS,
            data_format=ClientMapLayer.FORMAT_WMS,
            service_url="https://example.com/wms?token=secret-b",
            tile_url="https://tiles.example.com/{z}/{x}/{y}.png?token=secret-b",
            service_layers="b",
            processing_status=ClientMapLayer.STATUS_READY,
            is_active=True,
            metadata={"tiles_path": "client-b/private", "private_path": "/srv/private/map/b"},
        )

    def test_manager_lists_only_map_layers_in_managed_organizations(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get("/api/admin/map-layers/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        returned_ids = {item["id"] for item in payload}
        self.assertIn(self.layer_a.id, returned_ids)
        self.assertNotIn(self.layer_b.id, returned_ids)

    def test_manager_can_create_map_layer_for_managed_client(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/admin/clients/{self.org_a.id}/map-layers/",
            {
                "name": "WMS manager",
                "layer_type": ClientMapLayer.LAYER_WMS,
                "data_format": ClientMapLayer.FORMAT_WMS,
                "service_url": "https://example.com/wms",
                "service_layers": "public_layer",
                "is_active": "true",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["client_id"], self.org_a.id)
        self.assertEqual(response.data.get("service_url"), "")

    def test_manager_cannot_create_map_layer_for_unmanaged_client(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/admin/clients/{self.org_b.id}/map-layers/",
            {
                "name": "WMS hors périmètre",
                "layer_type": ClientMapLayer.LAYER_WMS,
                "data_format": ClientMapLayer.FORMAT_WMS,
                "service_url": "https://example.com/wms",
                "service_layers": "blocked",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_manager_can_update_and_delete_map_layer_in_scope_only(self):
        self.client.force_authenticate(self.manager)
        update_a = self.client.patch(f"/api/admin/map-layers/{self.layer_a.id}/", {"name": "Map A modifiée"}, format="json")
        update_b = self.client.patch(f"/api/admin/map-layers/{self.layer_b.id}/", {"name": "Map B interdite"}, format="json")
        self.assertEqual(update_a.status_code, status.HTTP_200_OK, update_a.data)
        self.assertEqual(update_b.status_code, status.HTTP_404_NOT_FOUND)

        delete_b = self.client.delete(f"/api/admin/map-layers/{self.layer_b.id}/")
        self.assertEqual(delete_b.status_code, status.HTTP_404_NOT_FOUND)

    def test_manager_admin_map_layer_response_masks_sensitive_fields(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(f"/api/admin/map-layers/{self.layer_a.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data.get("service_url"), "")
        self.assertEqual(response.data.get("tile_url"), "")

        metadata = response.data.get("metadata", {})
        self.assertNotIn("tiles_path", metadata)
        self.assertNotIn("private_path", metadata)

    def test_client_still_cannot_call_map_layer_admin_routes_after_manager_opening(self):
        self.client.force_authenticate(self.client_a)
        response = self.client.get("/api/admin/map-layers/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_geotiff_metadata_tiles_ready_and_tile_url_are_not_enough(self):
        layer = ClientMapLayer.objects.create(
            client=self.org_a,
            name="Raster sans tuiles réelles",
            layer_type=ClientMapLayer.LAYER_ORTHOPHOTO,
            data_format=ClientMapLayer.FORMAT_GEOTIFF,
            tile_url="https://tiles.example.test/{z}/{x}/{y}.png",
            processing_status=ClientMapLayer.STATUS_READY,
            metadata={"requires_tiling": True, "tiles_ready": True},
        )

        self.assertFalse(is_client_displayable_layer(layer))

