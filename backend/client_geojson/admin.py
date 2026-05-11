from django.contrib import admin

from .models import GeoJsonLayer


@admin.register(GeoJsonLayer)
class GeoJsonLayerAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "client", "layer_type", "is_active", "file_size", "created_at"]
    list_filter = ["client", "layer_type", "is_active", "created_at"]
    search_fields = ["name", "description", "client__name", "client__code", "original_filename"]
    readonly_fields = ["original_filename", "file_size", "metadata", "uploaded_by", "created_at", "updated_at"]
