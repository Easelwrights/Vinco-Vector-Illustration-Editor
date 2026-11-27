import base64
import binascii
import math
import re

FORMAT = "vinco"
FORMAT_VERSION = 1

LIMITS = {
    "items": 100000,
    "nodes": 2000000,
    "depth": 64,
    "artboards": 100,
    "layers": 500,
    "text": 20000,
    "name": 120,
    "asset_bytes": 25 * 1024 * 1024,
    "coordinate": 1e7,
    "swatches": 1000,
    "symbols": 1000,
    "guides": 500,
}

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$")
SIGNATURES = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "image/webp": (b"RIFF",),
}
BLEND_MODES = {
    "normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn",
    "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity",
}
EFFECTS = {"dropShadow", "blur", "outerGlow", "innerGlow", "roundCorners", "zigZag", "roughen", "puckerBloat"}
EFFECT_NUMBERS = ("dx", "dy", "blur", "opacity", "radius", "size", "ridges", "detail", "seed", "amount")
ARROWS = {"none", "arrow", "triangle", "circle", "square", "bar"}
UNITS = {"px", "pt", "mm", "cm", "in"}
ITEM_TYPES = {"path", "text", "image", "group", "instance"}


class ValidationError(ValueError):
    pass


def fail(message):
    raise ValidationError(message)


def number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > LIMITS["coordinate"]:
        fail(f"{label}: número inválido.")
    return float(value)


def optional_number(value, label, default):
    return default if value is None else number(value, label)


def clamp(value, low, high):
    return max(low, min(high, value))


def text(value, label, limit=LIMITS["name"]):
    if not isinstance(value, str):
        fail(f"{label}: texto esperado.")
    if len(value) > limit:
        fail(f"{label}: texto longo demais.")
    return value


def identifier(value, label):
    if not isinstance(value, str) or not ID.match(value):
        fail(f"{label}: identificador inválido.")
    return value


def color(value, label):
    if not isinstance(value, str) or not HEX.match(value):
        fail(f"{label}: cor inválida.")
    return value.lower()


def boolean(value, default):
    return value if isinstance(value, bool) else default


def matrix(value, label):
    if not isinstance(value, list) or len(value) != 6:
        fail(f"{label}: matriz inválida.")
    return [number(v, label) for v in value]


def paint(value, label):
    if value is None:
        return None
    if not isinstance(value, dict):
        fail(f"{label}: pintura inválida.")
    if value.get("type") == "color":
        return {"type": "color", "color": color(value.get("color"), label)}
    if value.get("type") == "gradient":
        kind = value.get("kind")
        if kind not in ("linear", "radial"):
            fail(f"{label}: tipo de degradê inválido.")
        stops = value.get("stops")
        if not isinstance(stops, list) or not 1 <= len(stops) <= 64:
            fail(f"{label}: paradas do degradê inválidas.")
        result = {
            "type": "gradient",
            "kind": kind,
            "stops": [
                {
                    "offset": clamp(number(s.get("offset") if isinstance(s, dict) else None, label), 0, 1),
                    "color": color(s.get("color"), label),
                    "opacity": clamp(optional_number(s.get("opacity"), label, 1.0), 0, 1),
                }
                for s in stops
            ],
        }
        if kind == "linear":
            for key, default in (("x1", 0.0), ("y1", 0.5), ("x2", 1.0), ("y2", 0.5)):
                result[key] = optional_number(value.get(key), label, default)
        else:
            for key, default in (("cx", 0.5), ("cy", 0.5), ("r", 0.5)):
                result[key] = optional_number(value.get(key), label, default)
            result["r"] = max(0.0, result["r"])
        return result
    return fail(f"{label}: pintura inválida.")


