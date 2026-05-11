from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from organizations.models import Organization, OrganizationMembership
from support.models import SupportMessage, SupportTicket


from support.serializers import validate_support_attachment_file
class SupportAttachmentPrivateStorageSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Client A", code="CLIENT_A_SUP", organization_type="client")
        self.org_b = Organization.objects.create(name="Client B", code="CLIENT_B_SUP", organization_type="client")
        self.client_a = User.objects.create_user(username="support-client-a", password="pass12345", role="client", client=self.org_a, client_code="CLIENT_A_SUP")
        self.client_b = User.objects.create_user(username="support-client-b", password="pass12345", role="client", client=self.org_b, client_code="CLIENT_B_SUP")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True)
        self.ticket_a = SupportTicket.objects.create(user=self.client_a, subject="Ticket A", message="Message A")
        self.message_a = SupportMessage.objects.create(
            ticket=self.ticket_a,
            author=self.client_a,
            body="Pièce jointe A",
            attachment=SimpleUploadedFile("support-a.txt", b"private-support-a"),
        )

    def test_client_b_cannot_download_client_a_support_attachment(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/support/messages/{self.message_a.id}/attachment/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_anonymous_user_receives_401_on_support_attachment(self):
        response = self.client.get(f"/api/support/messages/{self.message_a.id}/attachment/")
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_private_support_attachment_has_security_headers(self):
        self.client.force_authenticate(self.client_a)
        response = self.client.get(f"/api/support/messages/{self.message_a.id}/attachment/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Content-Security-Policy"], "sandbox")
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response["Vary"], "Authorization")

    def test_private_support_attachment_is_not_served_through_media_url(self):
        response = self.client.get(f"/media/{self.message_a.attachment.name}")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SupportAttachmentValidationTests(APITestCase):
    def test_rejects_fake_image_attachment(self):
        file = SimpleUploadedFile("photo.jpg", b"not an image", content_type="image/jpeg")
        with self.assertRaises(Exception):
            validate_support_attachment_file(file)

    def test_rejects_empty_attachment(self):
        file = SimpleUploadedFile("empty.txt", b"", content_type="text/plain")
        with self.assertRaises(Exception):
            validate_support_attachment_file(file)


class SupportClientLeakageSecurityTests(APITestCase):
    def setUp(self):
        self.org_a = Organization.objects.create(name="Tenant Support A", code="TENANT_SUP_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Tenant Support B", code="TENANT_SUP_B", organization_type="client")
        self.client_a = User.objects.create_user(username="support-leak-client-a", password="pass12345", role="client", client=self.org_a, client_code="TENANT_SUP_A")
        self.client_b = User.objects.create_user(username="support-leak-client-b", password="pass12345", role="client", client=self.org_b, client_code="TENANT_SUP_B")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True, is_active=True)
        self.ticket_a = SupportTicket.objects.create(user=self.client_a, subject="Ticket confidentiel A", message="Message A")
        self.message_a = SupportMessage.objects.create(
            ticket=self.ticket_a,
            author=self.client_a,
            body="Pièce jointe A",
            attachment=SimpleUploadedFile("support-a-secure.txt", b"private-support-a"),
        )

    def test_client_b_cannot_list_client_a_ticket(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get("/api/support/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data.get("results", response.data) if isinstance(response.data, dict) else response.data
        self.assertNotIn(self.ticket_a.id, {item["id"] for item in payload})

    def test_client_b_cannot_retrieve_client_a_ticket(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/support/{self.ticket_a.id}/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_client_b_cannot_download_client_a_support_attachment(self):
        self.client.force_authenticate(self.client_b)
        response = self.client.get(f"/api/support/messages/{self.message_a.id}/attachment/")
        self.assertIn(response.status_code, {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND})

    def test_anonymous_user_receives_401_on_private_support_routes(self):
        detail_response = self.client.get(f"/api/support/{self.ticket_a.id}/")
        attachment_response = self.client.get(f"/api/support/messages/{self.message_a.id}/attachment/")
        self.assertEqual(detail_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(attachment_response.status_code, status.HTTP_401_UNAUTHORIZED)
