# Generated manually for MAPGEO notification query performance.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("notifications", "0002_notification_links"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(fields=["user", "is_read", "-created_at"], name="notificatio_user_id_0b3f1d_idx"),
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(fields=["notification_type", "-created_at"], name="notificatio_notific_9e7c8b_idx"),
        ),
    ]
