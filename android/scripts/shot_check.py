#!/usr/bin/env python3
"""Pixel check for an emulator screenshot.

The DOM audit can pass while Aero's first paint is still on screen: header,
bubbles, and an unhighlighted dock. Bubbles also satisfy a "not a flat color"
test. This looks at the PNG itself.

Usage: shot_check.py <png> <tab> <theme>
tab is track, sync, video, look, time, or render.
"""
import pathlib
import struct
import sys
import zlib

TAB = {"track": 0, "sync": 1, "video": 2, "look": 3, "time": 4, "render": 5}
SOFT = {"home", "intro", "intro2", "intro3"}


def decode(path):
    b = pathlib.Path(path).read_bytes()
    if not b.startswith(b"\x89PNG\r\n\x1a\n") or len(b) < 8000:
        raise SystemExit("bad screenshot %s (%s bytes)" % (path, len(b)))
    i, w, h, color, depth, idat = 8, 0, 0, 0, 0, []
    while i + 8 <= len(b):
        ln, typ = struct.unpack(">I4s", b[i:i + 8])
        data = b[i + 8:i + 8 + ln]
        i += 12 + ln
        if typ == b"IHDR":
            w, h, depth, color = struct.unpack(">IIBB", data[:10])
        elif typ == b"IDAT":
            idat.append(data)
        elif typ == b"IEND":
            break
    if depth != 8 or color not in (2, 6) or not w or not h:
        raise SystemExit("unsupported png %sx%s" % (w, h))
    n = 4 if color == 6 else 3
    raw = zlib.decompress(b"".join(idat))
    stride = w * n
    rows = []
    pos = 0
    prev = bytearray(stride)

    def paeth(a, b_, c):
        pred = a + b_ - c
        pa, pb, pc = abs(pred - a), abs(pred - b_), abs(pred - c)
        if pa <= pb and pa <= pc:
            return a
        return b_ if pb <= pc else c

    for _y in range(h):
        f = raw[pos]
        row = bytearray(raw[pos + 1:pos + 1 + stride])
        pos += 1 + stride
        if f == 1:
            for x in range(stride):
                row[x] = (row[x] + (row[x - n] if x >= n else 0)) & 255
        elif f == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                left = row[x - n] if x >= n else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif f == 4:
            for x in range(stride):
                left = row[x - n] if x >= n else 0
                up = prev[x]
                ul = prev[x - n] if x >= n else 0
                row[x] = (row[x] + paeth(left, up, ul)) & 255
        elif f != 0:
            raise SystemExit("bad filter %s" % f)
        prev = row
        rows.append(row)
    return w, h, n, rows


def pix(rows, n, x, y):
    o = x * n
    row = rows[y]
    return row[o], row[o + 1], row[o + 2]


def active(theme, r, g, b):
    if theme == "aero":
        return b > 160 and b > r + 35 and g > 90
    if theme == "y2k":
        return r > 150 and r > b + 40 and 90 < g < 210 and b < 140
    return g > 160 and g > r + 60 and g > b + 40


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: shot_check.py <png> <tab> <theme>")
    path, tab, theme = sys.argv[1:]
    if (tab not in TAB and tab not in SOFT) or theme not in ("aero", "y2k", "winamp"):
        raise SystemExit("unknown tab/theme %s %s" % (tab, theme))
    w, h, n, rows = decode(path)
    idx = TAB.get(tab, 0)
    y0, y1 = int(h * 0.78), int(h * 0.93)
    x0, x1 = int(w * 0.05), int(w * 0.95)
    nslot = len(TAB)
    slots = [0] * nslot
    span = max(1, x1 - x0)
    for y in range(y0, y1, 2):
        for x in range(x0, x1, 2):
            if active(theme, *pix(rows, n, x, y)):
                slots[min(nslot - 1, int((x - x0) / span * nslot))] += 1
    second = max(slots[i] for i in range(nslot) if i != idx)
    floor = 180 if theme == "winamp" else 800
    highlight = True if tab in SOFT else (slots[idx] >= floor and slots[idx] > second * 2.2)
    bg = pix(rows, n, 4, h // 2)
    content = total = 0
    for y in range(int(h * 0.42), int(h * 0.72), 3):
        for x in range(int(w * 0.08), int(w * 0.92), 3):
            r, g, b = pix(rows, n, x, y)
            total += 1
            if max(abs(r - bg[0]), abs(g - bg[1]), abs(b - bg[2])) > 28:
                content += 1
    ratio = content / total if total else 0
    # The empty Aero shell is ~0.02. Real tabs, including the dark Y2K sync
    # screen, stay above 0.05.
    filled = ratio > 0.05
    print("%s %s %s highlight=%s slots=%s content=%.3f" % (
        path, tab, theme, int(highlight), ",".join(str(s) for s in slots), ratio))
    if not highlight or not filled:
        why = []
        if not highlight:
            why.append("dock-highlight")
        if not filled:
            why.append("empty-main")
        raise SystemExit("screenshot missing " + ",".join(why))


if __name__ == "__main__":
    main()
