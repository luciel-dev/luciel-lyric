"""Lyric Video Maker - FastAPI backend."""
import json, os, re, shutil, subprocess, sys, threading, time, uuid
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .align import align_lyrics, group_into_lines, refine_with_energy
from .fonts import FontError, FontStore
from .render import ENGINE, PRESETS, SIZES, render as render_frames
from .compose import still as render_still
from .runtime import FFMPEG, FFPROBE, available_whisper_models, whisper_model_path
from . import runtime

ROOT = runtime.ROOT
DATA = runtime.DATA_DIR
UP, REN, WORK = DATA / "uploads", DATA / "renders", DATA / "work"
FONTS_DIR = DATA / "fonts"
PRESET_DIR = DATA / "presets"
for d in (UP, REN, WORK, FONTS_DIR, PRESET_DIR):
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Lyric Video Maker")
fonts = FontStore(FONTS_DIR)
_models, _model_lock = {}, threading.Lock()
MODELS = ["tiny.en", "base.en", "small.en", "base", "small"]


def get_model(name: str):
    from faster_whisper import WhisperModel
    with _model_lock:
        if name not in _models:
            local = whisper_model_path(name)
            _models[name] = WhisperModel(str(local) if local else name, device="cpu", compute_type="int8")
        return _models[name]


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)
    if r.returncode != 0:
        raise HTTPException(500, f"{cmd[0]} failed: {r.stderr[-1500:]}")
    return r


def audio_path(aid: str) -> Path:
    p = UP / aid / "audio.wav"
    if not p.exists():
        raise HTTPException(404, "audio not found")
    return p


def demucs_available() -> bool:
    # NOTE: don't import demucs/torch in this process - loading torch's OpenMP runtime next to
    # CTranslate2's corrupts faster-whisper results. Demucs runs in a subprocess instead.
    import importlib.util
    return importlib.util.find_spec("demucs") is not None


@app.get("/api/status")
def status():
    return dict(runtime.status(), demucs=demucs_available())


def _is_local(request: Request) -> bool:
    return bool(request.client) and request.client.host in ("127.0.0.1", "::1", "localhost")


@app.get("/api/config")
def config(request: Request):
    return {"presets": PRESETS, "engine": ENGINE,
            "sizes": list(SIZES.keys()), "demucs": demucs_available(),
            "models": available_whisper_models(MODELS),
            # desktop helpers: folders can only be opened for a browser on this computer
            "can_open_folders": _is_local(request), "desktop_mode": runtime.DESKTOP_MODE or None,
            "can_quit": _is_local(request) and runtime.SHUTDOWN_HOOK is not None}


class FolderReq(BaseModel):
    which: str = "renders"   # renders | data | fonts


@app.post("/api/open-folder")
def open_folder(req: FolderReq, request: Request):
    """Open the renders (or data) folder in Explorer / Finder / the file manager. Local requests only."""
    if not _is_local(request):
        raise HTTPException(403, "only available on this computer")
    path = {"renders": REN, "data": DATA, "fonts": FONTS_DIR}.get(req.which)
    if path is None:
        raise HTTPException(400, "unknown folder")
    path.mkdir(parents=True, exist_ok=True)
    try:
        if sys.platform == "win32":
            os.startfile(str(path))  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"could not open the folder: {e}")
    return {"opened": str(path)}


@app.post("/api/shutdown")
def shutdown(request: Request):
    """Quit the desktop app (used by the Quit button in browser-fallback mode and by the CI smoke test)."""
    if not _is_local(request) or runtime.SHUTDOWN_HOOK is None:
        raise HTTPException(403, "not available")
    threading.Timer(0.3, runtime.SHUTDOWN_HOOK).start()
    return {"stopping": True}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    aid = uuid.uuid4().hex[:12]
    d = UP / aid; d.mkdir(parents=True)
    raw = d / ("orig" + (Path(file.filename or "x.mp3").suffix or ".mp3"))
    with raw.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    wav = d / "audio.wav"
    conv = subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw), "-vn", "-ac", "2",
                           "-ar", "44100", str(wav)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if conv.returncode != 0 or not wav.exists():
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(400, "could not decode that file as audio (try mp3, wav or m4a)")
    pcm = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", str(wav), "-ac", "1", "-ar", "2000", "-f", "s16le", "-"],
        capture_output=True).stdout
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    dur = len(x) / 2000.0
    bins = 1200
    if len(x) < bins:
        x = np.pad(x, (0, bins - len(x)))
    chunks = np.array_split(np.abs(x), bins)
    peaks = np.array([c.max() if len(c) else 0 for c in chunks])
    peaks = (peaks / (peaks.max() or 1)).round(3).tolist()
    meta = {"id": aid, "name": file.filename, "duration": round(dur, 3), "peaks": peaks}
    (d / "meta.json").write_text(json.dumps(meta))
    return meta


