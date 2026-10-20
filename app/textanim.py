"""Text-animation engine (server side). MIRROR of static/engine/textanim.js - keep in sync:
same functions, same maths, same order of random draws, so the browser preview matches the render."""
import json
import math
from pathlib import Path

from .runtime import ROOT
PRESETS = json.loads((ROOT / "static" / "engine" / "presets.json").read_text(encoding="utf-8"))
M32 = 0xFFFFFFFF


def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, x):
    return a + (b - a) * x


def _out_bounce(x):
    n1, d1 = 7.5625, 2.75
    if x < 1 / d1:
        return n1 * x * x
    if x < 2 / d1:
        x -= 1.5 / d1; return n1 * x * x + 0.75
    if x < 2.5 / d1:
        x -= 2.25 / d1; return n1 * x * x + 0.9375
    x -= 2.625 / d1; return n1 * x * x + 0.984375


EASE = {
    "linear": lambda x: x,
    "inSine": lambda x: 1 - math.cos(x * math.pi / 2),
    "outSine": lambda x: math.sin(x * math.pi / 2),
    "inOutSine": lambda x: -(math.cos(math.pi * x) - 1) / 2,
    "inCubic": lambda x: x ** 3,
    "outCubic": lambda x: 1 - (1 - x) ** 3,
    "inOutCubic": lambda x: 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2,
    "outBack": lambda x: 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
    "outBounce": _out_bounce,
    "outElastic": lambda x: 0 if x == 0 else 1 if x == 1 else 2 ** (-10 * x) * math.sin((x * 10 - 0.75) * (2 * math.pi) / 3) + 1,
}


def ease(name, x):
    return EASE.get(name, EASE["outCubic"])(clamp(x))


