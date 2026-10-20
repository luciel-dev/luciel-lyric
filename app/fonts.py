"""Custom font storage: validate with fontTools, extract family name, persist in data/fonts."""
import json, re, shutil, subprocess, uuid
from pathlib import Path

from fontTools.ttLib import TTFont, TTLibError

ALLOWED = {".ttf", ".otf", ".woff", ".woff2"}
MAX_BYTES = 20 * 1024 * 1024
SAMPLE = "etaoinshrdlucmfwypvbgkETAOINSHRDLU"


class FontError(ValueError):
    pass


def _name(tt, *ids):
    names = tt["name"]
    for i in ids:
        # prefer Windows/Unicode English records, fall back to anything
        rec = names.getName(i, 3, 1, 0x409) or names.getName(i, 1, 0, 0)
        if rec is None:
            for r in names.names:
                if r.nameID == i:
                    rec = r; break
        if rec is not None:
            try:
                s = rec.toUnicode().strip()
            except Exception:
                continue
            if s:
                return s
    return None


def _system_families():
    try:
        out = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10).stdout
    except Exception:
        return set()
    fams = set()
    for line in out.splitlines():
        for f in line.split(","):
            fams.add(f.strip().lower())
    return fams


def _metrics(tt):
    """Layout metrics used by the renderer.
    libass sizes a font so that (usWinAscent + usWinDescent) == ASS Fontsize, so a font with tall
    vertical metrics renders with a much smaller em. We return:
      char_w     - average advance of common letters per 1 unit of ASS Fontsize (for line wrapping)
      size_scale - factor to bring the font's visual em in line with typical fonts (~1.2 em line)"""
    upm = tt["head"].unitsPerEm or 1000
    os2 = tt["OS/2"] if "OS/2" in tt else None
    if os2 is not None and (os2.usWinAscent + os2.usWinDescent) > 0:
        total = (os2.usWinAscent + os2.usWinDescent) / upm
    elif "hhea" in tt:
        total = (tt["hhea"].ascent - tt["hhea"].descent) / upm
    else:
        total = 1.2
    total = total if total > 0.3 else 1.2
    cmap = tt.getBestCmap() or {}
    hmtx = tt["hmtx"] if "hmtx" in tt else None
    widths = [hmtx.metrics[cmap[ord(c)]][0] / upm for c in SAMPLE
              if hmtx is not None and ord(c) in cmap and cmap[ord(c)] in hmtx.metrics]
    adv = sum(widths) / len(widths) if widths else 0.55
    size_scale = max(0.85, min(1.4, total / 1.2))  # capped: libass line height grows with it too
    return round(adv / total, 3), round(size_scale, 3)


class FontStore:
    def __init__(self, root: Path):
        self.root = Path(root); self.root.mkdir(parents=True, exist_ok=True)

    def _meta_path(self, fid):
        if not re.fullmatch(r"[a-f0-9]{12}", fid or ""):
            raise FontError("bad font id")
        return self.root / f"{fid}.json"

    def list(self):
        out = []
        for p in sorted(self.root.glob("*.json")):
            try:
                m = self.get(p.stem)
                if (self.root / m["file"]).exists():
                    out.append(m)
            except Exception:
                continue
        return sorted(out, key=lambda m: m.get("uploaded", 0))

    def get(self, fid):
        p = self._meta_path(fid)
        if not p.exists():
            raise FontError("font not found")
        m = json.loads(p.read_text())
        if "size_scale" not in m:  # migrate metadata written by older versions
            tt = TTFont(str(self.root / m["file"]))
            m["char_w"], m["size_scale"] = _metrics(tt)
            tt.close(); p.write_text(json.dumps(m, indent=1))
        return m

    def file(self, fid):
        return self.root / self.get(fid)["file"]

    def delete(self, fid):
        m = self.get(fid)
        (self.root / m["file"]).unlink(missing_ok=True)
        self._meta_path(fid).unlink(missing_ok=True)
        return m

    def add(self, src: Path, orig_name: str):
        import time
        ext = Path(orig_name).suffix.lower()
        if ext not in ALLOWED:
            raise FontError(f"unsupported font type '{ext}' (use .ttf, .otf, .woff, .woff2)")
        if src.stat().st_size > MAX_BYTES:
            raise FontError("font file too large (max 20 MB)")
        try:
            tt = TTFont(str(src), lazy=False)
        except TTLibError as e:
            raise FontError(f"not a valid font: {e}")
        except Exception as e:
            raise FontError(f"could not parse font: {e}")
        for tbl in ("name", "cmap", "head"):
            if tbl not in tt:
                raise FontError(f"font is missing required '{tbl}' table")
        family = _name(tt, 1, 16)            # legacy family = what libass/fontconfig match on
        typo_family = _name(tt, 16, 1)
        style = _name(tt, 2) or "Regular"
        full = _name(tt, 4) or family
        ps = _name(tt, 6)
        if not family:
            raise FontError("font has no family name in its name table")
        cmap = tt.getBestCmap() or {}
        if not any(ord(c) in cmap for c in "AaEe"):
            raise FontError("font has no Latin letters (A/a/E/e missing from cmap)")
        char_w, size_scale = _metrics(tt)
        os2 = tt["OS/2"] if "OS/2" in tt else None
        weight = int(os2.usWeightClass) if os2 is not None else 400
        italic = bool(os2.fsSelection & 1) if os2 is not None else False
        is_cff = "CFF " in tt or "CFF2" in tt
        fid = uuid.uuid4().hex[:12]
        out_name = f"{fid}{'.otf' if is_cff else '.ttf'}"
        out = self.root / out_name
        if tt.flavor in ("woff", "woff2"):
            tt.flavor = None          # decompress WOFF/WOFF2 -> plain sfnt for libass
            tt.save(str(out))
            converted = True
        else:
            shutil.copyfile(src, out)
            converted = False
        tt.close()
        meta = {"id": fid, "family": family, "typo_family": typo_family, "style": style, "full_name": full,
                "postscript_name": ps, "weight": weight, "italic": italic, "char_w": char_w, "size_scale": size_scale,
                "file": out_name, "original_filename": Path(orig_name).name, "converted_from": ext if converted else None,
                "shadows_system_font": family.lower() in _system_families(), "uploaded": time.time()}
        self._meta_path(fid).write_text(json.dumps(meta, indent=1))
        return meta
