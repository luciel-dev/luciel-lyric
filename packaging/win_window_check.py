"""CI check: the Windows build is a GUI-subsystem exe and opens a real window.

    python packaging/win_window_check.py --exe dist/LucielLyric/LucielLyric.exe --screenshot dist/windows-window.png

Confirms the PE subsystem is WINDOWS_GUI (not a console app), that a top-level window titled
Luciel Lyric appears, that it has minimize, maximize and close (system menu) plus a resizable
frame, that maximize/restore works, then closes it and requires the process and its children
to exit. A screenshot of the restored window is written when Pillow can capture it.
"""
import argparse
import ctypes
import os
import subprocess
import sys
import tempfile
import threading
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


_USER32 = None


def _user32():
    global _USER32
    if _USER32 is None:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.SendMessageTimeoutW.argtypes = [
            wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM,
            wintypes.UINT, wintypes.UINT, ctypes.POINTER(ctypes.c_size_t),
        ]
        user32.SendMessageTimeoutW.restype = ctypes.c_void_p
        _USER32 = user32
    return _USER32


def window_title(hwnd, timeout_ms=800):
    """Title, or None if the window does not answer. Never waits forever."""
    user32 = _user32()
    result = ctypes.c_size_t()
    WM_GETTEXTLENGTH, WM_GETTEXT, SMTO_ABORTIFHUNG = 0x000E, 0x000D, 0x0002
    if not user32.SendMessageTimeoutW(hwnd, WM_GETTEXTLENGTH, 0, 0, SMTO_ABORTIFHUNG, timeout_ms, ctypes.byref(result)):
        return None
    n = int(result.value)
    if n < 0 or n > 512:
        n = 256
    buf = ctypes.create_unicode_buffer(n + 1)
    if not user32.SendMessageTimeoutW(
        hwnd, WM_GETTEXT, n + 1, ctypes.addressof(buf), SMTO_ABORTIFHUNG, timeout_ms, ctypes.byref(result)
    ):
        return None
    return buf.value


def class_name(hwnd) -> str:
    user32 = ctypes.windll.user32
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def list_windows(pid: int):
    """Visible top-level windows for pid: (hwnd, w, h, class, title)."""
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
        found.append((
            int(hwnd), rect.right - rect.left, rect.bottom - rect.top,
            class_name(hwnd), window_title(hwnd),
        ))
        return True

    user32.EnumWindows(_cb, 0)
    return found


def find_window(pid: int, title: str):
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _cb(hwnd, _lp):
        proc = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(proc))
        if proc.value != pid or not user32.IsWindowVisible(hwnd):
            return True
        # Dialogs (#32770) are message boxes, not the app frame.
        if class_name(hwnd).startswith("#"):
            return True
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        if rect.right - rect.left < 400 or rect.bottom - rect.top < 300:
            return True
        text = window_title(hwnd)
        if text == title or (text or "").startswith(title):
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


def send_timeout(hwnd, msg, wp, timeout_ms=3000) -> bool:
    """Deliver a message, but return if the window does not answer. SendMessage would wait forever."""
    user32 = _user32()
    result = ctypes.c_size_t()
    return bool(user32.SendMessageTimeoutW(hwnd, msg, wp, 0, 0x0002, timeout_ms, ctypes.byref(result)))


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
    # BitBlt from the screen. PrintWindow asks the WebView2 window to paint and never returns.
    hdc = user32.GetDC(0)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    old = gdi32.SelectObject(mem, bmp)
    SRCCOPY = 0x00CC0020
    gdi32.BitBlt(mem, 0, 0, w, h, hdc, rect.left, rect.top, SRCCOPY)

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
    user32.ReleaseDC(0, hdc)
    Image.frombuffer("RGBX", (w, h), buf, "raw", "BGRX", 0, 1).convert("RGB").save(path)
    print(f"screenshot {path} ({w}x{h})")
    return True


def _kill_tree(pid: int) -> None:
    if not pid:
        return
    try:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=20)
    except Exception:  # noqa: BLE001
        pass


def _log_tail(data: Path, n=4000) -> str:
    log = data / "logs" / "luciel.log"
    if not log.exists():
        return ""
    return log.read_text(encoding="utf-8", errors="replace")[-n:]


def _arm_watchdog(holder, seconds: float) -> None:
    """If the check blocks inside a Win32 call, kill the app and exit. The step timeout is the backstop."""
    def _fire():
        time.sleep(seconds)
        print(f"WATCHDOG: window check still running after {seconds:.0f}s; killing the app", flush=True)
        data = holder.get("data")
        if data is not None:
            print(_log_tail(data), flush=True)
        proc = holder.get("proc")
        if proc is not None and proc.poll() is None:
            _kill_tree(proc.pid)
        os._exit(1)

    threading.Thread(target=_fire, name="window-check-watchdog", daemon=True).start()


