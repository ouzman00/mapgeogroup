from django.contrib import admin

from .models import Commune, Parcel, ParcelGeometryVersion, ParcelSide, ParcelTimelineEvent


class ParcelSideInline(admin.TabularInline):
    model = ParcelSide
    extra = 0


class ParcelTimelineEventInline(admin.TabularInline):
    model = ParcelTimelineEvent
    extra = 0


class ParcelGeometryVersionInline(admin.TabularInline):
    model = ParcelGeometryVersion
    extra = 0
    readonly_fields = ("created_at",)


@admin.register(Commune)
class CommuneAdmin(admin.ModelAdmin):
    list_display = ("id", "nom", "department", "region", "code")
    search_fields = ("nom", "department", "region", "code")
    list_filter = ("region", "department")


@admin.register(Parcel)
class ParcelAdmin(admin.ModelAdmin):
    list_display = ("id", "reference", "owner", "organization", "location", "status", "area", "survey_date", "created_at")
    list_filter = ("status", "region", "department", "commune", "survey_date", "organization")
    search_fields = ("reference", "title_number", "parcel_number", "location", "owner__username", "owner__client_code", "organization__name", "organization__code")
    inlines = [ParcelSideInline, ParcelTimelineEventInline, ParcelGeometryVersionInline]
