import json
from datetime import timezone as datetime_timezone

from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.db import connection, transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import serializers
from rest_framework.exceptions import APIException

from documents.serializers import ParcelDocumentSerializer
from documents.services import get_visible_documents_for_user
from organizations.models import Organization, OrganizationMembership

from .models import Parcel, ParcelGeometryVersion, ParcelSide, ParcelTimelineEvent
from .status_utils import normalize_parcel_status
from .services import (
    centroid_from_geometry,
    compute_area_perimeter_from_geometry,
    create_geometry_version,
    create_geometry_version_from_geom,
    derive_organization_for_owner,
    geos_to_geojson,
    geometry_to_geos,
    get_parcel_progress,
    normalize_geojson,
    point_from_lon_lat,
    polygon_from_coordinate_text,
)

User = get_user_model()

def _projected_point_to_wgs84(point):
    if point is None:
        return None
    try:
        clone = point.clone()
        if not clone.srid:
            clone.srid = 32628
        clone.transform(4326)
        return clone
    except Exception:
        return None


def _parcel_projected_centroid_point(obj):
    if getattr(obj, "centroid_geom", None) is not None:
        return obj.centroid_geom

    geom = getattr(obj, "geom", None)
    if geom is not None:
        try:
            return geom.centroid
        except Exception:
            pass

    try:
        easting = obj.longitude
        northing = obj.latitude
        if easting is not None and northing is not None:
            return Point(float(easting), float(northing), srid=32628)
    except (TypeError, ValueError):
        return None

    return None


def _parcel_centroid_lon_lat(obj):
    point = _projected_point_to_wgs84(_parcel_projected_centroid_point(obj))
    if point is None:
        return (None, None)
    return (point.x, point.y)


class ConflictError(APIException):
    status_code = 409
    default_detail = "La géométrie a été modifiée par une autre session."
    default_code = "geometry_conflict"


def _parse_geometry_timestamp(value):
    """
    Accepte une date envoyée par le frontend sous plusieurs formes :
    - datetime Python ;
    - chaîne ISO terminée par Z ;
    - chaîne ISO terminée par +00:00.
    """
    if not value:
        return None

    if hasattr(value, "utcoffset"):
        parsed = value
    else:
        parsed = parse_datetime(str(value))

    if parsed is None:
        return None

    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, datetime_timezone.utc)

    return parsed


def _geometry_timestamp_matches(expected, current):
    expected = _parse_geometry_timestamp(expected)
    current = _parse_geometry_timestamp(current)

    if not expected and not current:
        return True

    if not expected or not current:
        return False

    try:
        return abs((expected - current).total_seconds()) <= 1
    except Exception:
        return False


def _looks_like_wgs84_fields(latitude, longitude):
    """
    Les champs latitude/longitude du modèle stockent en réalité :
    - latitude  = Y / northing EPSG:32628 en mètres ;
    - longitude = X / easting EPSG:32628 en mètres.

    Donc une valeur de type GPS degrés, par exemple latitude=14.7,
    longitude=-17.4, doit être refusée si elle arrive directement.
    """
    if latitude is None or longitude is None:
        return False

    try:
        lat_value = float(latitude)
        lon_value = float(longitude)
    except (TypeError, ValueError):
        return False

    return -90 <= lat_value <= 90 and -180 <= lon_value <= 180


class ParcelSideSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParcelSide
        fields = [
            "id",
            "label",
            "length",
            "point_a",
            "point_b",
            "boundary_state",
            "verification_date",
        ]


class ParcelTimelineEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = ParcelTimelineEvent
        fields = [
            "id",
            "title",
            "description",
            "event_date",
            "progress",
        ]


