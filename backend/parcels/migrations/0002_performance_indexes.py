from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("parcels", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="parcel",
            name="status",
            field=models.CharField(choices=[('planned', 'Mission planifiée'), ('surveying', 'Levé en cours'), ('processing', 'Traitement en cours'), ('draft', 'Plan en préparation'), ('ready', 'Dossier prêt'), ('completed', 'Bornage réalisé'), ('disputed', 'Litigieuse'), ('to_verify', 'À vérifier')], db_index=True, default='planned', max_length=20),
        ),
        migrations.AlterField(
            model_name="parcel",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True, db_index=True),
        ),
        migrations.AddIndex(
            model_name='parcel',
            index=models.Index(fields=['owner', 'created_at'], name='parcels_par_owner_i_1e7ff7_idx'),
        ),
        migrations.AddIndex(
            model_name='parcel',
            index=models.Index(fields=['owner', 'status'], name='parcels_par_owner_i_6de4a2_idx'),
        ),
        migrations.AddIndex(
            model_name='parcel',
            index=models.Index(fields=['commune', 'created_at'], name='parcels_par_commune_8ec4dd_idx'),
        ),
    ]
