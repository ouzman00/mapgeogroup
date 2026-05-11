from django.contrib import admin

from .models import ClientMapLayer, ClientMapLayerFeature


class ClientMapLayerFeatureInline(admin.TabularInline):
    model = ClientMapLayerFeature
    extra = 0
    fields = ["id", "source_feature_id", "created_at"]
    readonly_fields = ["id", "source_feature_id", "created_at"]
    can_delete = False
    show_change_link = True

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(ClientMapLayer)
class ClientMapLayerAdmin(admin.ModelAdmin):
    list_display = ["id", "name", "client", "layer_type", "data_format", "source_kind", "is_active", "processing_status", "feature_count", "file_size", "created_at"]
    list_filter = ["client", "layer_type", "data_format", "source_kind", "is_active", "processing_status", "created_at"]
    search_fields = ["name", "description", "client__name", "client__code", "original_filename", "service_layers"]
    readonly_fields = ["original_filename", "file_size", "metadata", "uploaded_by", "created_at", "updated_at"]

    def feature_count(self, obj):
        return obj.features.count()
    feature_count.short_description = "Features"


@admin.register(ClientMapLayerFeature)
class ClientMapLayerFeatureAdmin(admin.ModelAdmin):
    list_display = ["id", "layer", "source_feature_id", "created_at"]
    list_filter = ["layer__client", "layer"]
    search_fields = ["source_feature_id", "layer__name", "properties"]
    readonly_fields = ["layer", "geometry", "properties", "source_feature_id", "created_at"]
