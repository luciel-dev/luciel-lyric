"""Remove the white background from the mascot art (stills + dance loops).

Approach: the art has dark line-art around the character, so we flood-fill "near white" from the image
border (connected-component labelling) - white hair/robe inside the outline is never reached. Then:
  * small enclosed white pockets that are clearly background (big gaps between wings/arms) are kept as-is
    (safer than eating the white robe);
  * edge pixels get soft alpha by "un-mixing" them from white (alpha = darkness, color = unpremultiplied),
    which removes the white halo/fringe from anti-aliased outlines.
Usage: python scripts/mascot_cutout.py <src_mascot_dir> <dst_dir>
"""
import json, shutil, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage

def cutout(rgb: np.ndarray, white_thr=232, band=2, seal=3):
    rgb = rgb.astype(np.float32)
    mn = rgb.min(axis=2)
    near_white = mn >= white_thr
    # Thicken the line-art by `seal` px before flood filling so small gaps in the outline (where the
    # white hair touches the white background) can't leak; afterwards grow the region back.
    lines = ndimage.binary_dilation(~near_white, iterations=seal)
    lab, n = ndimage.label(near_white & ~lines)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, border[border > 0])
    bg = ndimage.binary_dilation(bg, iterations=seal + 1) & near_white
    # close tiny speckles inside the bg (video noise) and do not let bg eat thin lines
    bg = ndimage.binary_opening(bg, iterations=1) | (bg & ndimage.binary_erosion(bg, iterations=1))
    alpha = np.where(bg, 0.0, 1.0)
    # soft edge: pixels within `band` px of the background get alpha from their darkness
    edge = ndimage.binary_dilation(bg, iterations=band) & ~bg
    a_edge = np.clip((255.0 - mn) / (255.0 - 150.0), 0, 1)
    alpha[edge] = np.maximum(a_edge[edge], 0.0)
    a = alpha[..., None]
    # un-premultiply from white: c = a*fg + (1-a)*255  ->  fg = (c - (1-a)*255)/a
    fg = np.where(a > 0.01, (rgb - (1 - a) * 255.0) / np.maximum(a, 0.01), rgb)
    out = np.dstack([np.clip(fg, 0, 255), alpha * 255]).astype(np.uint8)
    return out

def still(src: Path, dst: Path, size=None):
    im = Image.open(src).convert("RGB")
    out = Image.fromarray(cutout(np.asarray(im)), "RGBA")
    if size:
        out = out.resize((size, size), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.suffix == ".webp":
        out.save(dst, "WEBP", quality=90, method=6)
    else:
        out.save(dst, optimize=True)

def dance(src_mp4: Path, dst_stem: Path, size=320, fps=24):
    tmp = dst_stem.parent / f"_frames_{dst_stem.name}"
    shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir(parents=True)
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(src_mp4), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    W = H = 480
    frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    for i, f in enumerate(frames):
        im = Image.fromarray(cutout(f, white_thr=225), "RGBA").resize((size, size), Image.LANCZOS)
        im.save(tmp / f"f{i:04d}.png")
    # VP9 WebM with alpha (Chrome/Firefox/Edge) ...
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "f%04d.png"),
                    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34", "-row-mt", "1",
                    "-deadline", "good", "-cpu-used", "4", "-auto-alt-ref", "0", str(dst_stem.with_suffix(".webm"))], check=True)
    # ... and an animated WebP (works everywhere incl. Safari) at 12 fps
    frames_png = sorted(tmp.glob("f*.png"))[::2]
    ims = [Image.open(p) for p in frames_png]
    ims[0].save(dst_stem.with_suffix(".webp"), save_all=True, append_images=ims[1:], duration=int(1000 / (fps / 2)),
                loop=0, quality=70, method=4, lossless=False)
    shutil.rmtree(tmp)
    return len(frames)

if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    man = json.loads((src / "manifest.json").read_text())
    still(src / "idle/mascot-idle-512.png", dst / "idle.webp", 320)
    still(src / "idle/mascot-idle-512.png", dst / "idle.png", 320)
    for name in man["emotes"]:
        still(src / f"emotes/mascot-emote-{name}-512.png", dst / f"emote-{name}.webp", 320)
    if "--no-video" not in sys.argv:
        for tempo, r in man["reactions"].items():
            n = dance(src / f"{r['file']}.mp4", dst / f"dance-{tempo}")
            print("dance", tempo, n, "frames")
    shutil.copy(src / "manifest.json", dst / "manifest.json")
    shutil.copy(src / "README.txt", dst / "README-original.txt")
    print("done")
