from __future__ import annotations

from django.conf import settings


class SecurityHeadersMiddleware:
    """Ajoute des en-têtes sécurité sans dépendance externe.

    Les valeurs restent configurables par environnement pour éviter de casser les
    intégrations cartographiques. En production, le défaut active une CSP API/admin
    conservatrice et des protections navigateur standards.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        response.setdefault("X-Content-Type-Options", "nosniff")
        response.setdefault("X-Frame-Options", "DENY")
        response.setdefault("Referrer-Policy", "same-origin")
        response.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()")

        csp = getattr(settings, "SECURITY_CSP", "")
        if getattr(settings, "SECURITY_CSP_ENABLED", False) and csp:
            header = "Content-Security-Policy-Report-Only" if getattr(settings, "SECURITY_CSP_REPORT_ONLY", False) else "Content-Security-Policy"
            response.setdefault(header, csp)

        return response
