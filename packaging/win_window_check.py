"""CI check: the Windows build is a GUI-subsystem exe and opens a real window.

    python packaging/win_window_check.py --exe dist/LucielLyric/LucielLyric.exe --screenshot dist/windows-window.png

Confirms the PE subsystem is WINDOWS_GUI (not a console app), that a top-level window titled
Luciel Lyric appears, that it has minimize, maximize and close (system menu) plus a resizable
frame, that maximize/restore works, then closes it and requires the process and its children
to exit. A screenshot of the restored window is written when Pillow can capture it.
"""
import argparse
import ctypes
import json
import os
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.win_window import pe_subsystem  # noqa: E402

WS_MAXIMIZEBOX = 0x00010000
WS_MINIMIZEBOX = 0x00020000
WS_THICKFRAME = 0x00040000
WS_SYSMENU = 0x00080000
WS_CAPTION = 0x00C00000
NEED = {
    "caption": WS_CAPTION,
    "system menu (close)": WS_SYSMENU,
    "minimize": WS_MINIMIZEBOX,
    "maximize": WS_MAXIMIZEBOX,
    "resizable frame": WS_THICKFRAME,
}
WM_SYSCOMMAND = 0x0112
SC_MAXIMIZE = 0xF030
SC_RESTORE = 0xF120
WM_CLOSE = 0x0010


def fail(msg):
    raise SystemExit("FAIL: " + msg)


def pids_named(name: str):
    if sys.platform != "win32":
        return []
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    TH32CS_SNAPPROCESS = 0x2

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_void_p),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    out = []
    pe = PROCESSENTRY32W()
    pe.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    k32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    k32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    ok = k32.Process32FirstW(snap, ctypes.byref(pe))
    while ok:
        if pe.szExeFile.lower() == name.lower():
            out.append(int(pe.th32ProcessID))
        ok = k32.Process32NextW(snap, ctypes.byref(pe))
    k32.CloseHandle(snap)
    return out


def find_window(pid: int, title: str):
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _cb(hwnd, _lp):
        proc = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(proc))
        if proc.value != pid or not user32.IsWindowVisible(hwnd):
            return True
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        if rect.right - rect.left < 400 or rect.bottom - rect.top < 300:
            return True  # skip message boxes and other tiny popups
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        if buf.value == title or buf.value.startswith(title):
            found.append(hwnd)
        return True

    user32.EnumWindows(_cb, 0)
    return found[0] if found else None


def window_style(hwnd) -> int:
    user32 = ctypes.windll.user32
    fn = getattr(user32, "GetWindowLongPtrW", user32.GetWindowLongW)
    fn.argtypes = [wintypes.HWND, ctypes.c_int]
    fn.restype = ctypes.c_ssize_t
    return int(fn(hwnd, -16)) & 0xFFFFFFFF


def send(hwnd, msg, wp):
    user32 = ctypes.windll.user32
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.SendMessageW(hwnd, msg, wp, 0)