@app.get("/api/audio/{aid}")
def get_audio(aid: str):
    return FileResponse(audio_path(aid), media_type="audio/wav")


@app.post("/api/background")
async def upload_bg(file: UploadFile = File(...)):
    bid = uuid.uuid4().hex[:12]
    ext = (Path(file.filename or "x.jpg").suffix or ".jpg").lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp"):
        raise HTTPException(400, "background must be jpg/png/webp")
    p = UP / f"bg_{bid}{ext}"
    with p.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"bg_id": p.name}


VIDEO_EXT = (".mp4", ".mov", ".webm", ".m4v", ".mkv")


@app.post("/api/bgvideo")
async def upload_bg_video(file: UploadFile = File(...)):
    ext = (Path(file.filename or "x.mp4").suffix or ".mp4").lower()
    if ext not in VIDEO_EXT:
        raise HTTPException(400, "background video must be mp4/mov/webm")
    vid = uuid.uuid4().hex[:12]
    d = UP / f"bgv_{vid}"; d.mkdir()
    src = d / f"source{ext}"
    with src.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    pr = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
                         "-of", "json", str(src)], capture_output=True, text=True, encoding="utf-8", errors="replace")
    try:
        info = json.loads(pr.stdout)
        vstreams = [s for s in info.get("streams", []) if s.get("codec_type") == "video"]
        dur = float(info.get("format", {}).get("duration") or 0)
    except Exception:
        vstreams, dur = [], 0
    if not vstreams or dur <= 0:
        shutil.rmtree(d, ignore_errors=True)
        raise HTTPException(400, "could not read a video stream from that file")
    has_audio = any(s.get("codec_type") == "audio" for s in info["streams"])
    # small, browser-safe H.264 proxy for the UI preview (any input codec, e.g. ProRes .mov)
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-an", "-vf",
         "scale=-2:'min(480,ih)',fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
         "-movflags", "+faststart", str(d / "preview.mp4")])
    # thumbnail strip for the trim editor: 12 frames spread over the clip, 96 px high, one image
    n = 12
    subprocess.run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(d / "preview.mp4"), "-vf",
                    f"fps={n / max(0.5, dur):.5f},scale=-2:96,tile={n}x1", "-frames:v", "1", "-q:v", "5",
                    str(d / "thumbs.jpg")], capture_output=True)
    meta = {"bg_video_id": vid, "name": file.filename, "duration": round(dur, 3), "has_audio": has_audio,
            "width": vstreams[0].get("width"), "height": vstreams[0].get("height"),
            "preview_url": f"/api/bgvideo/{vid}/preview", "thumbs": n,
            "thumbs_url": f"/api/bgvideo/{vid}/thumbs" if (d / "thumbs.jpg").exists() else None}
    (d / "meta.json").write_text(json.dumps(meta))
    return meta


def bg_video_meta(vid: str):
    if not vid or not vid.isalnum():
        raise HTTPException(400, "bad video id")
    d = UP / f"bgv_{vid}"
    if not (d / "meta.json").exists():
        raise HTTPException(404, "background video not found")
    m = json.loads((d / "meta.json").read_text())
    m["path"] = str(next(d.glob("source.*")))
    return m


@app.get("/api/bgvideo/{vid}/preview")
def bg_video_preview(vid: str):
    bg_video_meta(vid)
    return FileResponse(UP / f"bgv_{vid}" / "preview.mp4", media_type="video/mp4")


