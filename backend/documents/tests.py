from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from documents.models import ParcelDocument
from organizations.models import Organization, OrganizationMembership
from parcels.models import Parcel


from documents.serializers import ParcelDocumentSerializer
class DocumentPrivateStorageSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Client A", code="CLIENT_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Client B", code="CLIENT_B", organization_type="client")
        self.client_a = User.objects.create_user(username="client-a", password="pass12345", role="client", client=self.org_a, client_code="CLIENT_A")
        self.client_b = User.objects.create_user(username="client-b", password="pass12345", role="client", client=self.org_b, client_code="CLIENT_B")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True)
        self.parcel_a = Parcel.objects.create(
            reference="A-001",
            owner=self.client_a,
            organization=self.org_a,
            location="Dakar",
            area="100.00",
            perimeter="40.00",
        )
        self.document_a = ParcelDocument.objects.create(
            parcel=self.parcel_a,
            title="Document privé A",
            document_type="plan_pdf",
            file=SimpleUploadedFile("doc-a.pdf", b"%PDF-1.4\nprivate-a"),
            status="final",
            is_public_for_client=True,
            uploaded_by=self.client_a,
            source="client_upload",
        )

    def test_client_b_cannot_download_client_a_document(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/documents/{self.document_a.id}/download/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_anonymous_user_receives_401_on_document_download(self):
        response = self.client.get(f"/api/documents/{self.document_a.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_private_document_download_has_security_headers(self):
        self.client.force_authenticate(self.client_a)
        response = self.client.get(f"/api/documents/{self.document_a.id}/download/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Content-Security-Policy"], "sandbox")
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response["Vary"], "Authorization")

    def test_private_document_is_not_served_through_media_url(self):
        response = self.client.get(f"/media/{self.document_a.file.name}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class DocumentFileValidationTests(APITestCase):
    def test_rejects_fake_pdf_content(self):
        serializer = ParcelDocumentSerializer()
        file = SimpleUploadedFile("fake.pdf", b"not a pdf", content_type="application/pdf")
        with self.assertRaises(Exception):
            serializer.validate_file(file)

    def test_rejects_suspicious_filename(self):
        serializer = ParcelDocumentSerializer()
        file = SimpleUploadedFile("../secret.pdf", b"%PDF-1.4\n", content_type="application/pdf")
        with self.assertRaises(Exception):
            serializer.validate_file(file)

    def test_accepts_real_pdf_signature(self):
        serializer = ParcelDocumentSerializer()
        file = SimpleUploadedFile("plan.pdf", b"%PDF-1.4\n%EOF", content_type="application/pdf")
        self.assertEqual(serializer.validate_file(file), file)


class DocumentClientLeakageSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Tenant Document A", code="TENANT_DOC_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Tenant Document B", code="TENANT_DOC_B", organization_type="client")
        self.client_a = User.objects.create_user(username="doc-leak-client-a", password="pass12345", role="client", client=self.org_a, client_code="TENANT_DOC_A")
        self.client_b = User.objects.create_user(username="doc-leak-client-b", password="pass12345", role="client", client=self.org_b, client_code="TENANT_DOC_B")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True, is_active=True)
        self.parcel_a = Parcel.objects.create(reference="DOC-PA-001", owner=self.client_a, organization=self.org_a, location="Dakar", area="100.00", perimeter="40.00")
        self.document_a = ParcelDocument.objects.create(
            parcel=self.parcel_a,
            title="Document A confidentiel",
            document_type="plan_pdf",
            file=SimpleUploadedFile("doc-a-secure.pdf", b"%PDF-1.4\nprivate-a"),
            status="final",
            is_public_for_client=True,
            uploaded_by=self.client_a,
            source="client_upload",
        )

    def _document_ids_for_client_b(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get("/api/documents/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        return {item["id"] for item in payload}

    def test_client_b_cannot_list_client_a_document(self):
        self.assertNotIn(self.document_a.id, self._document_ids_for_client_b())

    def test_client_b_cannot_retrieve_client_a_document(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/documents/{self.document_a.id}/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_client_b_cannot_download_client_a_document(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/documents/{self.document_a.id}/download/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_client_b_cannot_modify_client_a_document(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.patch(f"/api/documents/{self.document_a.id}/", {"title": "Intrusion"}, format="json")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})
        self.document_a.refresh_from_db()
        self.assertEqual(self.document_a.title, "Document A confidentiel")

    def test_client_b_cannot_delete_client_a_document(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.delete(f"/api/documents/{self.document_a.id}/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})
        self.assertTrue(ParcelDocument.objects.filter(pk=self.document_a.pk).exists())

    def test_anonymous_user_receives_401_on_private_document_routes(self):
        detail_response = self.client.get(f"/api/documents/{self.document_a.id}/")
        download_response = self.client.get(f"/api/documents/{self.document_a.id}/download/")
        self.assertEqual(detail_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(download_response.status_code, status.HTTP_401_UNAUTHORIZED)
