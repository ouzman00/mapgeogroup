from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# Charge .env.local en priorité (jamais versionné), puis .env comme fallback.
# En production (Render), aucun fichier .env n'est présent : les variables système sont utilisées.
load_dotenv(BASE_DIR / ".env.local", override=False)
load_dotenv(BASE_DIR / ".env", override=False)

# GeoDjango : chemins Windows locaux uniquement si aucune variable d'environnement
# n'est fournie. Sur Render/Linux, ne force pas de chemin Windows : les libs sont
# trouvées par le système après installation via Aptfile.
if os.getenv("GDAL_LIBRARY_PATH"):
    GDAL_LIBRARY_PATH = os.getenv("GDAL_LIBRARY_PATH")
elif os.name == "nt":
    GDAL_LIBRARY_PATH = r"C:\OSGeo4W\bin\gdal308.dll"

if os.getenv("GEOS_LIBRARY_PATH"):
    GEOS_LIBRARY_PATH = os.getenv("GEOS_LIBRARY_PATH")
elif os.name == "nt":
    GEOS_LIBRARY_PATH = r"C:\OSGeo4W\bin\geos_c.dll"


def env(name: str, default: str | None = None) -> str | None:
    return os.getenv(name, default)


def env_bool(name: str, default: bool = False) -> bool:
    value = env(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    raw = env(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError) as exc:
        raise ImproperlyConfigured(f"{name} doit être un entier.") from exc


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in env(name, default).split(",") if item.strip()]


def _normalize_db_engine(value: str | None) -> str:
    normalized = (value or "").strip().lower()

    engine_map = {
        "postgres": "django.contrib.gis.db.backends.postgis",
        "postgresql": "django.contrib.gis.db.backends.postgis",
        "pgsql": "django.contrib.gis.db.backends.postgis",
        "postgis": "django.contrib.gis.db.backends.postgis",
        "django.db.backends.postgresql": "django.contrib.gis.db.backends.postgis",
        "django.contrib.gis.db.backends.postgis": "django.contrib.gis.db.backends.postgis",
    }

    engine = engine_map.get(normalized, value or "django.contrib.gis.db.backends.postgis")
    if "sqlite" in str(engine).lower() or "spatialite" in str(engine).lower():
        raise ImproperlyConfigured(
            "SQLite/SpatiaLite est désactivé pour MapGeo. Utilisez PostgreSQL/PostGIS "
            "avec DATABASE_URL=postgis://mapgeo:mapgeo@127.0.0.1:5432/mapgeo_db."
        )
    return engine


def _database_schema() -> str:
    schema = (env("DB_SCHEMA", "donnees_mapgeo") or "donnees_mapgeo").strip()
    if not schema:
        raise ImproperlyConfigured("DB_SCHEMA ne peut pas être vide.")
    if not schema.replace("_", "a").isalnum() or schema[0].isdigit():
        raise ImproperlyConfigured("DB_SCHEMA doit être un identifiant PostgreSQL simple, ex: donnees_mapgeo.")
    return schema


def _apply_postgres_options(config: dict) -> dict:
    schema = _database_schema()
    options = dict(config.get("OPTIONS") or {})
    existing = str(options.get("options", "")).strip()
    if "search_path" not in existing:
        search_path_option = f"-c search_path={schema},public"
        options["options"] = f"{existing} {search_path_option}".strip()
    config["OPTIONS"] = options
    return config


def database_config_from_url(database_url: str | None):
    if not database_url:
        return None

    parsed = urlparse(database_url)

    scheme_map = {
        "postgres": "django.contrib.gis.db.backends.postgis",
        "postgresql": "django.contrib.gis.db.backends.postgis",
        "pgsql": "django.contrib.gis.db.backends.postgis",
        "postgis": "django.contrib.gis.db.backends.postgis",
    }

    engine = scheme_map.get(parsed.scheme)
    if not engine:
        raise ImproperlyConfigured(
            "DATABASE_URL doit utiliser PostgreSQL/PostGIS, ex: "
            "postgis://mapgeo:mapgeo@127.0.0.1:5432/mapgeo_db."
        )

    options = {}
    if parsed.query:
        for key, values in parse_qs(parsed.query).items():
            if values:
                options[key] = values[-1]

    config = {
        "ENGINE": engine,
        "NAME": parsed.path.lstrip("/") or env("DB_NAME", "mapgeo_db"),
        "USER": parsed.username or env("DB_USER", "mapgeo"),
        "PASSWORD": parsed.password or env("DB_PASSWORD", "mapgeo"),
        "HOST": parsed.hostname or env("DB_HOST", "127.0.0.1"),
        "PORT": str(parsed.port or env("DB_PORT", "5432")),
    }

    if options:
        config["OPTIONS"] = options

    return _apply_postgres_options(config)


