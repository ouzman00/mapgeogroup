from django.conf import settings
from django.contrib import admin
from django.db import connections
from django.http import JsonResponse
from django.urls import include, path
from accounts.views import CookieTokenRefreshView


def health_check(_request):
    database_status = "ok"
    try:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        database_status = "unavailable"
    if not settings.DEBUG:
        return JsonResponse({"status": "ok" if database_status == "ok" else "degraded"})
    return JsonResponse({
        "status": "ok" if database_status == "ok" else "degraded",
        "app": "MAPGEO Backend",
        "database": database_status,
        "schema": getattr(settings, "DB_SCHEMA", "donnees_mapgeo"),
    })


urlpatterns = [
    path("api/", include("client_actions.urls")),
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health-check"),
    path("api/auth/refresh/", CookieTokenRefreshView.as_view(), name="token-refresh"),
    path("api/accounts/", include("accounts.urls")),
    path("api/organizations/", include("organizations.urls")),
    path("api/parcels/", include("parcels.urls")),
    path("api/documents/", include("documents.urls")),
    path("api/notifications/", include("notifications.urls")),
    path("api/support/", include("support.urls")),
    path("api/dashboard/", include("dashboard.urls")),
    path("api/imports/", include("imports.urls")),
    path("api/map/", include("maplayers.urls")),
    path("api/", include("client_geojson.urls")),
    path("api/", include("client_map_layers.urls")),
]

# Les fichiers médias privés ne sont pas exposés directement. Utiliser les vues API authentifiées.
