from django.urls import path

from .views import ImportJobDetailView, ImportJobExecuteView, ImportJobListCreateView, ImportJobValidateView

urlpatterns = [
    path("", ImportJobListCreateView.as_view(), name="import-job-list-create"),
    path("<int:pk>/", ImportJobDetailView.as_view(), name="import-job-detail"),
    path("<int:pk>/validate/", ImportJobValidateView.as_view(), name="import-job-validate"),
    path("<int:pk>/execute/", ImportJobExecuteView.as_view(), name="import-job-execute"),
]
