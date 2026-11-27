FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=vinco.settings \
    VINCO_DEBUG=false

WORKDIR /app
RUN groupadd --system vinco && useradd --system --gid vinco --home-dir /app vinco

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY manage.py VERSION ./
COPY vinco ./vinco
COPY editor ./editor
RUN VINCO_SECRET_KEY=build-only-key-for-collecting-static-files-0000 python manage.py collectstatic --noinput && chown -R vinco:vinco /app

USER vinco
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2).status == 200 else 1)"
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn vinco.wsgi:application --bind 0.0.0.0:8000 --workers ${VINCO_WORKERS:-2} --access-logfile -"]
