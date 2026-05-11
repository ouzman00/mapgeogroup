from django.urls import path
from .views import DocumentBulkDeleteView, DocumentListCreateView, DocumentDetailView, DocumentDownloadView

urlpatterns = [
    path("", DocumentListCreateView.as_view(), name="document-list-create"),
    path("delete-selected/", DocumentBulkDeleteView.as_view(), name="document-delete-selected"),
    path("<int:pk>/download/", DocumentDownloadView.as_view(), name="document-download"),
    path("<int:pk>/", DocumentDetailView.as_view(), name="document-detail"),
]