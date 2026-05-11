from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ("id", "username", "email", "role", "client", "client_code", "company_name", "is_verified", "is_staff")
    list_filter = ("role", "client", "is_verified", "is_staff", "is_superuser", "is_active")
    search_fields = ("username", "email", "client_code", "client__name", "client__code", "first_name", "last_name", "company_name")
    fieldsets = BaseUserAdmin.fieldsets + (("Métadonnées MAPGEO", {"fields": ("role", "client", "client_code", "company_name", "phone", "is_verified")}),)
