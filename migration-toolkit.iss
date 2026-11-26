; Migration toolkit shared by setup.iss and preflight.iss (#include'd into
; their [Files] sections, so it holds Source lines only). Lives in the
; updater subfolder of {app}, kept apart from the app's node_modules: the
; bundled node.exe runs scripts\migrations (run_update.bat) and the upgrade
; pre-flight check (preflight.bat) from here via tsx. One list, so the
; pre-flight kit can never test against a different toolkit than Setup ships.
; updater.iss still carries its own copy of this list.
Source: "lib\*"; DestDir: "{app}\updater\lib"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\migrations\*"; DestDir: "{app}\updater\scripts\migrations"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\updater\*"; DestDir: "{app}\updater\scripts\updater"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "scripts\upgrade\*"; DestDir: "{app}\updater\scripts\upgrade"; Flags: ignoreversion recursesubdirs createallsubdirs
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
