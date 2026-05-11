# Generated manually for MAPGEO client document uploads.

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("documents", "0004_default_private_documents"),
    ]

    operations = [
        migrations.AddField(
            model_name="parceldocument",
            name="source",
            field=models.CharField(
                choices=[("internal", "Dépôt interne"), ("client_upload", "Dépôt client")],
                db_index=True,
                default="internal",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="parceldocument",
            name="uploaded_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="uploaded_parcel_documents",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name="parceldocument",
            index=models.Index(fields=["source", "created_at"], name="documents_p_source__a9c4f8_idx"),
        ),
    ]