@app.get("/api/bgvideo/{vid}/thumbs")
def bg_video_thumbs(vid: str):
    bg_video_meta(vid)
    p = UP / f"bgv_{vid}" / "thumbs.jpg"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/jpeg")


# ---------- saved style/animation/FX presets ----------
class PresetReq(BaseModel):
    name: str
    data: dict


def _preset_path(pid: str) -> Path:
    if not pid.isalnum() or len(pid) > 32:
        raise HTTPException(400, "bad preset id")
    return PRESET_DIR / f"{pid}.json"


@app.get("/api/presets")
def list_presets():
    out = []
    for p in sorted(PRESET_DIR.glob("*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    return {"presets": sorted(out, key=lambda m: m.get("saved", 0))}


@app.post("/api/presets")
def save_preset(req: PresetReq):
    name = req.name.strip()[:60] or "My preset"
    # same name -> overwrite
    pid = next((m["id"] for m in list_presets()["presets"] if m.get("name") == name), uuid.uuid4().hex[:12])
    meta = {"id": pid, "name": name, "saved": time.time(), "data": req.data}
    if len(json.dumps(meta)) > 200_000:
        raise HTTPException(400, "preset too large")
    _preset_path(pid).write_text(json.dumps(meta, indent=1), encoding="utf-8")
    return meta


@app.delete("/api/presets/{pid}")
def delete_preset(pid: str):
    p = _preset_path(pid)
    if not p.exists():
        raise HTTPException(404, "preset not found")
    p.unlink()
    return {"deleted": pid}


@app.get("/api/background/{name}")
def get_bg(name: str):
    p = UP / Path(name).name
    if not (p.name.startswith("bg_") and p.is_file()):
        raise HTTPException(404)
    return FileResponse(p)


class SyncReq(BaseModel):
    audio_id: str
    start: float = 0.0
    length: float = 20.0
    lyrics: str = ""
    separate_vocals: bool = False
    model: str = "base.en"
    language: str | None = None


@app.post("/api/sync")
def sync(req: SyncReq):
    src = audio_path(req.audio_id)
    length = min(30.0, max(15.0, req.length))
    job = WORK / f"sync_{uuid.uuid4().hex[:8]}"; job.mkdir()
    clip = job / "clip.wav"
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{req.start:.3f}", "-t", f"{length:.3f}",
         "-i", str(src), "-ac", "2", "-ar", "44100", str(clip)])
    t0 = time.time()
    asr_in, sep_used, sep_err = clip, False, None
    if req.separate_vocals:
        if not demucs_available():
            sep_err = "demucs not installed"
        else:
            r = subprocess.run(runtime.demucs_command(["--two-stems=vocals", "-n", "htdemucs", "-d", "cpu",
                                                       "-o", str(job / "sep"), str(clip)]),
                               capture_output=True, text=True, encoding="utf-8", errors="replace",
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            v = job / "sep" / "htdemucs" / "clip" / "vocals.wav"
            if r.returncode == 0 and v.exists():
                asr_in, sep_used = v, True
            else:
                sep_err = (r.stderr or "demucs failed")[-500:]
    t_sep = time.time() - t0
    model = get_model(req.model if req.model in available_whisper_models(MODELS) else "base.en")
    lang = req.language or (None if not req.model.endswith(".en") else "en")
    pcm16 = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-i", str(asr_in), "-ac", "1",
                            "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
    audio16 = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32) / 32768.0
    segs, info = model.transcribe(audio16, word_timestamps=True, beam_size=5, vad_filter=False,
                                  condition_on_previous_text=False, language=lang,
                                  )
    words = []
    for s in segs:
        for w in (s.words or []):
            t = w.word.strip()
            if t and w.start < length:
                words.append({"text": t, "start": round(max(0, w.start), 3),
                              "end": round(min(length, w.end), 3), "prob": round(w.probability, 3)})
    t_asr = time.time() - t0 - t_sep
    if sep_used:  # precise onsets from the isolated vocal stem
        words = refine_with_energy(words, audio16)
    if req.lyrics.strip():
        lines, stats = align_lyrics(req.lyrics, words, length)
        mode = "aligned_to_pasted_lyrics"
    else:
        lines, stats = group_into_lines(words), {"hyp_words": len(words)}
        mode = "transcribed"
    return {"lines": lines, "raw_words": words, "mode": mode, "stats": stats, "length": length,
            "vocal_separation": sep_used, "separation_error": sep_err,
            "timing": {"separation_s": round(t_sep, 1), "asr_s": round(t_asr, 1)},
            "language": getattr(info, "language", None)}