DEBUG = env_bool("DJANGO_DEBUG", False)
DJANGO_ENV = (env("DJANGO_ENV", "development" if DEBUG else "production") or "").strip().lower()

SECRET_KEY = env("DJANGO_SECRET_KEY")
_SECRET_KEY_PLACEHOLDERS = {
    "change-me",
    "change-me-with-a-long-random-secret",
    "dev-only-change-me-mapgeo-local-secret-key",
}

if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-change-me-mapgeo-local-secret-key"
    else:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY est obligatoire lorsque DJANGO_DEBUG=False."
        )

if not DEBUG:
    if SECRET_KEY in _SECRET_KEY_PLACEHOLDERS or len(SECRET_KEY) < 32:
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY doit être une valeur de production longue, aléatoire et non présente dans .env.example."
        )

TIME_ZONE = env("DJANGO_TIME_ZONE", "Africa/Dakar")
LANGUAGE_CODE = "fr-fr"

ALLOWED_HOSTS = env_list(
    "DJANGO_ALLOWED_HOSTS",
    "127.0.0.1,localhost" if DEBUG else "",
)

if not DEBUG and (not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS):
    raise ImproperlyConfigured(
        "DJANGO_ALLOWED_HOSTS doit lister explicitement les domaines de production, sans wildcard '*'."
    )

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "corsheaders",
    "django_filters",
    "rest_framework",
    "rest_framework_simplejwt",
    "accounts",
    "organizations",
    "parcels",
    "documents",
    "notifications",
    "support",
    "dashboard",
    "imports",
    "maplayers",
    "client_geojson",
    "client_map_layers",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "config.middleware.SecurityHeadersMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

default_database = database_config_from_url(env("DATABASE_URL")) or _apply_postgres_options({
    "ENGINE": _normalize_db_engine(env("DB_ENGINE", "postgis")),
    "NAME": env("DB_NAME", "mapgeo_db"),
    "USER": env("DB_USER", "mapgeo"),
    "PASSWORD": env("DB_PASSWORD", "mapgeo"),
    "HOST": env("DB_HOST", "127.0.0.1"),
    "PORT": env("DB_PORT", "5432"),
})

DATABASES = {
    "default": default_database,
}

DATABASES["default"]["CONN_MAX_AGE"] = env_int("DB_CONN_MAX_AGE", 60)

if "sqlite" in str(DATABASES["default"].get("ENGINE", "")).lower():
    raise ImproperlyConfigured(
        "SQLite est désactivé. MapGeo utilise uniquement PostgreSQL/PostGIS "
        "dans la base mapgeo_db avec le schéma donnees_mapgeo."
    )

DB_SCHEMA = _database_schema()

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Fichiers privés servis uniquement par des vues API authentifiées.
PRIVATE_MEDIA_ROOT = BASE_DIR / "private_media"
PRIVATE_GEOJSON_ROOT = PRIVATE_MEDIA_ROOT / "geojson"
PRIVATE_MAP_LAYERS_ROOT = PRIVATE_MEDIA_ROOT / "map_layers"
MAX_GEOJSON_UPLOAD_SIZE = env_int("MAX_GEOJSON_UPLOAD_SIZE", 20 * 1024 * 1024)
MAX_GEOJSON_FEATURES = env_int("MAX_GEOJSON_FEATURES", 50000)
MAX_VECTOR_UPLOAD_SIZE = env_int("MAX_VECTOR_UPLOAD_SIZE", 20 * 1024 * 1024)
MAX_IMAGE_OVERLAY_UPLOAD_SIZE = env_int("MAX_IMAGE_OVERLAY_UPLOAD_SIZE", 100 * 1024 * 1024)
MAX_RASTER_UPLOAD_SIZE = env_int("MAX_RASTER_UPLOAD_SIZE", 500 * 1024 * 1024)
MAX_MBTILES_UPLOAD_SIZE = env_int("MAX_MBTILES_UPLOAD_SIZE", 1024 * 1024 * 1024)
MAX_MAP_LAYER_UPLOAD_SIZE = env_int("MAX_MAP_LAYER_UPLOAD_SIZE", 200 * 1024 * 1024)
EXTERNAL_MAP_PROXY_MAX_BYTES = env_int("EXTERNAL_MAP_PROXY_MAX_BYTES", 20 * 1024 * 1024)
EXTERNAL_MAP_PROXY_ALLOWED_HOSTS = env_list("EXTERNAL_MAP_PROXY_ALLOWED_HOSTS")
GEOSERVER_WMS_URL = env("GEOSERVER_WMS_URL", "")
GEOSERVER_WORKSPACE = env("GEOSERVER_WORKSPACE", "")
MAX_WFS_IMPORT_FEATURES = env_int("MAX_WFS_IMPORT_FEATURES", 20000)
MAX_POSTGIS_IMPORT_FEATURES = env_int("MAX_POSTGIS_IMPORT_FEATURES", 20000)
POSTGIS_IMPORT_CONNECT_TIMEOUT = env_int("POSTGIS_IMPORT_CONNECT_TIMEOUT", 10)
POSTGIS_IMPORT_STATEMENT_TIMEOUT_MS = env_int("POSTGIS_IMPORT_STATEMENT_TIMEOUT_MS", 30000)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

