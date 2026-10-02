@echo off
setlocal EnableDelayedExpansion

set "MYSQL_DIR=%~dp0mysql"
set "MYSQL_BIN=%MYSQL_DIR%\bin"
set "DATA_DIR=C:\ProgramData\Verdix\mysql-data"
set "LOG_FILE=C:\ProgramData\Verdix\mysql-setup.log"
:: my.ini lives in ProgramData (always writable) — NOT under Program Files, whose
:: path may contain "(x86)" parentheses that break parenthesized echo blocks.
set "INI_FILE=C:\ProgramData\Verdix\my.ini"

echo [%date% %time%] Starting MySQL setup... >> "%LOG_FILE%"

:: ── Already installed? Just start and exit ────────────────────────────────────
sc query VerdixMySQL >nul 2>&1
if %errorlevel% equ 0 (
    echo [%date% %time%] VerdixMySQL service already exists, ensuring it is running. >> "%LOG_FILE%"
    net start VerdixMySQL >> "%LOG_FILE%" 2>&1
    echo [ok] MySQL service already installed.
    goto :run_migrations
)

:: ── First-time install ────────────────────────────────────────────────────────

:: Create data directory
if not exist "%DATA_DIR%" (
    mkdir "%DATA_DIR%"
    echo [%date% %time%] Created data directory: %DATA_DIR% >> "%LOG_FILE%"
)

:: Write my.ini using forward slashes (MySQL requirement on Windows).
:: Each line is redirected individually — NOT wrapped in a ( ) block — so the
:: "(x86)" in the basedir path can never be mistaken for a block terminator.
set "INI_DATADIR=%DATA_DIR:\=/%"
set "INI_BASEDIR=%MYSQL_DIR:\=/%"

>"%INI_FILE%"  echo [mysqld]
>>"%INI_FILE%" echo basedir=%INI_BASEDIR%
>>"%INI_FILE%" echo datadir=%INI_DATADIR%
>>"%INI_FILE%" echo port=3306
>>"%INI_FILE%" echo character-set-server=utf8mb4
>>"%INI_FILE%" echo collation-server=utf8mb4_0900_ai_ci
>>"%INI_FILE%" echo default-authentication-plugin=mysql_native_password
>>"%INI_FILE%" echo [client]
>>"%INI_FILE%" echo port=3306
>>"%INI_FILE%" echo default-character-set=utf8mb4
echo [%date% %time%] Wrote my.ini to %INI_FILE% >> "%LOG_FILE%"

:: Initialize the data directory (creates root@localhost with no password)
echo Initializing MySQL data directory...
echo [%date% %time%] Running mysqld --initialize-insecure (basedir=%MYSQL_DIR%) >> "%LOG_FILE%"
"%MYSQL_BIN%\mysqld.exe" --defaults-file="%INI_FILE%" --initialize-insecure --console >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] mysqld --initialize-insecure failed. Check %LOG_FILE%
    echo [%date% %time%] FAIL: initialize-insecure returned %errorlevel% >> "%LOG_FILE%"
    exit /b 1
)
echo [%date% %time%] Data directory initialized. >> "%LOG_FILE%"

:: Install as Windows service
"%MYSQL_BIN%\mysqld.exe" --install VerdixMySQL --defaults-file="%INI_FILE%"
if %errorlevel% neq 0 (
    echo [FAIL] mysqld --install failed. Check %LOG_FILE%
    echo [%date% %time%] FAIL: install service returned %errorlevel% >> "%LOG_FILE%"
    exit /b 1
)
echo [%date% %time%] Service installed. >> "%LOG_FILE%"

:: Start the service
net start VerdixMySQL
if %errorlevel% neq 0 (
    echo [FAIL] Could not start VerdixMySQL service. Check %LOG_FILE%
    echo [%date% %time%] FAIL: net start returned %errorlevel% >> "%LOG_FILE%"
    exit /b 1
)
echo [%date% %time%] Service started. >> "%LOG_FILE%"

