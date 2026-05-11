from __future__ import annotations

from collections.abc import Mapping
from rest_framework.views import exception_handler


def _extract_message(payload) -> str:
    if isinstance(payload, Mapping):
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail
        for value in payload.values():
            if isinstance(value, list) and value:
                first = value[0]
                if isinstance(first, str) and first.strip():
                    return first
                return "Erreur de validation."
        return "Une erreur est survenue."
    if isinstance(payload, list):
        return "Erreur de validation."
    if isinstance(payload, str) and payload.strip():
        return payload
    return "Une erreur est survenue."


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return response
    payload = response.data
    response.data = {
        "detail": _extract_message(payload),
        "status_code": response.status_code,
        "errors": payload,
    }
    return response
