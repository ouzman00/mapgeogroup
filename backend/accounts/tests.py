from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from organizations.models import Organization, OrganizationMembership


class AdminClientCreationTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin", password="adminpass123", role="admin")
        self.client.force_authenticate(self.admin)

    def test_admin_creates_complete_client_account(self):
        response = self.client.post(
            "/api/accounts/clients/",
            {
                "name": "Société Teranga",
                "code": "TERANGA",
                "email": "contact@teranga.test",
                "phone": "+221000000",
                "send_invitation": False,
                "password": "StrongClientPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        organization = Organization.objects.get(code="TERANGA")
        user = User.objects.get(client_code="TERANGA")
        self.assertEqual(organization.organization_type, "client")
        self.assertEqual(user.role, "client")
        self.assertIsNone(response.data.get("generated_password"))
        self.assertTrue(user.check_password("StrongClientPass123!"))
        self.assertTrue(
            OrganizationMembership.objects.filter(
                organization=organization,
                user=user,
                role="owner",
                is_primary=True,
                is_active=True,
            ).exists()
        )

    def test_inviting_additional_client_contact_does_not_duplicate_client_code(self):
        organization = Organization.objects.create(
            name="Client Alpha",
            code="ALPHA",
            organization_type="client",
            status="active",
        )
        owner = User.objects.create_user(
            username="alpha-owner",
            email="owner@alpha.test",
            password="clientpass123",
            role="client",
            client=organization,
            client_code="ALPHA",
            is_active=True,
            is_verified=True,
        )
        OrganizationMembership.objects.create(
            organization=organization,
            user=owner,
            role="owner",
            is_primary=True,
            is_active=True,
        )

        response = self.client.post(
            "/api/accounts/users/invite/",
            {"email": "contact@alpha.test", "role": "client", "organization": organization.id},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        invited = User.objects.get(email="contact@alpha.test")
        self.assertIsNone(invited.client_code)
        self.assertTrue(
            OrganizationMembership.objects.filter(
                organization=organization,
                user=invited,
                role="contact",
                is_primary=False,
                is_active=True,
            ).exists()
        )

    @override_settings(PUBLIC_REGISTRATION_ENABLED=False)
    def test_public_registration_can_be_disabled(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(
            "/api/accounts/register/",
            {
                "username": "free-client",
                "email": "free@example.test",
                "password": "StrongPass123!",
                "password_confirm": "StrongPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)


class UserRolePermissionTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin2", password="adminpass123", role="admin")
        self.manager = User.objects.create_user(username="manager", password="managerpass123", role="manager")
        self.surveyor = User.objects.create_user(username="surveyor", password="surveyorpass123", role="surveyor")
        self.client_user = User.objects.create_user(
            username="client-user",
            password="clientpass123",
            role="client",
            client_code="CLIENT_USER",
            is_verified=True,
        )

    def test_manager_cannot_invite_internal_user(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            "/api/accounts/users/invite/",
            {"email": "agent@example.test", "role": "agent"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_can_reset_client_access(self):
        self.client.force_authenticate(self.manager)
        response = self.client.post(
            f"/api/accounts/users/{self.client_user.id}/reset-access/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.client_user.refresh_from_db()
        self.assertTrue(self.client_user.is_active)
        self.assertNotIn("temporary_password", response.data)
        self.assertIn("reset_sent", response.data)

    def test_manager_cannot_modify_internal_user_with_patch(self):
        self.client.force_authenticate(self.manager)
        response = self.client.patch(
            f"/api/accounts/users/{self.surveyor.id}/",
            {"is_active": False},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.surveyor.refresh_from_db()
        self.assertTrue(self.surveyor.is_active)

    def test_admin_can_modify_internal_user_role(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            f"/api/accounts/users/{self.surveyor.id}/",
            {"role": "agent"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.surveyor.refresh_from_db()
        self.assertEqual(self.surveyor.role, "agent")

    def test_admin_reset_client_access_reactivates_client_organization(self):
        organization = Organization.objects.create(
            name="Client désactivé",
            code="CLIENT_DISABLED",
            organization_type="client",
            status="inactive",
        )
        client_user = User.objects.create_user(
            username="client-disabled",
            password="clientpass123",
            role="client",
            client=organization,
            client_code="CLIENT_DISABLED",
            is_active=False,
            is_verified=True,
        )
        OrganizationMembership.objects.create(
            organization=organization,
            user=client_user,
            role="owner",
            is_active=True,
            is_primary=True,
        )

        self.client.force_authenticate(self.admin)
        response = self.client.post(f"/api/accounts/users/{client_user.id}/reset-access/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        client_user.refresh_from_db()
        organization.refresh_from_db()
        self.assertTrue(client_user.is_active)
        self.assertEqual(organization.status, "active")
        self.assertEqual(response.data.get("organization", {}).get("status"), "active")
