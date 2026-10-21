"""The mascot card and its speech bubble must not cover controls.

For every editor step and theme, at 1280x800 and 1366x768, the visible boxes of
#mascot and #mascotBubble have to miss every input, button, select, textarea,
label, heading, and the preview/timeline. A planted overlap must be reported,
so a checker that never fires fails the run too.

CI runs this file. It serves static/ itself and stubs the two JSON endpoints
the page needs, so it does not boot the whisper stack.
"""
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
SHOTS = Path("/opt/cursor/artifacts/screenshots")
DOCS = ROOT / "docs" / "screenshots"
THEMES = ("aero", "y2k", "winamp")
VIEWPORTS = ((1280, 800), (1366, 768))

_ENGINE = json.loads((STATIC / "engine" / "presets.json").read_text(encoding="utf-8"))
_LOOKS = _ENGINE["looks"]
CONFIG = {
    "presets": {
        k: {
            "label": v["label"],
            "font": v["style"]["font"],
            "hi": v["style"]["active"],
            "grad": v["grad"],
            "upper": v["style"]["upper"],
        }
        for k, v in _LOOKS.items()
    },
    "engine": _ENGINE,
    "sizes": ["9:16", "4:5", "1:1", "16:9"],
    "demucs": False,
    "models": [],
    "tiers": [],
    "default_tier": "best",
    "aligner_ready": False,
    "can_open_folders": False,
    "desktop_mode": None,
    "can_quit": False,
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt, *args):
        return

    def _json(self, payload):
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/config":
            return self._json(CONFIG)
        if path == "/api/fonts":
            return self._json({"fonts": []})
        if path == "/api/presets":
            return self._json({"presets": []})
        return super().do_GET()


def serve():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# Visible boxes are clipped by overflow ancestors. A control scrolled out of
# the side panel must not count as a hit just because its layout box still
# extends through the mascot row.
OVERLAP_JS = r"""
() => {
  const bubble = document.querySelector('#mascotBubble');
  const mascot = document.querySelector('#mascot');
  if (window.Mascot) Mascot.say('Nice frame.', 60000);
  else if (bubble) { bubble.textContent = 'Nice frame.'; bubble.classList.add('show'); }
  function shown(el) {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0;
  }
  function box(el) {
    if (!shown(el)) return null;
    const rect = el.getBoundingClientRect();
    let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === 'none' || ps.visibility === 'hidden') return null;
      const clipX = /hidden|auto|scroll|clip/.test(ps.overflowX);
      const clipY = /hidden|auto|scroll|clip/.test(ps.overflowY);
      if (!clipX && !clipY) continue;
      const b = p.getBoundingClientRect();
      if (clipX) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
      if (clipY) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    }
    const width = right - left, height = bottom - top;
    if (width < 2 || height < 2) return null;
    return {left, right, top, bottom, width, height};
  }
  function intersects(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 1 && h > 1;
  }
  function label(el) {
    const id = el.id ? '#' + el.id : '';
    const text = (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName || '')
      .toString().replace(/\s+/g, ' ').trim().slice(0, 42);
    return (id + ' ' + text).trim();
  }
  const hits = [];
  if (!mascot) return ['#mascot missing'];
  const mbox = box(mascot);
  const bbox = bubble ? box(bubble) : null;
  if (mbox) {
    const pos = getComputedStyle(mascot).position;
    if (pos === 'fixed' || pos === 'absolute') hits.push('mascot is ' + pos);
    const parent = mascot.parentElement;
    if (!parent || !parent.classList.contains('work')) hits.push('mascot is not in the side-panel slot');
  }
  if (bbox) {
    const pos = getComputedStyle(bubble).position;
    if (pos === 'fixed' || pos === 'absolute') hits.push('bubble is ' + pos);
  }
  const actors = [];
  if (mbox) actors.push(['mascot', mbox]);
  if (bbox) actors.push(['bubble', bbox]);
  const scroller = document.querySelector('#step3');
  if (scroller && !scroller.classList.contains('step-off')) {
    const sb = scroller.getBoundingClientRect();
    const slot = {left: sb.left, right: sb.right, top: sb.top, bottom: sb.bottom, width: sb.width, height: sb.height};
    if (slot.height > 2) {
      if (mbox && intersects(mbox, slot)) hits.push('mascot overlaps the control scroller');
      if (bbox && intersects(bbox, slot)) hits.push('bubble overlaps the control scroller');
    }
  }
  const sel = 'input, textarea, select, button, label, summary, h2, h3, .sublbl, .field > span, .stagecol, #preview, #stage, #videoTl, #textTl, #wsWrap';
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('#mascot, .step-off, .hidden, #helpOverlay, #tour, .bgfx')) continue;
    const target = box(el);
    if (!target) continue;
    for (const [who, actor] of actors) {
      if (intersects(actor, target)) hits.push(who + ' covers ' + label(el));
    }
  }
  return hits.slice(0, 16);
}
"""

LAYOUT_JS = r"""
() => {
  const stage = document.querySelector('.stagecol').getBoundingClientRect();
  const tl = document.querySelector('#videoTl').getBoundingClientRect();
  const row = document.querySelector('#videoTl .tlrow').getBoundingClientRect();
  return {
    ratio: stage.width / innerWidth,
    tlRatio: tl.height / innerHeight,
    wide: tl.width > innerWidth * 0.9,
    row: row.height,
  };
}
"""


def overlap_hits(page):
    return page.evaluate(OVERLAP_JS)


