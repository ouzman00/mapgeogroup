from django.contrib import admin

from .models import ImportJob, ImportRowResult


@admin.register(ImportJob)
class ImportJobAdmin(admin.ModelAdmin):
    list_display = ("id", "job_type", "status", "created_by", "organization", "created_at", "finished_at")
    search_fields = ("original_filename", "created_by__username", "organization__name")
    list_filter = ("job_type", "status")


@admin.register(ImportRowResult)
class ImportRowResultAdmin(admin.ModelAdmin):
    list_display = ("job", "row_number", "reference", "status", "created_at")
    search_fields = ("reference", "job__original_filename")
    list_filter = ("status",)