class ParcelGeometryVersionSerializer(serializers.ModelSerializer):
    modified_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ParcelGeometryVersion
        fields = [
            "id",
            "geometry",
            "reason",
            "modified_by",
            "modified_by_name",
            "created_at",
        ]
        read_only_fields = fields

    def get_modified_by_name(self, obj):
        if not obj.modified_by_id:
            return None

        full_name = f"{obj.modified_by.first_name} {obj.modified_by.last_name}".strip()
        return full_name or obj.modified_by.company_name or obj.modified_by.username


class ParcelListSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    owner_client_code = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    organization_code = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    geometry = serializers.SerializerMethodField()
    crs = serializers.SerializerMethodField()
    centroid_x = serializers.SerializerMethodField()
    centroid_y = serializers.SerializerMethodField()
    centroid_easting = serializers.SerializerMethodField()
    centroid_northing = serializers.SerializerMethodField()
    centroid_lat = serializers.SerializerMethodField()
    centroid_lon = serializers.SerializerMethodField()

    class Meta:
        model = Parcel
        fields = [
            "id",
            "reference",
            "owner",
            "organization",
            "title_number",
            "parcel_number",
            "section",
            "location",
            "address",
            "village",
            "commune",
            "department",
            "region",
            "land_use",
            "area",
            "perimeter",
            "status",
            "progress",
            "survey_date",
            "method",
            "latitude",
            "longitude",
            "centroid_x",
            "centroid_y",
            "centroid_easting",
            "centroid_northing",
            "centroid_lat",
            "centroid_lon",
            "crs",
            "geometry",
            "geometry_updated_at",
            "archived_at",
            "archived_by",
            "owner_name",
            "owner_client_code",
            "organization_name",
            "organization_code",
            "created_at",
            "updated_at",
        ]

    def get_geometry(self, obj):
        return geos_to_geojson(obj.geom) if obj.geom is not None else obj.geometry

    def get_crs(self, obj):
        return "EPSG:32628"

    def get_centroid_x(self, obj):
        return obj.longitude

    def get_centroid_y(self, obj):
        return obj.latitude

    def get_centroid_easting(self, obj):
        return obj.longitude

    def get_centroid_northing(self, obj):
        return obj.latitude

    def get_centroid_lat(self, obj):
        _, lat = _parcel_centroid_lon_lat(obj)
        return lat

    def get_centroid_lon(self, obj):
        lon, _ = _parcel_centroid_lon_lat(obj)
        return lon

    def get_owner_name(self, obj):
        full_name = f"{obj.owner.first_name} {obj.owner.last_name}".strip()
        return full_name or obj.owner.company_name or obj.owner.username

    def get_owner_client_code(self, obj):
        return obj.owner.client_code

    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization_id else None

    def get_organization_code(self, obj):
        return obj.organization.code if obj.organization_id else None

    def get_progress(self, obj):
        return get_parcel_progress(obj)


class ParcelMapSerializer(serializers.ModelSerializer):
    """Serializer léger réservé à la fenêtre cartographique.

    Il évite d'exposer toute la fiche parcellaire à chaque déplacement de carte
    et peut simplifier la géométrie côté serveur lorsque le frontend le demande.
    """

    owner_name = serializers.SerializerMethodField()
    owner_client_code = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    organization_code = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    geometry = serializers.SerializerMethodField()
    crs = serializers.SerializerMethodField()
    centroid_lat = serializers.SerializerMethodField()
    centroid_lon = serializers.SerializerMethodField()

    class Meta:
        model = Parcel
        fields = [
            "id",
            "reference",
            "owner",
            "organization",
            "status",
            "progress",
            "commune",
            "department",
            "region",
            "area",
            "centroid_lat",
            "centroid_lon",
            "crs",
            "geometry",
            "geometry_updated_at",
            "owner_name",
            "owner_client_code",
            "organization_name",
            "organization_code",
            "updated_at",
        ]

    def _simplified_geom(self, obj):
        geom = getattr(obj, "geom", None)
        if geom is None:
            return None
        tolerance = self.context.get("map_simplify_tolerance") or 0
        try:
            tolerance = float(tolerance)
        except (TypeError, ValueError):
            tolerance = 0
        if tolerance <= 0:
            return geom
        try:
            return geom.simplify(tolerance, preserve_topology=True)
        except Exception:
            return geom

    def get_geometry(self, obj):
        geom = self._simplified_geom(obj)
        return geos_to_geojson(geom) if geom is not None else obj.geometry

    def get_crs(self, obj):
        return "EPSG:32628"

    def get_centroid_lat(self, obj):
        _, lat = _parcel_centroid_lon_lat(obj)
        return lat

    def get_centroid_lon(self, obj):
        lon, _ = _parcel_centroid_lon_lat(obj)
        return lon

    def get_owner_name(self, obj):
        full_name = f"{obj.owner.first_name} {obj.owner.last_name}".strip()
        return full_name or obj.owner.company_name or obj.owner.username

    def get_owner_client_code(self, obj):
        return obj.owner.client_code

    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization_id else None

    def get_organization_code(self, obj):
        return obj.organization.code if obj.organization_id else None

    def get_progress(self, obj):
        return get_parcel_progress(obj)


