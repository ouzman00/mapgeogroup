from django.urls import path

from .views import (
    ParcelCsvImportView,
    ParcelDetailView,
    ParcelGeometryHistoryView,
    ParcelListCreateView,
    ParcelMapView,
    ParcelOwnerOptionsView,
    ParcelProgressView,
)

urlpatterns = [
    path("", ParcelListCreateView.as_view(), name="parcel-list-create"),
    path("import-csv/", ParcelCsvImportView.as_view(), name="parcel-import-csv"),
    path("owners/", ParcelOwnerOptionsView.as_view(), name="parcel-owner-options"),
    path("map/", ParcelMapView.as_view(), name="parcel-map"),
    path("<int:pk>/", ParcelDetailView.as_view(), name="parcel-detail"),
    path("<int:pk>/progress/", ParcelProgressView.as_view(), name="parcel-progress"),
    path("<int:pk>/geometry-history/", ParcelGeometryHistoryView.as_view(), name="parcel-geometry-history"),
]
