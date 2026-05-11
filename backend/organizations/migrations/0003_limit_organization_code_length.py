from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("organizations", "0002_rename_organizatio_status_d8710f_idx_organizatio_status_54bdfc_idx_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="organization",
            name="code",
            field=models.CharField(max_length=32, unique=True),
        ),
    ]
