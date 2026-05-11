from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from organizations.models import Organization, OrganizationMembership
from parcels.models import Parcel


class ParcelClientIsolationTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin", password="adminpass123", role="admin")
        self.client_a = User.objects.create_user(username="client-a", password="clientpass123", role="client", client_code="CLIENT_A")
        self.client_b = User.objects.create_user(username="client-b", password="clientpass123", role="client", client_code="CLIENT_B")
        self.org_a = Organization.objects.create(name="Client A", code="CLIENT_A", organization_type="client")
        self.org_b = Organization.objects.create(name="Client B", code="CLIENT_B", organization_type="client")
        OrganizationMembership.objects.create(organization=self.org_a, user=self.client_a, role="owner", is_primary=True, is_active=True)
        OrganizationMembership.objects.create(organization=self.org_b, user=self.client_b, role="owner", is_primary=True, is_active=True)
        self.parcel_a = Parcel.objects.create(
            reference="PA-001",
            owner=self.client_a,
            organization=self.org_a,
            location="Dakar",
            area=Decimal("100.00"),
            perimeter=Decimal("40.00"),
        )

    def test_client_sees_only_own_organization_parcels(self):
        self.client.force_authenticate(self.client_a)
        response_a = self.client.get("/api/parcels/")
        self.assertEqual(response_a.status_code, status.HTTP_200_OK)
        self.assertEqual(response_a.data["count"], 1)
        self.assertEqual(response_a.data["results"][0]["reference"], "PA-001")

        self.client.force_authenticate(self.client_b)
        response_b = self.client.get("/api/parcels/")
        self.assertEqual(response_b.status_code, status.HTTP_200_OK)
        self.assertEqual(response_b.data["count"], 0)

        detail_b = self.client.get(f"/api/parcels/{self.parcel_a.id}/")
        self.assertEqual(detail_b.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_cannot_attach_owner_to_wrong_organization(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/parcels/",
            {
                "reference": "BAD-001",
                "owner": self.client_a.id,
                "organization": self.org_b.id,
                "location": "Thiès",
                "area": "50.00",
                "perimeter": "25.00",
                "status": "planned",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("owner", response.data)

    def test_owner_change_without_organization_moves_to_new_primary_organization(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            f"/api/parcels/{self.parcel_a.id}/",
            {"owner": self.client_b.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.parcel_a.refresh_from_db()
        self.assertEqual(self.parcel_a.owner_id, self.client_b.id)
        self.assertEqual(self.parcel_a.organization_id, self.org_b.id)

    def test_client_cannot_modify_parcel(self):
        self.client.force_authenticate(self.client_a)
        response = self.client.patch(f"/api/parcels/{self.parcel_a.id}/", {"location": "Modifié"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
