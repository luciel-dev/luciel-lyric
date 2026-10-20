"""Write packaging/build/version_info.txt (Windows exe version resource) from app/version.py."""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import re  # noqa: E402
from app.version import __version__, APP_NAME  # noqa: E402
if "--version" in sys.argv:          # e.g. from a git tag v1.2.0 / v1.2.0-beta
    __version__ = sys.argv[sys.argv.index("--version") + 1]
nums = [int(x) for x in re.findall(r"\d+", __version__)[:4]]
v = tuple((nums + [0] * 4)[:4])
(ROOT / "packaging" / "build").mkdir(parents=True, exist_ok=True)
(ROOT / "packaging" / "build" / "version_info.txt").write_text(f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={v}, prodvers={v}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[StringFileInfo([StringTable('040904B0', [StringStruct('CompanyName', '{APP_NAME}'),
    StringStruct('FileDescription', '{APP_NAME} - lyric video maker'), StringStruct('FileVersion', '{__version__}'),
    StringStruct('InternalName', 'LucielLyric'), StringStruct('OriginalFilename', 'LucielLyric.exe'),
    StringStruct('ProductName', '{APP_NAME}'), StringStruct('ProductVersion', '{__version__}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])]
)
""", encoding="utf-8")
print("wrote packaging/build/version_info.txt")
