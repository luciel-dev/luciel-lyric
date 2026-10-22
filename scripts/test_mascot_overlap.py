"""The mascot card and its speech bubble must not cover controls.

For every editor step and theme, at 1280x800, 1366x768, 1280x720, and 1920x1080,
the visible boxes of #mascot and #mascotBubble have to miss every input, button,
select, textarea, label, heading, and the preview/timeline. Audio, Sync, and
Video are also checked for clipped readouts and a full-width seek bar. A planted
overlap must be reported, so a checker that never fires fails the run too.

The same run drags the song-section handles and a video-clip edge with pointer
events. Section times have to move and stay inside 15–30 seconds. Trimming a
clip must leave lyric word times untouched. With the lyric lock on, a timeline
drag does nothing. Unlocked, a block slide, an edge drag, and a multi-select
drag move only times, and undo puts the previous times back. The lock is the
same one Sync uses.

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
VIEWPORTS = ((1280, 800), (1366, 768), (1280, 720), (1920, 1080))

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


CLIP_JS = r"""
() => {
  const step = window.LCFlow ? LCFlow.step() : 0;
  const hits = [];
  function shown(el) {
    if (!el || el.closest('.step-off, .hidden')) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }
  function clipped(el) {
    if (!shown(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === 'none' || ps.visibility === 'hidden') return false;
      const b = p.getBoundingClientRect();
      if (/hidden|auto|scroll|clip/.test(ps.overflowX)) {
        left = Math.max(left, b.left); right = Math.min(right, b.right);
      }
      if (/hidden|auto|scroll|clip/.test(ps.overflowY)) {
        top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom);
      }
    }
    return (bottom - top) < rect.height - 2 || (right - left) < rect.width - 2;
  }
  for (const sel of ['#wsHint', '#songRange .songread', '#stageTime', '#stagePlay']) {
    const el = document.querySelector(sel);
    if (el && clipped(el)) hits.push(sel + ' clipped');
  }
  if (step === 2 || step === 3) {
    const scrub = document.querySelector('#scrub');
    const transport = document.querySelector('.transport');
    const host = step === 3 ? document.querySelector('.stagecol') : document.querySelector('#dock');
    if (scrub && transport && host) {
      const sw = scrub.getBoundingClientRect();
      const tw = transport.getBoundingClientRect();
      const hw = host.getBoundingClientRect();
      if (hw.width > 40 && tw.width < hw.width * 0.92) hits.push('transport narrow ' + Math.round(tw.width) + '/' + Math.round(hw.width));
      if (tw.width > 40 && sw.width < tw.width * 0.45) hits.push('scrub narrow ' + Math.round(sw.width) + '/' + Math.round(tw.width));
      if (sw.height < 24) hits.push('scrub short ' + Math.round(sw.height));
    }
    const play = document.querySelector('#stagePlay');
    const time = document.querySelector('#stageTime');
    const hint = document.querySelector('#wsHint');
    function hit(a, b) {
      if (!a || !b || !shown(a) || !shown(b)) return false;
      const A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
      const w = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      return w > 1 && h > 1;
    }
    if (hit(play, scrub)) hits.push('preview covers scrub');
    if (hit(scrub, time)) hits.push('scrub covers time');
    if (hit(play, hint)) hits.push('preview covers hint');
    if (hit(time, hint)) hits.push('time covers hint');
  }
  if (step === 1 || step === 2 || step === 5) {
    const wave = document.querySelector('#songWave');
    if (!wave || wave.getBoundingClientRect().height < 100) hits.push('song wave short');
  }
  if (step === 2) {
    const stage = document.querySelector('#stage');
    if (stage && getComputedStyle(stage).display !== 'none') hits.push('sync stage still visible');
    const preview = document.querySelector('#preview');
    if (preview && getComputedStyle(preview).display !== 'none') hits.push('sync preview still visible');
    const lyric = document.querySelector('#wsBox');
    if (!lyric || lyric.getBoundingClientRect().height < 120) hits.push('lyric wave short');
  }
  return hits;
}
"""


def overlap_hits(page):
    return page.evaluate(OVERLAP_JS)


def clip_hits(page):
    return page.evaluate(CLIP_JS)


def _drag(page, locator, dx, steps=24):
    box = locator.bounding_box()
    if not box:
        raise RuntimeError("missing drag target " + str(locator))
    x = box["x"] + box["width"] / 2
    y = box["y"] + min(box["height"] / 2, 40)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y, steps=steps)
    page.mouse.up()
    page.wait_for_timeout(60)


def range_and_trim(page):
    """Pointer-drag the song window and a clip edge. Lyrics must stay put."""
    failures = []
    page.set_viewport_size({"width": 1920, "height": 1080})
    kept = page.evaluate("""() => {
      const lines = [
        {words: [{text: 'ONE', start: 0.2, end: 0.6}, {text: 'TWO', start: 0.6, end: 1.0}]},
        {words: [{text: 'THREE', start: 1.2, end: 1.6}]},
        {words: [{text: 'FOUR', start: 2.0, end: 2.4}]},
        {words: [{text: 'FIVE', start: 3.0, end: 3.5}]},
      ];
      const peaks = [];
      for (let i = 0; i < 400; i++) peaks.push(0.25 + 0.6 * Math.abs(Math.sin(i / 11)));
      S.audio = {id: 'long', name: 'long.wav', duration: 90, peaks};
      S.lines = JSON.parse(JSON.stringify(lines));
      S.start = 0;
      S.len = 20;
      LCFlow.show(1);
      return JSON.stringify(S.lines);
    }""")
    page.wait_for_selector("#songWave [part~='region-handle-right']", timeout=8000)
    before = page.evaluate("() => ({start: S.start, len: S.len})")
    _drag(page, page.locator("#songWave [part~='region-handle-right']"), 700, steps=40)
    right = page.evaluate("() => ({start: S.start, len: S.len, lines: JSON.stringify(S.lines), read: document.querySelector('#songLenRead').textContent})")
    if right["lines"] != kept:
        failures.append("end-handle drag changed lyric lines")
    if not (28 <= right["len"] <= 30.05):
        failures.append(f"end handle did not clamp near 30s: {right}")
    if abs(right["start"] - before["start"]) > 0.2 and right["len"] <= before["len"]:
        failures.append(f"end handle moved the start: {before} -> {right}")
    page.wait_for_selector("#songWave [part~='region-handle-left']", timeout=4000)
    _drag(page, page.locator("#songWave [part~='region-handle-left']"), 500, steps=36)
    left = page.evaluate("() => ({start: S.start, len: S.len, lines: JSON.stringify(S.lines)})")
    if left["lines"] != kept:
        failures.append("start-handle drag changed lyric lines")
    if left["len"] < 14.95 or left["len"] > 16.5:
        failures.append(f"start handle did not clamp near 15s: {left}")
    if left["start"] <= 0.2:
        failures.append(f"start handle did not move: {left}")
    length_held = left["len"]
    _drag(page, page.locator("#songWave [part='region section']"), 180, steps=16)
    moved = page.evaluate("() => ({start: S.start, len: S.len, lines: JSON.stringify(S.lines)})")
    if moved["lines"] != kept:
        failures.append("region drag changed lyric lines")
    if abs(moved["len"] - length_held) > 0.25:
        failures.append(f"region drag changed length: {length_held} -> {moved}")
    if moved["start"] <= left["start"] + 0.3:
        failures.append(f"region drag did not move the section: {left} -> {moved}")
    typed = page.evaluate("""() => {
      const input = document.querySelector('#songLenIn');
      input.value = '22';
      input.dispatchEvent(new Event('change', {bubbles: true}));
      return {len: S.len, lines: JSON.stringify(S.lines)};
    }""")
    if abs(typed["len"] - 22) > 0.05 or typed["lines"] != kept:
        failures.append(f"typed length failed: {typed}")
    # Settle a section with both handles inset for the screenshots.
    page.evaluate("""() => { setSection(8, 18); LCFlow.show(1); }""")
    page.wait_for_timeout(250)
    for theme in THEMES:
        page.click(f"#themePick button[data-theme='{theme}']")
        page.wait_for_timeout(180)
        page.screenshot(path=str(SHOTS / f"song_range_{theme}.png"))
        page.screenshot(path=str(DOCS / f"song-range-{theme}.png"))
    page.evaluate("""() => { setSection(4, 18); LCFlow.show(2); }""")
    page.wait_for_function(
        """() => {
          const stage = document.querySelector('#stage');
          const wave = document.querySelector('#wsBox');
          return stage && getComputedStyle(stage).display === 'none' && wave && wave.getBoundingClientRect().height >= 120;
        }""",
        timeout=8000,
    )
    for theme in THEMES:
        page.click(f"#themePick button[data-theme='{theme}']")
        page.wait_for_timeout(220)
        page.screenshot(path=str(SHOTS / f"sync_{theme}.png"))
        page.screenshot(path=str(DOCS / f"sync-{theme}.png"))
    words = page.evaluate("""() => {
      const words = JSON.stringify(S.lines.map(l => l.words.map(w => [w.text, w.start, w.end])));
      ED.onVideo({bg_video_id: 'v1', name: 'luciel-clip-916.mp4', duration: 6, preview_url: '', thumbs_url: ''});
      LCFlow.show(3);
      return words;
    }""")
    page.wait_for_selector("#tlTrack .tlclip .edge.out", timeout=8000)
    out0 = page.evaluate("() => ED.state().clips[0].out")
    for theme in THEMES:
        page.click(f"#themePick button[data-theme='{theme}']")
        page.wait_for_timeout(120)
        edge = page.locator("#tlTrack .tlclip .edge.out").first
        box = edge.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] - 70, box["y"] + 8, steps=8)
        page.wait_for_timeout(40)
        page.screenshot(path=str(SHOTS / f"trim_drag_{theme}.png"))
        page.screenshot(path=str(DOCS / f"trim-drag-{theme}.png"))
        page.mouse.up()
        page.wait_for_timeout(40)
    after = page.evaluate("""() => ({
      words: JSON.stringify(S.lines.map(l => l.words.map(w => [w.text, w.start, w.end]))),
      out: ED.state().clips[0].out,
    })""")
    if after["words"] != words:
        failures.append("clip trim changed lyric word times")
    if not (after["out"] < out0 - 0.2):
        failures.append(f"clip out edge did not trim: {out0} -> {after['out']}")
    return failures


def _pointer(page, locator, dx, dy=0, steps=12):
    box = locator.bounding_box()
    if not box:
        raise RuntimeError("missing drag target " + str(locator))
    x = box["x"] + box["width"] / 2
    y = box["y"] + box["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=steps)
    page.wait_for_timeout(40)
    return x, y


def lyric_slide(page):
    """Lock, slide, edge-resize, and multi-select lyric blocks. One undo each."""
    failures = []
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.evaluate("""() => {
      const lines = [
        {words: [{text: 'Hello', start: 0.5, end: 1.1}, {text: 'there', start: 1.1, end: 2.0}]},
        {words: [{text: 'We', start: 3.0, end: 3.4}, {text: 'are', start: 3.4, end: 3.9}, {text: 'here', start: 3.9, end: 5.0}]},
        {words: [{text: 'Fading', start: 8.2, end: 8.55}]},
        {words: [{text: 'Chorus', start: 10.0, end: 11.0}, {text: 'line', start: 11.0, end: 12.0}]},
        {words: [{text: 'Again', start: 13.0, end: 14.2}, {text: 'now', start: 14.2, end: 15.5}]},
      ];
      S.lines = JSON.parse(JSON.stringify(lines));
      S.start = 4;
      S.len = 20;
      S.timingLock = true;
      ED.state().styleOv = {size: 0.09};
      ED.state().lyricSel = [];
      if (!ED.state().clips.length) {
        ED.onVideo({bg_video_id: 'v1', name: 'luciel-clip-916.mp4', duration: 6, preview_url: '', thumbs_url: ''});
      }
      setTimingLock(true);
      LCFlow.show(3);
      ED.seek(0);
      ED.refresh();
    }""")
    page.wait_for_selector("#tlLyrics .tllyric.locked", timeout=8000)

    def times():
        return page.evaluate("""() => JSON.stringify(S.lines.map(l => l.words.map(w => [w.text, w.start, w.end])))""")

    base = times()
    style = page.evaluate("() => JSON.stringify(ED.state().styleOv)")
    locked_label = page.evaluate("""() => ({
      label: document.querySelector('#tlLockLabel').textContent,
      sync: document.querySelector('#lockToggle').textContent,
      cursor: getComputedStyle(document.querySelector('#tlLyrics .tllyric')).cursor,
      title: document.querySelector('#tlLyrics .tllyric[data-i="2"]').getAttribute('title'),
      overflow: getComputedStyle(document.querySelector('#tlLyrics .tllyric')).overflow,
    })""")
    if locked_label["label"] != "Lyrics locked":
        failures.append("default label " + locked_label["label"])
    if "locked" not in locked_label["sync"].lower():
        failures.append("sync lock out of step with timeline: " + locked_label["sync"])
    if locked_label["cursor"] != "not-allowed":
        failures.append("locked cursor " + locked_label["cursor"])
    if locked_label["title"] != "Fading" or locked_label["overflow"] != "hidden":
        failures.append("short block tooltip/overflow " + json.dumps(locked_label))
    box = page.locator("#tlLyrics .tllyric[data-i='2']")
    inside = page.evaluate("""() => {
      const block = document.querySelector('#tlLyrics .tllyric[data-i="2"]');
      const span = block.querySelector('span');
      const b = block.getBoundingClientRect();
      const s = span.getBoundingClientRect();
      const header = document.querySelector('#tlLock').getBoundingClientRect();
      const label = document.querySelector('#tlLockLabel').getBoundingClientRect();
      return {
        span: s.right <= b.right + 1 && s.left >= b.left - 1 && s.width <= b.width + 1,
        cut: span.scrollWidth > span.clientWidth + 1,
        label: label.right <= header.right + 1 && label.bottom <= header.bottom + 1,
      };
    }""")
    if not inside["span"] or not inside["cut"]:
        failures.append("Fading label overflow " + json.dumps(inside))
    if not inside["label"]:
        failures.append("lock label overflows its header " + json.dumps(inside))
    _pointer(page, page.locator("#tlLyrics .tllyric[data-i='0']"), 40)
    mid_lock = page.evaluate("() => ({tip: document.querySelector('#tlTip').textContent, hidden: document.querySelector('#tlTip').hidden})")
    page.mouse.up()
    page.wait_for_timeout(40)
    if mid_lock["tip"] != "Unlock to move" or mid_lock["hidden"]:
        failures.append("locked hint " + json.dumps(mid_lock))
    if times() != base:
        failures.append("locked drag changed times")
    page.click("#tlLock")
    shared = page.evaluate("""() => ({
      label: document.querySelector('#tlLockLabel').textContent,
      sync: document.querySelector('#lockToggle').textContent,
      pressed: document.querySelector('#tlLock').getAttribute('aria-pressed'),
    })""")
    if shared["label"] != "Lyrics unlocked" or "Unlocked" not in shared["sync"] or shared["pressed"] != "false":
        failures.append("timeline unlock did not unlock sync " + json.dumps(shared))
    page.evaluate("() => LCFlow.show(2)")
    page.click("#lockToggle")
    relock = page.evaluate("() => document.querySelector('#tlLockLabel').textContent")
    if relock != "Lyrics locked":
        failures.append("sync lock did not lock the timeline: " + relock)
    page.evaluate("() => LCFlow.show(3)")
    page.click("#tlLock")
    page.evaluate("() => { ED.seek(0); LCHist.capture(); }")
    before_slide = times()
    _pointer(page, page.locator("#tlLyrics .tllyric[data-i='0']"), 40)
    slide_tip = page.evaluate("() => ({tip: document.querySelector('#tlTip').textContent, hidden: document.querySelector('#tlTip').hidden})")
    page.mouse.up()
    page.wait_for_timeout(80)
    slid = json.loads(times())
    orig = json.loads(before_slide)
    deltas = []
    for word, was in zip(slid[0], orig[0]):
        deltas.append(round(word[1] - was[1], 3))
        deltas.append(round(word[2] - was[2], 3))
    if len(set(deltas)) != 1 or abs(deltas[0]) < 0.4:
        failures.append("slide delta " + json.dumps(deltas))
    if slid[0][-1][2] > slid[1][0][1] + 0.001:
        failures.append("slide overlapped the next line " + json.dumps(slid[:2]))
    if any(slid[i] != orig[i] for i in range(1, 5)):
        failures.append("slide moved another line")
    if any(word[0] != was[0] for line, was_line in zip(slid, orig) for word, was in zip(line, was_line)):
        failures.append("slide changed lyric text")
    if not slide_tip["hidden"] and "→" not in slide_tip["tip"]:
        failures.append("slide tooltip " + json.dumps(slide_tip))
    if slide_tip["hidden"]:
        failures.append("slide tooltip hidden")
    page.click("#btnUndo")
    page.wait_for_timeout(80)
    if times() != before_slide:
        failures.append("undo did not restore the slide " + times())
    page.click("#btnRedo")
    page.wait_for_timeout(80)
    if json.loads(times()) != slid:
        failures.append("redo did not restore the slide")
    page.click("#btnUndo")
    page.wait_for_timeout(350)

    page.evaluate("() => { ED.seek(0); LCHist.capture(); }")
    before_edge = times()
    _pointer(page, page.locator("#tlLyrics .tllyric[data-i='1'] .edge.out"), 60)
    page.mouse.up()
    page.wait_for_timeout(80)
    edged = json.loads(times())
    was = json.loads(before_edge)[1]
    got = edged[1]
    if abs(got[0][1] - was[0][1]) > 0.02:
        failures.append("edge drag moved the line start " + json.dumps(got))
    if got[-1][2] < was[-1][2] + 0.5:
        failures.append("edge drag did not extend the line " + json.dumps({"was": was, "got": got}))
    old_span = was[-1][2] - was[0][1]
    new_span = got[-1][2] - got[0][1]
    for word, prev in zip(got, was):
        expect = got[0][1] + (prev[1] - was[0][1]) / old_span * new_span
        if abs(word[1] - expect) > 0.03:
            failures.append("edge drag did not rescale words " + json.dumps({"was": was, "got": got}))
            break
    if got[-1][2] > json.loads(before_edge)[2][0][1] + 0.001:
        failures.append("edge drag overlapped the next block")
    if any(word[0] != prev[0] for word, prev in zip(got, was)):
        failures.append("edge drag changed text")
    page.click("#btnUndo")
    page.wait_for_timeout(350)
    if times() != before_edge:
        failures.append("undo did not restore the edge drag " + times())

    page.locator("#tlLyrics .tllyric[data-i='3']").click()
    page.locator("#tlLyrics .tllyric[data-i='4']").click(modifiers=["Shift"])
    selected = page.evaluate("() => ED.state().lyricSel.slice().sort((a, b) => a - b)")
    if selected != [3, 4]:
        failures.append("shift-click selection " + json.dumps(selected))
    page.evaluate("() => { ED.seek(0); LCHist.capture(); }")
    before_multi = times()
    _pointer(page, page.locator("#tlLyrics .tllyric[data-i='3']"), 50)
    page.mouse.up()
    page.wait_for_timeout(80)
    moved = json.loads(times())
    prior = json.loads(before_multi)
    d3 = round(moved[3][0][1] - prior[3][0][1], 3)
    d4 = round(moved[4][0][1] - prior[4][0][1], 3)
    if abs(d3 - d4) > 0.001 or abs(d3) < 0.4:
        failures.append(f"section drag deltas {d3} {d4}")
    if any(moved[i] != prior[i] for i in (0, 1, 2)):
        failures.append("section drag moved a line outside the selection")
    if moved[4][-1][2] > 20.001 or moved[3][0][1] < -0.001:
        failures.append("section drag left the song window")
    page.click("#btnUndo")
    page.wait_for_timeout(350)
    if times() != before_multi:
        failures.append("undo did not restore the section drag " + times())

    gap = page.evaluate("""() => {
      const blocks = [...document.querySelectorAll('#tlLyrics .tllyric')].map(n => {
        const b = n.getBoundingClientRect();
        return {i: +n.dataset.i, left: b.left, right: b.right, top: b.top, bottom: b.bottom};
      });
      const a = blocks.find(b => b.i === 2);
      const c = blocks.find(b => b.i === 4);
      return {x: a.right + 12, y: a.top + 8, x2: c.right - 6, y2: a.bottom - 6};
    }""")
    page.mouse.move(gap["x"], gap["y"])
    page.mouse.down()
    page.mouse.move(gap["x2"], gap["y2"], steps=8)
    page.mouse.up()
    page.wait_for_timeout(40)
    marqueed = page.evaluate("() => ED.state().lyricSel.slice().sort((a, b) => a - b)")
    if marqueed != [3, 4]:
        failures.append("marquee selection " + json.dumps(marqueed))
    page.evaluate("() => { ED.seek(0); LCHist.capture(); }")
    before_box = times()
    _pointer(page, page.locator("#tlLyrics .tllyric[data-i='3']"), 36)
    page.mouse.up()
    page.wait_for_timeout(80)
    boxed = json.loads(times())
    prior_box = json.loads(before_box)
    if round(boxed[3][0][1] - prior_box[3][0][1], 3) != round(boxed[4][0][1] - prior_box[4][0][1], 3):
        failures.append("marquee drag did not move the section together")
    if boxed[3] == prior_box[3]:
        failures.append("marquee drag did not move")
    page.click("#btnUndo")
    page.wait_for_timeout(350)

    page.evaluate("() => { ED.seek(0); LCHist.capture(); }")
    _pointer(page, page.locator("#tlLyrics .tllyric[data-i='0']"), 320)
    page.mouse.up()
    page.wait_for_timeout(60)
    clamped = json.loads(times())
    if clamped[0][-1][2] > clamped[1][0][1] + 0.001:
        failures.append("large drag overlapped " + json.dumps(clamped[:2]))
    if clamped[0][0][1] < -0.001:
        failures.append("large drag left the window")
    page.click("#btnUndo")
    page.wait_for_timeout(350)
    _pointer(page, page.locator("#tlLyrics .tllyric[data-i='4']"), 500)
    page.mouse.up()
    page.wait_for_timeout(60)
    windowed = json.loads(times())
    if windowed[4][-1][2] > 20.001:
        failures.append("drag left the song window " + json.dumps(windowed[4]))
    page.click("#btnUndo")
    page.wait_for_timeout(350)
    if page.evaluate("() => JSON.stringify(ED.state().styleOv)") != style:
        failures.append("lyric drag changed styling")
    if page.evaluate("() => S.start") != 4:
        failures.append("lyric drag changed the song section start")
    page.evaluate("""() => {
      const clip = ED.state().clips[0];
      clip.in = 0;
      clip.out = Math.min(4, clip.duration || 4);
      clip.start = 0;
      ED.refresh();
    }""")
    clip_before = page.evaluate("() => ED.state().clips[0].start")
    words_before = times()
    _pointer(page, page.locator("#tlTrack .tlclip").first, 40)
    page.mouse.up()
    page.wait_for_timeout(40)
    if times() != words_before:
        failures.append("clip drag changed lyric times while lyrics were unlocked")
    if abs(page.evaluate("() => ED.state().clips[0].start") - clip_before) < 0.05:
        failures.append("clip drag no longer moves the clip")
    page.evaluate("""start => { ED.state().clips[0].start = start; ED.refresh(); }""", clip_before)

    page.evaluate("""() => {
      S.lines = [
        {words: [{text: 'Hello', start: 0.5, end: 1.1}, {text: 'there', start: 1.1, end: 2.0}]},
        {words: [{text: 'We', start: 3.0, end: 3.4}, {text: 'are', start: 3.4, end: 3.9}, {text: 'here', start: 3.9, end: 5.0}]},
        {words: [{text: 'Fading', start: 8.2, end: 8.55}]},
        {words: [{text: 'Chorus', start: 10.0, end: 11.0}, {text: 'line', start: 11.0, end: 12.0}]},
        {words: [{text: 'Again', start: 13.0, end: 14.2}, {text: 'now', start: 14.2, end: 15.5}]},
      ];
      ED.state().lyricSel = [];
      setTimingLock(true);
      ED.seek(4);
      ED.refresh();
    }""")
    for theme in THEMES:
        page.click(f"#themePick button[data-theme='{theme}']")
        page.wait_for_timeout(180)
        page.screenshot(path=str(SHOTS / f"lyric_locked_{theme}.png"), full_page=False)
        page.screenshot(path=str(DOCS / f"lyric-locked-{theme}.png"), full_page=False)
        page.click("#tlLock")
        page.wait_for_timeout(80)
        block = page.locator("#tlLyrics .tllyric[data-i='3']")
        _pointer(page, block, 70)
        tip = page.evaluate("() => document.querySelector('#tlTip').textContent")
        if "→" not in tip:
            failures.append(theme + " drag tooltip missing " + tip)
        page.screenshot(path=str(SHOTS / f"lyric_drag_{theme}.png"), full_page=False)
        page.screenshot(path=str(DOCS / f"lyric-drag-{theme}.png"), full_page=False)
        page.mouse.up()
        page.wait_for_timeout(40)
        page.evaluate("""() => {
          const lines = [
            {words: [{text: 'Hello', start: 0.5, end: 1.1}, {text: 'there', start: 1.1, end: 2.0}]},
            {words: [{text: 'We', start: 3.0, end: 3.4}, {text: 'are', start: 3.4, end: 3.9}, {text: 'here', start: 3.9, end: 5.0}]},
            {words: [{text: 'Fading', start: 8.2, end: 8.55}]},
            {words: [{text: 'Chorus', start: 10.0, end: 11.0}, {text: 'line', start: 11.0, end: 12.0}]},
            {words: [{text: 'Again', start: 13.0, end: 14.2}, {text: 'now', start: 14.2, end: 15.5}]},
          ];
          S.lines = lines;
          ED.state().lyricSel = [3, 4];
          ED.seek(4);
          ED.refresh();
        }""")
        page.wait_for_timeout(60)
        _pointer(page, page.locator("#tlLyrics .tllyric[data-i='3']"), 48)
        page.screenshot(path=str(SHOTS / f"lyric_section_{theme}.png"), full_page=False)
        page.screenshot(path=str(DOCS / f"lyric-section-{theme}.png"), full_page=False)
        page.mouse.up()
        page.wait_for_timeout(40)
        page.evaluate("() => setTimingLock(true)")
    page.evaluate("""() => {
      S.lines = [
        {words: [{text: 'Hello', start: 0.5, end: 1.1}, {text: 'there', start: 1.1, end: 2.0}]},
        {words: [{text: 'We', start: 3.0, end: 3.4}, {text: 'are', start: 3.4, end: 3.9}, {text: 'here', start: 3.9, end: 5.0}]},
        {words: [{text: 'Fading', start: 8.2, end: 8.55}]},
        {words: [{text: 'Chorus', start: 10.0, end: 11.0}, {text: 'line', start: 11.0, end: 12.0}]},
        {words: [{text: 'Again', start: 13.0, end: 14.2}, {text: 'now', start: 14.2, end: 15.5}]},
      ];
      setTimingLock(true);
      ED.refresh();
    }""")
    return failures


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
                        if step in (1, 2, 5):
                            page.wait_for_function(
                                """() => {
                                  const wave = document.querySelector('#songWave');
                                  const box = document.querySelector('#songRange');
                                  return wave && box && !box.classList.contains('hidden') && wave.getBoundingClientRect().height >= 100;
                                }""",
                                timeout=8000,
                            )
                        hits = overlap_hits(page)
                        where = f"step {step} {theme} {width}x{height}"
                        if step in (1, 2, 3):
                            clipped = clip_hits(page)
                            if clipped:
                                failures.append(f"{where} clip: {clipped}")
                                page.screenshot(path=str(SHOTS / f"clip_fail_{theme}_{width}x{height}_s{step}.png"))
                                print("FAIL", where, "clip", clipped)
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
                                print("shot", name)
            trim_failures = range_and_trim(page)
            for item in trim_failures:
                failures.append(item)
                print("FAIL", item)
            if not trim_failures:
                print("range and trim ok")
            lyric_failures = lyric_slide(page)
            for item in lyric_failures:
                failures.append(item)
                print("FAIL", item)
            if not lyric_failures:
                print("lyric slide ok")
            page.set_viewport_size({"width": 1280, "height": 800})
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
