import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORTABLE = ROOT / "Vinco.html"
PREFS = "localStorage.setItem('vinco.prefs.v1', JSON.stringify({tutorialDone: true}))"
LAYER = "vinco.app.doc.layers[0].children"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class EditorMixin:
    url = None

    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True, bypass_csp=True)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        self.page.add_init_script(PREFS)
        self.page.goto(self.url)
        self.page.wait_for_function("window.vinco && window.vinco.app.active")
        box = self.page.locator("#canvas-host").bounding_box()
        self.ox, self.oy = box["x"], box["y"]

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def js(self, expression):
        return self.page.evaluate(expression)

    def drag(self, x1, y1, x2, y2, steps=6):
        m = self.page.mouse
        m.move(self.ox + x1, self.oy + y1)
        m.down()
        for i in range(1, steps + 1):
            m.move(self.ox + x1 + (x2 - x1) * i / steps, self.oy + y1 + (y2 - y1) * i / steps)
        m.up()

    def click(self, x, y):
        self.page.mouse.click(self.ox + x, self.oy + y)

    def draw_rect(self, x1=150, y1=150, x2=350, y2=300):
        self.page.keyboard.press("m")
        self.drag(x1, y1, x2, y2)

    def test_draws_rectangle_and_ellipse(self):
        self.draw_rect()
        self.page.keyboard.press("l")
        self.drag(400, 150, 500, 250)
        self.assertEqual(self.js(f"{LAYER}.length"), 2)
        self.assertEqual(self.js(f"{LAYER}[1].subpaths[0].nodes.length"), 4)
        self.assertEqual(self.js("vinco.app.selection.length"), 1)

    def test_undo_and_redo(self):
        self.draw_rect()
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.js(f"{LAYER}.length"), 0)
        self.page.keyboard.press("Control+Shift+z")
        self.assertEqual(self.js(f"{LAYER}.length"), 1)

    def test_pen_creates_curves_and_closes(self):
        self.page.keyboard.press("p")
        self.click(150, 400)
        self.drag(250, 300, 300, 280)
        self.click(350, 420)
        self.click(150, 400)
        self.assertEqual(self.js(f"{LAYER}[0].subpaths[0].closed"), True)
        self.assertEqual(self.js(f"{LAYER}[0].subpaths[0].nodes[1].smooth"), True)

    def test_move_with_selection_tool_and_arrows(self):
        self.draw_rect()
        self.page.keyboard.press("v")
        before = self.js("vinco.app.selectionBounds().minX")
        self.drag(250, 220, 300, 220)
        moved = self.js("vinco.app.selectionBounds().minX")
        self.assertGreater(moved, before + 30)
        self.page.keyboard.press("Shift+ArrowLeft")
        self.assertAlmostEqual(self.js("vinco.app.selectionBounds().minX"), moved - 10, places=3)

    def test_alt_drag_duplicates(self):
        self.draw_rect()
        self.page.keyboard.press("v")
        self.page.keyboard.down("Alt")
        self.drag(250, 220, 420, 220)
        self.page.keyboard.up("Alt")
        self.assertEqual(self.js(f"{LAYER}.length"), 2)

    def test_pathfinder_unite(self):
        self.draw_rect()
        self.draw_rect(300, 250, 450, 400)
        self.page.keyboard.press("Control+a")
        self.js("vinco.panels.pathfinder('unite')")
        self.assertEqual(self.js(f"{LAYER}.length"), 1)

    def test_group_ungroup_and_layers_panel(self):
        self.draw_rect()
        self.draw_rect(400, 150, 500, 250)
        self.page.keyboard.press("Control+a")
        self.page.keyboard.press("Control+g")
        self.assertEqual(self.js(f"{LAYER}.map(i => i.type)"), ["group"])
        self.assertGreater(self.page.locator(".layer-row").count(), 1)
        self.page.keyboard.press("Control+Shift+g")
        self.assertEqual(self.js(f"{LAYER}.length"), 2)

    def test_text_tool(self):
        self.page.keyboard.press("t")
        self.click(300, 200)
        self.page.keyboard.type("Vinco")
        self.page.keyboard.press("Escape")
        self.assertEqual(self.js(f"{LAYER}[0].content"), "Vinco")

    def test_direct_selection_moves_anchor(self):
        self.draw_rect()
        self.page.keyboard.press("a")
        self.page.keyboard.press("Shift+Control+a")
        start = self.js(f"[{LAYER}[0].subpaths[0].nodes[0].x, {LAYER}[0].subpaths[0].nodes[0].y]")
        sx, sy = self.js(f"(() => {{ const p = vinco.viewport.toScreen({LAYER}[0].subpaths[0].nodes[0]); return [p.x, p.y]; }})()")
        self.drag(sx, sy, sx - 40, sy - 40)
        end = self.js(f"[{LAYER}[0].subpaths[0].nodes[0].x, {LAYER}[0].subpaths[0].nodes[0].y]")
        self.assertLess(end[0], start[0] - 20)
        self.assertEqual(self.js(f"{LAYER}[0].subpaths[0].nodes[1].x"), self.js(f"{LAYER}[0].subpaths[0].nodes[1].x"))

    def test_color_swatch_applies_fill(self):
        self.draw_rect()
        self.page.locator('[data-panel="swatches"] .panel-head').click()
        self.page.locator('[data-panel="swatches"] [data-sw="2"]').click()
        self.assertEqual(self.js(f"{LAYER}[0].style.fill.color"), self.js("vinco.app.doc.swatches[2]"))

    def test_effect_and_svg_export(self):
        self.draw_rect()
        self.js("vinco.applyEffect({type: 'dropShadow', dx: 4, dy: 4, blur: 4, opacity: 0.5, color: '#000000', enabled: true})")
        with self.page.expect_download() as info:
            self.js("vinco.io.exportFile('svg', {scope: '0'})")
        path = info.value.path()
        content = Path(path).read_text(encoding="utf-8")
        self.assertIn("<filter", content)
        self.assertIn("<path", content)

    def test_pdf_and_png_export(self):
        self.draw_rect()
        with self.page.expect_download() as info:
            self.js("vinco.io.exportFile('pdf', {scope: 'all'})")
        self.assertTrue(Path(info.value.path()).read_bytes().startswith(b"%PDF-1.7"))
        with self.page.expect_download() as info:
            self.js("vinco.io.exportFile('png', {scope: '0', scale: 1, transparent: true})")
        self.assertTrue(Path(info.value.path()).read_bytes().startswith(b"\x89PNG"))

    def test_menus_and_shortcuts_dialog(self):
        self.page.get_by_role("button", name="Ajuda").click()
        self.page.get_by_role("menuitem", name="Atalhos do teclado").click()
        self.assertTrue(self.page.locator(".dialog").is_visible())
        self.page.keyboard.press("Escape")
        self.assertEqual(self.page.locator(".dialog").count(), 0)

    def test_new_document_tab(self):
        self.js("vinco.app.newDocument({name: 'Segundo', width: 200, height: 200})")
        self.assertEqual(self.page.locator(".doc-tab").count(), 2)
        self.page.locator(".doc-tab").first.click()
        self.assertEqual(self.js("vinco.app.doc.name"), "Sem título")

    def test_interface_palettes_and_theme(self):
        self.page.locator("#palette").click()
        self.page.locator(".menu .menu-item").nth(2).click()
        self.assertEqual(self.js("document.documentElement.dataset.palette"), "3")
        self.page.locator("#theme").click()
        self.assertEqual(self.js("document.documentElement.dataset.theme"), "dark")

    def test_draft_is_saved_and_offered(self):
        self.draw_rect()
        self.page.wait_for_timeout(2000)
        self.page.reload()
        self.page.wait_for_function("window.vinco")
        self.assertTrue(self.page.get_by_text("Recuperar trabalho").is_visible())


