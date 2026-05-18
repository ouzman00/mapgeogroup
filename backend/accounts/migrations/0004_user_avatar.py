from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_normalize_blank_client_code"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="avatar",
            field=models.ImageField(
                blank=True,
                null=True,
                upload_to="avatars/",
                help_text="Photo de profil utilisateur, max 2 Mo.",
            ),
        ),
    ]
