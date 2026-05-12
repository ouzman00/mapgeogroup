from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("imports", "0005_alter_importjob_file"),
    ]

    operations = [
        migrations.AddField(
            model_name="importjob",
            name="skip_errors",
            field=models.BooleanField(
                default=False,
                help_text="Si True, importe les lignes valides même en présence d'erreurs.",
            ),
        ),
    ]
