; Vendix Inno Setup Script
;
; ONE installer for both cases - it detects which one applies (see IsUpgrade in
; [Code]):
;   - No existing Vendix  -> full install: bundled MySQL service, database
;     schema + seed, shortcuts.
;   - Existing Vendix     -> in-place update: stops the running app, overwrites
;     the app files, applies pending DB migrations. The existing .env, MySQL
;     service, and database (C:\ProgramData\Verdix) are never touched.
; updater.iss remains as a smaller patch-only alternative.
#define AppName "Vendix"
; Version comes from package.json via `npm run build:installer`
; (iscc /DAppVersion=x.y.z). The fallback below is only for direct iscc runs.
#ifndef AppVersion
  #define AppVersion "1.19.5"
#endif
#define AppPublisher "BHAGOH SYSTEMS"
#define AppExeName "verdix.exe"

[Setup]
AppId={{D3F73FF9-A96F-4F5C-9E2B-62972F84B373}
AppName={#AppName}
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
SetupIconFile=public\verdix_logo.ico
OutputBaseFilename=VendixSetup_{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
DisableFinishedPage=yes
; Install as a true 64-bit app into C:\Program Files\Vendix (no "(x86)").
; The bundled node.exe and MySQL are x64, and a paren-free path avoids batch
; quoting pitfalls during MySQL setup.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Dirs]
; License store — lives OUTSIDE {app} so it survives uninstall/updates.
; Pre-created with user-modify rights so the POS server (running as the
; logged-in user) can write C:\ProgramData\Verdix\license.dat after activation.
Name: "{commonappdata}\Verdix"; Permissions: users-modify

[Files]
; Electron app binary
Source: "dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Runtime config
; .env is the site's real DB credentials/config: copied only when missing, so
; an update never overwrites it (a fresh install has none, so it gets copied).
Source: ".env"; DestDir: "{app}"; Flags: onlyifdoesntexist
Source: "C:\Program Files\nodejs\node.exe"; DestDir: "{app}"; Flags: ignoreversion

; Microsoft VC++ 2015-2022 Redistributable — required by bundled mysqld.exe.
; Fresh Windows PCs often lack it; installed silently before MySQL setup.
Source: "redist\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: not IsUpgrade

; Database setup — verdix_install.sql holds the full table structure, reference
; data, and the default admin. Applied via bundled mysql.exe (no Node).
; It is a hand-regenerated mysqldump snapshot, NOT built by any npm script, and
; the installer never runs migrations — so it goes stale silently as migrations
; land. Regenerate it whenever the schema changes; see the schema-regeneration
; notes for which seed tables to include and which dev-DB drift to strip.
Source: "verdix_install.sql"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup_mysql_service.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall_mysql_service.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "start_server.bat"; DestDir: "{app}"; Flags: ignoreversion
; Hidden launcher for start_server.bat — runs it with no visible console window
; at boot (see [Icons] {commonstartup} entry).
Source: "start_server_hidden.vbs"; DestDir: "{app}"; Flags: ignoreversion

; Bundled MySQL 8.0 (portable — no separate MySQL install needed on client PC)
; Excludes drop ~600MB of files the server never needs at runtime: debug symbols
; (*.pdb incl. the 352MB mysqld.pdb), debug plugins, dev headers/libs, Perl tools,
; docs, and the MeCab CJK full-text dictionaries (unused by this POS).
Source: "mysql-bundle\*"; DestDir: "{app}\mysql"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.pdb,*.lib,*.pl,lib\plugin\debug\*,lib\mecab\*,docs\*,include\*"; Check: NeedMySqlFiles

; Next.js Standalone Files
; IMPORTANT: exclude stale operational scripts that Next traced into the standalone
; folder. This copy runs AFTER our explicit copies, so without these excludes the
; OLD bundled copies (e.g. a setup_mysql_service.bat that calls run_migration.bat)
; would overwrite the up-to-date ones we ship deliberately.
Source: ".next\standalone\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.sql,*.log,server.log,dev_server.log,.env,setup_mysql_service.bat,uninstall_mysql_service.bat,start_server.bat,run_migration.bat,init_database.js,migrate.js"
; Explicit node_modules copy — the wildcard above does NOT reliably recurse into
; node_modules, which left the install without next/dist/server/next.js and broke
; server startup. This dedicated entry guarantees the full traced node_modules ships.
Source: ".next\standalone\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
; Full 'next' package from dev node_modules — the standalone trace OMITS turbopack
; runtime files (e.g. next\dist\compiled\next-server\app-route-turbo.runtime.prod.js)
; that every API route loads at request time. Without this, routes 500 with
; "Cannot find module ...app-route-turbo.runtime.prod.js". Overlaying the complete
; package fills those gaps.
Source: "node_modules\next\*"; DestDir: "{app}\node_modules\next"; Flags: ignoreversion recursesubdirs createallsubdirs
; node-cron's standalone trace only captures package.json (its CJS entry is
; resolved dynamically), which silently breaks the backup scheduler on installs.
; Overlay the full package the same way as 'next' above.
Source: "node_modules\node-cron\*"; DestDir: "{app}\node_modules\node-cron"; Flags: ignoreversion recursesubdirs createallsubdirs
; Runtime deps of 'next' that the standalone trace OMITS from node_modules.
; The traced next/dist/shared/lib/constants.js requires @swc/helpers, next
; loads @next/env, and server rendering requires react — but none get bundled
; into .next/standalone/node_modules. On the client (no repo node_modules to
; fall back to) the server crashes at startup with "Cannot find module
; '@swc/helpers/_/_interop_require_default'" (then @next/env, then react), so
; it never binds port 3000 and Electron shows "server failed to respond".
; Ship each as a sibling, same overlay pattern as 'next' above.
Source: "node_modules\@swc\helpers\*"; DestDir: "{app}\node_modules\@swc\helpers"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\@next\env\*"; DestDir: "{app}\node_modules\@next\env"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\react\*"; DestDir: "{app}\node_modules\react"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: ".next\static\*"; DestDir: "{app}\.next\static"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs

; -- Migration toolkit: lives in the updater subfolder of {app}, kept apart from the app's node_modules --
; Runs scripts/migrations/*.ts via the bundled node.exe after the schema is in
; place: on an update it applies whatever is new; on a fresh install it brings
; the verdix_install.sql snapshot (which goes stale) up to date. Same file set
; as updater.iss - keep the two in sync. See run_update.bat.
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


[Icons]
Name: "{autoprograms}\Vendix POS"; Filename: "{app}\{#AppExeName}"; Parameters: "--route=/pos --role=""POS Terminal"""; IconFilename: "{app}\public\verdix_logo.ico"
Name: "{autodesktop}\Vendix POS"; Filename: "{app}\{#AppExeName}"; Parameters: "--route=/pos --role=""POS Terminal"""; IconFilename: "{app}\public\verdix_logo.ico"
Name: "{userstartup}\Vendix POS"; Filename: "{app}\{#AppExeName}"; Parameters: "--route=/pos --role=""POS Terminal"""; IconFilename: "{app}\public\verdix_logo.ico"
; Launch the server at boot through wscript + the hidden VBS wrapper so no
; console window appears (start_server.bat directly would flash a cmd window
; even with runminimized). wscript is the default, no-console host for .vbs.
Name: "{commonstartup}\Vendix Server"; Filename: "wscript.exe"; Parameters: """{app}\start_server_hidden.vbs"""


[Run]
; Install VC++ runtime first — bundled mysqld.exe depends on it.
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "Installing runtime components..."; Flags: waituntilterminated; Check: not IsUpgrade
; Sets up bundled MySQL as a Windows service, creates the DB, applies schema + admin.
; On an update the service/DB already exist, so it only makes sure MySQL is running.
Filename: "{app}\setup_mysql_service.bat"; Flags: runhidden waituntilterminated; StatusMsg: "Setting up database..."
; Applies pending migrations (update) / brings the bundled schema current (fresh).
Filename: "{app}\run_update.bat"; Flags: runhidden waituntilterminated; StatusMsg: "Applying database updates..."
Filename: "{app}\{#AppExeName}"; Flags: nowait skipifsilent

[UninstallRun]
Filename: "{app}\uninstall_mysql_service.bat"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveMySQLService"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{commonappdata}\Verdix\mysql-data"

[Code]
// True only for a real update: Vendix is already installed in the chosen
// directory AND its MySQL service is registered. Leftover app files from a
// failed or cancelled earlier install (no service) must NOT count, or the
// installer would skip MySQL setup and leave the PC without a database.
function IsUpgrade: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\{#AppExeName}')) and
            FileExists(ExpandConstant('{app}\.env')) and
            RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\VerdixMySQL');
end;

// The bundled MySQL files are copied on a fresh install, and also on an update
// if they are somehow missing. On a normal update they are skipped: the
// running service holds them locked (jemalloc.dll etc.) and they never change.
function NeedMySqlFiles: Boolean;
begin
  Result := (not IsUpgrade) or
            (not FileExists(ExpandConstant('{app}\mysql\bin\mysqld.exe')));
end;

// Runs BEFORE [Files] copies anything. On an update, release locks on
// verdix.exe / server.js / DLLs so the overwrite neither fails nor leaves a
// half-updated install. Neither the MySQL service nor mysqld.exe is touched.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  NodeExePath: String;
  PsCommand: String;
begin
  if IsUpgrade then
  begin
    Exec('taskkill.exe', '/F /IM verdix.exe /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    // node.exe is a generic name - kill only the copy bundled at {app}\node.exe,
    // matched by its exact executable path.
    NodeExePath := ExpandConstant('{app}\node.exe');
    PsCommand := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter ''Name=\"node.exe\"'' | ' +
      'Where-Object { $_.ExecutablePath -eq ''' + NodeExePath + ''' } | ' +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"';
    Exec('powershell.exe', PsCommand, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    // A killed process can hold file handles briefly (AV scan, deferred cleanup).
    Sleep(2000);
  end;
  Result := '';
end;
