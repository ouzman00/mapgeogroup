from django.db.models import Avg, Case, IntegerField, OuterRef, Subquery, Sum, Value, When
from django.db.models.functions import Coalesce
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import filter_organizations_for_user, filter_parcels_for_user, get_readable_organization_ids, is_admin_user
from documents.models import ParcelDocument
from documents.services import get_visible_documents_for_user
from notifications.models import Notification
from organizations.models import Organization
from parcels.models import Parcel, ParcelTimelineEvent
from parcels.services import STATUS_PROGRESS_MAP
from support.models import SupportTicket


class DashboardStatsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        parcels_qs = filter_parcels_for_user(
            Parcel.objects.filter(archived_at__isnull=True),
            user,
        )
        clients_qs = filter_organizations_for_user(Organization.objects.filter(organization_type="client"), user)
        documents_qs = get_visible_documents_for_user(user, ParcelDocument.objects.all())

        if is_admin_user(user):
            support_qs = SupportTicket.objects.all()
        else:
            org_ids = get_readable_organization_ids(user) or []
            if getattr(user, "role", None) == "client":
                support_qs = SupportTicket.objects.filter(user=user).distinct()
            else:
                support_qs = (SupportTicket.objects.filter(user=user) | SupportTicket.objects.filter(parcel__organization_id__in=org_ids)).distinct()

        notifications_qs = Notification.objects.filter(user=user)

        latest_progress = ParcelTimelineEvent.objects.filter(
            parcel_id=OuterRef("pk"),
            progress__isnull=False,
        ).order_by("-event_date", "-id").values("progress")[:1]
        status_progress = Case(
            *(When(status=status_key, then=Value(progress)) for status_key, progress in STATUS_PROGRESS_MAP.items()),
            default=Value(0),
            output_field=IntegerField(),
        )
        progress_average = parcels_qs.annotate(
            dashboard_progress=Coalesce(
                Subquery(latest_progress, output_field=IntegerField()),
                status_progress,
            )
        ).aggregate(value=Avg("dashboard_progress"))["value"]
        average_progress = round(progress_average or 0)

        blocked_count = parcels_qs.filter(status="disputed").count()
        total_area = parcels_qs.aggregate(value=Sum("area"))["value"] or 0

        return Response({
            "total_parcels": parcels_qs.count(),
            "active_parcels": parcels_qs.exclude(status="completed").count(),
            "completed_parcels": parcels_qs.filter(status="completed").count(),
            "ready_parcels": parcels_qs.filter(status="ready").count(),
            "to_verify_parcels": parcels_qs.filter(status="to_verify").count(),
            "blocked_parcels": blocked_count,
            "disputed_parcels": blocked_count,
            "average_progress": average_progress,
            "total_area": total_area,
            "total_documents": documents_qs.count(),
            "validated_documents": documents_qs.filter(status__in=["validated", "final"]).count(),
            "draft_documents": documents_qs.filter(status="draft").count(),
            "unread_notifications": notifications_qs.filter(is_read=False).count(),
            "open_support_tickets": support_qs.filter(status__in=["open", "in_progress"]).count(),
            "urgent_support_tickets": support_qs.filter(priority="urgent", status__in=["open", "in_progress"]).count(),
            "active_clients": clients_qs.filter(status="active").count(),
            "prospect_clients": clients_qs.filter(status="prospect").count(),
        })
