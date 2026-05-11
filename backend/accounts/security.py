from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LoginThrottleState:
    is_locked: bool
    attempts: int
    max_attempts: int
    retry_after_seconds: int


def _client_ip(request) -> str:
    forwarded = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")[0].strip()
    return forwarded or request.META.get("REMOTE_ADDR") or "unknown"


def _identity_hash(value: str) -> str:
    normalized = (value or "").strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]


def _cache_key(prefix: str, login: str, request) -> str:
    ip = _client_ip(request)
    return f"auth:{prefix}:{_identity_hash(login)}:{_identity_hash(ip)}"


def _max_attempts() -> int:
    return int(getattr(settings, "LOGIN_MAX_FAILED_ATTEMPTS", 5) or 5)


def _lockout_seconds() -> int:
    minutes = int(getattr(settings, "LOGIN_LOCKOUT_MINUTES", 15) or 15)
    return max(60, minutes * 60)


def get_login_throttle_state(login: str, request) -> LoginThrottleState:
    lock_key = _cache_key("lock", login, request)
    attempts_key = _cache_key("attempts", login, request)
    locked_until = cache.get(lock_key)
    now = timezone.now().timestamp()
    retry_after = max(0, int(float(locked_until or 0) - now))
    attempts = int(cache.get(attempts_key) or 0)
    return LoginThrottleState(
        is_locked=retry_after > 0,
        attempts=attempts,
        max_attempts=_max_attempts(),
        retry_after_seconds=retry_after,
    )


def register_login_failure(login: str, request, *, user: Any = None) -> LoginThrottleState:
    attempts_key = _cache_key("attempts", login, request)
    lock_key = _cache_key("lock", login, request)
    lockout_seconds = _lockout_seconds()
    max_attempts = _max_attempts()

    try:
        attempts = cache.incr(attempts_key)
    except ValueError:
        attempts = 1
        cache.set(attempts_key, attempts, timeout=lockout_seconds)

    if attempts >= max_attempts:
        locked_until = timezone.now().timestamp() + lockout_seconds
        cache.set(lock_key, locked_until, timeout=lockout_seconds)
        logger.warning(
            "Blocage temporaire de connexion après %s tentatives échouées user_id=%s ip=%s login_hash=%s",
            attempts,
            getattr(user, "pk", None),
            _client_ip(request),
            _identity_hash(login),
        )

    return get_login_throttle_state(login, request)


def reset_login_failures(login: str, request) -> None:
    cache.delete(_cache_key("attempts", login, request))
    cache.delete(_cache_key("lock", login, request))


def retry_after_label(seconds: int) -> str:
    minutes = max(1, int(round((seconds or 0) / 60)))
    return f"{minutes} minute{'s' if minutes > 1 else ''}"


@dataclass(frozen=True)
class PublicActionThrottleState:
    is_locked: bool
    attempts: int
    max_attempts: int
    retry_after_seconds: int


def _public_action_limits(scope: str) -> tuple[int, int]:
    if scope == "activation":
        max_attempts = int(getattr(settings, "ACTIVATION_MAX_ATTEMPTS", 8) or 8)
        window_minutes = int(getattr(settings, "ACTIVATION_WINDOW_MINUTES", 30) or 30)
    else:
        max_attempts = int(getattr(settings, "PASSWORD_RESET_MAX_ATTEMPTS", 5) or 5)
        window_minutes = int(getattr(settings, "PASSWORD_RESET_WINDOW_MINUTES", 30) or 30)
    return max(1, max_attempts), max(60, window_minutes * 60)


def _public_action_cache_key(scope: str, kind: str, identifier: str, request) -> str:
    ip = _client_ip(request)
    safe_scope = "".join(ch for ch in str(scope or "auth") if ch.isalnum() or ch in {"_", "-"})
    return f"auth:{safe_scope}:{kind}:{_identity_hash(identifier)}:{_identity_hash(ip)}"


def get_public_action_throttle_state(scope: str, identifier: str, request) -> PublicActionThrottleState:
    max_attempts, window_seconds = _public_action_limits(scope)
    lock_key = _public_action_cache_key(scope, "lock", identifier, request)
    attempts_key = _public_action_cache_key(scope, "attempts", identifier, request)
    locked_until = cache.get(lock_key)
    now = timezone.now().timestamp()
    retry_after = max(0, int(float(locked_until or 0) - now))
    attempts = int(cache.get(attempts_key) or 0)
    return PublicActionThrottleState(
        is_locked=retry_after > 0,
        attempts=attempts,
        max_attempts=max_attempts,
        retry_after_seconds=retry_after,
    )


def register_public_action_attempt(scope: str, identifier: str, request) -> PublicActionThrottleState:
    max_attempts, window_seconds = _public_action_limits(scope)
    attempts_key = _public_action_cache_key(scope, "attempts", identifier, request)
    lock_key = _public_action_cache_key(scope, "lock", identifier, request)

    try:
        attempts = cache.incr(attempts_key)
    except ValueError:
        attempts = 1
        cache.set(attempts_key, attempts, timeout=window_seconds)

    if attempts >= max_attempts:
        locked_until = timezone.now().timestamp() + window_seconds
        cache.set(lock_key, locked_until, timeout=window_seconds)
        logger.warning(
            "Blocage temporaire action publique scope=%s après %s tentative(s) ip=%s identifier_hash=%s",
            scope,
            attempts,
            _client_ip(request),
            _identity_hash(identifier),
        )

    return get_public_action_throttle_state(scope, identifier, request)


def reset_public_action_throttle(scope: str, identifier: str, request) -> None:
    cache.delete(_public_action_cache_key(scope, "attempts", identifier, request))
    cache.delete(_public_action_cache_key(scope, "lock", identifier, request))