class RenderReq(BaseModel):
    audio_id: str
    start: float = 0.0
    length: float = 20.0
    lines: list
    aspect: str = "9:16"
    preset: str = "neon"          # look: neon | bold | dreamy (base colours, font, gradient)
    anim_preset: str = "karaoke"  # text animation preset id (see static/engine/presets.json)
    style: dict | None = None     # full or partial style overrides (customisation panel)
    anim: dict | None = None      # full or partial animation overrides
    fx: list | None = None        # [{"id": "glitch", "amount": 0-100, "option": "bursts", "on": true}, ...]
    zoom: dict | None = None      # {"preset": "pushin"} or {"keys": [{t,z,x,y,ease}], "target": "bg"|"all"}
    bg_id: str | None = None
    title: str = ""
    visualizer: bool = True
    font_id: str | None = None   # uploaded font overriding the look's font
    bg_mode: str | None = None   # gradient | image | video | black | green | transparent
    transparent_format: str = "mov"   # mov (ProRes 4444) | webm (VP9 alpha)
    bg_video_id: str | None = None
    video_offset: float = 0.0    # legacy name for video_in
    video_in: float | None = None
    video_out: float | None = None
    video_darken: float = 0.35
    video_blur: float = 0.0
    video_audio: bool = False    # mix the background video's own audio under the song
    video_volume: float = 0.5


@app.get("/api/fonts")
def list_fonts():
    return {"fonts": [dict(f, url=f"/api/fonts/{f['id']}/file") for f in fonts.list()]}


@app.post("/api/fonts")
async def upload_font(file: UploadFile = File(...)):
    tmp = WORK / f"fontup_{uuid.uuid4().hex[:8]}{Path(file.filename or 'x').suffix.lower()}"
    try:
        with tmp.open("wb") as f:
            shutil.copyfileobj(file.file, f)
        meta = fonts.add(tmp, file.filename or tmp.name)
    except FontError as e:
        raise HTTPException(400, str(e))
    finally:
        tmp.unlink(missing_ok=True)
    return dict(meta, url=f"/api/fonts/{meta['id']}/file")


@app.get("/api/fonts/{fid}/file")
def font_file(fid: str):
    try:
        p = fonts.file(fid)
    except FontError as e:
        raise HTTPException(404, str(e))
    return FileResponse(p, media_type="font/otf" if p.suffix == ".otf" else "font/ttf")


@app.delete("/api/fonts/{fid}")
def delete_font(fid: str):
    try:
        m = fonts.delete(fid)
    except FontError as e:
        raise HTTPException(404, str(e))
    return {"deleted": fid, "family": m["family"]}


_COLOR_KEYS = ("color", "active", "sung", "strokeColor", "shadowColor", "glowColor", "boxColor", "boxText",
               "titleColor", "titleColor2", "titleStrokeColor", "titleShadowColor")
_RANGES = {"titleSize": (0.05, 2.0), "titlePosY": (0.0, 0.95), "titleAlpha": (0.0, 1.0), "titleStroke": (0.0, 0.3),
           "titleShadowAlpha": (0.0, 1.0), "titleShadowBlur": (0.0, 0.5)}


