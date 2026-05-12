from rest_framework import serializers

from config.file_validation import validate_csv_file

from .models import ImportJob, ImportRowResult
from .services import _safe_import_payload, _safe_import_raw_row


class ImportRowResultSerializer(serializers.ModelSerializer):
    raw_data = serializers.SerializerMethodField()
    normalized_data = serializers.SerializerMethodField()

    class Meta:
        model = ImportRowResult
        fields = ["id", "row_number", "reference", "status", "raw_data", "normalized_data", "error_message", "created_at"]
        read_only_fields = fields

    def get_raw_data(self, obj):
        return _safe_import_raw_row(obj.raw_data or {})

    def get_normalized_data(self, obj):
        return _safe_import_payload(obj.normalized_data or {})


class ImportJobSerializer(serializers.ModelSerializer):
    rows = ImportRowResultSerializer(many=True, read_only=True)
    organization_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ImportJob
        fields = [
            "id", "job_type", "status", "file", "original_filename", "organization", "organization_name", "created_by", "created_by_name",
            "default_owner", "execute_on_process", "skip_errors", "summary", "error_message", "started_at", "finished_at", "created_at", "updated_at", "rows",
        ]
        read_only_fields = [
            "id", "status", "summary", "error_message", "started_at", "finished_at", "created_at", "updated_at", "rows",
            "organization_name", "created_by_name", "created_by",
        ]
        extra_kwargs = {"file": {"write_only": True}}

    def get_organization_name(self, obj):
        return obj.organization.name if obj.organization_id else None

    def get_created_by_name(self, obj):
        full_name = f"{obj.created_by.first_name} {obj.created_by.last_name}".strip()
        return full_name or obj.created_by.company_name or obj.created_by.username

    def validate_file(self, file):
        validate_csv_file(
            file,
            max_size=10 * 1024 * 1024,
            max_rows=5000,
            required_any_columns=("reference", "ref", "parcel_reference"),
        )
        return file
