from rest_framework.routers import DefaultRouter

from .views import ClientActionViewSet

router = DefaultRouter()
router.register(r"client-actions", ClientActionViewSet, basename="client-actions")

urlpatterns = router.urls
