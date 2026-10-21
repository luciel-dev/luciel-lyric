"""Browser checks for the five-step editor: lock, pointer trim/resize, and lyric isolation."""
import json
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path("/workspace")
SHOTS = Path("/opt/cursor/artifacts/screenshots")
SHOTS.mkdir(parents=True, exist_ok=True)
WAV = ROOT / "docs/fixtures/sung_clip.wav"
MP4 = Path("/tmp/luciel-clip-916.mp4")
LYRICS = "\n".join([
    "PLEASE SEND ME BACK TO HEAVEN",
    "I DONT WANNA LIVE LIKE THIS",
    "PLEASE SEND ME BACK TO HEAVEN",
    "I DON'T WANNA FEEL LIKE THIS",
])
THEMES = ("aero", "y2k", "winamp")


def shot(page, name):
    path = SHOTS / f"{name}.png"
    page.screenshot(path=str(path), full_page=True)
    print("shot", path)


def times(page):
    return page.evaluate("() => S.lines.map(ln => ln.words.map(w => [w.start, w.end, w.text]))")


def fingerprint(page):
    return page.evaluate("""() => {
      const st = ED.state();
      return LLLayers.textFingerprint(S.lines, st.styleOv);
    }""")


def lines_json(page):
    return page.evaluate("() => JSON.stringify(S.lines)")


def style_json(page):
    return page.evaluate("() => JSON.stringify(ED.state().styleOv)")


def lyric_lines(page):
    return page.evaluate("() => S.lines.map(ln => ln.words.map(w => w.text).join(' '))")


def overflow(page):
    return page.evaluate("""() => {
      const bad = [];
      const step1 = document.querySelector('#step1');
      if (step1 && !step1.classList.contains('step-off')) {
        const box = step1.querySelector('.lcd-marquee');
        const span = box && box.querySelector('span');
        const em = span && span.querySelector('em');
        if (!box || !span || !span.dataset.full || !em || !em.firstChild) bad.push('LCD title missing');
        else {
          const prevAnim = span.style.animation;
          const prevPad = span.style.paddingLeft;
          span.style.animation = 'none';
          span.style.transform = 'none';
          const range = document.createRange();
          const n = Math.min(12, em.firstChild.textContent.length);
          range.setStart(em.firstChild, 0);
          range.setEnd(em.firstChild, n);
          const r = range.getBoundingClientRect();
          const b = box.getBoundingClientRect();
          const startVisible = r.width > 0 && r.left >= b.left - 1 && r.left < b.right - 4;
          let fits = true;
          if (!span.classList.contains('scrolling')) fits = em.getBoundingClientRect().right <= b.right + 2;
          span.style.animation = prevAnim;
          span.style.paddingLeft = prevPad;
          if (!startVisible || !fits) bad.push('LCD title is cut off');
        }
      }
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('.step-off, .hidden, #mascot, .bgfx, #helpOverlay, #tour, .tlscroll, #lines, .rotimes, .presets, .lcd-marquee')) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.position === 'fixed') continue;
        if (s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'scroll') continue;
        if (el.clientWidth < 8 || el.clientHeight < 8) continue;
        if (['CANVAS','VIDEO','INPUT','TEXTAREA','IMG'].includes(el.tagName)) continue;
        if (el.tagName === 'SELECT') {
          const opt = el.options[el.selectedIndex];
          const label = opt ? (opt.textContent || '').trim() : '';
          if (label) {
            const probe = document.createElement('span');
            probe.textContent = label;
            probe.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;white-space:nowrap;pointer-events:none';
            probe.style.font = s.font;
            probe.style.letterSpacing = s.letterSpacing;
            probe.style.textTransform = s.textTransform;
            document.body.appendChild(probe);
            const textW = probe.getBoundingClientRect().width;
            probe.remove();
            const pad = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
            const arrow = (s.appearance === 'none' || s.webkitAppearance === 'none') ? 0 : 20;
            if (textW > el.clientWidth - pad - arrow + 1) bad.push((el.id || 'select') + ' ' + label.slice(0, 48));
          }
          continue;
        }
        const clipped = (s.overflowX === 'hidden' || s.overflow === 'hidden' || s.textOverflow === 'ellipsis')
          && el.scrollWidth > el.clientWidth + 6;
        if (!clipped) continue;
        const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
        if (!text) continue;
        bad.push((el.id || el.className || el.tagName) + ' ' + text.slice(0, 48));
      }
      return bad.slice(0, 8);
    }""")


