from pathlib import Path

from django.contrib.gis.gdal import DataSource
from django.contrib.gis.geos import GEOSGeometry
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from parcels.models import Commune


class Command(BaseCommand):
    help = "Importe une couche communes SHP/GPKG/GeoJSON dans donnees_mapgeo.communes."

    def add_arguments(self, parser):
        parser.add_argument("path", help="Chemin du fichier SHP, GPKG ou GeoJSON des communes.")
        parser.add_argument("--layer", type=int, default=0, help="Index de couche GDAL, par défaut 0.")
        parser.add_argument("--name-field", default="", help="Champ du nom de commune, ex: NOM, COMMUNE, CCRCA_1.")
        parser.add_argument("--code-field", default="", help="Champ code commune optionnel.")
        parser.add_argument("--department-field", default="", help="Champ département optionnel.")
        parser.add_argument("--region-field", default="", help="Champ région optionnel.")
        parser.add_argument("--replace", action="store_true", help="Vide la table communes avant import.")

    def handle(self, *args, **options):
        path = Path(options["path"])
        if not path.exists():
            raise CommandError(f"Fichier introuvable : {path}")

        ds = DataSource(str(path))
        try:
            layer = ds[options["layer"]]
        except Exception as exc:
            raise CommandError(f"Impossible de lire la couche {options['layer']} : {exc}") from exc

        fields = list(layer.fields)
        name_field = options["name_field"] or self._pick(fields, ["nom", "NOM", "name", "NAME", "commune", "COMMUNE", "CCRCA_1", "ccrca_1"])
        code_field = options["code_field"] or self._pick(fields, ["code", "CODE", "code_commune", "CODE_COMMUNE", "id", "ID"])
        department_field = options["department_field"] or self._pick(fields, ["department", "departement", "DEPARTEMENT", "dept", "DEPT"])
        region_field = options["region_field"] or self._pick(fields, ["region", "REGION"])

        if not name_field:
            raise CommandError(
                "Aucun champ nom de commune détecté. Utilise --name-field NOM_DU_CHAMP. "
                f"Champs disponibles : {', '.join(fields)}"
            )

        created = 0
        with transaction.atomic():
            if options["replace"]:
                Commune.objects.all().delete()

            for feature in layer:
                if not feature.geom:
                    continue
                geom = GEOSGeometry(feature.geom.wkt, srid=feature.geom.srid or 4326)
                if geom.srid != 32628:
                    geom.transform(32628)

                values = {
                    "nom": str(feature.get(name_field) or "").strip() or "Sans nom",
                    "code": str(feature.get(code_field) or "").strip() or None if code_field else None,
                    "department": str(feature.get(department_field) or "").strip() or None if department_field else None,
                    "region": str(feature.get(region_field) or "").strip() or None if region_field else None,
                    "geom": geom,
                }
                Commune.objects.create(**values)
                created += 1

        self.stdout.write(self.style.SUCCESS(f"Communes importées : {created}"))

    @staticmethod
    def _pick(fields, candidates):
        lower_map = {field.lower(): field for field in fields}
        for candidate in candidates:
            if candidate in fields:
                return candidate
            match = lower_map.get(candidate.lower())
            if match:
                return match
        return ""
