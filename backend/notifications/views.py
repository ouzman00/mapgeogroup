from django.db.models import Q
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification
from .serializers import NotificationSerializer
from .services import mark_all_as_read


def _notification_ids_from_payload(data):
    raw_ids = data.get("ids") if isinstance(data, dict) else []
    if isinstance(raw_ids, str):
        raw_ids = [item.strip() for item in raw_ids.split(",") if item.strip()]
    if not isinstance(raw_ids, (list, tuple, set)):
        return []
    ids = []
    for value in raw_ids:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    return sorted(set(ids))


class NotificationListView(generics.ListAPIView):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_base_queryset(self):
        return Notification.objects.filter(user=self.request.user)

    def get_queryset(self):
        queryset = self.get_base_queryset().order_by("-created_at")
        params = self.request.query_params

        status_filter = params.get("status") or params.get("is_read")
        if status_filter:
            value = str(status_filter).strip().lower()
            if value in {"unread", "false", "0", "non_lu", "non-lu"}:
                queryset = queryset.filter(is_read=False)
            elif value in {"read", "true", "1", "lu"}:
                queryset = queryset.filter(is_read=True)

        notification_type = params.get("type") or params.get("notification_type")
        if notification_type:
            value = str(notification_type).strip().lower()
            type_map = {
                "document": "document",
                "documents": "document",
                "parcelle": "parcel",
                "parcelles": "parcel",
                "parcel": "parcel",
                "parcels": "parcel",
                "support": "support",
                "ticket": "support",
                "tickets": "support",
            }
            queryset = queryset.filter(notification_type=type_map.get(value, value))

        priority = params.get("priority") or params.get("severity")
        if priority:
            value = str(priority).strip().lower()
            if value in {"erreur", "error", "critical", "critique"}:
                queryset = queryset.filter(Q(severity__icontains="error") | Q(severity__icontains="critical") | Q(notification_type="error"))
            elif value in {"alerte", "warning", "warn"}:
                queryset = queryset.filter(Q(severity__icontains="warning") | Q(severity__icontains="alert") | Q(notification_type="warning"))
            elif value in {"succès", "succes", "success"}:
                queryset = queryset.filter(Q(severity__icontains="success") | Q(notification_type="success"))
            elif value in {"information", "info"}:
                queryset = queryset.filter(Q(severity__isnull=True) | Q(severity="") | Q(notification_type="info"))

        query = params.get("q") or params.get("search")
        if query:
            value = str(query).strip()
            queryset = queryset.filter(
                Q(title__icontains=value)
                | Q(message__icontains=value)
                | Q(notification_type__icontains=value)
                | Q(severity__icontains=value)
                | Q(related_type__icontains=value)
            )

        return queryset

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        base_queryset = self.get_base_queryset()
        if isinstance(response.data, dict):
            response.data["unread_count"] = base_queryset.filter(is_read=False).count()
            response.data["total_count"] = base_queryset.count()
        return response


class NotificationMarkReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        try:
            notification = Notification.objects.get(pk=pk, user=request.user)
        except Notification.DoesNotExist:
            return Response({"detail": "Notification introuvable."}, status=status.HTTP_404_NOT_FOUND)
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response({"detail": "Notification marquée comme lue.", "is_read": True})


class NotificationMarkAllReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        updated = mark_all_as_read(request.user)
        return Response({"detail": f"{updated} notification(s) marquée(s) comme lue(s).", "updated": updated, "unread_count": 0})


class NotificationDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, pk):
        deleted, _ = Notification.objects.filter(pk=pk, user=request.user).delete()
        if not deleted:
            return Response({"detail": "Notification introuvable."}, status=status.HTTP_404_NOT_FOUND)
        unread_count = Notification.objects.filter(user=request.user, is_read=False).count()
        return Response({"detail": "Notification supprimée.", "deleted": deleted, "unread_count": unread_count})


class NotificationBulkDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        ids = _notification_ids_from_payload(request.data or {})
        if not ids:
            return Response({"detail": "Sélectionnez au moins une notification à supprimer."}, status=status.HTTP_400_BAD_REQUEST)
        deleted, _ = Notification.objects.filter(user=request.user, id__in=ids).delete()
        unread_count = Notification.objects.filter(user=request.user, is_read=False).count()
        return Response({"detail": f"{deleted} notification(s) supprimée(s).", "deleted": deleted, "ids": ids, "unread_count": unread_count})