def launch(p):
    args = ["--no-sandbox", "--disable-dev-shm-usage"]
    try:
        return p.chromium.launch(headless=True, args=args)
    except Exception:
        return p.chromium.launch(channel="chrome", headless=True, args=args)


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)
    httpd = serve()
    port = httpd.server_address[1]
    failures = []
    try:
        with sync_playwright() as p:
            browser = launch(p)
            page = browser.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
            page.add_init_script("""
              localStorage.setItem('lc-tour-skip', '1');
              localStorage.removeItem('lc-mascot-hidden');
              localStorage.removeItem('lc-side-shut');
              localStorage.removeItem('lc-tl-frac');
              localStorage.removeItem('lc-theme');
            """)
            errors = []
            page.on("pageerror", lambda err: errors.append(str(err)))
            page.goto(f"http://127.0.0.1:{port}/", wait_until="domcontentloaded")
            page.wait_for_function(
                "() => !!(window.ED && window.LCFlow && window.Mascot && document.querySelector('#ctlText input'))",
                timeout=30000,
            )
            page.evaluate("""() => {
              S.audio = {id: 'clip', name: 'sung.wav', duration: 20, peaks: [0.2, 0.5, 0.4, 0.3, 0.6, 0.2]};
              S.lines = [{words: [{text: 'PLEASE', start: 0.2, end: 0.8}, {text: 'SEND', start: 0.8, end: 1.4}]}];
              S.start = 0;
              S.len = 20;
              ED.skipVideo();
              const scale = document.querySelector('#scaleIn');
              if (scale) scale.value = '1.35';
              const y = document.querySelector('#posY');
              if (y) y.value = '0.42';
            }""")
            for width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                for theme in THEMES:
                    page.click(f"#themePick button[data-theme='{theme}']")
                    page.wait_for_timeout(150)
                    for step in range(1, 6):
                        page.evaluate(f"() => LCFlow.show({step})")
                        page.wait_for_timeout(120)
                        if step == 3:
                            page.evaluate("""() => {
                              const step3 = document.querySelector('#step3');
                              if (step3) step3.scrollTop = 0;
                              const title = document.querySelector('#overlayText');
                              if (title && !document.querySelector('#overlayList [data-del]')) {
                                title.value = 'END CREDITS';
                                document.querySelector('#overlayAdd').click();
                              }
                            }""")
                        hits = overlap_hits(page)
                        where = f"step {step} {theme} {width}x{height}"
                        if hits:
                            failures.append(f"{where}: {hits}")
                            page.screenshot(path=str(SHOTS / f"overlap_fail_{theme}_{width}x{height}_s{step}.png"))
                            print("FAIL", where, hits)
                        else:
                            print("ok", where)
                        if step == 3:
                            # Scroll the controls the 1.5.1 dock covered into the pane and measure again.
                            for sel in ("#scaleIn", "#posY", "#overlayText"):
                                page.evaluate(
                                    """sel => document.querySelector(sel).scrollIntoView({block: 'center', inline: 'nearest'})""",
                                    sel,
                                )
                                scrolled = overlap_hits(page)
                                if scrolled:
                                    failures.append(f"{where} scrolled {sel}: {scrolled}")
                                    page.screenshot(path=str(SHOTS / f"overlap_fail_{theme}_{width}x{height}_s{step}.png"))
                                    print("FAIL", where, "scrolled", sel, scrolled)
                            page.evaluate("""() => {
                              const scroller = document.querySelector('#step3');
                              const title = document.querySelector('#overlayText');
                              const pane = scroller.getBoundingClientRect();
                              const box = title.getBoundingClientRect();
                              scroller.scrollTop += box.bottom - pane.bottom + 8;
                            }""")
                            framed = overlap_hits(page)
                            if framed:
                                failures.append(f"{where} framed: {framed}")
                                print("FAIL", where, "framed", framed)
                        if step == 3:
                            box = page.evaluate(LAYOUT_JS)
                            if not (0.55 <= box["ratio"] <= 0.65 and 0.28 <= box["tlRatio"] <= 0.40 and box["wide"] and box["row"] >= 48):
                                failures.append(f"{where} layout {box}")
                                print("LAYOUT", where, box)
                            if (width, height) == (1280, 800):
                                name = f"video-{theme}-1280x800.png"
                                page.screenshot(path=str(SHOTS / f"video_{theme}_1280800.png"))
                                page.screenshot(path=str(DOCS / name))
                                print("shot", name)
            page.evaluate("""() => {
              LCFlow.show(3);
              const target = document.querySelector('#overlayText');
              target.scrollIntoView({block: 'center', inline: 'center'});
              const r = target.getBoundingClientRect();
              const mascot = document.querySelector('#mascot');
              const work = document.querySelector('.work');
              mascot.style.overflow = 'visible';
              if (work) work.style.overflow = 'visible';
              const bubble = document.querySelector('#mascotBubble');
              bubble.classList.add('show');
              bubble.textContent = 'Nice frame.';
              bubble.style.position = 'fixed';
              bubble.style.left = r.left + 'px';
              bubble.style.top = r.top + 'px';
              bubble.style.width = Math.max(120, r.width) + 'px';
              bubble.style.height = Math.max(40, r.height) + 'px';
              bubble.style.margin = '0';
              bubble.style.zIndex = '90';
            }""")
            planted = overlap_hits(page)
            caught = any("overlayText" in hit or "Title or credit" in hit for hit in planted)
            print("planted", planted)
            if not caught:
                failures.append("planted bubble was not detected: " + json.dumps(planted))
            if errors:
                print("PAGEERRORS", errors[:8])
            browser.close()
    finally:
        httpd.shutdown()
    if failures:
        print("OVERLAP", json.dumps(failures, indent=2))
        raise SystemExit("mascot overlap: " + json.dumps(failures))
    print("mascot overlap ok")


if __name__ == "__main__":
    main()
