; Vendix upgrade pre-flight kit (VendixPreflight_X.Y.Z.exe)
;
; Runs the upgrade pre-flight check on a store BEFORE it is updated. It does
; not install or change Vendix: it unpacks node.exe, the migration toolkit and
; preflight.bat into C:\ProgramData\Verdix\preflight-kit and runs the check
; against the database named in the EXISTING install's .env
; (C:\Program Files\Vendix\.env).
;
; Why a separate file: from 1.20.12 every install carries {app}\preflight.bat,
; but an older install (e.g. 1.19.13) has none, and VendixSetup applies the
; migrations as part of installing - so a check shipped only inside Setup
; would arrive too late for the update it is meant to vet. Run this on the
; store's SERVER PC first; VendixSetup only once it says CLEAR TO UPDATE.
;
; The kit carries the SAME migration list as the Setup of the same version
; (migration-toolkit.iss is shared), so "pending" means exactly what that
; Setup will run. Build both from the same commit.
;
; Build:  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DAppVersion=x.y.z preflight.iss

#ifndef AppVersion
  #define AppVersion "1.20.12"
#endif

[Setup]
AppId={{6F0B8E52-3C1A-4D7E-9A43-5B2E7C1D9F60}
AppName=Vendix Pre-flight Check
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher=BHAGOH SYSTEMS
DefaultDirName={commonappdata}\Verdix\preflight-kit
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes
Uninstallable=no
CreateUninstallRegKey=no
SetupIconFile=public\verdix_logo.ico
OutputBaseFilename=VendixPreflight_{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[InstallDelete]
; A kit left over from an earlier version must not mix its old migration list
; into this one's.
Type: filesandordirs; Name: "{app}\updater"

[Files]
Source: "C:\Program Files\nodejs\node.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "preflight.bat"; DestDir: "{app}"; Flags: ignoreversion
#include "migration-toolkit.iss"

[Run]
; Visible console: the report and the FIX prompt are the whole point.
Filename: "{cmd}"; Parameters: "/c ""{app}\preflight.bat"""; Flags: waituntilterminated; StatusMsg: "Running the pre-flight check..."
