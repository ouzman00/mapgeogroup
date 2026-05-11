from django.db import migrations, models
import config.storage


def migrate_documents_to_private_storage(apps, schema_editor):
    config.storage.migrate_public_media_prefix_to_private("documents")


class Migration(migrations.Migration):
    dependencies = [
        ("documents", "0005_document_upload_origin"),
    ]

    operations = [
        migrations.RunPython(migrate_documents_to_private_storage, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="parceldocument",
            name="file",
            field=models.FileField(storage=config.storage.PrivateMediaStorage("documents"), upload_to=config.storage.private_document_upload_to),
        ),
    ]
