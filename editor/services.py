import base64
import hashlib
import json

from django.conf import settings
from django.db import transaction

from .models import Artboard, Asset, Document, DocumentVersion, Layer, Symbol
from .validation import validate_document


class ConflictError(Exception):
    def __init__(self, current):
        super().__init__("conflict")
        self.current = current


def count_items(items):
    total = 0
    for entry in items:
        total += 1
        if isinstance(entry.get("children"), list):
            total += count_items(entry["children"])
    return total


def snapshot_of(doc):
    return {key: value for key, value in doc.items() if key != "assets"}


def _write_children(document, doc, assets):
    document.artboards.all().delete()
    document.layers.all().delete()
    document.symbols.all().delete()
    Artboard.objects.bulk_create(
        [Artboard(document=document, key=a["id"], position=i, name=a["name"], x=a["x"], y=a["y"], width=a["width"], height=a["height"]) for i, a in enumerate(doc["artboards"])]
    )
    Layer.objects.bulk_create(
        [
            Layer(document=document, key=layer["id"], position=i, name=layer["name"], visible=layer["visible"], locked=layer["locked"], color=layer["color"], items=layer["children"], item_count=count_items(layer["children"]))
            for i, layer in enumerate(doc["layers"])
        ]
    )
    Symbol.objects.bulk_create([Symbol(document=document, key=s["id"], position=i, name=s["name"], items=s["children"]) for i, s in enumerate(doc["symbols"])])
    existing = {a.key: a.sha256 for a in document.assets.only("key", "sha256")}
    for key, asset in assets.items():
        digest = hashlib.sha256(asset["data"]).hexdigest()
        if existing.get(key) == digest:
            continue
        Asset.objects.update_or_create(document=document, key=key, defaults={"mime": asset["mime"], "sha256": digest, "size": len(asset["data"]), "data": asset["data"]})


def _record_version(document, doc, asset_keys, size):
    DocumentVersion.objects.create(document=document, revision=document.revision, snapshot=snapshot_of(doc), asset_keys=sorted(asset_keys), size_bytes=size)
    limit = settings.VINCO["MAX_REVISIONS"]
    stale = list(document.versions.order_by("-revision").values_list("id", flat=True)[limit:])
    if stale:
        DocumentVersion.objects.filter(id__in=stale).delete()
    referenced = set(asset_keys)
    for keys in document.versions.values_list("asset_keys", flat=True):
        referenced.update(keys)
    document.assets.exclude(key__in=referenced).delete()


def _payload_size(raw):
    return len(json.dumps(raw, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


@transaction.atomic
def create_document(raw):
    doc, assets, _ = validate_document(raw)
    size = _payload_size(raw)
    document = Document.objects.create(name=doc["name"], units=doc["units"], background=doc["background"], swatches=doc["swatches"], guides=doc["guides"], size_bytes=size, revision=1)
    _write_children(document, doc, assets)
    _record_version(document, doc, assets.keys(), size)
    return document


@transaction.atomic
def update_document(document_id, raw, expected_revision):
    document = Document.objects.select_for_update().get(id=document_id)
    if expected_revision is not None and int(expected_revision) != document.revision:
        raise ConflictError(document.revision)
    doc, assets, _ = validate_document(raw)
    size = _payload_size(raw)
    document.name = doc["name"]
    document.units = doc["units"]
    document.background = doc["background"]
    document.swatches = doc["swatches"]
    document.guides = doc["guides"]
    document.size_bytes = size
    document.revision += 1
    document.save()
    _write_children(document, doc, assets)
    _record_version(document, doc, assets.keys(), size)
    return document


def asset_url(asset):
    return f"data:{asset.mime};base64,{base64.b64encode(bytes(asset.data)).decode('ascii')}"


def load_document(document, snapshot=None, asset_keys=None):
    if snapshot is None:
        doc = {
            "format": "vinco",
            "version": 1,
            "name": document.name,
            "units": document.units,
            "background": document.background,
            "artboards": [{"id": a.key, "name": a.name, "x": a.x, "y": a.y, "width": a.width, "height": a.height} for a in document.artboards.all()],
            "layers": [{"id": layer.key, "type": "layer", "name": layer.name, "visible": layer.visible, "locked": layer.locked, "color": layer.color, "children": layer.items} for layer in document.layers.all()],
            "swatches": document.swatches,
            "symbols": [{"id": s.key, "name": s.name, "children": s.items} for s in document.symbols.all()],
            "guides": document.guides or {"horizontal": [], "vertical": []},
        }
        keys = None
    else:
        doc = dict(snapshot)
        keys = set(asset_keys or [])
    query = document.assets.all() if keys is None else document.assets.filter(key__in=keys)
    doc["assets"] = {asset.key: asset_url(asset) for asset in query}
    return doc


@transaction.atomic
def restore_version(document_id, revision):
    document = Document.objects.select_for_update().get(id=document_id)
    version = document.versions.get(revision=revision)
    raw = load_document(document, version.snapshot, version.asset_keys)
    return update_document(document.id, raw, document.revision)


def summary(document):
    return {
        "id": str(document.id),
        "name": document.name,
        "revision": document.revision,
        "size": document.size_bytes,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
    }