class ParcelDetailSerializer(serializers.ModelSerializer):
    owner = serializers.PrimaryKeyRelatedField(read_only=True)
    owner_name = serializers.SerializerMethodField()
    owner_client_code = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    organization_code = serializers.SerializerMethodField()
    geometry = serializers.SerializerMethodField()
    sides = ParcelSideSerializer(many=True, read_only=True)
    timeline_events = ParcelTimelineEventSerializer(many=True, read_only=True)
    geometry_versions = ParcelGeometryVersionSerializer(many=True, read_only=True)
    documents = serializers.SerializerMethodField()
    computed_area = serializers.SerializerMethodField()
    computed_perimeter = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    crs = serializers.SerializerMethodField()
    centroid_x = serializers.SerializerMethodField()
    centroid_y = serializers.SerializerMethodField()
    centroid_easting = serializers.SerializerMethodField()
    centroid_northing = serializers.SerializerMethodField()
    centroid_lat = serializers.SerializerMethodField()
    centroid_lon = serializers.SerializerMethodField()

    class Meta:
        model = Parcel
        fields = [
            "id",
            "reference",
            "owner",
            "owner_name",
            "owner_client_code",
            "organization",
            "organization_name",
            "organization_code",
            "title_number",
            "parcel_number",
            "section",
            "location",
            "address",
            "village",
            "commune",
            "department",
            "region",
            "land_use",
            "area",
            "perimeter",
            "computed_area",
            "computed_perimeter",
            "progress",
            "status",
            "survey_date",
            "method",
            "latitude",
            "longitude",
            "centroid_x",
            "centroid_y",
            "centroid_easting",
            "centroid_northing",
            "centroid_lat",
            "centroid_lon",
            "crs",
            "geometry",
            "geometry_updated_at",
            "archived_at",
            "archived_by",
            "orientation",
            "access_info",
            "risk_level",
            "notes",
            "sides",
            "timeline_events",
            "documents",
            "geometry_versions",
            "created_at",
            "updated_at",
        ]

    def get_geometry(self, obj):
        return geos_to_geojson(obj.geom) if obj.geom is not None else obj.geometry

    def get_crs(self, obj):
        return "EPSG:32628"

    def get_centroid_x(self, obj):
        return obj.longitude

    def get_centroid_y(self, obj):
        return obj.latitude

    def get_centroid_easting(self, obj):
        return obj.longitude

    def get_centroid_northing(self, obj):
        return obj.latitude

    def get_centroid_lat(self, obj):
        _, lat = _parcel_centroid_lon_lat(obj)
        return lat

    def get_centroid_lon(self, obj):
        lon, _ = _parcel_centroid_lon_lat(obj)
        return lon

    def get_owner_name(self, obj):
        full_name = f"{obj.owner.first_name} {obj.owner.last_name}".strip()
        return full_name or obj.owner.company_name or obj.owner.username

    def get_owner_client_code(self, obj):
        return obj.owner.client_code

    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization_id else None

    def get_organization_code(self, obj):
        return obj.organization.code if obj.organization_id else None

    def get_documents(self, obj):
        request = self.context.get("request")
        queryset = obj.documents.none()

        if request:
            queryset = get_visible_documents_for_user(request.user, obj.documents.all())

        return ParcelDocumentSerializer(queryset, many=True, context=self.context).data

    def get_computed_area(self, obj):
        area, _ = compute_area_perimeter_from_geometry(geom=obj.geom)
        return area

    def get_computed_perimeter(self, obj):
        _, perimeter = compute_area_perimeter_from_geometry(geom=obj.geom)
        return perimeter

    def get_progress(self, obj):
        return get_parcel_progress(obj)


