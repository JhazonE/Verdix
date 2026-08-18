; Vendix Updater — Inno Setup Script
;
; Patches an EXISTING Vendix install in place: overwrites app files and
; applies any pending database migrations. Deliberately does NOT touch:
;   - .env (the site's real DB credentials/config — see [Files] below)
;   - The MySQL service, verdix_install.sql, or the data directory
;     (C:\ProgramData\Verdix\mysql-data) — the database and its data are
;     never part of this installer at all.
;   - Add/Remove Programs (Uninstallable=no — this is a patch, not a
;     separately-tracked application; see setup.iss for the real installer).
;
; Must be run on a PC that already has Vendix installed via setup.iss (same
; {autopf}\Vendix directory, same bundled node.exe, same MySQL service).
#define AppName "Vendix"
; Version comes from package.json via `npm run build:updater`
; (iscc /DAppVersion=x.y.z). The fallback below is only for direct iscc runs.
#ifndef AppVersion
  #define AppVersion "1.19.8"
#endif
#define AppPublisher "BHAGOH SYSTEMS"
#define AppExeName "verdix.exe"

[Setup]
; No AppId: Uninstallable=no below means Inno never writes an Add/Remove
; Programs entry, so there's nothing for an AppId to identify or collide
; with — reusing setup.iss's AppId here would be meaningless at best.
AppName={#AppName} Updater
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
SetupIconFile=public\verdix_logo.ico
OutputBaseFilename=VendixUpdater_{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
DisableFinishedPage=yes
DisableReadyPage=yes
DisableWelcomePage=no
; Patch only — do not register as its own entry in Add/Remove Programs and
; do not create an uninstaller. Uninstalling Vendix itself (setup.iss) still
; removes everything this installer writes, since it all lands under {app}.
Uninstallable=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Electron app binary — same overlay as setup.iss.
Source: "dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Runtime config: .env is NEVER overwritten by the updater. DestName-less
; "skip existing file" isn't a real Inno flag — Inno's own `onlyifdoesntexist`
; flag does exactly this: it copies the bundled .env ONLY if {app}\.env is
; missing (e.g. patching an install that was somehow set up without one), and
; silently leaves an existing .env completely untouched otherwise.
Source: ".env"; DestDir: "{app}"; Flags: onlyifdoesntexist uninsneveruninstall

; Next.js Standalone Files — identical overlay set to setup.iss. Same
; excludes: never let a stale traced copy of these operational scripts
; overwrite the up-to-date ones (which this updater does not ship changes
; to, but the exclude must match or Next's trace output re-introduces them).
Source: ".next\standalone\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.sql,*.log,server.log,dev_server.log,.env,setup_mysql_service.bat,uninstall_mysql_service.bat,start_server.bat,run_migration.bat,init_database.js,migrate.js"
Source: ".next\standalone\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\next\*"; DestDir: "{app}\node_modules\next"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\node-cron\*"; DestDir: "{app}\node_modules\node-cron"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\@swc\helpers\*"; DestDir: "{app}\node_modules\@swc\helpers"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\@next\env\*"; DestDir: "{app}\node_modules\@next\env"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\react\*"; DestDir: "{app}\node_modules\react"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: ".next\static\*"; DestDir: "{app}\.next\static"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs

; ── Migration toolkit — isolated under {app}\updater, NOT {app}\node_modules ──
; A self-contained set of packages (mysql2, tsx, node-cron, date-fns, uuid,
; dotenv + tsx's own esbuild/get-tsconfig deps) needed to run
; scripts/migrations/*.ts via the bundled node.exe, kept in its own
; node_modules so it can never shadow or be shadowed by the app's real one
; above. See run_update.bat and scripts/updater/run-migrate.ts for exactly
; why this lives one level below {app} and how it still finds the real .env.
Source: "lib\*"; DestDir: "{app}\updater\lib"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\migrations\*"; DestDir: "{app}\updater\scripts\migrations"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\updater\*"; DestDir: "{app}\updater\scripts\updater"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "tsconfig.json"; DestDir: "{app}\updater"; Flags: ignoreversion
Source: "node_modules\mysql2\*"; DestDir: "{app}\updater\node_modules\mysql2"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\dotenv\*"; DestDir: "{app}\updater\node_modules\dotenv"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\node-cron\*"; DestDir: "{app}\updater\node_modules\node-cron"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\date-fns\*"; DestDir: "{app}\updater\node_modules\date-fns"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\uuid\*"; DestDir: "{app}\updater\node_modules\uuid"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\tsx\*"; DestDir: "{app}\updater\node_modules\tsx"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\esbuild\*"; DestDir: "{app}\updater\node_modules\esbuild"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\@esbuild\win32-x64\*"; DestDir: "{app}\updater\node_modules\@esbuild\win32-x64"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\get-tsconfig\*"; DestDir: "{app}\updater\node_modules\get-tsconfig"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\resolve-pkg-maps\*"; DestDir: "{app}\updater\node_modules\resolve-pkg-maps"; Flags: ignoreversion recursesubdirs createallsubdirs
; mysql2's own declared dependencies (its full package.json "dependencies"
; list — see mysql2/package.json). denque/iconv-lite/generate-function/
; long/lru.min/sqlstring/is-property/safer-buffer are exercised by a normal
; query; named-placeholders/aws-ssl-profiles/seq-queue are for named
; placeholders / SSL / compressed-protocol connections that this project's
; queries don't currently use, but are cheap to include and avoid a latent
; "Cannot find module" if that ever changes.
Source: "node_modules\denque\*"; DestDir: "{app}\updater\node_modules\denque"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\iconv-lite\*"; DestDir: "{app}\updater\node_modules\iconv-lite"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\generate-function\*"; DestDir: "{app}\updater\node_modules\generate-function"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\is-property\*"; DestDir: "{app}\updater\node_modules\is-property"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\long\*"; DestDir: "{app}\updater\node_modules\long"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\lru.min\*"; DestDir: "{app}\updater\node_modules\lru.min"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\safer-buffer\*"; DestDir: "{app}\updater\node_modules\safer-buffer"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\sqlstring\*"; DestDir: "{app}\updater\node_modules\sqlstring"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\named-placeholders\*"; DestDir: "{app}\updater\node_modules\named-placeholders"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\aws-ssl-profiles\*"; DestDir: "{app}\updater\node_modules\aws-ssl-profiles"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\seq-queue\*"; DestDir: "{app}\updater\node_modules\seq-queue"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "run_update.bat"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; Applies pending migrations, then relaunches verdix.exe. The app/server were
; already stopped in [Code]'s PrepareToInstall, before [Files] copied over
; any locked files — see below.
Filename: "{app}\run_update.bat"; Flags: runhidden waituntilterminated; StatusMsg: "Applying database updates..."
Filename: "{app}\{#AppExeName}"; Flags: nowait skipifsilent

[Code]
// Runs BEFORE [Files] copies anything — the whole reason this exists is to
// release locks on verdix.exe/server.js/DLLs so the file overwrite below
// doesn't fail or leave a half-updated install. server.js is the persistent
// background process (boot-launched via start_server_hidden.vbs); verdix.exe
// is the Electron shell, which may or may not be open at the same time.
// Neither the MySQL service nor mysqld.exe are touched here.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  NodeExePath: String;
  PsCommand: String;
begin
  // verdix.exe only ever runs from {app}, so a plain /IM filter is already
  // precise for it. node.exe is NOT — it's a generic binary name other
  // software (or a dev machine) may also be running — so kill only the
  // specific copy bundled at {app}\node.exe by matching its exact
  // executable path via PowerShell (available on every supported Windows
  // version, unlike wmic.exe which is deprecated/removed on newer builds
  // and whose WQL string-quoting is brittle here), not every node.exe on
  // the system.
  Exec('taskkill.exe', '/F /IM verdix.exe /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  NodeExePath := ExpandConstant('{app}\node.exe');
  PsCommand := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter ''Name=\"node.exe\"'' | ' +
    'Where-Object { $_.ExecutablePath -eq ''' + NodeExePath + ''' } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"';
  Exec('powershell.exe', PsCommand, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // Windows can hold a file handle open briefly after a process is killed
  // (antivirus scan, deferred handle cleanup); [Files] copying right on top
  // of that can intermittently fail on a still-locked .dll/.exe. A short
  // settle delay avoids that race.
  Sleep(2000);
  Result := '';
end;
