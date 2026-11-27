import re
from html import escape

HEX = re.compile(r"^#[0-9a-f]{6}$")
SAFE_ID = re.compile(r"[^A-Za-z0-9_-]")
BLEND = {
    "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light",
    "difference", "exclusion", "hue", "saturation", "color", "luminosity",
}


def quoteattr(value):
    return f'"{escape(value, quote=True)}"'


def num(value):
    result = round(float(value), 3)
    if result == 0:
        result = 0.0
    text = f"{result:.3f}".rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def safe_color(value):
    return value if isinstance(value, str) and HEX.match(value) else "#000000"


def straight(a, b):
    return a["ox"] == a["x"] and a["oy"] == a["y"] and b["ix"] == b["x"] and b["iy"] == b["y"]


def path_data(subpaths):
    parts = []
    for sub in subpaths:
        nodes = sub["nodes"]
        if not nodes:
            continue
        parts.append(f"M{num(nodes[0]['x'])} {num(nodes[0]['y'])}")
        count = len(nodes) if sub["closed"] else len(nodes) - 1
        for i in range(max(0, count)):
            a = nodes[i]
            b = nodes[(i + 1) % len(nodes)]
            if straight(a, b):
                parts.append(f"L{num(b['x'])} {num(b['y'])}")
            else:
                parts.append(f"C{num(a['ox'])} {num(a['oy'])} {num(b['ix'])} {num(b['iy'])} {num(b['x'])} {num(b['y'])}")
        if sub["closed"]:
            parts.append("Z")
    return "".join(parts)


def gradient_def(paint, gid):
    stops = "".join(
        f'<stop offset="{num(s["offset"])}" stop-color="{safe_color(s["color"])}"' + (f' stop-opacity="{num(s["opacity"])}"' if s.get("opacity", 1) != 1 else "") + "/>"
        for s in sorted(paint["stops"], key=lambda s: s["offset"])
    )
    if paint["kind"] == "radial":
        return f'<radialGradient id="{gid}" cx="{num(paint["cx"])}" cy="{num(paint["cy"])}" r="{num(paint["r"])}">{stops}</radialGradient>'
    return f'<linearGradient id="{gid}" x1="{num(paint["x1"])}" y1="{num(paint["y1"])}" x2="{num(paint["x2"])}" y2="{num(paint["y2"])}">{stops}</linearGradient>'


def paint_attr(paint, gid, defs):
    if not paint:
        return "none"
    if paint["type"] == "gradient":
        defs.append(gradient_def(paint, gid))
        return f"url(#{gid})"
    return safe_color(paint["color"])


def style_attrs(style, prefix, defs, evenodd=False):
    attrs = [f'fill="{paint_attr(style.get("fill"), prefix + "-f", defs)}"']
    if evenodd:
        attrs.append('fill-rule="evenodd"')
    stroke = style.get("stroke")
    width = style.get("strokeWidth", 0)
    if stroke and width > 0:
        attrs.append(f'stroke="{paint_attr(stroke, prefix + "-s", defs)}"')
        attrs.append(f'stroke-width="{num(width)}"')
        if style.get("cap") in ("round", "projecting"):
            attrs.append(f'stroke-linecap="{"square" if style["cap"] == "projecting" else "round"}"')
        if style.get("join") in ("round", "bevel"):
            attrs.append(f'stroke-linejoin="{style["join"]}"')
        if any(d > 0 for d in style.get("dash", [])):
            attrs.append(f'stroke-dasharray="{" ".join(num(d) for d in style["dash"])}"')
    else:
        attrs.append('stroke="none"')
    return " ".join(attrs)


def matrix_attr(m):
    if not m or m == [1, 0, 0, 1, 0, 0]:
        return ""
    return f' transform="matrix({" ".join(num(v) for v in m)})"'


