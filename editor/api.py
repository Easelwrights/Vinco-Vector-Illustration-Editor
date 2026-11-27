import json
import logging

from django.conf import settings
from django.core.exceptions import RequestDataTooBig
from django.db import DatabaseError, connection
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods

from . import services
from .models import Document
from .svg_export import export_svg
from .validation import ValidationError, validate_document

logger = logging.getLogger(__name__)


def reply(data, status=200):
    return JsonResponse(data, status=status, json_dumps_params={"ensure_ascii": False})


def error(message, status=400, **extra):
    return reply({"error": message, **extra}, status=status)


class PayloadTooLarge(Exception):
    pass


def read_json(request):
    if request.content_type != "application/json":
        raise ValidationError("Envie o corpo como application/json.")
    try:
        return json.loads(request.body.decode("utf-8"))
    except RequestDataTooBig:
        raise PayloadTooLarge from None
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValidationError("JSON inválido.") from None


def too_large():
    return error(f"O documento passa do limite de {settings.MAX_DOCUMENT_MB} MB.", status=413)


def get_document(document_id):
    try:
        return Document.objects.get(id=document_id)
    except Document.DoesNotExist:
        return None


@require_http_methods(["GET"])
def index(request):
    return reply(
        {
            "service": "vinco",
            "version": settings.VINCO["VERSION"],
            "endpoints": [
                "GET /api/v1/health",
                "GET|POST /api/v1/documents",
                "GET|PUT|DELETE /api/v1/documents/<id>",
                "GET /api/v1/documents/<id>/svg?artboard=0",
                "GET /api/v1/documents/<id>/export",
                "GET /api/v1/documents/<id>/versions",
                "POST /api/v1/documents/<id>/versions/<revision>/restore",
            ],
        }
    )


@require_http_methods(["GET"])
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        database = "ok"
    except DatabaseError:
        logger.exception("Banco de dados indisponível")
        return reply({"status": "error", "service": "vinco", "database": "unavailable"}, status=503)
    return reply({"status": "ok", "service": "vinco", "version": settings.VINCO["VERSION"], "database": database, "engine": connection.vendor})


@require_http_methods(["GET", "POST"])
def documents(request):
    if request.method == "GET":
        limit = settings.VINCO["MAX_DOCUMENTS_LISTED"]
        query = request.GET.get("q", "").strip()[:120]
        rows = Document.objects.all()
        if query:
            rows = rows.filter(name__icontains=query)
        return reply({"documents": [services.summary(d) for d in rows[:limit]]})
    try:
        body = read_json(request)
        raw = body.get("document") if isinstance(body, dict) else None
        document = services.create_document(raw)
    except PayloadTooLarge:
        return too_large()
    except ValidationError as exc:
        return error(str(exc))
    return reply({**services.summary(document)}, status=201)


@require_http_methods(["GET", "PUT", "DELETE"])
def document(request, document_id):
    current = get_document(document_id)
    if current is None:
        return error("Documento não encontrado.", status=404)
    if request.method == "GET":
        return reply({**services.summary(current), "document": services.load_document(current)})
    if request.method == "DELETE":
        current.delete()
        return HttpResponse(status=204)
    try:
        body = read_json(request)
        if not isinstance(body, dict):
            raise ValidationError("Corpo inválido.")
        revision = body.get("revision")
        if revision is not None and (isinstance(revision, bool) or not isinstance(revision, int)):
            raise ValidationError("Revisão inválida.")
        updated = services.update_document(current.id, body.get("document"), revision)
    except PayloadTooLarge:
        return too_large()
    except ValidationError as exc:
        return error(str(exc))
    except services.ConflictError as exc:
        return error("O documento foi alterado por outra pessoa ou aba.", status=409, current_revision=exc.current)
    return reply(services.summary(updated))


@require_http_methods(["GET"])
def svg(request, document_id):
    current = get_document(document_id)
    if current is None:
        return error("Documento não encontrado.", status=404)
    try:
        index_value = int(request.GET.get("artboard", "0"))
    except ValueError:
        return error("Prancheta inválida.")
    doc = services.load_document(current)
    response = HttpResponse(export_svg(doc, index_value), content_type="image/svg+xml; charset=utf-8")
    response["Content-Security-Policy"] = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox"
    response["Content-Disposition"] = f'inline; filename="{_filename(current.name)}.svg"'
    return response


@require_http_methods(["GET"])
def export(request, document_id):
    current = get_document(document_id)
    if current is None:
        return error("Documento não encontrado.", status=404)
    doc = services.load_document(current)
    validate_document(doc)
    response = HttpResponse(json.dumps(doc, ensure_ascii=False), content_type="application/json; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{_filename(current.name)}.vinco"'
    return response


@require_http_methods(["GET"])
def versions(request, document_id):
    current = get_document(document_id)
    if current is None:
        return error("Documento não encontrado.", status=404)
    rows = current.versions.only("revision", "size_bytes", "created_at")
    return reply({"versions": [{"revision": v.revision, "size": v.size_bytes, "created_at": v.created_at.isoformat()} for v in rows]})


@require_http_methods(["POST"])
def restore(request, document_id, revision):
    current = get_document(document_id)
    if current is None:
        return error("Documento não encontrado.", status=404)
    if not current.versions.filter(revision=revision).exists():
        return error("Versão não encontrada.", status=404)
    try:
        updated = services.restore_version(current.id, revision)
    except ValidationError as exc:
        return error(str(exc))
    return reply({**services.summary(updated), "document": services.load_document(updated)})


def _filename(name):
    cleaned = "".join(c for c in name if c.isalnum() or c in " -_").strip()
    return cleaned[:80] or "documento"
