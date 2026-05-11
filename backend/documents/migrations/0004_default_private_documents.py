from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("documents", "0003_rename_documents_p_parcel__1fe53e_idx_documents_p_parcel__d3e6f2_idx_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="parceldocument",
            name="is_public_for_client",
            field=models.BooleanField(default=False),
        ),
    ]
