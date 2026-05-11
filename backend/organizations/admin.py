from django.contrib import admin

from .models import Organization, OrganizationMembership


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "organization_type", "status", "created_at")
    search_fields = ("name", "code", "email")
    list_filter = ("organization_type", "status")


@admin.register(OrganizationMembership)
class OrganizationMembershipAdmin(admin.ModelAdmin):
    list_display = ("organization", "user", "role", "is_primary", "is_active")
    search_fields = ("organization__name", "organization__code", "user__username", "user__email")
    list_filter = ("role", "is_primary", "is_active")
