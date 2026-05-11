from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="parceldocument",
            name="status",
            field=models.CharField(choices=[('draft', 'Brouillon'), ('validated', 'Validé'), ('final', 'Final'), ('archived', 'Archivé')], db_index=True, default='draft', max_length=20),
        ),
        migrations.AlterField(
            model_name="parceldocument",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True, db_index=True),
        ),
        migrations.AddIndex(
            model_name='parceldocument',
            index=models.Index(fields=['parcel', 'created_at'], name='documents_p_parcel__1fe53e_idx'),
        ),
        migrations.AddIndex(
            model_name='parceldocument',
            index=models.Index(fields=['parcel', 'status'], name='documents_p_parcel__1144bf_idx'),
        ),
    ]
