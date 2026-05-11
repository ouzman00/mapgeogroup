from django.db import migrations, models
import django.db.models.deletion


def backfill_user_client(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    OrganizationMembership = apps.get_model("organizations", "OrganizationMembership")

    for user in User.objects.filter(client__isnull=True):
        membership = (
            OrganizationMembership.objects.filter(
                user_id=user.id,
                is_active=True,
                organization__organization_type="client",
            )
            .order_by("-is_primary", "id")
            .first()
        )
        if membership:
            user.client_id = membership.organization_id
            user.save(update_fields=["client"])


class Migration(migrations.Migration):
    dependencies = [
        ("organizations", "0003_limit_organization_code_length"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="client",
            field=models.ForeignKey(
                blank=True,
                db_index=True,
                help_text="Client auquel l'utilisateur est rattaché pour l'isolation des données privées.",
                limit_choices_to={"organization_type": "client"},
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="client_users",
                to="organizations.organization",
            ),
        ),
        migrations.RunPython(backfill_user_client, migrations.RunPython.noop),
    ]
