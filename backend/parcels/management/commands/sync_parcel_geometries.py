import math
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.utils import timezone

from parcels.models import Parcel
from parcels.services import (
    centroid_from_geometry,
    compute_area_perimeter_from_geometry,
    geos_to_geojson,
    point_from_lon_lat,
)


def clean_number(value, default=None):
    """
    Convertit une valeur en nombre propre.
    Évite les NaN / inf qui cassent les DecimalField Django.
    """
    if value is None:
        return default

    try:
        number = float(value)
    except (TypeError, ValueError):
        return default

    if math.isnan(number) or math.isinf(number):
        return default

    return number


def clean_decimal(value, default="0"):
    number = clean_number(value, None)
    if number is None:
        return Decimal(default)
    return Decimal(str(round(number, 2)))


class Command(BaseCommand):
    help = "Resynchronise geometry, area, perimeter, latitude, longitude depuis geom."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Affiche ce qui serait synchronisé sans modifier la base.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        queryset = Parcel.objects.exclude(geom__isnull=True)
        total = queryset.count()
        updated = 0
        skipped = 0

        self.stdout.write(f"Parcelles avec geom trouvées : {total}")

        for parcel in queryset.iterator():
            try:
                geojson = geos_to_geojson(parcel.geom)

                area, perimeter = compute_area_perimeter_from_geometry(geom=parcel.geom)
                y, x = centroid_from_geometry(geom=parcel.geom)

                area = clean_decimal(area, "0")
                perimeter = clean_decimal(perimeter, "0")
                x = clean_number(x, None)
                y = clean_number(y, None)

                parcel.geometry = geojson
                parcel.area = area
                parcel.perimeter = perimeter
                parcel.latitude = y
                parcel.longitude = x

                if x is not None and y is not None:
                    parcel.centroid_geom = point_from_lon_lat(x, y)
                else:
                    parcel.centroid_geom = None

                parcel.geometry_updated_at = timezone.now()

                if not dry_run:
                    parcel.save(
                        update_fields=[
                            "geometry",
                            "area",
                            "perimeter",
                            "latitude",
                            "longitude",
                            "centroid_geom",
                            "geometry_updated_at",
                        ]
                    )

                updated += 1
                self.stdout.write(
                    self.style.SUCCESS(f"OK {parcel.id} - {parcel.reference}")
                )

            except Exception as exc:
                skipped += 1
                self.stdout.write(
                    self.style.ERROR(
                        f"ERREUR {parcel.id} - {parcel.reference} : {exc}"
                    )
                )

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"DRY RUN terminé : {updated} parcelle(s) seraient synchronisées, {skipped} erreur(s)."
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Synchronisation terminée : {updated} parcelle(s) synchronisée(s), {skipped} erreur(s)."
                )
            )
