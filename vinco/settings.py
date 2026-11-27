import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name, default=None):
    value = os.environ.get(name)
    return default if value is None or value == "" else value


def env_bool(name, default=False):
    return str(env(name, str(default))).strip().lower() in {"1", "true", "sim", "yes", "on"}


def env_list(name, default=""):
    return [item.strip() for item in str(env(name, default)).split(",") if item.strip()]


def env_int(name, default, minimum=0, maximum=10**9):
    try:
        value = int(env(name, str(default)))
    except (TypeError, ValueError):
        raise ImproperlyConfigured(f"{name} precisa ser um número inteiro.") from None
    return max(minimum, min(maximum, value))


VERSION = (BASE_DIR / "VERSION").read_text(encoding="utf-8").strip() if (BASE_DIR / "VERSION").exists() else "1.0.0"

DEVELOPMENT_KEY = "vinco-chave-local-de-desenvolvimento-troque-em-producao"
EXAMPLE_KEYS = {DEVELOPMENT_KEY, "troque-esta-chave"}

DEBUG = env_bool("VINCO_DEBUG", True)
SECRET_KEY = env("VINCO_SECRET_KEY", DEVELOPMENT_KEY)

if not DEBUG and (SECRET_KEY in EXAMPLE_KEYS or len(SECRET_KEY) < 32):
    raise ImproperlyConfigured(
        "VINCO_SECRET_KEY insegura: com VINCO_DEBUG=false defina uma chave aleatória com pelo menos 32 caracteres "
        "(os scripts start.sh e start.cmd geram uma no .env)."
    )

ALLOWED_HOSTS = env_list("VINCO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
CSRF_TRUSTED_ORIGINS = env_list("VINCO_CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "editor",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "editor.security.SecurityHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "editor.security.ApiTokenMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "editor.security.WriteLimitMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "vinco.urls"
WSGI_APPLICATION = "vinco.wsgi.application"
ASGI_APPLICATION = "vinco.asgi.application"

TEMPLATES = []

if env("VINCO_DB_ENGINE", "sqlite") == "postgresql":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("VINCO_DB_NAME", "vinco"),
            "USER": env("VINCO_DB_USER", "vinco"),
            "PASSWORD": env("VINCO_DB_PASSWORD", ""),
            "HOST": env("VINCO_DB_HOST", "localhost"),
            "PORT": env("VINCO_DB_PORT", "5432"),
            "CONN_MAX_AGE": 60,
            "CONN_HEALTH_CHECKS": True,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": env("VINCO_SQLITE_PATH", str(BASE_DIR / "vinco.sqlite3")),
        }
    }

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "pt-br"
TIME_ZONE = env("VINCO_TIMEZONE", "America/Sao_Paulo")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
WHITENOISE_USE_FINDERS = True
WHITENOISE_AUTOREFRESH = DEBUG

MAX_DOCUMENT_MB = env_int("VINCO_MAX_DOCUMENT_MB", 48, 1, 512)
DATA_UPLOAD_MAX_MEMORY_SIZE = MAX_DOCUMENT_MB * 1024 * 1024

CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Strict"
SESSION_COOKIE_SAMESITE = "Strict"
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"

if env_bool("VINCO_HTTPS", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = env_int("VINCO_HSTS_SECONDS", 31536000)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("VINCO_HSTS_SUBDOMAINS", False)
    SECURE_SSL_REDIRECT = env_bool("VINCO_HTTPS_REDIRECT", False)

VINCO = {
    "VERSION": VERSION,
    "API_TOKEN": env("VINCO_API_TOKEN", ""),
    "MAX_REVISIONS": env_int("VINCO_MAX_REVISIONS", 30, 1, 1000),
    "WRITE_LIMIT": env_int("VINCO_WRITE_LIMIT", 120, 0, 100000),
    "TRUSTED_PROXY": env_bool("VINCO_TRUSTED_PROXY", False),
    "MAX_DOCUMENTS_LISTED": 500,
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("VINCO_LOG_LEVEL", "INFO")},
}
