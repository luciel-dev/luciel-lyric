"""Build the app icons from the mascot's idle image: packaging/build/icon.{ico,icns,png}.

    python packaging/make_icons.py
The mascot (transparent WebP) is placed on a soft rounded-square tile so it reads on light and dark
docks/taskbars. .ico: 16-256 px; .icns: 16-1024 px (Pillow writes both on every OS)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "static" / "mascot" / "idle.webp"
OUT = ROOT / "packaging" / "build"


def tile(size=1024):
    S = size * 4                                   # supersample for smooth edges
    bg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    grad = Image.new("RGBA", (1, S))
    top, bot = (255, 214, 236), (176, 146, 255)    # soft pink -> lavender
    for y in range(S):
        f = y / (S - 1)
        grad.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * f) for i in range(3)) + (255,))
    grad = grad.resize((S, S))
    m = int(S * 0.06)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((m, m, S - m, S - m), radius=int(S * 0.2), fill=255)
    bg.paste(grad, (0, 0), mask)
    # mascot: trim transparent border, fit into ~80% of the tile, soft drop shadow
    mz = Image.open(SRC).convert("RGBA")
    mz = mz.crop(mz.getchannel("A").getbbox())
    box = int(S * 0.78)
    sc = min(box / mz.width, box / mz.height)
    mz = mz.resize((int(mz.width * sc), int(mz.height * sc)), Image.Resampling.LANCZOS)
    x, y = (S - mz.width) // 2, (S - mz.height) // 2 + int(S * 0.02)
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    a = Image.new("L", (S, S), 0); a.paste(mz.getchannel("A"), (x, y + int(S * 0.015)))
    sh.putalpha(a.point(lambda v: v * 0.35).filter(ImageFilter.GaussianBlur(S * 0.012)))
    bg = Image.alpha_composite(bg, sh)
    bg.alpha_composite(mz, (x, y))
    return bg.resize((size, size), Image.Resampling.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    im = tile(1024)
    im.save(OUT / "icon.png")
    im.save(OUT / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    im.save(OUT / "icon.icns")
    for p in ("icon.png", "icon.ico", "icon.icns"):
        print(f"wrote {OUT / p} ({(OUT / p).stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
