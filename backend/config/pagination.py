from django.conf import settings
from rest_framework.pagination import PageNumberPagination


class StandardResultsSetPagination(PageNumberPagination):
    page_size = getattr(settings, "REST_FRAMEWORK", {}).get("PAGE_SIZE", 20)
    page_size_query_param = "page_size"
    max_page_size = 200


class MapViewportPagination(PageNumberPagination):
    """Pagination dédiée à la carte.

    La carte travaille par emprise BBOX : on autorise un volume supérieur à la
    liste standard, tout en gardant un plafond serveur strict et configurable.
    """

    page_size = getattr(settings, "MAP_VIEWPORT_PAGE_SIZE", 500)
    page_size_query_param = "page_size"
    max_page_size = getattr(settings, "MAP_VIEWPORT_MAX_PAGE_SIZE", 1000)
