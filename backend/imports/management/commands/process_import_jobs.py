import time

from django.conf import settings
from django.core.management.base import BaseCommand

from imports.models import ImportJob
from imports.services import process_import_job


class Command(BaseCommand):
    help = "Traite les imports CSV en file d'attente."

    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true", help="Reste en écoute pour traiter les nouveaux jobs.")

    def handle(self, *args, **options):
        loop = options.get("loop", False)
        sleep_seconds = max(2, int(getattr(settings, "IMPORT_QUEUE_POLL_SECONDS", 10)))
        batch_size = max(1, int(getattr(settings, "IMPORT_QUEUE_BATCH_SIZE", 3)))

        def process_batch():
            jobs = ImportJob.objects.filter(status__in=["pending", "validating"]).order_by("created_at")[:batch_size]
            processed = 0
            for job in jobs:
                process_import_job(job)
                processed += 1
            return processed

        processed = process_batch()
        self.stdout.write(self.style.SUCCESS(f"{processed} import(s) traité(s)."))

        while loop:
            processed = process_batch()
            if processed:
                self.stdout.write(self.style.SUCCESS(f"{processed} import(s) traité(s)."))
            time.sleep(sleep_seconds)