class ParcelCreateUpdateSerializer(serializers.ModelSerializer):
    owner = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(role="client"),
        required=False,
    )
    organization = serializers.PrimaryKeyRelatedField(
        queryset=Organization.objects.filter(organization_type="client"),
        required=False,
        allow_null=True,
    )

    geometry = serializers.JSONField(required=False, allow_null=True)
    sides = ParcelSideSerializer(many=True, required=False)
    timeline_events = ParcelTimelineEventSerializer(many=True, required=False)

    # Ces champs sont calculés automatiquement depuis geometry/geom.
    # Ils doivent donc être optionnels à l'entrée API.
    area = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    perimeter = serializers.DecimalField(
        max_digits=14,
        decimal_places=2,
        required=False,
        allow_null=True,
    )
    latitude = serializers.DecimalField(
        max_digits=14,
        decimal_places=3,
        required=False,
        allow_null=True,
    )
    longitude = serializers.DecimalField(
        max_digits=14,
        decimal_places=3,
        required=False,
        allow_null=True,
    )
    centroid_easting = serializers.DecimalField(
        max_digits=14,
        decimal_places=3,
        required=False,
        allow_null=True,
        write_only=True,
    )
    centroid_northing = serializers.DecimalField(
        max_digits=14,
        decimal_places=3,
        required=False,
        allow_null=True,
        write_only=True,
    )

    coordinates_text = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
    )
    geometry_change_reason = serializers.CharField(
        write_only=True,
        required=False,
        allow_blank=True,
    )

    expected_geometry_updated_at = serializers.DateTimeField(
        write_only=True,
        required=False,
        allow_null=True,
    )

    geometry_updated_at = serializers.DateTimeField(read_only=True)

    class Meta:
        model = Parcel
        fields = [
            "id",
            "reference",
            "owner",
            "organization",
            "title_number",
            "parcel_number",
            "section",
            "location",
            "address",
            "village",
            "commune",
            "department",
            "region",
            "land_use",
            "area",
            "perimeter",
            "status",
            "survey_date",
            "method",
            "latitude",
            "longitude",
            "centroid_easting",
            "centroid_northing",
            "geometry",
            "geometry_updated_at",
            "archived_at",
            "archived_by",
            "coordinates_text",
            "geometry_change_reason",
            "expected_geometry_updated_at",
            "orientation",
            "access_info",
            "risk_level",
            "notes",
            "sides",
            "timeline_events",
        ]
        read_only_fields = ["archived_at", "archived_by"]

    def validate_status(self, value):
        normalized = normalize_parcel_status(value)

        if not normalized:
            valid = ", ".join(choice[0] for choice in Parcel.STATUS_CHOICES)
            raise serializers.ValidationError(
                f"Statut parcelle invalide. Valeurs acceptées : {valid}."
            )

        return normalized

    def validate_owner(self, value):
        request = self.context.get("request")

        if request and getattr(request.user, "role", None) == "client":
            raise serializers.ValidationError("Le portail client est en lecture seule pour les parcelles.")

        if value and getattr(value, "role", None) != "client":
            raise serializers.ValidationError(
                "Le propriétaire doit être un utilisateur client."
            )

        return value

    def validate_organization(self, value):
        request = self.context.get("request")

        if request and getattr(request.user, "role", None) == "client":
            raise serializers.ValidationError("Le portail client est en lecture seule pour les parcelles.")

        return value

    def validate(self, attrs):
        coordinates_text = attrs.pop("coordinates_text", None)
        centroid_easting = attrs.pop("centroid_easting", None)
        centroid_northing = attrs.pop("centroid_northing", None)

        if centroid_easting is not None and "longitude" not in attrs:
            attrs["longitude"] = centroid_easting
        if centroid_northing is not None and "latitude" not in attrs:
            attrs["latitude"] = centroid_northing

        request = self.context.get("request")

        if request and getattr(request.user, "role", None) == "client":
            raise serializers.ValidationError("Le portail client est en lecture seule pour les parcelles.")

        expected_geometry_updated_at = attrs.pop(
            "expected_geometry_updated_at",
            None,
        )

        if expected_geometry_updated_at is None:
            expected_geometry_updated_at = self.initial_data.get(
                "expected_geometry_updated_at"
            )

        if expected_geometry_updated_at is None:
            expected_geometry_updated_at = self.initial_data.get(
                "geometry_updated_at"
            )

        expected_geometry_updated_at = _parse_geometry_timestamp(
            expected_geometry_updated_at
        )

        geometry_provided = "geometry" in attrs or bool(coordinates_text)

        if self.instance is not None and geometry_provided:
            current_geometry_updated_at = getattr(
                self.instance,
                "geometry_updated_at",
                None,
            )

            if current_geometry_updated_at and expected_geometry_updated_at is None:
                raise ConflictError(
                    {
                        "detail": (
                            "Timestamp géométrique manquant. Rechargez la parcelle "
                            "avant de sauvegarder afin d'éviter d'écraser une modification QGIS/API."
                        ),
                        "geometry_updated_at": current_geometry_updated_at.isoformat(),
                    }
                )

            if (
                current_geometry_updated_at
                and expected_geometry_updated_at is not None
                and not _geometry_timestamp_matches(
                    expected_geometry_updated_at,
                    current_geometry_updated_at,
                )
            ):
                raise ConflictError(
                    {
                        "detail": (
                            "La géométrie a été modifiée depuis son chargement. "
                            "Rechargez la parcelle avant de sauvegarder."
                        ),
                        "geometry_updated_at": current_geometry_updated_at.isoformat(),
                    }
                )

        geometry = attrs.get("geometry")

        if "geometry" in attrs and geometry is None:
            attrs["geometry"] = None
        elif geometry is not None:
            attrs["geometry"] = normalize_geojson(geometry)
        elif coordinates_text:
            attrs["geometry"] = polygon_from_coordinate_text(coordinates_text)

        latitude = attrs.get("latitude")  # Y / northing EPSG:32628
        longitude = attrs.get("longitude")  # X / easting EPSG:32628

        if latitude is not None and not (abs(float(latitude)) < 10_000_000):
            raise serializers.ValidationError({
                "latitude": "Y / northing EPSG:32628 invalide."
            })

        if longitude is not None and not (abs(float(longitude)) < 10_000_000):
            raise serializers.ValidationError({
                "longitude": "X / easting EPSG:32628 invalide."
            })

        if _looks_like_wgs84_fields(latitude, longitude):
            raise serializers.ValidationError({
                "latitude": (
                    "Les champs latitude/longitude semblent être en degrés GPS. "
                    "Le projet attend Y/X projetés en mètres EPSG:32628."
                ),
                "longitude": (
                    "Les champs latitude/longitude semblent être en degrés GPS. "
                    "Le projet attend Y/X projetés en mètres EPSG:32628."
                ),
            })

        owner_provided = "owner" in attrs
        organization_provided = "organization" in attrs

        owner = attrs.get("owner") if owner_provided else getattr(
            self.instance,
            "owner",
            None,
        )
        organization = attrs.get("organization") if organization_provided else getattr(
            self.instance,
            "organization",
            None,
        )

        if self.instance is None and owner is None:
            raise serializers.ValidationError(
                {"owner": "Le propriétaire client est obligatoire."}
            )

        if owner and getattr(owner, "role", None) != "client":
            raise serializers.ValidationError(
                {"owner": "Le propriétaire doit être un utilisateur client."}
            )

        if owner and (
            organization is None or (owner_provided and not organization_provided)
        ):
            organization = derive_organization_for_owner(owner)
            attrs["organization"] = organization

        if owner and organization:
            membership_exists = OrganizationMembership.objects.filter(
                user=owner,
                organization=organization,
                is_active=True,
            ).exists()

            if not membership_exists:
                raise serializers.ValidationError(
                    {
                        "owner": (
                            "Le propriétaire choisi n'appartient pas "
                            "à l'organisation sélectionnée."
                        )
                    }
                )

        elif owner and organization is None:
            organization = derive_organization_for_owner(owner)
            attrs["organization"] = organization

        effective_organization_for_validation = attrs.get("organization") if "organization" in attrs else organization
        if effective_organization_for_validation is None:
            raise serializers.ValidationError({
                "organization": "Une organisation cliente est obligatoire pour rattacher la parcelle."
            })

        reference = (attrs.get("reference") or getattr(self.instance, "reference", "") or "").strip()
        effective_organization = attrs.get("organization") if "organization" in attrs else getattr(self.instance, "organization", None)
        if reference and effective_organization:
            duplicate_qs = Parcel.objects.filter(
                reference__iexact=reference,
                organization=effective_organization,
                archived_at__isnull=True,
            )
            if self.instance is not None:
                duplicate_qs = duplicate_qs.exclude(pk=self.instance.pk)
            if duplicate_qs.exists():
                raise serializers.ValidationError({
                    "reference": "Cette référence existe déjà dans cette organisation active."
                })

        geometry = attrs.get("geometry")

        if "geometry" in attrs and geometry is None:
            attrs["geom"] = None
            attrs["geometry"] = None
            attrs["centroid_geom"] = None
            attrs["latitude"] = None
            attrs["longitude"] = None
            attrs["area"] = attrs.get("area", 0) or 0
            attrs["perimeter"] = 0
            attrs["geometry_updated_at"] = None

        elif geometry:
            geos = geometry_to_geos(geometry)

            attrs["geom"] = geos
            attrs["geometry"] = geos_to_geojson(geos)

            lat, lon = centroid_from_geometry(geom=geos)
            attrs["latitude"] = lat
            attrs["longitude"] = lon

            attrs["centroid_geom"] = (
                point_from_lon_lat(lon, lat)
                if lat is not None and lon is not None
                else None
            )

            area, perimeter = compute_area_perimeter_from_geometry(geom=geos)

            if area is not None:
                attrs["area"] = area

            if perimeter is not None:
                attrs["perimeter"] = perimeter

            attrs["geometry_updated_at"] = timezone.now()

        return attrs

    def _sync_children(self, parcel, sides, timeline_events):
        if sides is not None:
            parcel.sides.all().delete()
            ParcelSide.objects.bulk_create(
                [ParcelSide(parcel=parcel, **item) for item in sides]
            )

        if timeline_events is not None:
            parcel.timeline_events.all().delete()
            ParcelTimelineEvent.objects.bulk_create(
                [
                    ParcelTimelineEvent(parcel=parcel, **item)
                    for item in timeline_events
                ]
            )

    @transaction.atomic
    def create(self, validated_data):
        sides = validated_data.pop("sides", None)
        timeline_events = validated_data.pop("timeline_events", None)
        reason = validated_data.pop("geometry_change_reason", None)

        parcel = super().create(validated_data)

        self._sync_children(parcel, sides, timeline_events)

        if parcel.geom:
            request = self.context.get("request")
            user = request.user if request else None

            create_geometry_version(
                parcel,
                modified_by=user,
                reason=reason or "Création initiale",
            )

        return parcel

    @transaction.atomic
    def update(self, instance, validated_data):
        sides = validated_data.pop("sides", None)
        timeline_events = validated_data.pop("timeline_events", None)
        reason = validated_data.pop("geometry_change_reason", None)

        before_geom = geos_to_geojson(instance.geom) if instance.geom else None
        geometry_before = json.dumps(before_geom, sort_keys=True) if before_geom else None

        if "geom" in validated_data:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT set_config('mapgeo.skip_geom_history', 'on', true)"
                )

        parcel = super().update(instance, validated_data)

        self._sync_children(parcel, sides, timeline_events)

        geometry_after = (
            json.dumps(geos_to_geojson(parcel.geom), sort_keys=True)
            if parcel.geom
            else None
        )

        if geometry_before != geometry_after:
            request = self.context.get("request")
            user = request.user if request else None

            if before_geom:
                create_geometry_version_from_geom(
                    parcel,
                    before_geom,
                    modified_by=user,
                    reason=f"Avant modification — {reason or 'Mise à jour géométrique'}",
                )

            if geometry_after:
                create_geometry_version(
                    parcel,
                    modified_by=user,
                    reason=reason or "Mise à jour géométrique",
                )

        return parcel


