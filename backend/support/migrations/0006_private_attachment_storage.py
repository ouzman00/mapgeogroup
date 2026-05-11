from django.db import migrations, models
import config.storage


def migrate_support_to_private_storage(apps, schema_editor):
    config.storage.migrate_public_media_prefix_to_private("support")


class Migration(migrations.Migration):
    dependencies = [
        ("support", "0005_supportticket_category"),
    ]

    operations = [
        migrations.RunPython(migrate_support_to_private_storage, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="supportmessage",
            name="attachment",
            field=models.FileField(blank=True, null=True, storage=config.storage.PrivateMediaStorage("support"), upload_to=config.storage.private_support_attachment_upload_to),
        ),
    ]
