"""Compare JS vs Python text item lists: python scripts/dev/parity_items.py lines.json"""
import json, subprocess, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from app.textanim import PRESETS, prepare, build_items

lines = json.load(open(sys.argv[1]))
js = json.loads(subprocess.run(["node", str(pathlib.Path(__file__).with_name("parity_items.js")), sys.argv[1]],
                               capture_output=True, text=True, check=True).stdout)
def measure(s, f):
    return sum(0.28 if c == " " else 0.4 + (ord(c) % 7) * 0.05 for c in s) * f["px"] * (1.05 if f["weight"] >= 700 else 1)
bad = 0; n = 0
def cmp(a, b, path):
    global bad, n
    if isinstance(a, dict):
        for k in set(a) | set(b or {}):
            if k == "font": continue
            cmp(a.get(k), (b or {}).get(k), path + "." + k)
    elif isinstance(a, (int, float)) and not isinstance(a, bool) and isinstance(b, (int, float)):
        n += 1
        if abs(a - b) > 1e-6 * max(1, abs(a)):
            bad += 1; print("DIFF", path, a, b) if bad < 20 else None
    else:
        n += 1
        if a != b and not (a in (None, 0) and b in (None, 0)):
            bad += 1; print("DIFF", path, a, b) if bad < 20 else None
EX = json.loads('''{"titleGrad": true, "titleColor": "#ff85c0", "titleColor2": "#ffd23f", "titleSize": 0.7, "titlePosY": 0.12, "titleAlpha": 0.95, "titleWeight": 800, "titleUpper": true, "titleStroke": 0.06, "titleStrokeColor": "#4b1035", "titleShadowAlpha": 0.6, "titleShadowBlur": 0.1}''')
CANDY = next(p for p in PRESETS["palettes"] if p["id"] == "candy")["colors"]
for ap, sfx, extra in [(a, s, e) for a in PRESETS["anims"] for s, e in (("", {}), ("+pal", {**CANDY, **EX}))]:
    style = {**PRESETS["styleDefaults"], **PRESETS["looks"]["neon"]["style"], **ap.get("style", {}), **extra}
    anim = {**PRESETS["animDefaults"], **ap.get("anim", {})}
    groups = prepare(lines, style, anim, 20)
    sc = {"W": 1080, "H": 1920, "style": style, "anim": anim, "measure": measure, "groups": groups, "title": "Hello", "clipLen": 20, "layKey": "a"}
    for i, f in enumerate(range(0, 600, 7)):
        py = build_items(f / 30, sc); j = js[ap["id"] + sfx][i]
        if len(py) != len(j):
            bad += 1; print("COUNT", ap["id"] + sfx, f, len(py), len(j)); continue
        for a, b in zip(py, j):
            cmp(a, b, f"{ap['id']}{sfx}@{f}")
print(f"compared {n} values, {bad} diffs")
sys.exit(1 if bad else 0)
