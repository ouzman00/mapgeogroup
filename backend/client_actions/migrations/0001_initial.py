from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('parcels', '0013_parcel_nicad'),
    ]

    operations = [
        migrations.CreateModel(
            name='ClientAction',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=255)),
                ('description', models.TextField(blank=True)),
                ('action_type', models.CharField(choices=[('document', 'Fournir un document'), ('validation', 'Valider une information'), ('payment', 'Effectuer un paiement'), ('appointment', 'Confirmer un rendez-vous'), ('other', 'Autre')], default='other', max_length=30)),
                ('status', models.CharField(choices=[('open', 'À faire'), ('done', 'Terminé'), ('cancelled', 'Annulé')], db_index=True, default='open', max_length=20)),
                ('due_date', models.DateField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_client_actions', to=settings.AUTH_USER_MODEL)),
                ('parcel', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='client_actions', to='parcels.parcel')),
            ],
        ),
    ]