class ParcelOwnerOptionSerializer(serializers.ModelSerializer):
    label = serializers.SerializerMethodField()
    organization_id = serializers.SerializerMethodField()
    organization_name = serializers.SerializerMethodField()
    organization_code = serializers.SerializerMethodField()
    organizations = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "client_code",
            "username",
            "first_name",
            "last_name",
            "company_name",
            "label",
            "organization_id",
            "organization_name",
            "organization_code",
            "organizations",
        ]

    def _primary_membership(self, obj):
        memberships = getattr(obj, "_prefetched_objects_cache", {}).get(
            "organization_memberships"
        )

        if memberships is not None:
            active = [item for item in memberships if item.is_active]
            active.sort(key=lambda item: (not item.is_primary, item.id))
            return active[0] if active else None

        return (
            obj.organization_memberships.filter(is_active=True)
            .select_related("organization")
            .order_by("-is_primary", "id")
            .first()
        )

    def get_organizations(self, obj):
        memberships = getattr(obj, "_prefetched_objects_cache", {}).get(
            "organization_memberships"
        )

        if memberships is None:
            memberships = (
                obj.organization_memberships.filter(is_active=True)
                .select_related("organization")
                .order_by("-is_primary", "id")
            )
        else:
            memberships = sorted(
                [item for item in memberships if item.is_active],
                key=lambda item: (not item.is_primary, item.id),
            )

        return [
            {
                "id": membership.organization_id,
                "name": membership.organization.name,
                "code": membership.organization.code,
                "is_primary": membership.is_primary,
            }
            for membership in memberships
        ]

    def get_label(self, obj):
        membership = self._primary_membership(obj)
        org = membership.organization if membership else None

        name = (
            f"{obj.first_name} {obj.last_name}".strip()
            or obj.company_name
            or obj.username
        )

        suffix = org.code if org else obj.client_code

        return f"{name} · {suffix}" if suffix else name

    def get_organization_id(self, obj):
        membership = self._primary_membership(obj)
        return membership.organization_id if membership else None

    def get_organization_name(self, obj):
        membership = self._primary_membership(obj)
        return membership.organization.name if membership else None

    def get_organization_code(self, obj):
        membership = self._primary_membership(obj)
        return membership.organization.code if membership else None
