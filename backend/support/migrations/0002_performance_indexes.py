from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("support", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="supportticket",
            name="status",
            field=models.CharField(choices=[('open', 'Ouvert'), ('in_progress', 'En cours'), ('resolved', 'Résolu'), ('closed', 'Fermé')], db_index=True, default='open', max_length=20),
        ),
        migrations.AlterField(
            model_name="supportticket",
            name="priority",
            field=models.CharField(choices=[('low', 'Faible'), ('medium', 'Moyenne'), ('high', 'Élevée'), ('urgent', 'Urgente')], db_index=True, default='medium', max_length=20),
        ),
        migrations.AlterField(
            model_name="supportticket",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True, db_index=True),
        ),
        migrations.AddIndex(
            model_name='supportticket',
            index=models.Index(fields=['user', 'created_at'], name='support_sup_user_id_455176_idx'),
        ),
        migrations.AddIndex(
            model_name='supportticket',
            index=models.Index(fields=['status', 'created_at'], name='support_sup_status__c121ae_idx'),
        ),
    ]