def _clean_style(d):
    d = dict(d or {})
    d.pop("fontId", None)   # set from font_id below
    for k in _COLOR_KEYS:   # palette / title colours: #rgb or #rrggbb only (boxText may be "" = use active colour)
        if k in d:
            v = d[k]
            if k == "boxText" and v in ("", None):
                d[k] = ""
            elif not (isinstance(v, str) and re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", v)):
                d.pop(k)
    for k, (lo, hi) in _RANGES.items():
        if k in d:
            try:
                d[k] = min(hi, max(lo, float(d[k])))
            except (TypeError, ValueError):
                d.pop(k)
    if "titleWeight" in d and d["titleWeight"] not in (400, 700, 800):
        d.pop("titleWeight")
    return d


def _scene(req: RenderReq):
    """RenderReq -> (audio path, keyword args for compose.build/render, uploaded font meta)."""
    src = audio_path(req.audio_id)
    bg = None
    if req.bg_id:
        bg = UP / Path(req.bg_id).name
        if not bg.exists():
            raise HTTPException(404, "background not found")
    font_meta = font_path = None
    if req.font_id:
        try:
            font_meta, font_path = fonts.get(req.font_id), fonts.file(req.font_id)
        except FontError as e:
            raise HTTPException(404, str(e))
    mode = req.bg_mode or ("image" if bg else "gradient")
    bgv = None
    if mode == "video":
        vm = bg_video_meta(req.bg_video_id or "")
        vin = req.video_in if req.video_in is not None else req.video_offset
        vin = min(max(0.0, vin), max(0.0, vm["duration"] - 0.1))
        vout = req.video_out
        if vout is not None:
            vout = min(vm["duration"], vout)
            if vout <= vin + 0.1:
                vout = None
        bgv = {"path": vm["path"], "in": vin, "out": vout, "darken": req.video_darken, "blur": req.video_blur,
               "mix_audio": req.video_audio, "video_volume": req.video_volume, "has_audio": vm["has_audio"],
               "duration": vm["duration"]}
    if mode == "image" and not bg:
        raise HTTPException(400, "image mode needs an uploaded background image")
    style = _clean_style(req.style)
    if font_meta:
        style["fontId"] = req.font_id
    kw = dict(aspect=req.aspect, look=req.preset, anim_id=req.anim_preset, style=style, anim=req.anim,
              lines=req.lines, title=req.title, visualizer=req.visualizer, bg_mode=mode, bg_image=bg,
              bg_video=bgv, zoom=req.zoom, fx_list=req.fx or [],
              font_files={req.font_id: font_path} if font_path else None)
    return src, kw, font_meta


@app.post("/api/render")
def render(req: RenderReq):
    src, kw, font_meta = _scene(req)
    rid = uuid.uuid4().hex[:10]
    out = REN / f"lyric_video_{rid}.mp4"
    t0 = time.time()
    try:
        res = render_frames(src, req.start, min(30.0, max(1.0, req.length)), out, WORK / f"render_{rid}",
                            transparent_format=req.transparent_format, **kw)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    out = Path(res["out"])
    return {"url": f"/api/download/{out.name}", "file": out.name, "render_s": round(time.time() - t0, 1),
            "bg_mode": kw["bg_mode"], "container": out.suffix.lstrip("."), "fx_skipped": res["fx_skipped"],
            "frames": res["frames"], "fps": res["fps"], "size_mb": round(out.stat().st_size / 1e6, 2),
            "fonts_used": [res["font_file"]], "custom_font": font_meta and font_meta["family"],
            "custom_font_resolved": True if font_meta else None}


class StillReq(RenderReq):
    t: float = 0.0
    width: int | None = None    # e.g. the preview canvas size, for side-by-side comparison
    height: int | None = None


@app.post("/api/still")
def still(req: StillReq):
    """One frame rendered by the real renderer, as PNG (preview/render parity checks)."""
    import io
    from fastapi.responses import Response
    src, kw, _ = _scene(req)
    full = SIZES.get(req.aspect, SIZES["9:16"])
    size = (req.width, req.height) if req.width and req.height else None
    try:
        im = render_still(max(0.0, req.t), src, req.start, min(30.0, max(1.0, req.length)), size=size, full_width=full[0], **kw)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    buf = io.BytesIO(); im.save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png")


@app.get("/api/download/{name}")
def download(name: str, inline: int = 0):
    p = REN / Path(name).name
    if not p.exists():
        raise HTTPException(404)
    mt = {".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"}.get(p.suffix, "application/octet-stream")
    return FileResponse(p, media_type=mt, filename=None if inline else p.name)


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")
