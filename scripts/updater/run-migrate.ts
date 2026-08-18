// Dedicated entrypoint for the update installer (VendixUpdater.iss).
//
// Not `npm run migrate` (scripts/migrations/index.ts) directly: importing
// lib/mysql.ts pulls in lib/init-scheduler.ts as a side effect, which starts
// node-cron jobs that keep the event loop alive forever — fine for the app
// server, but it means the plain migration CLI never exits on its own. An
// unattended installer .bat waiting on that would hang indefinitely. This
// wrapper runs the same migrateUp() and then force-exits once it resolves.
//
// This file lives under {app}\updater (its own node_modules/tsconfig.json,
// kept separate from the app's real node_modules — see run_update.bat), but
// the real .env is one level up at {app}\.env. lib/mysql.ts's own
// dotenv.config() resolves relative to process.cwd(), which run_update.bat
// deliberately sets to {app}\updater (tsx's tsconfig-paths resolution for
// the @/* aliases used throughout lib/ needs cwd there, not {app}). So load
// the real .env explicitly here, first — dotenv.config() defaults to
// non-destructive (default `override: false`), so lib/mysql.ts's later
// no-args call just no-ops for keys already set here.
//
// migrations/index (and lib/mysql.ts transitively) is loaded via require(),
// not a static import: static imports are hoisted and run before this file's
// own top-level code, which would call lib/mysql.ts's dotenv.config() (cwd-
// relative, finding nothing useful) before the explicit call below ever
// executes — and since dotenv doesn't override already-set keys, that first,
// wrong call would win. require() below runs strictly after line 22.
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { migrateUp } = require('../migrations/index') as typeof import('../migrations/index');

migrateUp()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('❌ Update migration failed:', error);
    process.exit(1);
  });
