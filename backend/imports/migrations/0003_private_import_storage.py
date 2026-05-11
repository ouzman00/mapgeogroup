from django.db import migrations, models
import config.storage


def migrate_imports_to_private_storage(apps, schema_editor):
    config.storage.migrate_public_media_prefix_to_private("imports")


class Migration(migrations.Migration):
    dependencies = [
        ("imports", "0002_rename_imports_imp_status_1dd98f_idx_imports_imp_status_717e0b_idx_and_more"),
    ]

    operations = [
        migrations.RunPython(migrate_imports_to_private_storage, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="importjob",
            name="file",
            field=models.FileField(storage=config.storage.PrivateMediaStorage("imports"), upload_to=config.storage.private_import_upload_to),
        ),
    ]