cors_allowed_origins = env_list("DJANGO_CORS_ALLOWED_ORIGINS")
cors_allow_all_requested = env_bool("DJANGO_CORS_ALLOW_ALL_ORIGINS", False)

if not DEBUG and cors_allow_all_requested:
    raise ImproperlyConfigured(
        "DJANGO_CORS_ALLOW_ALL_ORIGINS=True est interdit en production."
    )

CORS_ALLOW_ALL_ORIGINS = DEBUG and (cors_allow_all_requested or not cors_allowed_origins)
CORS_ALLOWED_ORIGINS = [] if CORS_ALLOW_ALL_ORIGINS else cors_allowed_origins
CORS_ALLOW_CREDENTIALS = env_bool("DJANGO_CORS_ALLOW_CREDENTIALS", True)

CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    ",".join(cors_allowed_origins),
)

MAP_VIEWPORT_PAGE_SIZE = env_int("MAP_VIEWPORT_PAGE_SIZE", 500)
MAP_VIEWPORT_MAX_PAGE_SIZE = env_int("MAP_VIEWPORT_MAX_PAGE_SIZE", 1000)

# Cache — Redis partagé entre les workers Gunicorn pour que le throttling
# anti-brute-force soit effectif sur tous les workers.
# En développement sans Redis, repli sur LocMemCache (non partagé, acceptable en local).
_redis_url = env("REDIS_URL")
if _redis_url:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": _redis_url,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "mapgeo-default",
        }
    }

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
    ),
    "DEFAULT_PAGINATION_CLASS": "config.pagination.StandardResultsSetPagination",
    "PAGE_SIZE": env_int("API_PAGE_SIZE", 20),
    "EXCEPTION_HANDLER": "config.api.custom_exception_handler",
    # Throttling DRF global — complète le throttling custom des endpoints sensibles.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": env("DRF_THROTTLE_ANON", "60/minute"),
        "user": env("DRF_THROTTLE_USER", "300/minute"),
    },
}

JWT_ACCESS_MINUTES = env_int("JWT_ACCESS_MINUTES", 60)
JWT_REFRESH_DAYS = env_int("JWT_REFRESH_DAYS", 7)
JWT_REFRESH_COOKIE_ENABLED = env_bool("JWT_REFRESH_COOKIE_ENABLED", True)
JWT_REFRESH_COOKIE_BODY_ENABLED = env_bool("JWT_REFRESH_COOKIE_BODY_ENABLED", DEBUG)
JWT_REFRESH_COOKIE_NAME = env("JWT_REFRESH_COOKIE_NAME", "mapgeo_refresh")
JWT_REFRESH_COOKIE_PATH = env("JWT_REFRESH_COOKIE_PATH", "/api/auth/refresh/")
JWT_REFRESH_COOKIE_SAMESITE = env("JWT_REFRESH_COOKIE_SAMESITE", "Lax")
JWT_REFRESH_COOKIE_SECURE = env_bool("JWT_REFRESH_COOKIE_SECURE", not DEBUG)
JWT_REFRESH_COOKIE_HTTPONLY = True

