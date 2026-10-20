"""End-to-end API check: upload -> sync (optionally with vocal isolation) -> render -> download.

  python scripts/smoke_test.py [--url http://localhost:8000] [--audio docs/demo/song.mp3]
                             [--lyrics docs/demo/lyrics.txt] [--no-vocals] [--start 6] [--length 20]
Uses only the Python standard library.
"""
import argparse
import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def call(url, data=None, headers=None, method=None, timeout=900):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return r.status, r.headers.get("content-type", ""), body


def post_json(url, obj):
    s, _, b = call(url, json.dumps(obj).encode(), {"Content-Type": "application/json"})
    return json.loads(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--audio", default=str(ROOT / "docs" / "demo" / "song.mp3"))
    ap.add_argument("--lyrics", default=str(ROOT / "docs" / "demo" / "lyrics.txt"))
    ap.add_argument("--no-vocals", action="store_true")
    ap.add_argument("--start", type=float, default=6.0)
    ap.add_argument("--length", type=float, default=20.0)
    ap.add_argument("--preset", default="neon", help="look: neon | bold | dreamy")
    ap.add_argument("--anim", default="capcut", help="text animation preset id (static/engine/presets.json)")
    ap.add_argument("--zoom", default="punch", help="zoom preset: none | pushin | pullout | punch | kenburns")
    ap.add_argument("--fx", default="leaks:40,streak:50,vignette:50,glitch:50,grain:25",
                    help="comma list of fx_id:amount ('' = none)")
    a = ap.parse_args()
    base = a.url.rstrip("/")

    st = json.loads(call(base + "/api/status")[2])
    print("status:", json.dumps(st))

    audio = Path(a.audio)
    bnd = uuid.uuid4().hex
    body = (f"--{bnd}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{audio.name}\"\r\n"
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + audio.read_bytes() + f"\r\n--{bnd}--\r\n".encode()
    t = time.time()
    up = json.loads(call(base + "/api/upload", body, {"Content-Type": f"multipart/form-data; boundary={bnd}"})[2])
    print(f"upload: id={up['id']} duration={up['duration']}s ({time.time() - t:.1f}s)")

    lyrics = Path(a.lyrics).read_text(encoding="utf-8") if a.lyrics and Path(a.lyrics).exists() else ""
    t = time.time()
    sy = post_json(base + "/api/sync", {"audio_id": up["id"], "start": a.start, "length": a.length,
                                       "lyrics": lyrics, "separate_vocals": not a.no_vocals, "model": "base.en"})
    nwords = sum(len(l["words"]) for l in sy["lines"])
    print(f"sync: mode={sy['mode']} vocal_separation={sy['vocal_separation']} err={sy['separation_error']} "
          f"lines={len(sy['lines'])} words={nwords} stats={sy.get('stats')} timing={sy['timing']} ({time.time() - t:.1f}s)")
    for l in sy["lines"][:4]:
        print("   ", round(l["words"][0]["start"], 2), " ".join(w["text"] for w in l["words"]))

    t = time.time()
    rr = post_json(base + "/api/render", {"audio_id": up["id"], "start": a.start, "length": a.length,
                                         "lines": sy["lines"], "aspect": "9:16", "preset": a.preset,
                                         "anim_preset": a.anim, "zoom": {"preset": a.zoom},
                                         "fx": [{"id": f.split(":")[0], "amount": float(f.split(":")[1]) if ":" in f else 50}
                                                for f in a.fx.split(",") if f.strip()],
                                         "title": "Luciel Lyric smoke test"})
    print(f"render: {rr['file']} in {rr['render_s']}s ({rr.get('fps')} fps, anim={a.anim}, zoom={a.zoom}, fx={a.fx or 'none'}) "
          f"fonts_used={rr['fonts_used']} ({time.time() - t:.1f}s)")
    # a single server-rendered frame (same renderer) must come back as PNG
    s2, ct2, png = call(base + "/api/still", json.dumps({"audio_id": up["id"], "start": a.start, "length": a.length,
                        "lines": sy["lines"], "preset": a.preset, "anim_preset": a.anim, "t": 3.0, "width": 270, "height": 480}).encode(),
                        {"Content-Type": "application/json"})
    print(f"still: HTTP {s2} {ct2} {len(png)} bytes")
    s, ct, b = call(base + rr["url"])
    print(f"download: HTTP {s} {ct} {len(b) / 1e6:.2f} MB")
    ok = (s == 200 and len(b) > 100_000 and nwords > 0 and (a.no_vocals or sy["vocal_separation"])
          and s2 == 200 and png[:8] == b"\x89PNG\r\n\x1a\n")
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
