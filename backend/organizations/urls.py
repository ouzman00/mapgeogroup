from django.urls import path

from .views import OrganizationDetailView, OrganizationListCreateView, OrganizationLookupView

urlpatterns = [
    path("", OrganizationListCreateView.as_view(), name="organization-list-create"),
    path("lookup/", OrganizationLookupView.as_view(), name="organization-lookup"),
    path("<int:pk>/", OrganizationDetailView.as_view(), name="organization-detail"),
]
