from django.db import migrations


def normalize_blank_client_codes(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.filter(client_code="").update(client_code=None)


def noop_reverse(apps, schema_editor):
    # Plusieurs comptes peuvent légitimement avoir client_code=NULL ; ne pas revenir à "".
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_user_client"),
    ]

    operations = [
        migrations.RunPython(normalize_blank_client_codes, noop_reverse),
    ]
