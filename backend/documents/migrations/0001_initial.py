from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("parcels", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="ParcelDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=255)),
                ("document_type", models.CharField(choices=[("plan_pdf", "Plan PDF"), ("pv_bornage", "PV de bornage"), ("rapport_topo", "Rapport topographique"), ("orthophoto", "Orthophoto"), ("photo_terrain", "Photo terrain"), ("image_annotee", "Image annotée"), ("dxf", "DXF"), ("dwg", "DWG"), ("kml", "KML"), ("csv", "CSV"), ("excel", "Excel"), ("invoice", "Facture"), ("quote", "Devis"), ("other", "Autre")], default="other", max_length=30)),
                ("file", models.FileField(upload_to="documents/%Y/%m/")),
                ("version", models.CharField(default="v1", max_length=20)),
                ("status", models.CharField(choices=[("draft", "Brouillon"), ("validated", "Validé"), ("final", "Final"), ("archived", "Archivé")], default="draft", max_length=20)),
                ("description", models.TextField(blank=True, null=True)),
                ("is_public_for_client", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("parcel", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="documents", to="parcels.parcel")),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
