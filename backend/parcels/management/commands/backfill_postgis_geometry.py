from django.core.management.base import BaseCommand

from parcels.models import Parcel
from parcels.services import backfill_parcel_postgis


class Command(BaseCommand):
    help = "Backfill geometry JSON -> geom PostGIS + centroïde + métriques."

    def handle(self, *args, **options):
        updated = 0
        failed = 0
        for parcel in Parcel.objects.all().iterator():
            try:
                backfill_parcel_postgis(parcel)
                updated += 1
            except Exception as exc:
                failed += 1
                self.stderr.write(f"Échec parcelle {parcel.reference}: {exc}")
        self.stdout.write(self.style.SUCCESS(f"{updated} parcelle(s) traitée(s), {failed} échec(s)."))
