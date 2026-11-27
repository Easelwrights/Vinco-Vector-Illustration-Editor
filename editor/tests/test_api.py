import base64
import json
import struct
import zlib

from django.test import Client, TestCase, override_settings

from editor.models import Asset, Document, DocumentVersion, Layer
from editor.security import WriteLimitMiddleware
from editor.svg_export import export_svg
from editor.validation import ValidationError, validate_document


def png_bytes():
    raw = b"\x00\xff\x00\x00\xff"
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def node(x, y):
    return {"x": x, "y": y, "ix": x, "iy": y, "ox": x, "oy": y, "smooth": False}


def sample(name="Teste", **extra):
    doc = {
        "format": "vinco",
        "version": 1,
        "name": name,
        "units": "px",
        "background": "#ffffff",
        "artboards": [{"id": "a1", "name": "Prancheta 1", "x": 0, "y": 0, "width": 400, "height": 300}],
        "layers": [
            {
                "id": "l1",
                "type": "layer",
                "name": "Camada 1",
                "visible": True,
                "locked": False,
                "color": "#4f7cff",
                "children": [
                    {
                        "id": "p1",
                        "type": "path",
                        "name": "",
                        "subpaths": [{"closed": True, "nodes": [node(10, 10), node(100, 10), node(100, 80)]}],
                        "style": {"fill": {"type": "color", "color": "#5d1c16"}, "stroke": {"type": "color", "color": "#000000"}, "strokeWidth": 2},
                    },
                    {
                        "id": "t1",
                        "type": "text",
                        "content": "Olá <script>alert(1)</script>",
                        "matrix": [1, 0, 0, 1, 20, 200],
                        "font": {"family": "Arial, sans-serif", "size": 24},
                        "style": {"fill": {"type": "color", "color": "#000000"}, "stroke": None},
                    },
                ],
            }
        ],
        "swatches": ["#000000", "#ffffff"],
        "symbols": [],
        "assets": {},
        "guides": {"horizontal": [50], "vertical": []},
    }
    doc.update(extra)
    return doc


