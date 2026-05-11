from rest_framework.permissions import BasePermission


class CanViewMapContextLayers(BasePermission):
    """Autorise les couches de contexte cartographique aux utilisateurs connectés.

    Ces couches sont traitées comme des référentiels SIG de contexte, distincts
    des données métier sensibles comme les parcelles/documents/support.
    """

    allowed_roles = {"admin", "manager", "agent", "surveyor", "client"}

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        return getattr(user, "role", None) in self.allowed_roles
