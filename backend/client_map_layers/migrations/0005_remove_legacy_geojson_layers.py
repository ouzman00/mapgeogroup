from django.db import migrations


def remove_legacy_geojson_layers(apps, schema_editor):
    ClientMapLayer = apps.get_model("client_map_layers", "ClientMapLayer")
    # Nouveau socle : plus d’import/affichage basé sur fichiers GeoJSON locaux.
    # On retire uniquement les anciennes couches GeoJSON locales ; PostGIS, WFS et WMS sont conservées.
    ClientMapLayer.objects.filter(data_format="geojson").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("client_map_layers", "0004_postgis_source_format"),
    ]

    operations = [
        migrations.RunPython(remove_legacy_geojson_layers, migrations.RunPython.noop),
    ]
