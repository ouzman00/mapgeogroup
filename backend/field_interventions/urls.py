from rest_framework.routers import DefaultRouter

from .views import FieldInterventionViewSet

router = DefaultRouter()
router.register(r"field-interventions", FieldInterventionViewSet, basename="field-interventions")

urlpatterns = router.urls