if JWT_ACCESS_MINUTES <= 0:
    raise ImproperlyConfigured("JWT_ACCESS_MINUTES doit être supérieur à 0.")

if JWT_REFRESH_DAYS <= 0:
    raise ImproperlyConfigured("JWT_REFRESH_DAYS doit être supérieur à 0.")

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=JWT_ACCESS_MINUTES),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=JWT_REFRESH_DAYS),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
]

IMPORT_QUEUE_POLL_SECONDS = env_int("IMPORT_QUEUE_POLL_SECONDS", 10)
IMPORT_QUEUE_BATCH_SIZE = env_int("IMPORT_QUEUE_BATCH_SIZE", 3)
MAX_IMPORT_CSV_SIZE_MB = env_int("MAX_IMPORT_CSV_SIZE_MB", 10)
MAX_IMPORT_CSV_SIZE_BYTES = MAX_IMPORT_CSV_SIZE_MB * 1024 * 1024

PUBLIC_REGISTRATION_ENABLED = env_bool(
    "PUBLIC_REGISTRATION_ENABLED",
    False,
)


LOGIN_MAX_FAILED_ATTEMPTS = env_int("LOGIN_MAX_FAILED_ATTEMPTS", 5)
LOGIN_LOCKOUT_MINUTES = env_int("LOGIN_LOCKOUT_MINUTES", 15)
PASSWORD_RESET_TIMEOUT = env_int("PASSWORD_RESET_TIMEOUT_SECONDS", 15 * 60)
PASSWORD_RESET_MAX_ATTEMPTS = env_int("PASSWORD_RESET_MAX_ATTEMPTS", 5)
PASSWORD_RESET_WINDOW_MINUTES = env_int("PASSWORD_RESET_WINDOW_MINUTES", 30)
ACTIVATION_MAX_ATTEMPTS = env_int("ACTIVATION_MAX_ATTEMPTS", 8)
ACTIVATION_WINDOW_MINUTES = env_int("ACTIVATION_WINDOW_MINUTES", 30)

SECURITY_CSP_ENABLED = env_bool("SECURITY_CSP_ENABLED", not DEBUG)
SECURITY_CSP_REPORT_ONLY = env_bool("SECURITY_CSP_REPORT_ONLY", False)
SECURITY_CSP = env(
    "SECURITY_CSP",
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://mt1.google.com https://www.google.cn https://*.google.com https://*.google.cn; "
    "font-src 'self' data:; "
    "connect-src 'self' https://*.basemaps.cartocdn.com https://mt1.google.com https://www.google.cn https://*.google.com https://*.google.cn; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'none'; "
    "form-action 'self'"
)

GOOGLE_OAUTH_CLIENT_ID = env("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CREATE_CLIENTS = env_bool("GOOGLE_OAUTH_CREATE_CLIENTS", False)

FRONTEND_URL = env("FRONTEND_URL", "http://localhost:5173")

DEFAULT_FROM_EMAIL = env(
    "DEFAULT_FROM_EMAIL",
    "noreply@mapgeo.local",
)

EMAIL_BACKEND = env(
    "EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend",
)

# Configuration SMTP — obligatoire en production pour l'activation et le reset password.
# Définir EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD sur Render.
EMAIL_HOST = env("EMAIL_HOST", "localhost")
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
EMAIL_USE_SSL = env_bool("EMAIL_USE_SSL", False)
EMAIL_TIMEOUT = env_int("EMAIL_TIMEOUT", 10)

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"
    SECURE_REFERRER_POLICY = "same-origin"
    SECURE_HSTS_SECONDS = env_int("DJANGO_SECURE_HSTS_SECONDS", 31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
        "DJANGO_SECURE_HSTS_INCLUDE_SUBDOMAINS",
        True,
    )
    SECURE_HSTS_PRELOAD = env_bool(
        "DJANGO_SECURE_HSTS_PRELOAD",
        True,
    )
    SECURE_SSL_REDIRECT = env_bool(
        "DJANGO_SECURE_SSL_REDIRECT",
        False,
    )
    if env_bool("DJANGO_SECURE_PROXY_SSL_HEADER", True):
        SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
# Import CSV preview/confirm workflow
IMPORT_PREVIEW_CONFIRM_REQUIRED = env_bool("IMPORT_PREVIEW_CONFIRM_REQUIRED", True)
MAP_LAYER_TABLES_RAW = env("MAP_LAYER_TABLES", "")