def item_markup(item, doc, assets):
    if item.get("visible") is False:
        return ""
    prefix = "v" + SAFE_ID.sub("", item["id"])
    defs = []
    kind = item["type"]
    body = ""
    if kind == "path":
        body = f'<path d="{path_data(item["subpaths"])}" {style_attrs(item["style"], prefix, defs, item.get("fillRule") == "evenodd")}/>'
    elif kind == "text":
        font = item["font"]
        family = quoteattr(font["family"])
        attrs = f'font-family={family} font-size="{num(font["size"])}"'
        if font["weight"] != 400:
            attrs += f' font-weight="{font["weight"]}"'
        if font["style"] == "italic":
            attrs += ' font-style="italic"'
        paint = style_attrs(item["style"], prefix, defs)
        if item.get("onPath"):
            defs.append(f'<path id="{prefix}-tp" d="{path_data(item["onPath"])}"/>')
            body = f'<text {attrs} {paint}><textPath href="#{prefix}-tp">{escape(item["content"], quote=False)}</textPath></text>'
        else:
            anchor = {"center": "middle", "right": "end"}.get(item["align"], "start")
            leading = font["size"] * font["leading"]
            base_x = 0
            if item.get("area"):
                base_x = item["area"]["width"] / 2 if item["align"] == "center" else item["area"]["width"] if item["align"] == "right" else 0
            spans = "".join(
                f'<tspan x="{num(base_x)}" y="{num((font["size"] if item.get("area") else 0) + i * leading)}">{escape(line, quote=False) or " "}</tspan>' for i, line in enumerate(item["content"].split("\n"))
            )
            body = f'<text{matrix_attr(item["matrix"])} {attrs} text-anchor="{anchor}" {paint} xml:space="preserve">{spans}</text>'
    elif kind == "image":
        href = assets.get(item["asset"])
        if href:
            body = f'<image href="{href}" width="{num(item["width"])}" height="{num(item["height"])}" preserveAspectRatio="none"{matrix_attr(item["matrix"])}/>'
    elif kind == "instance":
        body = f'<use href="#sym-{SAFE_ID.sub("", item["symbol"])}"{matrix_attr(item["matrix"])}/>'
    elif kind == "group":
        visible = [c for c in item["children"] if c.get("visible") is not False]
        if item.get("clip") and len(visible) > 1 and visible[-1]["type"] == "path":
            defs.append(f'<clipPath id="{prefix}-c"><path d="{path_data(visible[-1]["subpaths"])}"/></clipPath>')
            body = f'<g clip-path="url(#{prefix}-c)">{"".join(item_markup(c, doc, assets) for c in visible[:-1])}</g>'
        else:
            body = "".join(item_markup(c, doc, assets) for c in visible)
    attrs = []
    if item.get("opacity", 1) != 1:
        attrs.append(f'opacity="{num(item["opacity"])}"')
    if item.get("blend") in BLEND:
        attrs.append(f'style="mix-blend-mode:{item["blend"]}"')
    defs_markup = f"<defs>{''.join(defs)}</defs>" if defs else ""
    if not attrs and not defs_markup:
        return body
    return f"<g{(' ' + ' '.join(attrs)) if attrs else ''}>{defs_markup}{body}</g>"


def export_svg(doc, artboard_index=0):
    boards = doc["artboards"]
    board = boards[artboard_index] if 0 <= artboard_index < len(boards) else boards[0]
    assets = doc.get("assets", {})
    symbols = "".join(f'<g id="sym-{SAFE_ID.sub("", s["id"])}">{"".join(item_markup(c, doc, assets) for c in s["children"])}</g>' for s in doc.get("symbols", []))
    layers = "".join(
        f"<g id={quoteattr(layer['name'].replace(' ', '_'))}>{''.join(item_markup(c, doc, assets) for c in layer['children'])}</g>" for layer in doc["layers"] if layer.get("visible", True)
    )
    view_box = f'{num(board["x"])} {num(board["y"])} {num(board["width"])} {num(board["height"])}'
    defs = f"<defs>{symbols}</defs>" if symbols else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="{num(board["width"])}" height="{num(board["height"])}" viewBox="{view_box}">{defs}{layers}</svg>\n'
    )