class ApiTests(TestCase):
    def setUp(self):
        WriteLimitMiddleware.reset()
        self.client = Client()

    def post(self, path, body, **kwargs):
        return self.client.post(path, data=json.dumps(body), content_type="application/json", **kwargs)

    def put(self, path, body, **kwargs):
        return self.client.put(path, data=json.dumps(body), content_type="application/json", **kwargs)

    def create(self, **extra):
        response = self.post("/api/v1/documents", {"document": sample(**extra)})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_health_reports_service(self):
        data = self.client.get("/api/v1/health").json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "vinco")

    def test_index_lists_endpoints(self):
        self.assertIn("endpoints", self.client.get("/api/v1").json())

    def test_home_serves_editor_with_csrf_cookie(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Vinco", response.content)
        self.assertIn("csrftoken", response.cookies)

    def test_create_and_read_round_trip(self):
        created = self.create()
        data = self.client.get(f"/api/v1/documents/{created['id']}").json()
        self.assertEqual(data["revision"], 1)
        doc = data["document"]
        self.assertEqual(doc["name"], "Teste")
        self.assertEqual(doc["layers"][0]["children"][0]["id"], "p1")
        self.assertEqual(doc["guides"]["horizontal"], [50.0])
        validate_document(doc)

    def test_normalized_tables_are_filled(self):
        created = self.create()
        document = Document.objects.get(id=created["id"])
        self.assertEqual(document.artboards.count(), 1)
        layer = Layer.objects.get(document=document)
        self.assertEqual(layer.item_count, 2)
        self.assertEqual(DocumentVersion.objects.filter(document=document).count(), 1)

    def test_update_increments_revision_and_detects_conflict(self):
        created = self.create()
        url = f"/api/v1/documents/{created['id']}"
        ok = self.put(url, {"document": sample(name="Novo"), "revision": 1})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["revision"], 2)
        conflict = self.put(url, {"document": sample(name="Velho"), "revision": 1})
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["current_revision"], 2)

    def test_versions_and_restore(self):
        created = self.create(name="Primeira")
        url = f"/api/v1/documents/{created['id']}"
        self.put(url, {"document": sample(name="Segunda"), "revision": 1})
        versions = self.client.get(f"{url}/versions").json()["versions"]
        self.assertEqual([v["revision"] for v in versions], [2, 1])
        restored = self.post(f"{url}/versions/1/restore", {})
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.json()["revision"], 3)
        self.assertEqual(restored.json()["document"]["name"], "Primeira")
        self.assertEqual(self.post(f"{url}/versions/99/restore", {}).status_code, 404)

    @override_settings(VINCO={"VERSION": "t", "API_TOKEN": "", "MAX_REVISIONS": 3, "WRITE_LIMIT": 0, "TRUSTED_PROXY": False, "MAX_DOCUMENTS_LISTED": 500})
    def test_old_versions_are_pruned(self):
        created = self.create()
        url = f"/api/v1/documents/{created['id']}"
        for revision in range(1, 6):
            self.put(url, {"document": sample(name=f"v{revision}"), "revision": revision})
        self.assertEqual(DocumentVersion.objects.filter(document_id=created["id"]).count(), 3)

    def test_assets_are_stored_deduplicated_and_returned(self):
        url_data = "data:image/png;base64," + base64.b64encode(png_bytes()).decode()
        doc = sample(assets={"as1": url_data})
        doc["layers"][0]["children"].append({"id": "m1", "type": "image", "asset": "as1", "width": 10, "height": 10, "matrix": [1, 0, 0, 1, 0, 0]})
        created = self.post("/api/v1/documents", {"document": doc}).json()
        asset = Asset.objects.get(document_id=created["id"])
        self.assertEqual(asset.mime, "image/png")
        back = self.client.get(f"/api/v1/documents/{created['id']}").json()["document"]
        self.assertEqual(back["assets"]["as1"], url_data)

    def test_rejects_image_with_wrong_signature(self):
        fake = "data:image/png;base64," + base64.b64encode(b"<svg onload=alert(1)>").decode()
        doc = sample(assets={"as1": fake})
        response = self.post("/api/v1/documents", {"document": doc})
        self.assertEqual(response.status_code, 400)

    def test_rejects_svg_data_urls(self):
        doc = sample(assets={"as1": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="})
        self.assertEqual(self.post("/api/v1/documents", {"document": doc}).status_code, 400)

    def test_validation_errors(self):
        cases = [
            {"format": "outro"},
            sample(version=2),
            sample(artboards=[]),
            sample(layers="x"),
        ]
        bad_color = sample()
        bad_color["layers"][0]["children"][0]["style"]["fill"]["color"] = "red;background:url(x)"
        cases.append(bad_color)
        bad_number = sample()
        bad_number["layers"][0]["children"][0]["subpaths"][0]["nodes"][0]["x"] = 1e12
        cases.append(bad_number)
        duplicate = sample()
        duplicate["layers"][0]["children"][1]["id"] = "p1"
        cases.append(duplicate)
        missing_symbol = sample()
        missing_symbol["layers"][0]["children"].append({"id": "s1", "type": "instance", "symbol": "nada", "matrix": [1, 0, 0, 1, 0, 0]})
        cases.append(missing_symbol)
        for case in cases:
            with self.subTest(case=str(case)[:60]):
                self.assertEqual(self.post("/api/v1/documents", {"document": case}).status_code, 400)

    def test_rejects_non_json_and_bad_json(self):
        self.assertEqual(self.client.post("/api/v1/documents", data="x", content_type="text/plain").status_code, 400)
        self.assertEqual(self.client.post("/api/v1/documents", data="{bad", content_type="application/json").status_code, 400)

    def test_bad_revision_type(self):
        created = self.create()
        response = self.put(f"/api/v1/documents/{created['id']}", {"document": sample(), "revision": "1"})
        self.assertEqual(response.status_code, 400)

    def test_not_found_and_delete(self):
        self.assertEqual(self.client.get("/api/v1/documents/00000000-0000-0000-0000-000000000000").status_code, 404)
        created = self.create()
        self.assertEqual(self.client.delete(f"/api/v1/documents/{created['id']}").status_code, 204)
        self.assertFalse(Document.objects.filter(id=created["id"]).exists())

    def test_list_and_search(self):
        self.create(name="Logo azul")
        self.create(name="Cartaz")
        names = [d["name"] for d in self.client.get("/api/v1/documents?q=logo").json()["documents"]]
        self.assertEqual(names, ["Logo azul"])

    def test_svg_export_escapes_text_and_is_sandboxed(self):
        created = self.create()
        response = self.client.get(f"/api/v1/documents/{created['id']}/svg")
        self.assertEqual(response.status_code, 200)
        body = response.content.decode()
        self.assertNotIn("<script>", body)
        self.assertIn("&lt;script&gt;", body)
        self.assertIn("sandbox", response["Content-Security-Policy"])
        self.assertIn('viewBox="0 0 400 300"', body)

    def test_export_downloads_vinco(self):
        created = self.create()
        response = self.client.get(f"/api/v1/documents/{created['id']}/export")
        self.assertEqual(response.status_code, 200)
        self.assertIn(".vinco", response["Content-Disposition"])
        self.assertEqual(json.loads(response.content)["format"], "vinco")


class SecurityTests(TestCase):
    def setUp(self):
        WriteLimitMiddleware.reset()

    def test_csrf_is_enforced_for_browser_writes(self):
        client = Client(enforce_csrf_checks=True)
        response = client.post("/api/v1/documents", data=json.dumps({"document": sample()}), content_type="application/json")
        self.assertEqual(response.status_code, 403)
        client.get("/")
        token = client.cookies["csrftoken"].value
        ok = client.post("/api/v1/documents", data=json.dumps({"document": sample()}), content_type="application/json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(ok.status_code, 201)

    @override_settings(VINCO={"VERSION": "t", "API_TOKEN": "token-secreto-de-teste", "MAX_REVISIONS": 30, "WRITE_LIMIT": 0, "TRUSTED_PROXY": False, "MAX_DOCUMENTS_LISTED": 500})
    def test_api_token_bypasses_csrf_only_when_correct(self):
        client = Client(enforce_csrf_checks=True)
        body = json.dumps({"document": sample()})
        wrong = client.post("/api/v1/documents", data=body, content_type="application/json", HTTP_AUTHORIZATION="Bearer errado")
        self.assertEqual(wrong.status_code, 403)
        right = client.post("/api/v1/documents", data=body, content_type="application/json", HTTP_AUTHORIZATION="Bearer token-secreto-de-teste")
        self.assertEqual(right.status_code, 201)

    @override_settings(VINCO={"VERSION": "t", "API_TOKEN": "", "MAX_REVISIONS": 30, "WRITE_LIMIT": 2, "TRUSTED_PROXY": False, "MAX_DOCUMENTS_LISTED": 500})
    def test_write_limit(self):
        client = Client()
        body = json.dumps({"document": sample()})
        codes = [client.post("/api/v1/documents", data=body, content_type="application/json").status_code for _ in range(3)]
        self.assertEqual(codes, [201, 201, 429])

    def test_security_headers(self):
        response = Client().get("/api/v1/health")
        self.assertIn("default-src 'self'", response["Content-Security-Policy"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertIn("camera=()", response["Permissions-Policy"])
        self.assertEqual(Client().get("/")["X-Frame-Options"], "DENY")

    def test_methods_are_restricted(self):
        self.assertEqual(Client().patch("/api/v1/documents").status_code, 405)
        self.assertEqual(Client().post("/api/v1/health").status_code, 405)

    @override_settings(DATA_UPLOAD_MAX_MEMORY_SIZE=1024)
    def test_body_size_limit(self):
        big = sample(name="x")
        big["layers"][0]["children"][0]["name"] = "a" * 100
        big["swatches"] = ["#000000"] * 400
        response = Client().post("/api/v1/documents", data=json.dumps({"document": big}), content_type="application/json")
        self.assertEqual(response.status_code, 413)


class ValidationTests(TestCase):
    def test_font_family_is_sanitized(self):
        doc = sample()
        doc["layers"][0]["children"][1]["font"]["family"] = 'Arial"><script>'
        clean, _, _ = validate_document(doc)
        self.assertNotIn('"', clean["layers"][0]["children"][1]["font"]["family"])
        self.assertNotIn("<", clean["layers"][0]["children"][1]["font"]["family"])

    def test_gradient_and_effects(self):
        doc = sample()
        doc["layers"][0]["children"][0]["style"]["fill"] = {"type": "gradient", "kind": "linear", "stops": [{"offset": 0, "color": "#ffffff"}, {"offset": 2, "color": "#000000"}]}
        doc["layers"][0]["children"][0]["effects"] = [{"type": "dropShadow", "dx": 3, "dy": 3, "color": "#000000"}]
        clean, _, _ = validate_document(doc)
        item = clean["layers"][0]["children"][0]
        self.assertEqual(item["style"]["fill"]["stops"][1]["offset"], 1)
        self.assertEqual(item["effects"][0]["type"], "dropShadow")
        doc["layers"][0]["children"][0]["effects"] = [{"type": "script"}]
        with self.assertRaises(ValidationError):
            validate_document(doc)

    def test_svg_export_renders_groups_clips_and_symbols(self):
        doc = sample()
        doc["symbols"] = [{"id": "y1", "name": "Estrela", "children": [doc["layers"][0]["children"][0]]}]
        doc["layers"][0]["children"] = [
            {"id": "g1", "type": "group", "clip": True, "children": [{**doc["symbols"][0]["children"][0], "id": "p2"}, {**doc["symbols"][0]["children"][0], "id": "p3"}]},
            {"id": "s1", "type": "instance", "symbol": "y1", "matrix": [1, 0, 0, 1, 50, 0]},
        ]
        clean, _, _ = validate_document(doc)
        svg = export_svg({**clean, "assets": {}})
        self.assertIn("<clipPath", svg)
        self.assertIn('<use href="#sym-y1"', svg)
        self.assertIn('<g id="sym-y1">', svg)