class PortableTests(EditorMixin, unittest.TestCase):
    url = PORTABLE.as_uri()


class ServerTests(EditorMixin, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        port = free_port()
        env = {**os.environ, "VINCO_SQLITE_PATH": str(Path(cls.tmp.name) / "e2e.sqlite3"), "VINCO_WRITE_LIMIT": "0", "VINCO_DB_ENGINE": "sqlite"}
        subprocess.run([sys.executable, "manage.py", "migrate", "--noinput", "-v", "0"], cwd=ROOT, env=env, check=True)
        cls.server = subprocess.Popen([sys.executable, "manage.py", "runserver", f"127.0.0.1:{port}", "--noreload"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.url = f"http://127.0.0.1:{port}/"
        for _ in range(100):
            try:
                with urllib.request.urlopen(cls.url + "api/v1/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(0.2)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.tmp.cleanup()

    def test_save_to_server_and_reopen(self):
        self.page.wait_for_function("vinco.io.server !== null")
        self.draw_rect()
        self.js("vinco.io.saveToServer()")
        self.page.wait_for_function("vinco.app.active.serverId !== null")
        server_id = self.js("vinco.app.active.serverId")
        with urllib.request.urlopen(f"{self.url}api/v1/documents/{server_id}", timeout=5) as response:
            data = json.loads(response.read())
        self.assertEqual(len(data["document"]["layers"][0]["children"]), 1)
        self.draw_rect(400, 150, 450, 200)
        self.js("vinco.io.saveToServer()")
        self.page.wait_for_function("vinco.app.active.revision === 2")
        self.js(f"vinco.io.loadFromServer('{server_id}')")
        self.page.wait_for_function("vinco.app.tabs.length === 2")
        self.assertEqual(self.js(f"{LAYER}.length"), 2)


if __name__ == "__main__":
    unittest.main()
