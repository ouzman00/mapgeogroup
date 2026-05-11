from django.contrib.auth import get_user_model

from .models import Notification


def notify_user(
    user,
    title,
    message,
    notification_type="info",
    *,
    severity=None,
    target_url=None,
    related_type=None,
    related_id=None,
):
    if not user or not getattr(user, "pk", None):
        return None
    return Notification.objects.create(
        user=user,
        title=title,
        message=message,
        notification_type=notification_type,
        severity=severity,
        target_url=target_url,
        related_type=related_type,
        related_id=related_id,
    )


def notify_client_users(
    client,
    title,
    message,
    notification_type="info",
    *,
    severity=None,
    target_url=None,
    related_type=None,
    related_id=None,
):
    """Crée une notification pour tous les utilisateurs actifs rattachés à un client."""
    client_id = getattr(client, "pk", client)
    if not client_id:
        return 0

    User = get_user_model()
    users = User.objects.filter(client_id=client_id, is_active=True).only("id")
    notifications = [
        Notification(
            user=user,
            title=title,
            message=message,
            notification_type=notification_type,
            severity=severity,
            target_url=target_url,
            related_type=related_type,
            related_id=related_id,
        )
        for user in users
    ]
    if not notifications:
        return 0
    Notification.objects.bulk_create(notifications)
    return len(notifications)


def mark_all_as_read(user) -> int:
    return Notification.objects.filter(user=user, is_read=False).update(is_read=True)
