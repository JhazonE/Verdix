@echo off
setlocal EnableDelayedExpansion

set "APP_DIR=%~dp0"
set "LOG_FILE=C:\ProgramData\Verdix\update.log"

if not exist "C:\ProgramData\Verdix" mkdir "C:\ProgramData\Verdix" >nul 2>&1

echo [%date% %time%] Starting Vendix update in %APP_DIR% >> "%LOG_FILE%"

:: ── Apply any pending schema migrations ────────────────────────────────────
:: verdix.exe/server.js were already stopped by [Code]'s PrepareToInstall,
:: before [Files] even copied anything (see updater.iss) — that's what let
:: this app's files be overwritten safely. The MySQL service itself is
:: untouched — the database and its data directory are never part of this
:: update. Migrations are additive/idempotent (see
:: scripts/migrations/runner.ts): already-applied ones are skipped, so this
:: is safe to run against a database that already has live data.
echo Applying database updates...
echo [%date% %time%] Running migrations via bundled node.exe >> "%LOG_FILE%"
:: cwd must be {app}\updater — tsx resolves the @/* path aliases used
:: throughout lib/ against the nearest tsconfig.json from cwd, which lives in
:: updater\ (its own node_modules, kept separate from {app}'s real one; see
:: the comment block at the top of scripts\updater\run-migrate.ts). That
:: script loads the real {app}\.env explicitly itself, since dotenv would
:: otherwise resolve against this cwd and miss it.
pushd "%APP_DIR%updater"
"%APP_DIR%node.exe" "%APP_DIR%updater\node_modules\tsx\dist\cli.mjs" "%APP_DIR%updater\scripts\updater\run-migrate.ts" >> "%LOG_FILE%" 2>&1
set "MIGRATE_RESULT=%errorlevel%"
popd

if not "%MIGRATE_RESULT%"=="0" (
    echo [FAIL] Database update failed. Check %LOG_FILE%
    echo [%date% %time%] FAIL: migration step returned %MIGRATE_RESULT% >> "%LOG_FILE%"
    exit /b 1
)

echo [%date% %time%] Update complete. >> "%LOG_FILE%"
echo [ok] Vendix update applied successfully.
exit /b 0
