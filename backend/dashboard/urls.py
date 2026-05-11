from django.urls import path
from .views import DashboardStatsView

urlpatterns = [
    path("", DashboardStatsView.as_view(), name="dashboard-stats"),
]