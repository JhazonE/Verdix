// Installer-side entrypoint for scripts/upgrade/preflight.ts, launched by
// preflight.bat with the bundled node.exe — no repo, no npm on the store PC.
//
// Same constraints as run-migrate.ts next to it: cwd is the updater folder
// (tsx resolves the @/* aliases in lib/ from the tsconfig.json there), so
// lib/mysql.ts's own cwd-relative dotenv.config() finds nothing useful. Load
// the store's real .env FIRST, then require() the check — a static import
// would be hoisted above this and lose the race (dotenv never overrides a key
// that is already set).
//
// Where the .env is: preflight.bat passes VERDIX_ENV_FILE. Inside an install
// that is {app}\.env; in the standalone VendixPreflight kit (run BEFORE the
// new Setup, against an old install that has no preflight of its own) it is
// the existing install's .env under Program Files. The fallback below is the
// in-install layout ({app}\updater\scripts\updater -> {app}\.env).
//
// preflight.ts reads --fix from process.argv and calls process.exit itself,
// so the cron workers lib/mysql.ts starts cannot keep this process alive.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const envFile = process.env.VERDIX_ENV_FILE || path.resolve(__dirname, '../../../.env');

if (!fs.existsSync(envFile)) {
  console.error(`Cannot find the Vendix settings file (.env) at:\n  ${envFile}`);
  console.error('Is Vendix installed on this PC? The check reads the database details from that file.');
  process.exit(2);
}

dotenv.config({ path: envFile });
console.log(`Settings: ${envFile}`);
console.log(`Database: ${process.env.DB_NAME || 'verdix'} on ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '3306'}`);

require('../upgrade/preflight');
