; Inno Setup 6 script for Luciel Lyric (Windows x64).
;   iscc /DAppVersion=1.0.0 /DSourceDir=..\..\dist\LucielLyric packaging\windows\LucielLyric.iss
; Output: dist\LucielLyric-Setup.exe. Per-user install by default (no admin needed); user data lives in
; %APPDATA%\LucielLyric and is kept on uninstall.
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\LucielLyric"
#endif

[Setup]
AppId={{6D7E2C1A-5B0F-4C1E-9F8A-1E2D3C4B5A60}
AppName=Luciel Lyric
AppVersion={#AppVersion}
AppVerName=Luciel Lyric {#AppVersion}
AppPublisher=Luciel Lyric
DefaultDirName={autopf}\Luciel Lyric
DefaultGroupName=Luciel Lyric
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir=..\..\dist
OutputBaseFilename=LucielLyric-Setup
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\LucielLyric.exe
UninstallDisplayName=Luciel Lyric
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=4
WizardStyle=modern
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Luciel Lyric"; Filename: "{app}\LucielLyric.exe"
Name: "{autoprograms}\Luciel Lyric (open renders folder)"; Filename: "{userappdata}\LucielLyric\renders"
Name: "{autodesktop}\Luciel Lyric"; Filename: "{app}\LucielLyric.exe"; Tasks: desktopicon

[Dirs]
Name: "{userappdata}\LucielLyric\renders"

[Run]
; Evergreen bootstrapper (small, needs a network the first time). Skipped when WebView2 is already there.
Filename: "{app}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft Edge WebView2 (the app window)..."; Flags: runhidden waituntilterminated; Check: not WebView2Ready
Filename: "{app}\LucielLyric.exe"; Description: "{cm:LaunchProgram,Luciel Lyric}"; Flags: nowait postinstall skipifsilent

[Code]
function WebView2Ready: Boolean;
var
  V, Client, Tail: String;
begin
  Result := False;
  Client := Chr(123) + 'F3017226-FE2A-4295-8BDF-00C3A9A7E4C5' + Chr(125);
  Tail := '\Microsoft\EdgeUpdate\Clients\' + Client;
  if RegQueryStringValue(HKCU, 'SOFTWARE' + Tail, 'pv', V) then
    if (V <> '') and (V <> '0.0.0.0') then begin Result := True; Exit; end;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node' + Tail, 'pv', V) then
    if (V <> '') and (V <> '0.0.0.0') then begin Result := True; Exit; end;
  if RegQueryStringValue(HKLM, 'SOFTWARE' + Tail, 'pv', V) then
    if (V <> '') and (V <> '0.0.0.0') then begin Result := True; Exit; end;
end;
