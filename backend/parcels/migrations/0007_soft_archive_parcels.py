from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("parcels", "0006_projected_meters_srid_32628"),
    ]

    operations = [
        migrations.AddField(
            model_name="parcel",
            name="archived_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="parcel",
            name="archived_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="archived_parcels",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name="parcel",
            index=models.Index(fields=["archived_at", "created_at"], name="parcels_par_archive_78c9e1_idx"),
        ),
    ]
