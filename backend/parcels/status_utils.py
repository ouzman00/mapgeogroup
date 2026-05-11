"""Compatibilité des statuts parcelles entre l'ancien frontend et l'API backend.

Le backend conserve les statuts métier canoniques ci-dessous, mais accepte aussi
les anciens libellés techniques encore présents dans certaines versions du frontend.
"""

CANONICAL_PARCEL_STATUSES = {
    "planned",
    "surveying",
    "processing",
    "draft",
    "ready",
    "completed",
    "disputed",
    "to_verify",
}

PARCEL_STATUS_ALIASES = {
    # Ancien frontend / anciennes maquettes
    "created": "planned",
    "in_progress": "surveying",
    "verification": "to_verify",
    "blocked": "disputed",
    "report_finalized": "completed",
    "finalized": "completed",
    "done": "completed",
    # Aliases fréquents côté UI/API
    "pending": "planned",
    "planned": "planned",
    "surveying": "surveying",
    "processing": "processing",
    "draft": "draft",
    "ready": "ready",
    "completed": "completed",
    "disputed": "disputed",
    "to_verify": "to_verify",
}


def normalize_parcel_status(value: str | None) -> str | None:
    """Retourne le statut canonique ou None si la valeur est vide/inconnue."""
    if value is None:
        return None
    key = str(value).strip().lower()
    if not key:
        return None
    return PARCEL_STATUS_ALIASES.get(key)


def normalize_status_list(raw_value: str | None) -> list[str]:
    """Accepte status=a,b ou status[]=a&status[]=b via une chaîne concaténée."""
    if raw_value is None:
        return []
    values = []
    for item in str(raw_value).replace(";", ",").split(","):
        normalized = normalize_parcel_status(item)
        if normalized and normalized not in values:
            values.append(normalized)
    return values