# ---- deterministic PRNG identical to the JS one (mulberry32 + integer hash) ----
def mulberry32(a):
    st = [a & M32]

    def nxt():
        a = st[0] = (st[0] + 0x6D2B79F5) & M32
        t = ((a ^ (a >> 15)) * (1 | a)) & M32
        t = (((t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32) ^ t) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296
    return nxt


def hash2(a, b):
    return (((a & M32) * 0x9E3779B1) & M32) ^ ((((b + 0x7F4A7C15) & M32) * 0x85EBCA77) & M32)


def rand1(a, b):
    return mulberry32(hash2(a, b))()


# ---- presets ----
def resolve(look="neon", anim_id=None, style=None, anim=None):
    """Merge: styleDefaults < look style < animation preset style < explicit overrides (same in editor.js)."""
    lk = PRESETS["looks"].get(look) or PRESETS["looks"]["neon"]
    st = dict(PRESETS["styleDefaults"]); st.update(lk["style"])
    an = dict(PRESETS["animDefaults"])
    ap = next((a for a in PRESETS["anims"] if a["id"] == anim_id), None)
    if ap:
        an.update(ap.get("anim", {})); st.update(ap.get("style", {}))
    if style:
        st.update({k: v for k, v in style.items() if v is not None})
    if anim:
        an.update({k: v for k, v in anim.items() if v is not None})
    return st, an, lk


def prepare(lines, style, anim, clip_len):
    clean = []
    for ln in lines or []:
        ws = []
        for w in ln.get("words", []) or []:
            tx = str(w.get("text", "") if w.get("text") is not None else "").strip()
            if not tx:
                continue
            s = float(w["start"]); e = max(float(w["end"]), s + 0.05)
            ws.append({"text": tx.upper() if style.get("upper") else tx, "s": s, "e": e})
        if ws:
            clean.append(ws)
    clean.sort(key=lambda ws: ws[0]["s"])
    groups = []
    for li, ws in enumerate(clean):
        if anim["layout"] == "line":
            groups.append({"words": ws, "line": li}); continue
        n = 1 if anim["layout"] == "word" else max(1, int(round(anim.get("chunk") or 3)))
        for i in range(0, len(ws), n):
            groups.append({"words": ws[i:i + n], "line": li})
    lead, hold = (0.25, 0.8) if anim["layout"] == "line" else (0.12, 0.35)
    for gi, g in enumerate(groups):
        st = g["words"][0]["s"] - lead
        if gi > 0:
            st = max(st, min(groups[gi - 1]["words"][-1]["e"], g["words"][0]["s"]))
        g["gs"] = max(0.0, st)
    for gi, g in enumerate(groups):
        en = g["words"][-1]["e"] + hold
        if gi + 1 < len(groups):
            en = min(en, groups[gi + 1]["gs"])
        g["ge"] = min(max(en, g["gs"] + 0.2), clip_len)
    cid = 0
    for gi, g in enumerate(groups):
        for wi, w in enumerate(g["words"]):
            w["id"] = gi * 1000 + wi; w["cid0"] = cid; cid += len(w["text"])
    return groups


def js_round(x):
    return math.floor(x + 0.5)


def base_size(style, W, H):
    return js_round(style["size"] * min(W, H))


def layout_group(g, style, W, H, measure):
    fs = base_size(style, W, H)
    maxW = style["maxWidth"] * W

    def do(fs):
        font = {"family": style["font"], "weight": style["weight"], "px": fs, "fontId": style.get("fontId") or ""}
        sp = measure(" ", font); tr = (style.get("tracking") or 0) * fs
        widths = [measure(w["text"], font) + tr * max(0, len(w["text"]) - 1) for w in g["words"]]
        rows, cur, cw = [], [], 0.0
        for i, w in enumerate(widths):
            if cur and cw + sp + w > maxW:
                rows.append({"idx": cur, "w": cw}); cur, cw = [], 0.0
            cw += (sp if cur else 0) + w; cur.append(i)
        if cur:
            rows.append({"idx": cur, "w": cw})
        return font, sp, tr, widths, rows

    font, sp, tr, widths, rows = do(fs)
    widest = max(r["w"] for r in rows)
    if widest > maxW:
        fs = max(6, js_round(fs * maxW / widest)); font, sp, tr, widths, rows = do(fs)
    lh = fs * style["lineHeight"]; blockH = len(rows) * lh; top = style["posY"] * H - blockH / 2
    pos = [None] * len(widths)
    for ri, r in enumerate(rows):
        by = top + ri * lh + lh * 0.5 + fs * 0.35
        a = style.get("align", "center")
        x = (W - maxW) / 2 if a == "left" else (W + maxW) / 2 - r["w"] if a == "right" else (W - r["w"]) / 2
        for i in r["idx"]:
            pos[i] = {"x": x, "y": by, "w": widths[i]}; x += widths[i] + sp
    return {"fs": fs, "font": font, "tr": tr, "pos": pos, "top": top, "bottom": top + blockH}


def _txt(**kw):
    d = {"k": "text", "stroke": 0, "strokeColor": "#000000", "scale": 1, "rot": 0, "dx": 0, "dy": 0, "blur": 0,
         "glow": None, "shadow": None, "wipe": None}
    d.update(kw); return d


def build_items(t, sc):
    W, H, style, anim, measure = sc["W"], sc["H"], sc["style"], sc["anim"], sc["measure"]
    items = []
    amp = anim.get("intensity", 1); spd = max(0.05, anim.get("speed", 1))
    frame_no = math.floor(t * 30)
    fs_base = base_size(style, W, H)
    if sc.get("title"):
        g_ = style.get
        tsize = g_("titleSize"); tsize = 0.45 if tsize is None else tsize
        tpx = max(6, js_round(fs_base * tsize))
        tw_ = g_("titleWeight"); tw_ = 400 if tw_ is None else tw_
        font = {"family": style["font"], "weight": tw_, "px": tpx, "fontId": style.get("fontId") or ""}
        ttext = sc["title"].upper() if g_("titleUpper") else sc["title"]
        tw = measure(ttext, font)
        fa = min(clamp(t / 0.4), clamp((sc["clipLen"] - t) / 0.4))
        tpos = g_("titlePosY"); tpos = 0.06 if tpos is None else tpos
        ty = H * tpos
        talpha = g_("titleAlpha"); talpha = 0.81 if talpha is None else talpha
        tsh = ({"color": g_("titleShadowColor") or "#000000", "alpha": g_("titleShadowAlpha"),
                "sigma": (g_("titleShadowBlur") or 0) * tpx, "dy": 0.05 * tpx} if (g_("titleShadowAlpha") or 0) > 0 else None)
        tcol = g_("titleColor") or "#ffffff"
        items.append(_txt(text=ttext, font=font, x=(W - tw) / 2, y=ty + tpx * 0.8, w=tw, fill=tcol,
                          fill2=(g_("titleColor2") or tcol) if g_("titleGrad") else None, alpha=talpha * fa,
                          stroke=(g_("titleStroke") or 0) * tpx, strokeColor=g_("titleStrokeColor") or "#000000",
                          shadow=tsh, cx=W / 2, cy=ty))
    if sc.get("artist"):
        g_ = style.get
        asize = g_("artistSize"); asize = 0.32 if asize is None else asize
        apx = max(6, js_round(fs_base * asize))
        awt = g_("artistWeight"); awt = 400 if awt is None else awt
        font = {"family": style["font"], "weight": awt, "px": apx, "fontId": style.get("fontId") or ""}
        atext = sc["artist"].upper() if g_("artistUpper") else sc["artist"]
        aw = measure(atext, font)
        fa = min(clamp(t / 0.4), clamp((sc["clipLen"] - t) / 0.4))
        apos = g_("artistPosY"); apos = 0.13 if apos is None else apos
        ay = H * apos
        aalpha = g_("artistAlpha"); aalpha = 0.9 if aalpha is None else aalpha
        acol = g_("artistColor") or "#ffffff"
        items.append(_txt(text=atext, font=font, x=(W - aw) / 2, y=ay + apx * 0.8, w=aw, fill=acol,
                          fill2=None, alpha=aalpha * fa, stroke=0, strokeColor="#000000", cx=W / 2, cy=ay))
    groups = sc["groups"]
    gi = next((i for i, g in enumerate(groups) if g["gs"] <= t < g["ge"]), -1)
    if gi < 0:
        return items
    g = groups[gi]
    if g.get("_layKey") != sc.get("layKey") or "_lay" not in g:
        g["_lay"] = layout_group(g, style, W, H, measure); g["_layKey"] = sc.get("layKey")
    lay = g["_lay"]; fs = lay["fs"]
    enterD = anim.get("dur", 0.22) / spd; exitD = anim.get("exitDur", 0.18) / spd
    exitX = clamp((t - (g["ge"] - exitD)) / exitD) if anim["exit"] != "none" and exitD > 0 else 0
    unit = "char" if anim["enter"] == "type" else anim["unit"]
    need_chars = unit == "char" or anim.get("idle") == "wave" or anim["active"] == "wave" or abs(style.get("tracking") or 0) > 1e-6
    glow_base = {"color": style["glowColor"], "sigma": style["glow"] * fs, "alpha": style["glowAlpha"]} if style["glow"] > 0 else None
    shadow = ({"color": style["shadowColor"], "alpha": style["shadowAlpha"], "sigma": style["shadowBlur"] * fs,
               "dy": style["shadowY"] * fs} if style["shadowAlpha"] > 0 else None)
    stroke = style["strokeWidth"] * fs
    boxes, texts = [], []
    cursor = None
    A = anim["active"]; amt = anim.get("activeAmt", 1) * amp
    stagger = anim.get("stagger", 0.04)
    for wi, w in enumerate(g["words"]):
        p = lay["pos"][wi]
        before, active, after = t < w["s"], w["s"] <= t < w["e"], t >= w["e"]
        act = (t - w["s"]) / (w["e"] - w["s"]) if active else 1 if after else 0
        fill, alpha_mul, wipe, glow, wsc, wdx, wdy, wrot = style["color"], 1.0, None, glow_base, 1.0, 0.0, 0.0, 0.0
        if before:
            alpha_mul = style["unsungAlpha"]
        if A == "none":
            pass
        elif A == "fill":
            if active:
                alpha_mul = style["unsungAlpha"]; wipe = {"frac": act, "color": style["active"]}
            elif after:
                fill = style["sung"]
        else:
            if active:
                fill = style["boxText"] if A == "box" and style.get("boxText") else style["active"]
            elif after:
                fill = style["sung"]
        if A == "box" and active:
            bp = clamp((t - w["s"]) / 0.08); pad = style["boxPad"] * fs
            boxes.append({"k": "box", "x": p["x"] - pad, "y": p["y"] - fs * 0.86 - pad * 0.35, "w": p["w"] + pad * 2,
                          "h": fs * 1.12 + pad * 0.7, "r": style["boxRadius"] * fs, "color": style["boxColor"],
                          "alpha": style["boxAlpha"] * min(1, bp * 2), "scale": lerp(0.6, 1, ease("outBack", bp)),
                          "cx": p["x"] + p["w"] / 2, "cy": p["y"] - fs * 0.3})
        if A == "scale":
            if active:
                x = t - w["s"]; pk = x / 0.07 if x < 0.07 else max(0.45, 1 - (x - 0.07) / 0.3); wsc *= 1 + 0.22 * amt * pk
            elif after:
                x2 = t - w["e"]
                if x2 < 0.12:
                    wsc *= 1 + 0.22 * amt * 0.45 * (1 - x2 / 0.12)
        if A == "glow" and active:
            r = clamp((t - w["s"]) / 0.06)
            glow = {"color": style["active"], "sigma": max(style["glow"], 0.09) * fs * max(0.2, amt), "alpha": 0.95 * r}
        if A == "shake" and active:
            R = mulberry32(hash2(w["id"] + 17, frame_no))
            wdx += (R() - 0.5) * 0.06 * fs * amt; wdy += (R() - 0.5) * 0.06 * fs * amt; wrot += (R() - 0.5) * 6 * amt
        chars = list(w["text"]) if need_chars else [w["text"]]
        for ci, ch in enumerate(chars):
            cx0 = p["x"] + measure(w["text"][:ci], lay["font"]) + lay["tr"] * ci if need_chars else p["x"]
            cw = measure(ch, lay["font"]) if need_chars else p["w"]
            k = 0 if unit == "line" else wi if unit == "word" else (w["cid0"] - g["words"][0]["cid0"]) + ci
            if anim["trigger"] == "word":
                if unit == "line":
                    u0 = g["gs"]
                elif unit == "word":
                    u0 = w["s"] - 0.03
                else:
                    u0 = (w["s"] + (w["e"] - w["s"]) * ci / len(chars) if anim["enter"] == "type"
                          else w["s"] - 0.03 + stagger * ci / spd)
            else:
                u0 = g["gs"] + stagger * k / spd
            if anim["enter"] != "none" and t < u0:
                continue
            e = clamp((t - u0) / enterD) if enterD > 0 else 1; E = ease(anim.get("ease"), e)
            a, sc_, dx, dy, rot, bl = alpha_mul, wsc, wdx, wdy, wrot, 0.0
            uid = w["id"] * 64 + ci if need_chars else w["id"]
            en = anim["enter"]; dist = anim.get("dist", 0.6)
            if en == "fade":
                a *= E
            elif en == "pop":
                sc_ *= lerp(0.4, 1, E); a *= min(1, e * 3)
            elif en == "slide":
                dy += (1 - E) * dist * fs * amp; a *= e
            elif en == "blur":
                bl += (1 - E) * 0.22 * fs * amp; a *= e; sc_ *= 1 + 0.12 * (1 - E) * amp
            elif en == "drop":
                dy -= (1 - E) * dist * fs * amp; rot += (1 - E) * -14 * amp; a *= min(1, e * 2.5)
            elif en == "scale":
                sc_ *= lerp(0.15, 1, E); a *= min(1, e * 2)
            elif en == "flicker":
                if e < 1:
                    a *= 1 if rand1(uid + 101, frame_no) < 0.25 + 0.75 * e else 0.12
            elif en == "spin":
                rot += (1 - E) * -120 * amp; sc_ *= lerp(0.3, 1, E); a *= e
            if exitX > 0:
                X = ease("inCubic", exitX); ex = anim["exit"]
                if ex == "fade":
                    a *= 1 - exitX
                elif ex == "slide":
                    dy -= X * dist * 0.6 * fs; a *= 1 - exitX
                elif ex == "blur":
                    bl += X * 0.2 * fs; a *= 1 - exitX
                elif ex == "pop":
                    sc_ *= 1 - 0.5 * X; a *= 1 - exitX
                elif ex == "flicker":
                    a *= 1 if rand1(uid + 303, frame_no) < 1 - exitX else 0.1
            if anim.get("idle") == "wave":
                dy += math.sin(2 * math.pi * (t * 1.1) - k * 0.55) * 0.07 * fs * anim.get("idleAmt", 1) * amp
            if A == "wave" and active:
                dy += math.sin(2 * math.pi * (t * 2.2) - ci * 0.8) * 0.1 * fs * amt
            if a <= 0.003:
                continue
            wp = None
            if wipe:
                wx = p["x"] + wipe["frac"] * p["w"]
                f = clamp((wx - cx0) / max(1, cw)) if need_chars else wipe["frac"]
                wp = {"frac": f, "color": wipe["color"], "a": clamp(a / max(0.01, alpha_mul))}
            texts.append(_txt(text=ch, font=lay["font"], x=cx0, y=p["y"], w=cw, fill=fill, alpha=clamp(a), stroke=stroke,
                              strokeColor=style["strokeColor"], scale=sc_, rot=rot, cx=cx0 + cw / 2 + dx,
                              cy=p["y"] - fs * 0.35 + dy, dx=dx, dy=dy, blur=bl, glow=glow, shadow=shadow, wipe=wp))
            if anim.get("cursor"):
                cursor = (cx0 + cw + dx, p["y"])
    items += boxes + texts
    if anim.get("cursor") and cursor is not None and math.floor(t * 3) % 2 == 0 and exitX == 0:
        cw = measure("|", lay["font"])
        items.append(_txt(text="|", font=lay["font"], x=cursor[0] + fs * 0.04, y=cursor[1], w=cw, fill=style["active"], alpha=1,
                          stroke=stroke, strokeColor=style["strokeColor"], cx=cursor[0], cy=cursor[1], glow=glow_base, shadow=shadow))
    if style.get("showNext") and anim["layout"] == "line" and gi + 1 < len(groups):
        nx = groups[gi + 1]; npx = max(6, js_round(fs * 0.62))
        font = {"family": style["font"], "weight": style["weight"], "px": npx, "fontId": style.get("fontId") or ""}
        text = " ".join(w["text"] for w in nx["words"])
        tw = measure(text, font); maxW = style["maxWidth"] * W
        if tw > maxW:
            font = dict(font, px=max(6, js_round(npx * maxW / tw))); tw = measure(text, font)
        y = min(lay["bottom"] + fs * 0.6 + font["px"] * 0.8, H * 0.8)
        fa = min(clamp((t - g["gs"]) / 0.15), 1 - exitX)
        if fa > 0:
            items.append(_txt(text=text, font=font, x=(W - tw) / 2, y=y, w=tw, fill=style["color"],
                              alpha=style["nextAlpha"] * fa, cx=W / 2, cy=y))
    return items


def zoom_at(t, keys):
    if not keys:
        return 1.0, 0.5, 0.5
    ks = sorted(keys, key=lambda k: k["t"])
    if t <= ks[0]["t"]:
        z, x, y = ks[0]["z"], ks[0]["x"], ks[0]["y"]
    elif t >= ks[-1]["t"]:
        z, x, y = ks[-1]["z"], ks[-1]["x"], ks[-1]["y"]
    else:
        i = 0
        while i + 1 < len(ks) and ks[i + 1]["t"] <= t:
            i += 1
        a, b = ks[i], ks[i + 1]
        u = (t - a["t"]) / max(1e-6, b["t"] - a["t"]); e = ease(b.get("ease") or "inOutSine", u)
        z = math.exp(lerp(math.log(max(1, a["z"])), math.log(max(1, b["z"])), e))
        x, y = lerp(a["x"], b["x"], e), lerp(a["y"], b["y"], e)
    z = max(1.0, z); hw = 0.5 / z
    return z, clamp(x, hw, 1 - hw), clamp(y, hw, 1 - hw)