def style(value, label):
    s = value if isinstance(value, dict) else {}
    dash = s.get("dash") if isinstance(s.get("dash"), list) else []
    return {
        "fill": paint(s.get("fill"), f"{label}.fill"),
        "stroke": paint(s.get("stroke"), f"{label}.stroke"),
        "strokeWidth": clamp(optional_number(s.get("strokeWidth"), label, 1.0), 0, 10000),
        "cap": s.get("cap") if s.get("cap") in ("butt", "round", "projecting") else "butt",
        "join": s.get("join") if s.get("join") in ("miter", "round", "bevel") else "miter",
        "miterLimit": clamp(optional_number(s.get("miterLimit"), label, 10.0), 1, 500),
        "dash": [max(0.0, number(d, label)) for d in dash[:6]],
        "arrowStart": s.get("arrowStart") if s.get("arrowStart") in ARROWS else "none",
        "arrowEnd": s.get("arrowEnd") if s.get("arrowEnd") in ARROWS else "none",
    }


def effects(value, label):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 32:
        fail(f"{label}: efeitos inválidos.")
    result = []
    for e in value:
        if not isinstance(e, dict) or e.get("type") not in EFFECTS:
            fail(f"{label}: efeito desconhecido.")
        out = {"type": e["type"], "enabled": boolean(e.get("enabled"), True)}
        for key in EFFECT_NUMBERS:
            if e.get(key) is not None:
                out[key] = number(e[key], label)
        if e.get("color") is not None:
            out["color"] = color(e["color"], label)
        if e.get("smooth") is not None:
            out["smooth"] = bool(e["smooth"])
        result.append(out)
    return result


def subpaths(value, label, counter):
    if not isinstance(value, list) or len(value) > 100000:
        fail(f"{label}: subcaminhos inválidos.")
    result = []
    for s in value:
        if not isinstance(s, dict) or not isinstance(s.get("nodes"), list):
            fail(f"{label}: subcaminho inválido.")
        counter["nodes"] += len(s["nodes"])
        if counter["nodes"] > LIMITS["nodes"]:
            fail("O documento tem pontos de ancoragem demais.")
        nodes = []
        for n in s["nodes"]:
            if not isinstance(n, dict):
                fail(f"{label}: ponto inválido.")
            x = number(n.get("x"), label)
            y = number(n.get("y"), label)
            nodes.append(
                {
                    "x": x,
                    "y": y,
                    "ix": optional_number(n.get("ix"), label, x),
                    "iy": optional_number(n.get("iy"), label, y),
                    "ox": optional_number(n.get("ox"), label, x),
                    "oy": optional_number(n.get("oy"), label, y),
                    "smooth": bool(n.get("smooth", False)),
                }
            )
        result.append({"closed": bool(s.get("closed", False)), "nodes": nodes})
    return result


