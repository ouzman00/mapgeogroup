from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from imports.models import ImportJob


class Command(BaseCommand):
    help = "Supprime les imports anciens et leurs lignes de résultat pour minimiser les données conservées."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=90,
            help="Conserver les imports des N derniers jours. Défaut : 90.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Affiche le volume concerné sans suppression.",
        )

    def handle(self, *args, **options):
        days = max(1, int(options["days"]))
        cutoff = timezone.now() - timedelta(days=days)
        queryset = ImportJob.objects.filter(created_at__lt=cutoff)
        count = queryset.count()

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING(f"{count} import(s) seraient supprimés avant {cutoff.isoformat()}."))
            return

        deleted, details = queryset.delete()
        self.stdout.write(self.style.SUCCESS(f"Purge terminée : {deleted} objet(s) supprimé(s), dont {count} import(s)."))
