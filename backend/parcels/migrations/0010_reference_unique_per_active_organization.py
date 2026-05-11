# Generated manually for MAPGEO parcel reference scoping.

from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):

    dependencies = [
        ("parcels", "0009_rename_parcels_par_archive_78c9e1_idx_parcels_par_archive_c91dff_idx"),
    ]

    operations = [
        migrations.AlterField(
            model_name="parcel",
            name="reference",
            field=models.CharField(max_length=100, db_index=True),
        ),
        migrations.AddConstraint(
            model_name="parcel",
            constraint=models.UniqueConstraint(
                fields=("organization", "reference"),
                condition=Q(archived_at__isnull=True),
                name="uniq_active_parcel_reference_per_org",
            ),
        ),
    ]
