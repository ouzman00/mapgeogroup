from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from imports.models import ImportJob
from organizations.models import Organization, OrganizationMembership


from imports.serializers import ImportJobSerializer
class ImportFilePrivateStorageSecurityTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(name="Client Import", code="CLIENT_IMPORT", organization_type="client")
        self.manager = User.objects.create_user(username="import-manager", password="pass12345", role="manager")
        self.other_org = Organization.objects.create(name="Client Import B", code="CLIENT_IMPORT_B", organization_type="client")
        self.other_manager = User.objects.create_user(username="import-manager-b", password="pass12345", role="manager")
        OrganizationMembership.objects.create(organization=self.org, user=self.manager, role="manager", is_primary=True)
        OrganizationMembership.objects.create(organization=self.other_org, user=self.other_manager, role="manager", is_primary=True)
        self.job = ImportJob.objects.create(
            organization=self.org,
            created_by=self.manager,
            file=SimpleUploadedFile("imports.csv", b"reference,location,area\nA,Dakar,10\n"),
            original_filename="imports.csv",
        )

    def test_private_import_file_download_has_security_headers(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(f"/api/imports/{self.job.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Content-Security-Policy"], "sandbox")
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response["Vary"], "Authorization")

    def test_manager_outside_organization_cannot_download_import_file(self):
        self.client.force_authenticate(self.other_manager)
        response = self.client.get(f"/api/imports/{self.job.id}/download/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_anonymous_user_receives_401_on_import_download(self):
        response = self.client.get(f"/api/imports/{self.job.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_private_import_file_is_not_served_through_media_url(self):
        response = self.client.get(f"/media/{self.job.file.name}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class ImportCsvValidationTests(APITestCase):
    def test_rejects_empty_csv(self):
        serializer = ImportJobSerializer()
        file = SimpleUploadedFile("empty.csv", b"", content_type="text/csv")
        with self.assertRaises(Exception):
            serializer.validate_file(file)

    def test_rejects_csv_without_reference_column(self):
        serializer = ImportJobSerializer()
        file = SimpleUploadedFile("bad.csv", b"location,area\nDakar,10\n", content_type="text/csv")
        with self.assertRaises(Exception):
            serializer.validate_file(file)

    def test_rejects_non_utf8_csv(self):
        serializer = ImportJobSerializer()
        file = SimpleUploadedFile("bad.csv", b"reference,location\nA,\xff\n", content_type="text/csv")
        with self.assertRaises(Exception):
            serializer.validate_file(file)

    def test_accepts_valid_csv(self):
        serializer = ImportJobSerializer()
        file = SimpleUploadedFile("ok.csv", b"reference,location,area\nA,Dakar,10\n", content_type="text/csv")
        self.assertEqual(serializer.validate_file(file), file)


class ImportClientLeakageSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Tenant Import A", code="TENANT_IMPORT_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Tenant Import B", code="TENANT_IMPORT_B", organization_type="client")
        self.manager_a = User.objects.create_user(username="import-leak-manager-a", password="pass12345", role="manager")
        self.manager_b = User.objects.create_user(username="import-leak-manager-b", password="pass12345", role="manager")
        self.client_b = User.objects.create_user(username="import-leak-client-b", password="pass12345", role="client", client=self.org_b, client_code="TENANT_IMPORT_B")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.manager_a, role="manager", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.manager_b, role="manager", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True, is_active=True)
        self.job_a = ImportJob.objects.create(
            organization=self.org_a,
            created_by=self.manager_a,
            file=SimpleUploadedFile("tenant-a-import.csv", b"reference,location,area\nA,Dakar,10\n"),
            original_filename="tenant-a-import.csv",
        )

    def test_manager_b_cannot_list_client_a_import(self):
        self.client.force_authenticate(self.manager_b)
        response = self.client.get("/api/imports/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        self.assertNotIn(self.job_a.id, {item["id"] for item in payload})

    def test_manager_b_cannot_retrieve_client_a_import(self):
        self.client.force_authenticate(self.manager_b)
        response = self.client.get(f"/api/imports/{self.job_a.id}/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_manager_b_cannot_download_client_a_import_file(self):
        self.client.force_authenticate(self.manager_b)
        response = self.client.get(f"/api/imports/{self.job_a.id}/download/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_client_user_cannot_call_import_routes(self):
        self.client.force_authenticate(self.client_b)
        list_response = self.client.get("/api/imports/")
        detail_response = self.client.get(f"/api/imports/{self.job_a.id}/")
        download_response = self.client.get(f"/api/imports/{self.job_a.id}/download/")
        self.assertEqual(list_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(detail_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(download_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_anonymous_user_receives_401_on_private_import_routes(self):
        detail_response = self.client.get(f"/api/imports/{self.job_a.id}/")
        download_response = self.client.get(f"/api/imports/{self.job_a.id}/download/")
        self.assertEqual(detail_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(download_response.status_code, status.HTTP_401_UNAUTHORIZED)



class ImportResultRedactionTests(APITestCase):
    def test_row_serializer_redacts_sensitive_and_unknown_columns(self):
        org = Organization.objects.create(name="Client Redaction", code="CLIENT_REDACTION", organization_type="client")
        manager = User.objects.create_user(username="redaction-manager", password="pass12345", role="manager")
        job = ImportJob.objects.create(
            organization=org,
            created_by=manager,
            file=SimpleUploadedFile("redaction.csv", b"reference,location,password,unexpected\nA,Dakar,secret,x\n"),
            original_filename="redaction.csv",
        )
        row = job.rows.create(
            row_number=2,
            reference="A",
            status="valid",
            raw_data={"reference": "A", "location": "Dakar", "password": "secret", "unexpected": "x"},
            normalized_data={"reference": "A", "geometry": {"type": "Point", "coordinates": [1, 2]}},
        )

        from imports.serializers import ImportRowResultSerializer

        payload = ImportRowResultSerializer(row).data
        self.assertNotIn("password", payload["raw_data"])
        self.assertNotIn("unexpected", payload["raw_data"])
        self.assertIn("__redacted_columns__", payload["raw_data"])
        self.assertIn("__ignored_columns__", payload["raw_data"])
        self.assertEqual(payload["normalized_data"]["geometry"]["type"], "Point")
        self.assertIn("point_count", payload["normalized_data"]["geometry"])