def item(value, label, counter, depth, assets, symbol_ids):
    if not isinstance(value, dict) or value.get("type") not in ITEM_TYPES:
        fail(f"{label}: objeto inválido.")
    counter["items"] += 1
    if counter["items"] > LIMITS["items"]:
        fail("O documento tem objetos demais.")
    if depth > LIMITS["depth"]:
        fail("Grupos aninhados demais.")
    kind = value["type"]
    base = {
        "id": identifier(value.get("id"), label),
        "type": kind,
        "name": text(value.get("name", ""), label),
        "visible": boolean(value.get("visible"), True),
        "locked": boolean(value.get("locked"), False),
        "opacity": clamp(optional_number(value.get("opacity"), label, 1.0), 0, 1),
        "blend": value.get("blend") if value.get("blend") in BLEND_MODES else "normal",
        "effects": effects(value.get("effects"), label),
    }
    if kind == "path":
        base.update(
            {
                "fillRule": "evenodd" if value.get("fillRule") == "evenodd" else "nonzero",
                "subpaths": subpaths(value.get("subpaths"), label, counter),
                "style": style(value.get("style"), label),
            }
        )
        if value.get("blendStep") is True:
            base["blendStep"] = True
        return base
    if kind == "text":
        font = value.get("font") if isinstance(value.get("font"), dict) else {}
        area = value.get("area")
        base.update(
            {
                "content": text(value.get("content", ""), label, LIMITS["text"]),
                "matrix": matrix(value.get("matrix", [1, 0, 0, 1, 0, 0]), label),
                "font": {
                    "family": re.sub(r'[<>"\\;{}]', "", text(font.get("family", "Arial, sans-serif"), label)),
                    "size": clamp(optional_number(font.get("size"), label, 24.0), 0.5, 5000),
                    "weight": int(clamp(round(optional_number(font.get("weight"), label, 400.0) / 100) * 100, 100, 900)),
                    "style": "italic" if font.get("style") == "italic" else "normal",
                    "leading": clamp(optional_number(font.get("leading"), label, 1.2), 0.1, 20),
                    "tracking": clamp(optional_number(font.get("tracking"), label, 0.0), -1000, 10000),
                },
                "align": value.get("align") if value.get("align") in ("left", "center", "right", "justify") else "left",
                "area": {"width": max(1.0, number(area.get("width"), label)), "height": max(1.0, number(area.get("height"), label))} if isinstance(area, dict) else None,
                "onPath": subpaths(value["onPath"], label, counter) if value.get("onPath") else None,
                "pathOffset": optional_number(value.get("pathOffset"), label, 0.0),
                "style": style(value.get("style"), label),
            }
        )
        return base
    if kind == "image":
        asset = value.get("asset")
        if not isinstance(asset, str) or asset not in assets:
            fail(f"{label}: imagem sem arquivo.")
        base.update(
            {
                "asset": identifier(asset, label),
                "width": max(0.0, number(value.get("width"), label)),
                "height": max(0.0, number(value.get("height"), label)),
                "matrix": matrix(value.get("matrix"), label),
            }
        )
        return base
    if kind == "instance":
        if value.get("symbol") not in symbol_ids:
            fail(f"{label}: símbolo inexistente.")
        base.update({"symbol": value["symbol"], "matrix": matrix(value.get("matrix"), label)})
        return base
    children = value.get("children")
    if not isinstance(children, list):
        fail(f"{label}: grupo inválido.")
    base.update({"clip": bool(value.get("clip", False)), "children": [item(c, f"{label}.{i}", counter, depth + 1, assets, symbol_ids) for i, c in enumerate(children)]})
    return base


def decode_asset(value):
    match = DATA_URL.match(value) if isinstance(value, str) else None
    if not match:
        fail("Imagem incorporada inválida (aceita PNG, JPEG, GIF e WebP).")
    mime = match.group(1)
    try:
        data = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
    except (binascii.Error, ValueError):
        fail("Imagem incorporada corrompida.")
    if len(data) > LIMITS["asset_bytes"]:
        fail("Imagem incorporada grande demais (máximo 25 MB).")
    if not any(data.startswith(sig) for sig in SIGNATURES[mime]):
        fail("O conteúdo da imagem não corresponde ao tipo declarado.")
    if mime == "image/webp" and data[8:12] != b"WEBP":
        fail("O conteúdo da imagem não corresponde ao tipo declarado.")
    return mime, data