def main():
    if sys.platform != "win32":
        fail("this check only runs on Windows")
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", required=True)
    ap.add_argument("--screenshot", default="")
    ap.add_argument("--timeout", type=float, default=120)
    a = ap.parse_args()
    holder = {"proc": None, "data": None}
    _arm_watchdog(holder, 300)
    exe = Path(a.exe).resolve()
    if not exe.is_file():
        fail(f"missing {exe}")
    sub = pe_subsystem(exe)
    print(f"PE subsystem {sub} (2 = GUI, 3 = console)", flush=True)
    if sub != 2:
        fail(f"LucielLyric.exe subsystem is {sub}, expected 2 (WINDOWS_GUI)")
    boot = exe.parent / "MicrosoftEdgeWebview2Setup.exe"
    internal = exe.parent / "_internal" / "MicrosoftEdgeWebview2Setup.exe"
    if not boot.is_file() or boot.stat().st_size < 100_000:
        where = f" (a copy exists in _internal, {internal.stat().st_size} bytes)" if internal.is_file() else ""
        fail("WebView2 bootstrapper is not next to LucielLyric.exe" + where)
    before = set(pids_named(exe.name))
    data = Path(tempfile.mkdtemp(prefix="luciel_win_"))
    holder["data"] = data
    env = dict(os.environ, LUCIEL_DATA_DIR=str(data), PYTHONUNBUFFERED="1", HF_HUB_OFFLINE="1", LUCIEL_NO_DIALOG="1")
    # Software rendering is more reliable for a CI screenshot; users keep the default.
    env["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--disable-gpu"
    proc = subprocess.Popen([str(exe)], env=env)
    holder["proc"] = proc
    print(f"launched pid {proc.pid}", flush=True)
    user32 = ctypes.windll.user32
    user32.IsZoomed.argtypes = [wintypes.HWND]
    user32.IsZoomed.restype = wintypes.BOOL
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
            print(_log_tail(data), flush=True)
            print("visible windows:", list_windows(proc.pid), flush=True)
            fail(f"no native window appeared (process exit {proc.poll()})")
        print(f"window hwnd={int(hwnd)} title={window_title(hwnd)!r}", flush=True)
        style = window_style(hwnd)
        print(f"window style 0x{style:08X}", flush=True)
        missing = [name for name, bit in NEED.items() if not (style & bit)]
        if missing:
            fail("window is missing " + ", ".join(missing))
        if not send_timeout(hwnd, WM_SYSCOMMAND, SC_MAXIMIZE):
            print("maximize message timed out", flush=True)
        zoomed = False
        for _ in range(20):
            if user32.IsZoomed(hwnd):
                zoomed = True
                break
            time.sleep(0.25)
        if not zoomed:
            fail("maximize did not zoom the window")
        print("maximized", flush=True)
        if not send_timeout(hwnd, WM_SYSCOMMAND, SC_RESTORE):
            print("restore message timed out", flush=True)
        restored = False
        for _ in range(20):
            if not user32.IsZoomed(hwnd):
                restored = True
                break
            time.sleep(0.25)
        if not restored:
            fail("restore left the window maximized")
        print("restored", flush=True)
        if a.screenshot:
            box = {}

            def _shot():
                try:
                    box["ok"] = save_png(hwnd, Path(a.screenshot))
                except Exception as e:  # noqa: BLE001
                    box["err"] = e

            shot = threading.Thread(target=_shot, name="window-screenshot", daemon=True)
            shot.start()
            shot.join(8)
            if shot.is_alive():
                print("screenshot timed out", flush=True)
            elif box.get("err"):
                print(f"screenshot failed ({box['err']})", flush=True)
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
        try:
            proc.wait(timeout=40)
        except subprocess.TimeoutExpired:
            fail("window closed but the process is still running")
        if proc.returncode not in (0, None):
            print(_log_tail(data, 2000), flush=True)
            fail(f"process exit {proc.returncode}")
        time.sleep(1)
        leftover = set(pids_named(exe.name)) - before
        if leftover:
            fail(f"orphaned LucielLyric.exe processes: {sorted(leftover)}")
        print("WINDOW CHECK: PASS", flush=True)
        return 0
    finally:
        if proc.poll() is None:
            _kill_tree(proc.pid)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass


if __name__ == "__main__":
    sys.exit(main() or 0)
