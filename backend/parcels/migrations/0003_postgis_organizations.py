from __future__ import annotations

import json

from django.db import migrations, models
from django.contrib.gis.db import models as gis_models
from django.contrib.gis.geos import GEOSGeometry, Point
from django.contrib.postgres.operations import CreateExtension
import django.db.models.deletion


def _as_multipolygon(geometry):
    if not geometry:
        return None
    if isinstance(geometry, str):
        geometry = json.loads(geometry)
    if geometry.get("type") == "Polygon":
        geometry = {"type": "MultiPolygon", "coordinates": [geometry.get("coordinates", [])]}
    if geometry.get("type") != "MultiPolygon":
        return None
    geom = GEOSGeometry(json.dumps(geometry), srid=4326)
    geom.srid = 4326
    return geom


def backfill_existing_data(apps, schema_editor):
    Parcel = apps.get_model("parcels", "Parcel")
    Organization = apps.get_model("organizations", "Organization")
    OrganizationMembership = apps.get_model("organizations", "OrganizationMembership")

    for parcel in Parcel.objects.select_related("owner").all():
        owner = parcel.owner
        code = getattr(owner, "client_code", None) or f"ORG-{owner.id}"
        name = getattr(owner, "company_name", None) or owner.get_full_name() or owner.username
        org, _ = Organization.objects.get_or_create(
            code=code[:32],
            defaults={"name": name, "email": owner.email or "", "status": "active"},
        )
        OrganizationMembership.objects.get_or_create(
            organization=org,
            user=owner,
            defaults={"role": "owner", "is_primary": True, "is_active": True},
        )
        parcel.organization = org
        if parcel.geometry and not parcel.geom:
            parcel.geom = _as_multipolygon(parcel.geometry)
        if parcel.latitude is not None and parcel.longitude is not None:
            parcel.centroid_geom = Point(float(parcel.longitude), float(parcel.latitude), srid=4326)
        parcel.save(update_fields=["organization", "geom", "centroid_geom"])


class Migration(migrations.Migration):
    dependencies = [
        ("organizations", "0001_initial"),
        ("parcels", "0002_performance_indexes"),
    ]

    operations = [
        CreateExtension("postgis"),
        migrations.AddField(
            model_name="parcel",
            name="organization",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="parcels", to="organizations.organization"),
        ),
        migrations.AddField(
            model_name="parcel",
            name="geom",
            field=gis_models.MultiPolygonField(blank=True, null=True, srid=4326),
        ),
        migrations.AddField(
            model_name="parcel",
            name="centroid_geom",
            field=gis_models.PointField(blank=True, null=True, srid=4326),
        ),
        migrations.AddField(
            model_name="parcel",
            name="geometry_updated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ParcelGeometryVersion",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("geom", gis_models.MultiPolygonField(blank=True, null=True, srid=4326)),
                ("geometry", models.JSONField(blank=True, null=True)),
                ("reason", models.CharField(blank=True, max_length=255, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("modified_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="parcel_geometry_versions", to="accounts.user")),
                ("parcel", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="geometry_versions", to="parcels.parcel")),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.AddIndex(model_name="parcel", index=models.Index(fields=["organization", "created_at"], name="parcels_par_organiz_111111_idx")),
        migrations.AddIndex(model_name="parcel", index=models.Index(fields=["organization", "status"], name="parcels_par_organiz_222222_idx")),
        migrations.RunPython(backfill_existing_data, migrations.RunPython.noop),
    ]
