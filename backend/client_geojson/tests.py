from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings

from .validators import validate_geojson_upload


class GeoJsonFileValidationTests(SimpleTestCase):
    def test_rejects_invalid_coordinates(self):
        payload = b'{"type":"Feature","geometry":{"type":"Point","coordinates":[999,999]},"properties":{}}'
        file = SimpleUploadedFile("bad.geojson", payload, content_type="application/geo+json")
        with self.assertRaises(Exception):
            validate_geojson_upload(file)

    @override_settings(MAX_GEOJSON_FEATURES=1)
    def test_rejects_too_many_features(self):
        payload = b'{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}},{"type":"Feature","geometry":{"type":"Point","coordinates":[1,1]},"properties":{}}]}'
        file = SimpleUploadedFile("too-many.geojson", payload, content_type="application/geo+json")
        with self.assertRaises(Exception):
            validate_geojson_upload(file)

    @override_settings(MAX_GEOJSON_PROPERTY_BYTES=10)
    def test_rejects_large_properties(self):
        payload = b'{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{"description":"very long value"}}'
        file = SimpleUploadedFile("large-props.geojson", payload, content_type="application/geo+json")
        with self.assertRaises(Exception):
            validate_geojson_upload(file)

    def test_accepts_valid_geojson(self):
        payload = b'{"type":"Feature","geometry":{"type":"Point","coordinates":[-17.4,14.7]},"properties":{"name":"ok"}}'
        file = SimpleUploadedFile("ok.geojson", payload, content_type="application/geo+json")
        metadata = validate_geojson_upload(file)
        self.assertEqual(metadata["feature_count"], 1)

    def test_rejects_projected_geojson_without_crs(self):
        payload = b'{"type":"Feature","geometry":{"type":"Point","coordinates":[230000,1627000]},"properties":{}}'
        file = SimpleUploadedFile("projected.geojson", payload, content_type="application/geo+json")
        with self.assertRaises(Exception):
            validate_geojson_upload(file)

from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from client_geojson.models import GeoJsonLayer
from client_geojson.serializers import GeoJsonLayerListSerializer
from organizations.models import Organization, OrganizationMembership


class GeoJsonClientLeakageSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Tenant GeoJSON A", code="TENANT_GEOJSON_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Tenant GeoJSON B", code="TENANT_GEOJSON_B", organization_type="client")
        self.client_a = User.objects.create_user(username="geojson-leak-client-a", password="pass12345", role="client", client=self.org_a, client_code="TENANT_GEOJSON_A")
        self.client_b = User.objects.create_user(username="geojson-leak-client-b", password="pass12345", role="client", client=self.org_b, client_code="TENANT_GEOJSON_B")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True, is_active=True)
        self.layer_a = GeoJsonLayer.objects.create(
            client=self.org_a,
            name="GeoJSON privé A",
            layer_type=GeoJsonLayer.TYPE_AUTRE,
            file=SimpleUploadedFile(
                "geojson-a.geojson",
                b'{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[-17.4,14.7]},"properties":{}}]}',
                content_type="application/geo+json",
            ),
            is_active=True,
            metadata={
                "feature_count": 1,
                "geometry_types": {"Point": 1},
                "private_path": "/srv/private_media/geojson/client-a/secret.geojson",
                "tiles_path": "client-a/private/tiles",
            },
        )

    def test_client_b_cannot_list_client_a_geojson_layer(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get("/api/geojson-layers/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        self.assertNotIn(self.layer_a.id, {item["id"] for item in payload})

    def test_client_b_cannot_retrieve_client_a_geojson_content(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/geojson-layers/{self.layer_a.id}/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_anonymous_user_receives_401_on_geojson_client_routes(self):
        list_response = self.client.get("/api/geojson-layers/")
        detail_response = self.client.get(f"/api/geojson-layers/{self.layer_a.id}/")
        self.assertEqual(list_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(detail_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_client_cannot_call_geojson_admin_routes(self):
        self.client.force_authenticate(self.client_a)
        list_response = self.client.get("/api/admin/geojson-layers/")
        create_response = self.client.post(f"/api/admin/clients/{self.org_a.id}/geojson-layers/", {}, format="multipart")
        detail_response = self.client.get(f"/api/admin/geojson-layers/{self.layer_a.id}/")
        self.assertEqual(list_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(create_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(detail_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_client_geojson_serializer_does_not_expose_private_paths(self):
        data = GeoJsonLayerListSerializer(self.layer_a).data
        self.assertNotIn("file", data)
        self.assertNotIn("original_filename", data)
        self.assertNotIn("private_path", data.get("metadata", {}))
        self.assertNotIn("tiles_path", data.get("metadata", {}))


class GeoJsonManagerScopedPermissionTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Manager GeoJSON A", code="MANAGER_GEOJSON_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Manager GeoJSON B", code="MANAGER_GEOJSON_B", organization_type="client")
        self.manager = User.objects.create_user(username="geojson-manager", password="pass12345", role="manager")
        self.client_a = User.objects.create_user(username="geojson-manager-client-a", password="pass12345", role="client", client=self.org_a, client_code="MANAGER_GEOJSON_A")
        self.client_b = User.objects.create_user(username="geojson-manager-client-b", password="pass12345", role="client", client=self.org_b, client_code="MANAGER_GEOJSON_B")

        OrganizationMembership.objects.create(organization=self.org_a, user=self.manager, role="manager", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True, is_active=True)

        self.layer_a = GeoJsonLayer.objects.create(
            client=self.org_a,
            name="GeoJSON manager A",
            layer_type=GeoJsonLayer.TYPE_AUTRE,
            file=SimpleUploadedFile(
                "manager-a.geojson",
                b'{"type":"Feature","geometry":{"type":"Point","coordinates":[-17.4,14.7]},"properties":{}}',
                content_type="application/geo+json",
            ),
            is_active=True,
            metadata={"feature_count": 1, "private_path": "/srv/private/geojson/a.geojson"},
        )
        self.layer_b = GeoJsonLayer.objects.create(
            client=self.org_b,
            name="GeoJSON manager B",
            layer_type=GeoJsonLayer.TYPE_AUTRE,
            file=SimpleUploadedFile(
                "manager-b.geojson",
                b'{"type":"Feature","geometry":{"type":"Point","coordinates":[-17.5,14.8]},"properties":{}}',
                content_type="application/geo+json",
            ),
            is_active=True,
            metadata={"feature_count": 1, "private_path": "/srv/private/geojson/b.geojson"},
        )

    def test_manager_lists_only_geojson_layers_in_managed_organizations(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get("/api/admin/geojson-layers/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        returned_ids = {item["id"] for item in payload}
        self.assertIn(self.layer_a.id, returned_ids)
        self.assertNotIn(self.layer_b.id, returned_ids)

    def test_manager_can_create_geojson_layer_for_managed_client(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/admin/clients/{self.org_a.id}/geojson-layers/",
            {
                "name": "Créée par manager",
                "type": GeoJsonLayer.TYPE_AUTRE,
                "file": SimpleUploadedFile(
                    "created.geojson",
                    b'{"type":"Feature","geometry":{"type":"Point","coordinates":[-17.4,14.7]},"properties":{}}',
                    content_type="application/geo+json",
                ),
                "is_active": "true",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["client_id"], self.org_a.id)

    def test_manager_cannot_create_geojson_layer_for_unmanaged_client(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/admin/clients/{self.org_b.id}/geojson-layers/",
            {
                "name": "Hors périmètre",
                "type": GeoJsonLayer.TYPE_AUTRE,
                "file": SimpleUploadedFile(
                    "blocked.geojson",
                    b'{"type":"Feature","geometry":{"type":"Point","coordinates":[-17.4,14.7]},"properties":{}}',
                    content_type="application/geo+json",
                ),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_manager_can_update_and_delete_geojson_layer_in_scope_only(self):
        self.client.force_authenticate(self.manager)
        update_a = self.client.patch(f"/api/admin/geojson-layers/{self.layer_a.id}/", {"name": "GeoJSON A modifié"}, format="json")
        update_b = self.client.patch(f"/api/admin/geojson-layers/{self.layer_b.id}/", {"name": "GeoJSON B interdit"}, format="json")
        self.assertEqual(update_a.status_code, status.HTTP_200_OK, update_a.data)
        self.assertEqual(update_b.status_code, status.HTTP_404_NOT_FOUND)

        delete_b = self.client.delete(f"/api/admin/geojson-layers/{self.layer_b.id}/")
        self.assertEqual(delete_b.status_code, status.HTTP_404_NOT_FOUND)

    def test_manager_admin_geojson_response_masks_sensitive_metadata(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(f"/api/admin/geojson-layers/{self.layer_a.id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn("private_path", response.data.get("metadata", {}))

    def test_client_still_cannot_call_geojson_admin_routes_after_manager_opening(self):
        self.client.force_authenticate(self.client_a)
        response = self.client.get("/api/admin/geojson-layers/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)