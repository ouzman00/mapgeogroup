from datetime import timedelta

import django_filters
from django.db.models import Q
from django.utils import timezone

from .models import Parcel
from .status_utils import normalize_status_list


class ParcelFilter(django_filters.FilterSet):
    reference = django_filters.CharFilter(field_name="reference", lookup_expr="icontains")
    location = django_filters.CharFilter(method="filter_location")
    client = django_filters.CharFilter(method="filter_client")
    village = django_filters.CharFilter(field_name="village", lookup_expr="icontains")
    commune = django_filters.CharFilter(field_name="commune", lookup_expr="icontains")
    title_number = django_filters.CharFilter(field_name="title_number", lookup_expr="icontains")
    parcel_number = django_filters.CharFilter(field_name="parcel_number", lookup_expr="icontains")
    section = django_filters.CharFilter(field_name="section", lookup_expr="icontains")
    owner_client_code = django_filters.CharFilter(field_name="owner__client_code", lookup_expr="iexact")
    organization = django_filters.NumberFilter(field_name="organization_id")
    organization_id = django_filters.NumberFilter(field_name="organization_id")
    organization_code = django_filters.CharFilter(field_name="organization__code", lookup_expr="iexact")
    status = django_filters.CharFilter(method="filter_status")
    min_area = django_filters.NumberFilter(field_name="area", lookup_expr="gte")
    max_area = django_filters.NumberFilter(field_name="area", lookup_expr="lte")
    owner = django_filters.NumberFilter(field_name="owner_id")
    q = django_filters.CharFilter(method="filter_q")
    period = django_filters.CharFilter(method="filter_period")

    class Meta:
        model = Parcel
        fields = [
            "reference", "location", "village", "commune", "title_number", "parcel_number", "section",
            "owner_client_code", "client", "status", "owner", "organization", "organization_id", "organization_code", "period",
        ]


    def filter_location(self, queryset, name, value):
        value = (value or "").strip()
        if not value:
            return queryset
        return queryset.filter(
            Q(location__icontains=value)
            | Q(commune__icontains=value)
            | Q(village__icontains=value)
            | Q(address__icontains=value)
            | Q(department__icontains=value)
            | Q(region__icontains=value)
        )

    def filter_client(self, queryset, name, value):
        value = (value or "").strip()
        if not value:
            return queryset

        lookup = (
            Q(owner__client_code__iexact=value)
            | Q(owner__username__iexact=value)
            | Q(owner__email__iexact=value)
            | Q(owner__first_name__icontains=value)
            | Q(owner__last_name__icontains=value)
            | Q(owner__company_name__icontains=value)
            | Q(organization__code__iexact=value)
            | Q(organization__name__icontains=value)
        )

        if value.isdigit():
            lookup |= Q(owner_id=int(value)) | Q(organization_id=int(value))

        return queryset.filter(lookup)

    def filter_status(self, queryset, name, value):
        statuses = normalize_status_list(value)
        if not statuses:
            return queryset.none() if value else queryset
        return queryset.filter(status__in=statuses)


    def filter_period(self, queryset, name, value):
        value = (value or "").strip().lower()
        if not value:
            return queryset

        now = timezone.now()
        if value == "today":
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif value == "week":
            start = now - timedelta(days=7)
        elif value == "current":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        elif value == "month":
            start = now - timedelta(days=30)
        elif value == "quarter":
            start = now - timedelta(days=90)
        else:
            return queryset

        return queryset.filter(updated_at__gte=start)

    def filter_q(self, queryset, name, value):
        value = (value or "").strip()
        if not value:
            return queryset
        return queryset.filter(
            Q(reference__icontains=value)
            | Q(location__icontains=value)
            | Q(commune__icontains=value)
            | Q(village__icontains=value)
            | Q(title_number__icontains=value)
            | Q(parcel_number__icontains=value)
            | Q(section__icontains=value)
            | Q(owner__client_code__icontains=value)
            | Q(owner__username__icontains=value)
            | Q(owner__first_name__icontains=value)
            | Q(owner__last_name__icontains=value)
            | Q(owner__company_name__icontains=value)
            | Q(organization__name__icontains=value)
            | Q(organization__code__icontains=value)
        )
