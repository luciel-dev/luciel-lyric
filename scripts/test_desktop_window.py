"""Checks for the Windows native-window helpers. No GUI and no network."""
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.win_window import (  # noqa: E402
    find_fixed_runtime,
    native_window_possible,
    pe_subsystem,
    runtime_ready,
)


def _pe(subsystem: int) -> bytes:
    buf = bytearray(0x200)
    buf[0:2] = b"MZ"
    e = 0x80
    buf[0x3C:0x40] = e.to_bytes(4, "little")
    buf[e:e + 4] = b"PE\0\0"
    buf[e + 24:e + 26] = (0x20B).to_bytes(2, "little")
    buf[e + 24 + 68:e + 24 + 70] = int(subsystem).to_bytes(2, "little")
    return bytes(buf)


def test_runtime_ready():
    assert runtime_ready("120.0.2210.91")
    assert runtime_ready("86.0.622.0")
    assert not runtime_ready("86.0.621.9")
    assert not runtime_ready("")
    assert not runtime_ready("0.0.0.0")
    assert not runtime_ready("not-a-version")


def test_native_choice():
    assert native_window_possible("120.0.0.0", None)
    assert not native_window_possible("", None)
    assert native_window_possible("", pathlib.Path("/tmp/WebView2Fixed"))


def test_fixed_runtime_and_pe():
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        assert find_fixed_runtime(root) is None
        fixed = root / "WebView2Fixed"
        fixed.mkdir()
        (fixed / "msedgewebview2.exe").write_bytes(b"MZ")
        assert find_fixed_runtime(root) == fixed
        exe = root / "app.exe"
        exe.write_bytes(_pe(2))
        assert pe_subsystem(exe) == 2
        exe.write_bytes(_pe(3))
        assert pe_subsystem(exe) == 3


if __name__ == "__main__":
    test_runtime_ready()
    test_native_choice()
    test_fixed_runtime_and_pe()
    print("desktop window tests ok")
