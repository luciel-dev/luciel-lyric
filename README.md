# Luciel Lyric: 15–30 s lyric video maker with auto-synced lyrics

You upload a song, pick a 15–30 s clip, and the app syncs the lyrics word by word (Whisper, with optional
Demucs vocal isolation). You can also paste the real lyrics and have them aligned to the audio. After
editing the words and timings you style them with an animation library (CapCut-style highlight boxes,
TikTok one-word captions, typewriter, bounce, wave, neon flicker and more), add keyframed zoom/pan and post
effects, and render an MP4 (or an overlay/alpha file). The live preview is drawn with the same maths as the render.

> `samples/` (test songs, sample renders, screenshot scripts) is development material and is not part of the
> distributable `LucielLyric.zip`; the zip ships `docs/` (demo song, sample MP4, screenshots) instead.

## Run

New users: see **INSTALL.md** (double-click `Install.*`, then `Start Luciel Lyric.*`).

```bash
./install.sh        # once: uv + private Python 3.12 + packages into runtime/, models into models/
./start.sh          # serves http://localhost:8000 and opens the browser (PORT=xxxx or --port to change)
NO_BROWSER=1 ./start.sh --host 0.0.0.0   # headless / LAN   (dev checkout: ./run.sh)
```

The installer (`scripts/setup.sh`, `scripts/setup.ps1` for Windows) downloads a pinned, SHA-256-checked
uv 0.13.3 into `runtime/`, has it fetch a managed CPython 3.12 (`UV_PYTHON_PREFERENCE=only-managed`, so the
user's own Python - any version - is ignored), keeps uv's Python and cache inside `runtime/`
(`UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR`), installs `scripts/requirements*.txt` into `runtime/venv`, fetches
models (`scripts/fetch_models.py`) and checks ffmpeg (`scripts/check_setup.py`).

Offline by design: the Whisper `base.en` model (`models/faster-whisper-base.en`) and the Demucs
`htdemucs` weights (`models/hf/hub/...`) ship with the full `LucielLyric.zip`, while the ~15 MB `LucielLyric-lite.zip` has setup download them once via `scripts/fetch_models.py` (pinned revisions, SHA-256 checked, resumable; `--check` to verify); `app/runtime.py` points `HF_HUB_CACHE`,
`HF_HOME` and `TORCH_HOME` at `models/` and sets `HF_HUB_OFFLINE=1`
(set `LUCIEL_ALLOW_DOWNLOADS=1` to allow other Whisper models to be downloaded).
The render fonts (Poppins 400/700/800, Bebas Neue, Pacifico; OFL) are in `static/fonts/render/` and are used
directly by both the browser preview (`@font-face`) and the renderer (FreeType via Pillow), so renders never
depend on installed system fonts.

ffmpeg: a system ffmpeg is used if it has x264, AAC, ProRes (`prores_ks`) and the `gblur`/`colorchannelmixer`/`amix`/`tile`
filters; otherwise the `static-ffmpeg` pip package's binaries (downloaded once by setup). Override with
`LUCIEL_FFMPEG=system|bundled|<folder>`. `GET /api/status` shows what's in use. (Env vars are `LUCIEL_*`; the old `LYRICCLIP_*` names still work.)
`python scripts/smoke_test.py` runs upload → sync (vocal isolation) → render (CapCut preset + punch zoom + 5 FX by
default; `--anim`, `--zoom`, `--fx`, `--preset` to change) → `/api/still` against a running server.

## Desktop app (Windows / macOS): no Python, double-click to run

Release builds are stand-alone: `LucielLyric-Setup.exe` (or the portable zip) on Windows 10/11 x64 and
`LucielLyric-mac-arm64.dmg` (Apple Silicon, macOS 14+). Python, all packages, ffmpeg, the Whisper `base.en` and
Demucs `htdemucs` models are inside, so the app works offline from the first launch.

* The app starts its local server on a free port (from 8000 up) and shows the UI in its own window, not
  in your browser. Windows uses a normal title bar (minimize, maximize, close) on WebView2; macOS uses
  the traffic-light buttons on WKWebView. The installer and the portable build include the WebView2
  bootstrapper and install that runtime if it is missing. If a native window still cannot be created,
  a dialog explains why and the app opens in the browser as a last resort (use **⏻ Quit** so the
  server actually stops). Closing the window stops the server and any encode or vocal-isolation process.
* Only one copy runs at a time. Starting it again brings the existing window forward.
* Your data (uploads, renders, custom fonts, presets, logs) is in `%APPDATA%\LucielLyric` on Windows,
  `~/Library/Application Support/LucielLyric` on macOS and `~/.local/share/LucielLyric` on Linux.
  **📂 Open renders folder** (next to Render) opens it.
* macOS: the app is ad-hoc signed but **not notarized**. The first time, right-click it and choose **Open**
  (macOS 15+: System Settings → Privacy & Security → **Open Anyway**). Windows SmartScreen may say
  "unknown publisher": **More info → Run anyway**.
* Intel Macs: an optional build without vocal isolation (no current PyTorch for Intel Macs) can be enabled
  in the workflow. Linux users can keep using `install.sh` / `start.sh`.
* Command line (all builds): `LucielLyric --server-only [--port N] [--data-dir DIR]`, `--browser`.

### Building the desktop apps

CI does it: `.github/workflows/build.yml` runs on pushes to `main`, pull requests, `v*` tags and manual
runs (**Run workflow** has options for the Intel-Mac and Linux builds). Per OS it:

1. installs `scripts/requirements*.txt` (CPU-only torch) and `packaging/requirements-desktop.txt`
   (PyInstaller 6.22.3, pywebview 6.2.1) into Python 3.12,
2. `scripts/fetch_models.py` fetches the models (pinned revisions, SHA-256 checked, cached between runs),
3. `packaging/fetch_ffmpeg.py` fetches a static ffmpeg/ffprobe 8.0 for the OS
   ([zackees/ffmpeg_bins](https://github.com/zackees/ffmpeg_bins), pinned commit and SHA-256, GPL build, see
   `ffmpeg/SOURCE.txt` in the app),
4. `packaging/make_icons.py` builds the icon (.ico/.icns/.png) from the mascot, and
   `packaging/make_version_info.py` the Windows version resource,
5. `pyinstaller packaging/luciel_lyric.spec` builds the onedir (`dist/LucielLyric/`, or `dist/Luciel Lyric.app` on macOS),
6. `packaging/ci_smoke.py` tests the frozen app headless: server-only mode, a temporary data folder and the
   internet blocked (dead proxy; a network namespace on Linux). It checks bundled ffmpeg and models, then runs upload → sync with Demucs
   → render → still → download, the single-instance guard, and a clean shutdown via `/api/shutdown`,
7. packages it: Inno Setup → `LucielLyric-Setup.exe` (per-user install, no admin) plus
   `LucielLyric-win-x64-portable.zip`; `packaging/macos/make_dmg.sh` → ad-hoc `codesign` plus a drag-to-Applications
   `.dmg` with a READ ME. The files are uploaded as artifacts, and on a `v*` tag they are attached to a draft release.

Local build (on the OS you are building for):

```bash
python -m venv .venv && . .venv/bin/activate          # Python 3.12
pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu   # skip on macOS
pip install -r scripts/requirements.txt -r scripts/requirements-vocals.txt -r packaging/requirements-desktop.txt
python scripts/fetch_models.py && python packaging/fetch_ffmpeg.py
python packaging/make_icons.py && python packaging/make_version_info.py
pyinstaller packaging/luciel_lyric.spec --noconfirm
python packaging/ci_smoke.py --exe dist/LucielLyric/LucielLyric       # .exe on Windows; on macOS the .app's Contents/MacOS/LucielLyric
```

`LUCIEL_NO_VOCALS=1` builds without torch/Demucs (much smaller; vocal isolation is turned off).
How the frozen app works:
* `desktop/luciel_desktop.py` is the entry point and `app/desktop.py` the launcher.
* `app/runtime.py` handles frozen paths, the user data folder and the bundled ffmpeg.
* Demucs runs as `LucielLyric --demucs …`, a second copy of the frozen exe, because a frozen app has no `python -m`.

Not in git: `models/*` (fetched), `data/`, `runtime/`, build outputs and `*.mp4`. The sample renders listed
under "Test / sample" are made locally with `scripts/smoke_test.py`.

## Android app

The Android build is a WebView shell around the same lyric engine (`static/engine`), with its own phone layout: grouped sections, a bottom dock for Track, Sync, Look, Timeline, and Render, and the same three themes (grey Frutiger Aero, muted Y2K, Winamp) plus the mascot. Desktop styling is separate.

On the phone, whisper.cpp transcribes the section you picked and the page aligns pasted lyrics the same way as the desktop aligner. Rendering is MediaCodec H.264 + AAC, including black and green backgrounds. Phone Max is 1080p30. Demucs vocal isolation is not in the APK: a phone build of htdemucs is hundreds of megabytes and too slow, so sync uses the full mix. The English `ggml-tiny.en` model (~75 MB) is downloaded on first Sync into app storage and is not inside the APK. After that download, picking a song, syncing, and rendering do not need a network.

`minSdk` is 26. The release APK contains `arm64-v8a` (phones) and `x86_64` (the CI emulator). CI signs with `LUCIEL_KEYSTORE_B64` when that secret is set, using `LUCIEL_KEY_ALIAS`, `LUCIEL_KEYSTORE_PASSWORD`, and `LUCIEL_KEY_PASSWORD`. The 1.3.0 key was created inside that CI job and never stored, so nothing can install over the 1.3.0 APK. Those secrets are not on the repo yet, so each job still mints a new key and a later APK will not replace the previous one until you uninstall.

## Using it

1. **Track**: drop an mp3/wav/m4a file. Click or drag on the waveform (or type a start time) to place the clip, and set its length with the slider (15–30 s, default 20 s). **Play clip** plays the selected range.
2. **Lyrics sync**: you can paste lyrics; the whole song is fine because only the part sung in the clip is kept. Pick a model (`base.en` by default). **Isolate vocals** (Demucs) is on by default when it's installed. It adds about 6 s for a 20 s clip and makes the timing much tighter.
3. **Edit & preview**: every word has editable text, start and end times (seconds from the clip start). You can split or merge lines, add or delete words, and shift everything by ±0.1 s. **Preview sync** plays the clip with a live karaoke preview. Words that were pasted but not heard in the audio get interpolated timings and an orange outline.
4. **Style, animate & render**: pick a **Look** (Neon Pop / Bold Poster / Dreamy Script: base colours, font, gradient), then use the four tabs. The canvas **stage** on the right shows the exact frame the renderer will produce; **▶ Preview** plays it with the song, and the scrubber (with keyframe diamonds) seeks.
   - **Text & animation**: animation library, font, full customisation, saved presets (below).
   - **Video · trim & zoom**: trim the background video and keyframe zoom/pan.
   - **Effects**: stackable post FX with intensity sliders.
   - **Background & export**: format (1080×1920, 1080×1080, 1920×1080), title, background mode, waveform visualizer.

## Text animation library

15 presets, each shown as a live animated thumbnail: **Karaoke fill**, **CapCut highlight box** (3-word chunks,
sung word in a rounded box), **TikTok one-word** (one big word at a time, pops on the beat), **Typewriter** (letters
type out as each word is sung, blinking cursor), **Bounce pop**, **Blur in**, **Wave**, **Neon flicker**, **Slide up**,
**Scale punch**, **Letter cascade** (letters drop and bounce in), **Soft fade**, **Glow highlight**, **Shake emphasis**,
**Spin in**.

Every parameter is editable:
- *Text & layout*: size, weight, UPPERCASE, letter spacing, line height, max width, vertical position, alignment, next-line preview + opacity.
- *Colours, outline, shadow & glow*: text, unsung opacity, active word, sung words, outline colour/width, shadow colour/opacity/blur/offset, glow colour/amount/opacity, highlight box colour/opacity/rounding/padding.
- *Animation timing & motion*: captions (whole line / chunks of N words / one word), enter effect (fade, pop, slide, blur, drop, type, scale, flicker, spin), animate by line/word/letter, start when the line appears or when each word is sung, duration, stagger, easing (10 curves incl. back, bounce, elastic), travel distance, active-word effect (fill wipe, colour, box, scale punch, glow, shake, wave) + strength, idle wave, exit effect (fade, slide, blur, pop, flicker) + duration, global speed and intensity, typing cursor.

**Presets**: *Save* stores look + style + animation + FX (+ zoom preset) under a name in `data/presets/`
(same name overwrites), *Load*/*🗑* manage them, *Export* downloads a `.json` file and *Import* loads one
(click Save to keep it). *Reset* drops your tweaks. API: `GET /api/presets`, `POST /api/presets {name, data}`,
`DELETE /api/presets/{id}`.

## Colour palettes & title styling

**Colour palette** (Text & animation tab): 12 curated palettes - Sunset, Vaporwave, Mono, Pastel, Ocean, Blood Moon,
Matcha, Gold & Black, Ice, Candy, Cyber Amber, Lime Punch. One click sets the text, active word, sung words, outline, glow,
shadow, highlight box, text-on-box and title colours together. Every colour stays individually editable below; your
edits sit on top of the palette, and the palette is kept when you switch animation presets ("Look colours" goes back to
the look's own colours).
- **✨ Auto from background** samples the background image, the current video frame or the gradient (64×64, hue
  histogram weighted by saturation, greys ignored). It builds a readable palette: light text tinted to the main hue, a vivid
  accent for the active word and box, a second hue for sung words and the title, and dark outline/shadow. Grey footage
  gets a mono palette.
- **★ Save colours** stores the current colours as a named custom palette in the browser (`localStorage["lc-palettes"]`).
  Exported preset JSON includes the palette (`data.palette`), and importing it re-adds the custom palette.

**Title text & colour**: title text + show toggle (mirrors the field in Background & export), colour, optional vertical
**gradient** (top → bottom colour), size (relative to the lyrics), position from the top, opacity, weight, UPPERCASE,
outline colour/width and shadow colour/opacity/blur. Title settings are independent of the look and animation preset:
switching those keeps them. Preview and render both draw the gradient the same way (baseline-relative stops), so they match.
Measured preview-vs-render difference for a gradient/outlined/shadowed title: mean 1.4/255 in the title band.

New style keys (accepted by `POST /api/render` and `/api/still` in `style`, validated server-side): `titleColor`,
`titleColor2`, `titleGrad`, `titleSize`, `titlePosY`, `titleAlpha`, `titleWeight`, `titleUpper`, `titleStroke`,
`titleStrokeColor`, `titleShadowAlpha`, `titleShadowColor`, `titleShadowBlur`, `boxText`. Palettes are in
`static/engine/presets.json` (`palettes`, `paletteKeys`). Screenshots: `docs/screenshots/palette_title_controls_cyberpunk.jpg`.

## Video editor: trim + keyframed zoom/pan

- **Trim** (video backgrounds): a thumbnail strip of the clip (12 frames, made at upload) with draggable in/out
  handles and numeric fields. The trimmed segment loops if it's shorter than the lyric clip; the mixed-in video
  audio is trimmed and looped with it (`atrim` + `aloop`).
- **Zoom & pan**: keyframes `{t, zoom, x, y, ease}`. Presets: *Slow push-in* (1→1.18, inOutSine), *Pull-out*
  (1.25→1, outCubic), *Punch zoom on lines* (1.12× kick at every line start, settles in 0.65 s), *Ken Burns pan*.
  Add a keyframe at the playhead, set its zoom and easing, then **drag on the preview** to move its focal point
  (double-click recentres; dragging where there is no keyframe adds one). Apply to the *background only* (default,
  lyrics stay put) or the *whole frame*.
- Smooth, jitter-free motion: zoom is interpolated in log space and every frame is resampled from the source with a
  floating-point crop box (`Image.resize(..., box=…)`, bicubic). There is no integer rounding of the crop, so slow
  zooms don't step. Measured on a tracked dot through a 4 s push-in + pan: monotonic motion, ≤0.12 px/frame,
  frame-to-frame acceleration ≤0.02 px. Background video is decoded at 1.25× when you zoom in so it stays sharp.

## Post effects

Stack any of these with an on/off toggle and an intensity slider (applied in this order): **Colour grade** (Warm, Cool,
Black & white, Faded film), **Light leaks** (three drifting procedural warm light blobs, screen blend), **Anamorphic
streak** (horizontal blue flare from the bright parts of the lyrics), **Vignette**, **VHS** (chroma shift,
horizontal softening, desaturation, scanlines, rolling tracking band, bottom-edge jitter), **Glitch** (RGB split,
scan-line band jitter, block displacement; *Bursts on line changes* or *Constant*), **Film grain**.

Overlay exports: effects that would break keying are disabled in the UI with a warning, and the server skips them
too (the render response lists them in `fx_skipped`):
- *Black (Screen/Add)*: only anamorphic streak, glitch and colour grade (except Faded film, which lifts black) are allowed.
- *Green screen* and *Transparent*: no post effects (they'd tint the key colour / need an opaque frame). Green screen also turns off glow and soft shadows.

## Preview = render

The renderer (`app/compose.py`) and the browser stage (`static/engine/stage.js`) run the same parametric engine:
- `static/engine/presets.json` is read by both (looks, 15 animation presets, defaults, FX list, zoom presets).
- `app/textanim.py` ⇄ `static/engine/textanim.js` turn time + lines into a resolution-independent draw list
  (all sizes are fractions of the frame); `app/raster.py` (Pillow/FreeType) ⇄ `drawItems` (canvas) draw it;
  `app/fx.py` (numpy) ⇄ `static/engine/fx.js` (ImageData) apply the effects. Randomness (flicker, shake,
  glitch, VHS) uses the same seeded mulberry32 generator in both languages, so it's bit-identical.
- The preview snaps to the 30 fps frame grid, so a paused preview shows exactly a frame the MP4 will contain.
- `POST /api/still` renders one frame with the real renderer (optionally at preview size) for checking.

Measured (`samples/ui_editor_check.py parity`): the draw lists of all 15 presets match to 1e-6 over 86 time
points each (155k values, `scripts/dev/parity_items.py`), and canvas vs server frames differ by a mean of
0.6–1.6 levels out of 255 across 28 preset/FX/zoom combinations (anti-aliasing and font hinting). Film grain is
random noise, so only its strength matches. Contact sheet: `docs/screenshots/preview_vs_render_parity.jpg` (left = browser, right = render).

## Backgrounds & overlay exports

| Mode | Output | Notes |
|---|---|---|
| Gradient (default) | MP4 (H.264/AAC) | slowly rotating linear gradient in the look's colours |
| Image | MP4 | uploaded jpg/png/webp, scaled and cropped to cover, darkened 35%; zoomable |
| **Video clip** | MP4 | mp4/mov/webm/m4v, **trim** in/out, **Darken** 0–90%, **Blur** 0–30 (gaussian sigma at output resolution), **Song audio only** (default) or **Mix in video audio** at 0–150%. Scaled and cropped to fill the format; the trimmed segment loops |
| **Black screen** | MP4 | pure #000 with lyrics only (visualizer and title off by default). Put it over footage with blend mode **Screen** or **Add / Linear Dodge** |
| **Green screen** | MP4 | pure #00FF00 for chroma keying; glow/soft shadow off, visualizer green clamped, post FX off |
| **Transparent** | **MOV ProRes 4444** (`yuva444p12le`, PCM audio) or **WebM VP9 alpha** (Opus) | lyrics only, real straight (un-premultiplied) alpha |

Frames are composed in RGBA by the app and piped to ffmpeg as raw video, so the alpha channel is exactly the
lyric layer's coverage (no premultiplied fringes). Checked on a WebM frame: about 97.6% of pixels have
alpha 0 and the lyric pixels reach 255.

The background-video upload is checked with ffprobe; it's rejected if there's no video stream. A muted 480p H.264
proxy is generated for the browser preview, so ProRes/HEVC sources also preview, plus the thumbnail strip for
trimming. Audio presence is detected, and the "mix" option is disabled when the clip has no audio.

### Render times (20 s clip, 8-core CPU, 6 worker threads)

| Job | Time | Size |
|---|---|---|
| 1080×1920, video bg (trim + punch/push-in zoom) + CapCut box + 6 FX (`docs/sample_showcase_anim_zoom_fx_1080x1920.mp4`) | ~24 s | 15.9 MB |
| 1080×1920 gradient, CapCut + punch zoom + 5 FX (smoke test) | ~16 s | 16 MB |
| 1920×1080 gradient, letter cascade, whole-frame pull-out, B&W + glitch | ~14 s | 13.9 MB |
| 1080×1080 image, Ken Burns, typewriter, VHS + faded | ~11 s | 6.1 MB |
| 1080×1920 black overlay (streak + glitch) | ~9 s | 1.0 MB |
| 1080×1920 green screen | ~4 s | 1.0 MB |
| 1080×1920 WebM VP9 alpha | ~19 s | 1.6 MB |
| 8 s ProRes 4444 alpha | ~6 s | 74 MB |

That's 25–145 rendered frames per second depending on effects. MP4s are x264 `veryfast` CRF 20 capped at 6 Mbit/s,
so a 30 s 1080×1920 clip stays around 24 MB even with grain. The browser preview runs at about 30 fps with six
effects on a video background in software-rendered headless Chrome (one frame ≈ 15 ms at 432×768).

## Custom fonts

In **Text & animation → Font**, click **Upload font** and pick a `.ttf`, `.otf`, `.woff` or `.woff2` file. The
font is added to the **Font** dropdown and selected; it replaces the look's font and keeps everything else.
The preview and the render both use the uploaded file itself (`FontFace` in the browser, FreeType on the server),
so there's no font substitution.

What the backend does (`app/fonts.py`): validates the extension and 20 MB limit and parses the file with
**fontTools** (rejects missing `name`/`cmap`/`head` tables or no Latin A/a/E/e glyphs), reads the family/style/
PostScript names, weight and italic flag, converts WOFF/WOFF2 to plain `.ttf`/`.otf`, and stores fonts in
`data/fonts/<id>.ttf|otf` with a `<id>.json` metadata file next to each. API: `GET /api/fonts`,
`POST /api/fonts` (multipart `file`), `GET /api/fonts/{id}/file`, `DELETE /api/fonts/{id}`; `POST /api/render`
accepts `"font_id"`.

## Themes & mascot

The header has a theme picker: **Aero** (glossy grey Frutiger Aero glass with bubbles and aqua accents), **Cyberpunk** (gritty industrial HUD: charcoal/gunmetal with dusty amber and muted teal accents, no glow; fine noise, faint scanlines, thin technical grid, chamfered panels with corner brackets, monospace section codes, segmented progress bar; internal id `y2k` kept so saved choices still work) and **Winamp** (2.x gunmetal bevels, striped title bars, green LCD with time/marquee, spectrum-style waveform, EQ sliders). The choice is stored in `localStorage["lc-theme"]` and applied before first paint. Themes affect the UI only, not rendered videos.

- Files: `static/index.html`, `static/style.css` (theme-agnostic base using CSS variables), `static/themes.css` (per-`[data-theme]` skins), `static/theme.js` (picker, stepper, LCD, WebAudio mini spectrum), `static/mascot.js`.
- Fonts are bundled locally (OFL, licences next to them) in `static/fonts/`: Istok Web (Frutiger-like), Rajdhani + Share Tech Mono (Cyberpunk), VT323, Silkscreen.
- `app.js` emits `lc:*` DOM events (audio, sync-start/done, render-start/done, error, play, stop, font, bgvideo) that the theme layer and mascot listen to.

### Mascot ("ANGEL.EXE")
Transparent assets live in `static/mascot/` (emote WebPs, `dance-{slow,mid,fast}.webm` VP9+alpha with animated-WebP fallback, `manifest.json`). Regenerate from the original pack with:

    .venv/bin/python scripts/mascot_cutout.py /tmp/mascotzip/mascot static/mascot

Shown small in the bottom-right corner, framed as a glass bubble (Aero), HUD ID card (Cyberpunk) or a mini Winamp window (Winamp). Reactions (priority-based, per manifest):
upload → surprised · sync start → music · sync done → mid dance then happy · render start → flying · render done → fast dance then love · error → crying (sync/render) or confused · preview playing → slow dance (loops while playing) · font upload → slow dance · background video → happy · theme switch → themed emote · click → greeting. After 90 s idle it shows sleepy, after 180 s cloud-sleep. Speech bubbles appear occasionally. Hide/show via the header button (`localStorage["lc-mascot-hidden"]`).

Deviations from manifest.json: the manifest says reactions are "never on a timer"; the inactivity sleepy swap and the looping dance during preview are deliberate exceptions.

Screenshots: `samples/output/themes/` (`theme_{aero,y2k,winamp}_{start,full,viewport,render_step}.png`, `mascot_sync_done_reaction.png`, `mascot_dancing_preview_{winamp,y2k}.png`, `mascot_render_done_y2k.png` (Y2K shots predate the Cyberpunk restyle; new ones in `samples/output/cyberpunk/`), `mascot_error_confused.png`), produced by `samples/ui_screenshot_themes.py`.
## How it works

| Stage | Implementation |
|---|---|
| Upload | ffmpeg converts the file to 44.1 kHz WAV; numpy computes 1200 waveform peaks for the canvas |
| Vocal isolation (optional) | `demucs --two-stems=vocals -n htdemucs` (CPU), run as a **subprocess** |
| ASR + word timestamps | `faster-whisper` (CTranslate2, int8 on CPU), `word_timestamps=True`, beam 5 |
| Onset refinement | When the vocal stem is available, word boundaries next to pauses are snapped to the vocal RMS envelope (Whisper word starts tend to be about 0.2–0.4 s early) |
| Pasted-lyrics alignment | Semi-global Needleman–Wunsch between the pasted words and the Whisper words, scored with RapidFuzz similarity. Free leading/trailing skips mean pasting the whole song still works. Matched words take Whisper's times; unmatched words are interpolated between anchors, weighted by length. Line breaks follow the pasted text |
| Line grouping (no pasted lyrics) | Breaks on pauses > 0.5 s, sentence punctuation, or a commas after 4+ words; at most 8 words or 38 characters per line |
| Render | `app/compose.py`: for every frame (thread pool, in order) background (gradient / image / decoded video) → float-box zoom/pan → waveform from the audio samples → lyric layer (`textanim` draw list rasterised by `raster.py`) → post FX (`fx.py`) → raw RGB(A) piped to ffmpeg, which adds the song (fades, optional video-audio mix) and encodes H.264/AAC, ProRes 4444 or VP9 alpha |

Code: `app/main.py` (API), `app/align.py` (alignment + refinement), `app/compose.py`, `app/textanim.py`,
`app/raster.py`, `app/fx.py` (renderer), `static/engine/` (preview engine + `presets.json`), `static/editor.js`
(step-4 panels), `static/app.js` (flow), plain HTML/CSS/JS.

API: `GET /api/config` (includes the engine presets), `POST /api/upload`, `GET /api/audio/{id}`, `POST /api/background`,
`POST /api/bgvideo` (→ `{bg_video_id, duration, has_audio, width, height, preview_url, thumbs_url}`),
`POST /api/sync`, `POST /api/render`, `POST /api/still`, `GET|POST /api/presets`, `DELETE /api/presets/{id}`,
`GET /api/download/{file}`.

`POST /api/render` body: `audio_id, start, length, lines, aspect, preset` (look) plus, all optional,
`anim_preset` (default `karaoke`), `style` / `anim` (partial overrides; keys as in `presets.json`),
`fx` (`[{"id": "glitch", "amount": 0-100, "option": "bursts"}]`), `zoom` (`{"preset": "pushin"}` or
`{"keys": [{"t", "z", "x", "y", "ease"}], "target": "bg"|"all"}`), `title`, `visualizer`, `font_id`,
`bg_mode`, `bg_id`, `bg_video_id`, `video_in`, `video_out` (`video_offset` still works as the in point),
`video_darken`, `video_blur`, `video_audio`, `video_volume`, `transparent_format`. Requests from the previous
version (no animation/FX fields) still render. The response includes `render_s`, `fps`, `size_mb`, `fx_skipped`.

## Test / sample

`samples/testsong/make_song.py` builds a royalty-free test song: original lyrics sung (well, spoken in rhythm)
by Piper TTS over a synthesized chord/bass/drum backing track. Ground-truth line onsets are measured from the
vocal stem. `samples/testsong/eval.py` runs `/api/sync` (clip 3–23 s, base.en) in four modes and scores them:

| Mode | Word accuracy | Line-onset MAE | Line-end MAE |
|---|---|---|---|
| transcribe only | 0.97 | 0.29 s (early bias) | 0.17 s |
| transcribe + Demucs | 0.94–1.00 | 0.11 s | 0.03 s |
| pasted lyrics | 1.00 | 0.30 s | 0.17 s |
| pasted lyrics + Demucs (best) | 1.00 | 0.10 s | 0.03 s |

Outputs are in `samples/output/`: sample MP4s for each preset and aspect ratio, plus one with an image
background, extracted frames (`frame_*.png`) and UI screenshots (`ui_screenshot*.png`, produced by
`samples/ui_screenshot.py` driving headless Chrome through the full flow).
Palette/title check: `samples/ui_palette_title_check.py [y2k|aero|winamp]`; Cyberpunk theme check: `samples/ui_cyberpunk_check.py`.
Editor checks: `samples/ui_editor_check.py [quick|parity|full]` (headless Chrome: panels in all three themes,
trim drag, keyframe drag, FX warnings, preset save/export/import/delete, preview FPS, preview-vs-render parity)
and `samples/testsong/e2e_editor.py` (API renders in every background mode, writes `samples/output/e2e/`).

## Known limitations

- The test vocals are TTS speech over a beat. Real sung vocals with melisma, harmonies, ad-libs or heavy
  effects will transcribe worse. Pasting the lyrics plus Demucs is the recommended path for real songs.
- Whisper can hallucinate or skip words in instrumental sections or when the vocals are buried in the mix. Use
  the editor to fix those, and check the preview before rendering.
- Line timing comes from word timings: whole lines that Whisper missed and you pasted get interpolated (orange
  outline) and may need manual adjustment.
- Sync and render requests are synchronous with no job queue: a single user at a time, and the UI waits on
  each request (a render takes roughly as long as the clip).
- Non-English: pick the multilingual `base`/`small` models. Scripts the chosen font lacks (CJK, emoji) render as
  missing glyphs; upload a font that covers them. Right-to-left text isn't laid out specially.
- No auth or cleanup: uploads, background videos (plus their preview proxies), presets and renders accumulate in `data/`.
- Preview vs render: the preview is drawn at 432×768 (or 768×432 / 576×576), so fine details (grain size,
  1-px scan lines, glitch row offsets) are coarser than in the 1080p render, and film grain uses different
  random noise. Text shaping can differ by a fraction of a pixel (browser vs FreeType/raqm kerning).
  The background video in the preview is the 480p proxy.
- Video backgrounds: no crossfade at the trim loop point (a visible cut if the clip doesn't loop seamlessly);
  variable-frame-rate phone clips are resampled to 30 fps; big 4K sources decode slower.
- "Whole frame" zoom also crops the lyrics; keep lines short or use "background only".
- Overlay exports: on the black screen a black outline/shadow is invisible (expected for Screen/Add); the
  green screen's semi-transparent "next line" and fades key as semi-transparent; ProRes is large and won't play
  in a browser; WebM alpha works in Chrome, Firefox, Premiere (plugin) and CapCut desktop, not Safari/QuickTime.
- Custom fonts: one font per video (lyrics, next line and title). No `.ttc` collections; variable fonts render
  at their default instance.
- macOS: the pinned PyAV wheel (used by faster-whisper) needs macOS 14 or newer.
- Important: don't `import torch`/`demucs` inside the server process. Loading torch's OpenMP runtime next to
  CTranslate2's silently corrupted faster-whisper output during development, which is why Demucs runs as a
  subprocess.
- UI themes: Safari gets the animated-WebP mascot fallback (no WebM alpha). `backdrop-filter` glass effects may
  be slow on weak GPUs. Full-page screenshots show fixed decorations (bubbles/grid) only near the top.