def save_png(hwnd, path: Path) -> bool:
    try:
        from PIL import Image
    except Exception as e:  # noqa: BLE001
        print(f"screenshot skipped ({e})")
        return False
    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return False
    w, h = rect.right - rect.left, rect.bottom - rect.top
    if w < 80 or h < 80:
        return False
    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    old = gdi32.SelectObject(mem, bmp)
    SRCCOPY = 0x00CC0020
    printed = user32.PrintWindow(hwnd, mem, 2)
    if not printed:
        gdi32.BitBlt(mem, 0, 0, w, h, hdc, 0, 0, SRCCOPY)

    class BI(ctypes.Structure):
        _fields_ = [
            ("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
            ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
            ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", ctypes.c_long), ("biYPelsPerMeter", ctypes.c_long),
            ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD),
        ]

    bi = BI()
    bi.biSize = ctypes.sizeof(BI)
    bi.biWidth = w
    bi.biHeight = -h
    bi.biPlanes = 1
    bi.biBitCount = 32
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT,
                                ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT]
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)
    gdi32.SelectObject(mem, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(hwnd, hdc)
    Image.frombuffer("RGBX", (w, h), buf, "raw", "BGRX", 0, 1).convert("RGB").save(path)
    print(f"screenshot {path} ({w}x{h})")
    return True


def main():
    if sys.platform != "win32":
        fail("this check only runs on Windows")
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--screenshot", default="")
    ap.add_argument("--timeout", type=float, default=180)
    a = ap.parse_args()
    exe = Path(a.exe).resolve()
    if not exe.is_file():
        fail(f"missing {exe}")
    sub = pe_subsystem(exe)
    print(f"PE subsystem {sub} (2 = GUI, 3 = console)")
    if sub != 2:
        fail(f"LucielLyric.exe subsystem is {sub}, expected 2 (WINDOWS_GUI)")
    boot = exe.parent / "MicrosoftEdgeWebview2Setup.exe"
    if not boot.is_file() or boot.stat().st_size < 100_000:
        fail("WebView2 bootstrapper is not next to LucielLyric.exe")
    before = set(pids_named(exe.name))
    data = Path(tempfile.mkdtemp(prefix="luciel_win_"))
    env = dict(os.environ, LUCIEL_DATA_DIR=str(data), PYTHONUNBUFFERED="1", HF_HUB_OFFLINE="1")
    # Software rendering is more reliable for a CI screenshot; users keep the default.
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--disable-gpu"
    proc = subprocess.Popen([str(exe)], env=env)
    user32 = ctypes.windll.user32
    hwnd = None
    t0 = time.time()
    try:
        while time.time() - t0 < a.timeout:
            if proc.poll() is not None:
                break
            hwnd = find_window(proc.pid, "Luciel Lyric")
            if hwnd:
                break
            time.sleep(0.5)
        if not hwnd:
            log = data / "logs" / "luciel.log"
            if log.exists():
                print(log.read_text(encoding="utf-8", errors="replace")[-4000:])
            fail(f"no native window appeared (process exit {proc.poll()})")
        user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
        user32.SetWindowPos.restype = wintypes.BOOL
        user32.IsZoomed.argtypes = [wintypes.HWND]
        user32.IsZoomed.restype = wintypes.BOOL
        user32.ShowWindow(hwnd, 9)
        user32.SetWindowPos(hwnd, 0, 40, 40, 960, 700, 0x0004)
        time.sleep(0.4)
        style = window_style(hwnd)
        print(f"window style 0x{style:08X}")
        missing = [name for name, bit in NEED.items() if not (style & bit)]
        if missing:
            fail("window is missing " + ", ".join(missing))
        send(hwnd, WM_SYSCOMMAND, SC_MAXIMIZE)
        time.sleep(0.6)
        if not user32.IsZoomed(hwnd):
            fail("maximize did not zoom the window")
        send(hwnd, WM_SYSCOMMAND, SC_RESTORE)
        time.sleep(0.4)
        if user32.IsZoomed(hwnd):
            fail("restore left the window maximized")
        user32.SetWindowPos(hwnd, 0, 40, 40, 960, 700, 0x0004)
        time.sleep(0.3)
        if a.screenshot:
            try:
                save_png(hwnd, Path(a.screenshot))
            except Exception as e:  # noqa: BLE001
                print(f"screenshot failed ({e})")
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
        try:
            proc.wait(timeout=40)
        except subprocess.TimeoutExpired:
            fail("window closed but the process is still running")
        if proc.returncode not in (0, None):
            log = data / "logs" / "luciel.log"
            tail = log.read_text(encoding="utf-8", errors="replace")[-2000:] if log.exists() else ""
            print(tail)
            fail(f"process exit {proc.returncode}")
        time.sleep(1)
        leftover = set(pids_named(exe.name)) - before
        if leftover:
            fail(f"orphaned LucielLyric.exe processes: {sorted(leftover)}")
        print("WINDOW CHECK: PASS")
        return 0
    finally:
        if proc.poll() is None:
            proc.kill()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass


if __name__ == "__main__":
    sys.exit(main() or 0)