def validate_document(raw):
    if not isinstance(raw, dict):
        fail("Documento vazio ou corrompido.")
    if raw.get("format") != FORMAT:
        fail("Este arquivo não é um documento do Vinco.")
    if raw.get("version") != FORMAT_VERSION:
        fail(f"Versão de arquivo não suportada: {raw.get('version')}.")
    counter = {"items": 0, "nodes": 0}
    raw_assets = raw.get("assets") if isinstance(raw.get("assets"), dict) else {}
    assets = {}
    for key, value in raw_assets.items():
        identifier(key, "assets")
        mime, data = decode_asset(value)
        assets[key] = {"mime": mime, "data": data}
    artboards = raw.get("artboards")
    layers = raw.get("layers")
    if not isinstance(artboards, list) or not 1 <= len(artboards) <= LIMITS["artboards"]:
        fail("Pranchetas inválidas.")
    if not isinstance(layers, list) or not 1 <= len(layers) <= LIMITS["layers"]:
        fail("Camadas inválidas.")
    symbols_raw = raw.get("symbols") if isinstance(raw.get("symbols"), list) else []
    if len(symbols_raw) > LIMITS["symbols"]:
        fail("Símbolos demais.")
    symbol_ids = {s.get("id") for s in symbols_raw if isinstance(s, dict)}
    symbols = []
    for i, s in enumerate(symbols_raw):
        if not isinstance(s, dict) or not isinstance(s.get("children"), list):
            fail("Símbolo inválido.")
        symbols.append(
            {
                "id": identifier(s.get("id"), f"symbols.{i}"),
                "name": text(s.get("name", "Símbolo"), "symbols"),
                "children": [item(c, f"symbols.{i}.{k}", counter, 1, assets, set()) for k, c in enumerate(s["children"])],
            }
        )
    doc = {
        "format": FORMAT,
        "version": FORMAT_VERSION,
        "name": text(raw.get("name", "Sem título"), "name") or "Sem título",
        "units": raw.get("units") if raw.get("units") in UNITS else "px",
        "background": raw["background"].lower() if isinstance(raw.get("background"), str) and HEX.match(raw["background"]) else "#ffffff",
        "artboards": [],
        "layers": [],
        "swatches": [],
        "symbols": symbols,
        "guides": {"horizontal": [], "vertical": []},
    }
    for i, a in enumerate(artboards):
        if not isinstance(a, dict):
            fail("Prancheta inválida.")
        doc["artboards"].append(
            {
                "id": identifier(a.get("id"), f"artboards.{i}"),
                "name": text(a.get("name", f"Prancheta {i + 1}"), "artboards"),
                "x": number(a.get("x"), "artboards"),
                "y": number(a.get("y"), "artboards"),
                "width": max(1.0, number(a.get("width"), "artboards")),
                "height": max(1.0, number(a.get("height"), "artboards")),
            }
        )
    for i, layer in enumerate(layers):
        if not isinstance(layer, dict) or not isinstance(layer.get("children"), list):
            fail("Camada inválida.")
        doc["layers"].append(
            {
                "id": identifier(layer.get("id"), f"layers.{i}"),
                "type": "layer",
                "name": text(layer.get("name", f"Camada {i + 1}"), "layers"),
                "visible": boolean(layer.get("visible"), True),
                "locked": boolean(layer.get("locked"), False),
                "color": layer["color"].lower() if isinstance(layer.get("color"), str) and HEX.match(layer["color"]) else "#4f7cff",
                "children": [item(c, f"layers.{i}.{k}", counter, 1, assets, symbol_ids) for k, c in enumerate(layer["children"])],
            }
        )
    swatches = raw.get("swatches") if isinstance(raw.get("swatches"), list) else []
    doc["swatches"] = [s.lower() for s in swatches if isinstance(s, str) and HEX.match(s)][: LIMITS["swatches"]]
    guides = raw.get("guides") if isinstance(raw.get("guides"), dict) else {}
    for axis in ("horizontal", "vertical"):
        values = guides.get(axis) if isinstance(guides.get(axis), list) else []
        doc["guides"][axis] = [number(g, "guides") for g in values[: LIMITS["guides"]]]
    seen = set()

    def check(entries):
        for entry in entries:
            if entry["id"] in seen:
                fail("Identificadores repetidos no documento.")
            seen.add(entry["id"])
            if entry.get("children"):
                check(entry["children"])

    check(doc["layers"])
    keys = {a["id"] for a in doc["artboards"]}
    if len(keys) != len(doc["artboards"]):
        fail("Identificadores de prancheta repetidos.")
    return doc, assets, counter