def main():
    subprocess.check_call([
        "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=0x2244aa:s=1080x1920:d=6",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
        "-shortest", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-c:a", "aac", str(MP4),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.add_init_script("localStorage.setItem('lc-tour-skip','1'); localStorage.removeItem('lc-draft'); localStorage.removeItem('lc-tl-frac'); localStorage.removeItem('lc-side-shut');")
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        page.goto("http://127.0.0.1:8765/", wait_until="networkidle")
        page.wait_for_function("() => window.LCFlow && window.ED && window.LLLayers && S && S.cfg", timeout=60000)
        if not page.evaluate("() => !!S.cfg.demucs"):
            page.wait_for_function("() => document.querySelector('#sepNote') && document.querySelector('#sepNote').hidden === false")
        assert page.locator("#step3 #syncBtn, #step3 #lockToggle, #step3 #tapHit, #step3 #lyricsIn, #step3 #shiftMinus").count() == 0
        assert page.locator("#videoTl #tapHit, #videoTl #syncBtn").count() == 0

        page.set_input_files("#audioFile", str(WAV))
        page.wait_for_function("() => !!S.audio", timeout=60000)
        page.click("#next1")
        page.wait_for_selector("#step2:not(.step-off)")
        if not page.evaluate("() => !!S.cfg.demucs"):
            assert page.locator("#sepNote").is_visible()
        page.fill("#lyricsIn", LYRICS)
        page.click("#syncBtn")
        page.wait_for_function("() => S.timingLock === true && S.lines.length >= 1", timeout=180000)
        typed = [ln.strip() for ln in LYRICS.splitlines() if ln.strip()]
        assert lyric_lines(page) == typed, lyric_lines(page)
        page.evaluate("() => { const t = +S.lines[0].words[0].start + 0.05; ED.seek(t); updatePreview(t); }")
        preview = " ".join(page.locator("#pvLine").inner_text().split())
        for word in typed[0].split():
            assert word in preview, (word, preview)
        before = times(page)
        assert before and before[0], before
        words = page.locator("#lines input.wt")
        n = words.count()
        assert n >= 3, n
        for i, text in enumerate(("HEAVENLY", "LIVING", "FEELING")):
            words.nth(i).fill(text)
        edited = times(page)
        flat_before = [(a, b) for row in before for a, b, _t in row]
        flat_edited = [(a, b) for row in edited for a, b, _t in row]
        assert flat_before == flat_edited, (flat_before, flat_edited)
        words.nth(0).click()
        for _ in range(5):
            page.keyboard.press("Space")
        page.locator("#step2 h2").click()
        for _ in range(5):
            page.keyboard.press("Space")
        page.wait_for_timeout(200)
        after_space = [(a, b) for row in times(page) for a, b, _t in row]
        assert after_space == flat_before, (after_space, flat_before)
        assert page.evaluate("() => S.timingLock === true")
        locked_text = page.locator("#lockToggle").inner_text()
        assert "locked" in locked_text.lower(), locked_text
        page.evaluate("""(typed) => {
          const rows = typed.map(line => line.split(/\\s+/));
          S.lines.forEach((ln, li) => ln.words.forEach((w, wi) => { if (rows[li] && rows[li][wi] != null) w.text = rows[li][wi]; }));
          renderLines();
        }""", typed)
        assert lyric_lines(page) == typed

        page.click("#next2")
        page.wait_for_selector("#step3:not(.step-off)")
        assert page.locator("#atl").count() == 0
        assert page.locator("#videoTl .tlscroll").count() == 1
        for name in ("Video", "Text", "Lyrics", "Audio"):
            assert page.locator("#videoTl .tlname", has_text=name).count() == 1
        page.set_input_files("#bgVideoFile", str(MP4))
        page.wait_for_function("() => ED.clipCount() > 0 && S.bgMode === 'video'", timeout=60000)
        page.wait_for_function("() => document.querySelector('#vidHandle').classList.contains('on')", timeout=20000)
        page.locator("#handleSE").scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        fp_video = fingerprint(page)
        lines_video = lines_json(page)
        style_video = style_json(page)
        scale0 = page.evaluate("() => ED.state().place.scale")
        out0 = page.evaluate("() => ED.state().clips[0].out")
        box = page.locator("#handleSE").bounding_box()
        assert box and box["width"] > 8, box
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] - 36, box["y"] - 48, steps=10)
        page.mouse.up()
        page.wait_for_timeout(200)
        scale1 = page.evaluate("() => ED.state().place.scale")
        assert scale1 < scale0 - 0.02, (scale0, scale1)
        edge = page.locator("#tlTrack .tlclip .edge.out").first
        edge.scroll_into_view_if_needed()
        eb = edge.bounding_box()
        assert eb, "missing trim edge"
        page.mouse.move(eb["x"] + eb["width"] / 2, eb["y"] + eb["height"] / 2)
        page.mouse.down()
        page.mouse.move(eb["x"] - 60, eb["y"] + eb["height"] / 2, steps=10)
        page.mouse.up()
        page.wait_for_timeout(200)
        out1 = page.evaluate("() => ED.state().clips[0].out")
        assert out1 < out0 - 0.2, (out0, out1)
        assert fingerprint(page) == fp_video
        assert lines_json(page) == lines_video
        assert style_json(page) == style_video

        page.click("#next3")
        page.wait_for_selector("#step4:not(.step-off)")
        page.locator("#ctlText .ctl[data-k=posY] input").fill("0.41")
        page.locator("#ctlText .ctl[data-k=size] input").fill("0.09")
        page.locator("#ctlColor .ctl[data-k=color] input").fill("#ff22aa")
        page.wait_for_timeout(200)
        fp = fingerprint(page)
        lj = lines_json(page)
        sj = style_json(page)
        assert "0.41" in sj or "0.410" in sj, sj
        page.evaluate("() => LCFlow.show(3)")
        page.wait_for_selector("#step3:not(.step-off)")
        page.fill("#scaleIn", "1.35")
        page.dispatch_event("#scaleIn", "change")
        page.fill("#posX", "0.42")
        page.dispatch_event("#posX", "change")
        page.fill("#posY", "0.58")
        page.dispatch_event("#posY", "change")
        page.select_option("#fitSel", "fit")
        page.select_option("#aspectIn", "1:1")
        page.select_option("#aspectIn", "16:9")
        page.select_option("#aspectIn", "4:5")
        page.select_option("#aspectIn", "9:16")
        page.select_option("#fitSel", "crop")
        page.fill("#overlayText", "END CREDITS")
        page.click("#overlayAdd")
        page.evaluate("() => ED.seek(1.2)")
        page.click("#tlSplit")
        page.wait_for_timeout(250)
        assert page.evaluate("() => ED.state().overlays.some(o => o.text === 'END CREDITS')")
        assert page.evaluate("() => ED.state().clips.length >= 2")
        assert fingerprint(page) == fp, (fingerprint(page), fp)
        assert lines_json(page) == lj
        assert style_json(page) == sj
        assert page.evaluate("() => ED.state().place.fit === 'crop'")
        lyric = page.locator("#tlLyrics .tllyric").first
        if lyric.count():
            lyric.click()
            assert lines_json(page) == lj

        page.evaluate("() => LCFlow.show(1)")
        page.click("#themePick button[data-theme='winamp']")
        caught = page.evaluate("""() => {
          const span = document.querySelector('#lcdTitle');
          const prev = span.style.paddingLeft;
          span.style.paddingLeft = '100%';
          span.style.animation = 'none';
          const box = span.parentElement;
          const em = span.querySelector('em');
          const range = document.createRange();
          range.setStart(em.firstChild, 0);
          range.setEnd(em.firstChild, Math.min(12, em.firstChild.textContent.length));
          const r = range.getBoundingClientRect();
          const b = box.getBoundingClientRect();
          const cut = !(r.width > 0 && r.left >= b.left - 1 && r.left < b.right - 4);
          span.style.paddingLeft = prev;
          span.style.animation = '';
          return cut;
        }""")
        assert caught, "overflow check did not catch a clipped LCD title"
        page.evaluate("""() => {
          const sel = document.querySelector('#aspectIn');
          sel.dataset.label = sel.options[sel.selectedIndex].text;
          sel.options[sel.selectedIndex].text = '9:16 vertical frame that should not fit';
          sel.style.width = '52px';
          sel.style.minWidth = '0';
          sel.style.maxWidth = '52px';
          sel.style.fieldSizing = 'fixed';
        }""")
        page.evaluate("() => LCFlow.show(3)")
        clipped = overflow(page)
        assert any('aspectIn' in item for item in clipped), clipped
        page.evaluate("""() => {
          const sel = document.querySelector('#aspectIn');
          sel.options[sel.selectedIndex].text = sel.dataset.label;
          sel.style.width = '';
          sel.style.minWidth = '';
          sel.style.maxWidth = '';
          sel.style.fieldSizing = '';
        }""")
        leaks = []
        for step, label in ((1, "step1"), (2, "step2_lock"), (3, "step3_handles"), (4, "step4"), (5, "step5")):
            page.evaluate(f"() => LCFlow.show({step})")
            page.wait_for_timeout(250)
            for theme in THEMES:
                page.click(f"#themePick button[data-theme='{theme}']")
                page.wait_for_timeout(200)
                bad = overflow(page)
                if bad:
                    leaks.append(f"{label} {theme}: {bad}")
                shot(page, f"{label}_{theme}")
                if step == 3:
                    page.locator(".stagecol").screenshot(path=str(SHOTS / f"resize_handles_{theme}.png"))
                    for w, h, tag in ((1280, 800, "1280800"), (1920, 1080, "19201080"), (1366, 768, "1366768")):
                        page.set_viewport_size({"width": w, "height": h})
                        page.wait_for_timeout(200)
                        box = page.evaluate("""() => {
                          const stage = document.querySelector('.stagecol').getBoundingClientRect();
                          const tl = document.querySelector('#videoTl').getBoundingClientRect();
                          const row = document.querySelector('#videoTl .tlrow').getBoundingClientRect();
                          const ruler = document.querySelector('#videoTl .tlruler').getBoundingClientRect();
                          const edge = document.querySelector('#videoTl .tlclip .edge');
                          const stepbar = document.querySelector('.stepper').getBoundingClientRect();
                          return {
                            ratio: stage.width / innerWidth,
                            tlRatio: tl.height / innerHeight,
                            wide: tl.width > innerWidth * 0.9,
                            row: row.height,
                            ruler: ruler.height,
                            edge: edge ? edge.getBoundingClientRect().width : 0,
                            step: stepbar.width > 80 && stepbar.bottom <= innerHeight,
                          };
                        }""")
                        assert 0.55 <= box["ratio"] <= 0.65, (theme, tag, box)
                        assert 0.28 <= box["tlRatio"] <= 0.40, (theme, tag, box)
                        assert box["wide"] and box["row"] >= 48 and box["ruler"] >= 22 and box["edge"] >= 18 and box["step"], (theme, tag, box)
                        bad = overflow(page)
                        if bad:
                            leaks.append(f"{label} {theme} {tag}: {bad}")
                        placed = page.evaluate("""() => {
                          const bubble = document.querySelector('#mascotBubble');
                          bubble.textContent = 'Nice frame.';
                          bubble.classList.add('show');
                          function hit(a, b) {
                            if (a.width < 2 || a.height < 2) return false;
                            return !(a.right <= b.left + 1 || a.left >= b.right - 1 || a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
                          }
                          const stage = document.querySelector('.stagecol').getBoundingClientRect();
                          const tl = document.querySelector('#videoTl').getBoundingClientRect();
                          const nodes = ['#mascot', '#mascotBubble'].map(sel => document.querySelector(sel).getBoundingClientRect());
                          const btn = document.querySelector('#overlayList [data-del]');
                          const ref = document.querySelector('#sideToggle');
                          const ba = btn ? getComputedStyle(btn) : null;
                          const br = ref ? getComputedStyle(ref) : null;
                          return {
                            clear: nodes.every(r => !hit(r, stage) && !hit(r, tl)),
                            themed: !!(btn && btn.classList.contains('btn') && ba && br && ba.backgroundColor === br.backgroundColor && ba.color === br.color),
                          };
                        }""")
                        assert placed["clear"] and placed["themed"], (theme, tag, placed)
                        if tag != "1366768":
                            page.screenshot(path=str(SHOTS / f"video_{theme}_{tag}.png"))
                    bar = page.locator("#tlSplitBar").bounding_box()
                    before = page.evaluate("() => document.querySelector('#videoTl').getBoundingClientRect().height")
                    page.mouse.move(bar["x"] + 40, bar["y"] + 4)
                    page.mouse.down()
                    page.mouse.move(bar["x"] + 40, bar["y"] - 70, steps=6)
                    page.mouse.up()
                    page.wait_for_timeout(150)
                    after = page.evaluate("() => ({h: document.querySelector('#videoTl').getBoundingClientRect().height, saved: localStorage.getItem('lc-tl-frac')})")
                    assert after["h"] > before + 20, (theme, before, after)
                    assert after["saved"], (theme, after)
                    page.evaluate("() => localStorage.removeItem('lc-tl-frac')")
                    page.evaluate("() => document.documentElement.style.removeProperty('--tl-h')")
                    page.click("#sideToggle")
                    assert page.evaluate("() => document.body.classList.contains('side-shut') && localStorage.getItem('lc-side-shut') === '1'")
                    page.click("#sideToggle")
                    page.set_viewport_size({"width": 1440, "height": 1000})
        if leaks:
            print("OVERFLOW", json.dumps(leaks, indent=2))
            raise SystemExit("text overflow: " + json.dumps(leaks))
        if errors:
            print("PAGEERRORS", errors)
            raise SystemExit("page errors: " + " | ".join(errors[:6]))
        print("editor ui ok", "words", n, "scale", scale0, "->", scale1, "out", out0, "->", out1)
        browser.close()


if __name__ == "__main__":
    main()
