from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from organizations.models import OrganizationMembership
from parcels.services import derive_organization_for_owner


class Command(BaseCommand):
    help = "Crée et rattache les organisations manquantes pour les utilisateurs existants."

    def handle(self, *args, **options):
        User = get_user_model()
        created_or_linked = 0
        for user in User.objects.all().iterator():
            before = OrganizationMembership.objects.filter(user=user, is_active=True).exists()
            derive_organization_for_owner(user)
            after = OrganizationMembership.objects.filter(user=user, is_active=True).exists()
            if not before and after:
                created_or_linked += 1
        self.stdout.write(self.style.SUCCESS(f"{created_or_linked} utilisateur(s) lié(s) à une organisation."))
