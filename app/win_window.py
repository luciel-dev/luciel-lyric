"""Windows native-window helpers for the desktop build.

Safe to import on macOS and Linux: Win32 calls stay inside functions. The packaged
Windows app uses a normal WinForms frame (minimize, maximize, close) on top of
WebView2. If that runtime is missing, the bundled Evergreen bootstrapper installs
it. A fixed runtime dropped next to the exe (WebView2Fixed/msedgewebview2.exe)
works with no network. The system browser is only the last resort.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# pywebview refuses anything older than this and would silently use the IE engine.
WEBVIEW2_MIN = (86, 0, 622, 0)
_CLIENT = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
_REG_PATHS = (
    r"SOFTWARE\Microsoft\EdgeUpdate\Clients\\" + _CLIENT,
    r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\\" + _CLIENT,
)
BOOTSTRAPPER_NAME = "MicrosoftEdgeWebview2Setup.exe"


def version_tuple(text: str):
    text = (text or "").strip()
    if not text or text == "0.0.0.0":
        return None
    parts = []
    for piece in text.split("."):
        if not piece.isdigit():
            return None
        parts.append(int(piece))
    if not parts:
        return None
    return tuple((parts + [0, 0, 0, 0])[:4])


def runtime_ready(version: str) -> bool:
    got = version_tuple(version)
    return got is not None and got >= WEBVIEW2_MIN


def native_window_possible(version: str, fixed_dir: Path | None) -> bool:
    """A real app window is possible when WebView2 is installed or a fixed runtime is on disk."""
    if fixed_dir is not None:
        return True
    return runtime_ready(version)


def find_fixed_runtime(folder: Path):
    """Offline xcopy runtime: <folder>/WebView2Fixed or a FixedVersionRuntime directory."""
    folder = Path(folder)
    direct = folder / "WebView2Fixed"
    if (direct / "msedgewebview2.exe").is_file():
        return direct
    if not folder.is_dir():
        return None
    for child in sorted(folder.glob("Microsoft.WebView2.FixedVersionRuntime*")):
        if (child / "msedgewebview2.exe").is_file():
            return child
    return None


def pe_subsystem(path: Path) -> int:
    """PE optional-header Subsystem. 2 = Windows GUI, 3 = console."""
    data = Path(path).read_bytes()
    if len(data) < 0x40 or data[:2] != b"MZ":
        raise ValueError(f"{path} is not a PE executable")
    e = int.from_bytes(data[0x3C:0x40], "little")
    if e + 26 > len(data) or data[e:e + 4] != b"PE\0\0":
        raise ValueError(f"{path} has no PE header")
    # Subsystem is at the same offset in PE32 and PE32+ optional headers.
    off = e + 24 + 68
    if off + 2 > len(data):
        raise ValueError(f"{path} PE header is truncated")
    return int.from_bytes(data[off:off + 2], "little")


def search_dirs(extra=()):
    dirs = []
    if getattr(sys, "frozen", False):
        dirs.append(Path(sys.executable).resolve().parent)
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            dirs.append(Path(meipass))
    for d in extra:
        p = Path(d)
        if p not in dirs:
            dirs.append(p)
    return dirs


def installed_webview2_version() -> str:
    if sys.platform != "win32":
        return ""
    import winreg
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for path in _REG_PATHS:
            try:
                with winreg.OpenKey(hive, path) as key:
                    pv, _ = winreg.QueryValueEx(key, "pv")
            except OSError:
                continue
            if runtime_ready(str(pv)):
                return str(pv)
    return ""


def find_bootstrapper(extra=()):
    found = []
    for folder in search_dirs(extra):
        path = folder / BOOTSTRAPPER_NAME
        try:
            if path.is_file() and path.stat().st_size > 100_000:
                found.append(path)
        except OSError:
            continue
    return found


def prepare_webview2(extra=()) -> str:
    """Return installed, fixed, bootstrapped, or missing. Sets the fixed-runtime env var when used."""
    if runtime_ready(installed_webview2_version()):
        return "installed"
    for folder in search_dirs(extra):
        fixed = find_fixed_runtime(folder)
        if fixed is not None:
            os.environ["WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"] = str(fixed)
            return "fixed"
    boots = find_bootstrapper(extra)
    if not boots:
        return "missing"
    _run_bootstrapper(boots[0])
    if runtime_ready(installed_webview2_version()):
        return "bootstrapped"
    return "missing"


def _run_bootstrapper(path: Path) -> None:
    import subprocess
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    print(f"installing WebView2 from {path}", flush=True)
    try:
        subprocess.run([str(path), "/silent", "/install"], timeout=180, creationflags=flags)
    except Exception as e:  # noqa: BLE001
        print(f"WebView2 installer did not finish ({type(e).__name__}: {e})", flush=True)


def message_box(text: str, title: str = "Luciel Lyric") -> None:
    if sys.platform != "win32":
        print(text, flush=True)
        return
    import ctypes
    # MB_ICONWARNING | MB_OK | MB_SETFOREGROUND
    ctypes.windll.user32.MessageBoxW(None, text, title, 0x00000030 | 0x00010000)


def set_app_id(app_id: str = "app.luciel.lyric") -> None:
    if sys.platform != "win32":
        return
    import ctypes
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(app_id)
    except Exception:  # noqa: BLE001
        pass


def arm_kill_on_job_close():
    """Put this process in a job that ends every child when the process exits. Keep the handle."""
    if sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    job = k32.CreateJobObjectW(None, None)
    if not job:
        return None

    class BASIC(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IOCOUNTS(ctypes.Structure):
        _fields_ = [(n, ctypes.c_ulonglong) for n in (
            "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
            "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class EXT(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BASIC),
            ("IoInfo", IOCOUNTS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    info = EXT()
    info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
        k32.CloseHandle(job)
        return None
    if not k32.AssignProcessToJobObject(job, k32.GetCurrentProcess()):
        k32.CloseHandle(job)
        return None
    return job


def focus_pid(pid: int) -> bool:
    """Restore and foreground a visible top-level window owned by pid."""
    if sys.platform != "win32" or not pid:
        return False
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _cb(hwnd, _lparam):
        proc = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(proc))
        if proc.value == pid and user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n > 0:
                found.append(hwnd)
        return True

    user32.EnumWindows(_cb, 0)
    if not found:
        return False
    hwnd = found[0]
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    # A newly started process may not be allowed to steal focus; ALT is the usual workaround.
    user32.keybd_event(0x12, 0, 0, 0)
    user32.SetForegroundWindow(hwnd)
    user32.keybd_event(0x12, 0, 2, 0)
    return True


def enforce_caption_buttons(window) -> None:
    """WinForms defaults already include the buttons; set them again so a theme cannot drop them."""
    form = getattr(window, "native", None)
    if form is None or sys.platform != "win32":
        return
    import clr
    clr.AddReference("System.Windows.Forms")
    from System.Windows.Forms import FormBorderStyle
    form.FormBorderStyle = FormBorderStyle.Sizable
    form.ControlBox = True
    form.MinimizeBox = True
    form.MaximizeBox = True
    form.ShowIcon = True
    form.ShowInTaskbar = True


def kill_descendants(root_pid: int) -> None:
    """Terminate child processes of root_pid. Does not kill root_pid itself."""
    if sys.platform != "win32" or not root_pid:
        return
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    TH32CS_SNAPPROCESS = 0x00000002

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
    if snap == ctypes.c_void_p(-1).value or not snap:
        return
    kids = {}
    try:
        pe = PROCESSENTRY32W()
        pe.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        k32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
        k32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
        ok = k32.Process32FirstW(snap, ctypes.byref(pe))
        while ok:
            kids.setdefault(int(pe.th32ParentProcessID), []).append(int(pe.th32ProcessID))
            ok = k32.Process32NextW(snap, ctypes.byref(pe))
    finally:
        k32.CloseHandle(snap)
    stack = list(kids.get(int(root_pid), []))
    victims = []
    while stack:
        pid = stack.pop()
        if pid == root_pid or pid in victims:
            continue
        victims.append(pid)
        stack.extend(kids.get(pid, []))
    PROCESS_TERMINATE = 0x0001
    for pid in victims:
        handle = k32.OpenProcess(PROCESS_TERMINATE, False, pid)
        if handle:
            k32.TerminateProcess(handle, 1)
            k32.CloseHandle(handle)