:: Wait for MySQL to fully initialize (first boot can be slow)
echo Waiting for MySQL to be ready...
timeout /t 10 /nobreak >nul

:: Set root password to match .env (DB_PASSWORD=rootpassword)
"%MYSQL_BIN%\mysql.exe" -u root --connect-expired-password -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'rootpassword'; FLUSH PRIVILEGES;" >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Could not set root password — MySQL may still be starting. Retrying in 10s...
    echo [%date% %time%] WARN: set password failed, retrying... >> "%LOG_FILE%"
    timeout /t 10 /nobreak >nul
    "%MYSQL_BIN%\mysql.exe" -u root --connect-expired-password -e "ALTER USER 'root'@'localhost' IDENTIFIED BY 'rootpassword'; FLUSH PRIVILEGES;" >> "%LOG_FILE%" 2>&1
)
echo [%date% %time%] Root password set. >> "%LOG_FILE%"

:run_migrations
:: ── Wait until MySQL actually answers (up to ~60s) ────────────────────────────
:: "net start" can return before the server accepts connections, and on an
:: update the service may have been stopped. Without this wait the steps below
:: (and run_update.bat's migrations) hit ECONNREFUSED on 3306.
set "TRIES=0"
:wait_mysql
"%MYSQL_BIN%\mysqladmin.exe" -u root -prootpassword ping >nul 2>&1
if %errorlevel% equ 0 goto :mysql_ready
set /a TRIES+=1
if %TRIES% geq 30 (
    echo [FAIL] MySQL is not responding on port 3306. Check %LOG_FILE%
    echo [%date% %time%] FAIL: MySQL did not respond after 60s >> "%LOG_FILE%"
    exit /b 1
)
timeout /t 2 /nobreak >nul
goto :wait_mysql
:mysql_ready
echo [%date% %time%] MySQL is accepting connections. >> "%LOG_FILE%"

:: ── Create database + apply schema/seed via bundled mysql client ──────────────
:: Uses the bundled mysql.exe (no Node/mysql2 needed). verdix_install.sql holds
:: the full 75-table structure (CREATE TABLE IF NOT EXISTS), reference data, and
:: the default admin account — so a fresh PC gets a ready-to-use database.
set "MYSQL_CLIENT=%MYSQL_BIN%\mysql.exe"

echo Creating database...
"%MYSQL_CLIENT%" -u root -prootpassword -e "CREATE DATABASE IF NOT EXISTS verdix CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;" >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] Could not create database. Check %LOG_FILE%
    echo [%date% %time%] FAIL: create database returned %errorlevel% >> "%LOG_FILE%"
    exit /b 1
)

:: Schema already applied (an update, or a re-run over an existing install)?
:: Then leave the data alone: re-importing the seed would resurrect rows the
:: store deleted and is pointless, since setup's run_update.bat applies any
:: pending migrations afterwards. The users table is the "schema applied" marker.
"%MYSQL_CLIENT%" -u root -prootpassword -N -e "SHOW TABLES FROM verdix LIKE 'users';" 2>nul | findstr /i "users" >nul
if %errorlevel% equ 0 (
    echo [%date% %time%] Database already populated, skipping verdix_install.sql. >> "%LOG_FILE%"
    echo [ok] Existing database kept.
    exit /b 0
)

echo Applying schema, reference data, and default admin...
"%MYSQL_CLIENT%" -u root -prootpassword verdix < "%~dp0verdix_install.sql" >> "%LOG_FILE%" 2>&1
if %errorlevel% neq 0 (
    echo [FAIL] Could not apply verdix_install.sql. Check %LOG_FILE%
    echo [%date% %time%] FAIL: apply verdix_install.sql returned %errorlevel% >> "%LOG_FILE%"
    exit /b 1
)

echo [%date% %time%] Setup complete. Default login: admin / admin123 >> "%LOG_FILE%"
echo [ok] Database ready. Default login -- username: admin  password: admin123
exit /b 0
