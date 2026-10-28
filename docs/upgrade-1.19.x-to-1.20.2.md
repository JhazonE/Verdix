# Upgrading an old install (1.19.8) to 1.20.2

Written for whoever runs the update on the customer's machine.

This is a **406-commit, 33-migration** jump (migrations 114 → 146). The updater
handles the sequence itself — there is no need to step through 1.19.9, 1.19.10
and so on — but two properties of the update path make an unprepared run
dangerous:

1. **Migration 119 deliberately aborts** when two `products` rows share a
   barcode. On this schema that is normal data (one `products` row per
   warehouse, and `TransferStockService` copies the barcode onto the sibling),
   so any store that has ever transferred stock will hit it.
2. **There is no way back.** `run_update.bat` overwrites the app's files
   *before* migrations run, `migrateUp()` has no outer transaction and records
   each migration as it goes, and migration 121 drops `product_price_levels`
   with a `down()` that explicitly refuses to rebuild it. A mid-way failure
   leaves the new build on a half-migrated database.

So the order below is not optional: **check, back up, then update.**

---

## 0. Multi-terminal stores: read this first

The usual Verdix store is **one PC running MySQL plus one or two terminals
pointed at its IP** — several machines, but ONE database. That changes the
procedure in three ways:

**Use the UPDATER, not the full installer, on the terminals.** `setup.iss`
runs `setup_mysql_service.bat`, which registers a local `VerdixMySQL` service,
creates a local `verdix` database and seeds it from `verdix_install.sql`. On a
terminal whose `.env` points at the server PC that is wrong: the machine ends
up with a second, empty database alongside the real one, and which one the app
talks to then depends entirely on its `.env`. `updater.iss` runs
`run_update.bat` alone and states in its own header that the MySQL service and
data directory "are never part of this installer at all" — which is what a
terminal needs. (`.env` is `onlyifdoesntexist` in both, so an existing machine
keeps its DB host either way.)

Note the updater's one assumption: it expects Vendix already installed in the
same `{autopf}\Vendix` directory with the same bundled `node.exe`, because it
patches files in place rather than laying down a new install. That holds for
any machine already running 1.19.8, which is exactly our case. It does **not**
require a local MySQL service — it never looks for one — so it is safe on a
terminal that has none.

**Run the terminals ONE AT A TIME.** `migrateUp()` takes no lock: two
terminals started together both read an empty pending set and run the same
migrations at once. Re-running a migration *sequentially* is safe — each one
guards itself with an INFORMATION_SCHEMA check, and `migrations.name` is
UNIQUE — but running two *concurrently* races those guards, and migration 121
can drop `product_price_levels` while the other process is still reading it.
Wait for each machine to finish before starting the next.

**Migrations only really run once.** The first machine applies all 33; every
machine after it finds them recorded and skips to the end. That is expected —
the later runs exist to update the app files on that machine, not the database.

So for a three-machine store:

| Order | Machine | What to run | Why |
|---|---|---|---|
| 1 | Server PC (has MySQL) | Updater | Applies the migrations, while the terminals are closed |
| 2 | Terminal A | Updater | Updates app files; finds no pending migrations |
| 3 | Terminal B | Updater | Same |

### Which machine is the server?

If you are not certain, check each machine's `.env` — it is the only thing that
decides. On each PC:

```bat
findstr /B "DB_HOST DB_NAME" "C:\Program Files\Vendix\.env"
sc query VerdixMySQL
```

- `DB_HOST=127.0.0.1` (or `localhost`) **and** the service exists → this is the
  server PC. Back this one up, and update it first.
- `DB_HOST=192.168.x.x` → a terminal. Note the IP: it must point at the server
  PC above.
- `DB_HOST=127.0.0.1` on **more than one** machine → they are NOT sharing a
  database, whatever was intended. Each has its own data, and each needs its
  own backup and its own pre-flight check. Stop and sort that out first,
  because sales rung up on those machines have been landing in different
  databases.

Close Verdix on every machine before starting, and keep it closed until the
whole store is done — a 1.19.8 terminal talking to a 1.20.2 database is reading
a schema its code does not know about.

---

## 1. Pre-flight check

From the repo, pointed at the customer's database (`.env` must have their
`DB_*` values):

```bash
npm run upgrade:preflight
```

This checks the DATABASE, so on a multi-terminal store you run it **once**,
not per machine — any machine that can reach the server's MySQL will do. Point
`.env` at the server PC (`DB_HOST=<server IP>`) if you are running it from your
own laptop.

It reports four things:

| Section | What it tells you |
|---|---|
| Migration state | How many migrations are pending, and their names in run order |
| Duplicate barcodes | Splits them into safe **warehouse siblings** and genuine **conflicts** |
| Table sizes | Row counts for the four tables migration 135 rewrites — sets your downtime |
| Behaviour changes | Whether *this* install loses sidebar pages, browser POS, or gets permissions merged |

The verdict line at the bottom is the gate:

- `CLEAR TO UPDATE: N migration(s) will run.` → proceed to step 2.
- `DO NOT UPDATE YET.` → there are genuine barcode conflicts. Go to step 1a.

### 1a. Resolving duplicate barcodes

The script already separated the two cases, because they need different
handling.

**Warehouse siblings** — the same item on another shelf. Safe to clear
automatically:

```bash
npm run upgrade:preflight -- --fix
```

This NULLs `products.barcode` on the sibling rows, keeping it on one row per
group. That is the same resolution `TransferStockService` already applies when
it inserts a sibling's base selling unit, and migration 126 later backfills a
base-unit barcode from `products.sku`, so no scan code is lost. Re-run without
`--fix` to confirm the groups are clear.

**Genuine conflicts** — different items sharing a barcode, or rows with no
warehouse. `--fix` will not touch these, and it should not: deciding which item
owns a barcode is a stock-keeping decision. Fix them by hand in the Products
list, then re-run the check.

---

## 2. Back up the database

Not optional, for the reasons at the top of this file. There is ONE database, so
this is one dump — taken on the **server PC**, with Verdix closed everywhere.

The installer bundles `mysqldump.exe` under the install directory (named
`Vendix`, not Verdix — that is the Inno `AppName`), so you do not need MySQL on
your PATH:

```bat
cd "C:\Program Files\Vendix"
mysql\bin\mysqldump.exe -u root -prootpassword --single-transaction ^
  --routines --triggers verdix > %USERPROFILE%\Desktop\verdix_pre_1.20.2.sql
```

**Verify the dump restores** into a scratch database before you continue:

```bat
mysql\bin\mysql.exe -u root -prootpassword -e "CREATE DATABASE verdix_restore_test"
mysql\bin\mysql.exe -u root -prootpassword verdix_restore_test < %USERPROFILE%\Desktop\verdix_pre_1.20.2.sql
mysql\bin\mysql.exe -u root -prootpassword -e "SELECT COUNT(*) FROM verdix_restore_test.products"
```

If that count matches the live `products` table, the dump is good. Drop the
scratch database afterwards. An unverified dump is not a backup.

Copy the .sql file off the machine as well — a backup that only exists on the
PC you are about to modify is not much of one.

---

## 3. Run the updater

Build it (version comes from `package.json`):

```bash
npm run build:updater     # produces VendixUpdater_1.20.2.exe
```

Copy `VendixUpdater_1.20.2.exe` to each machine, then run it **off-peak**, in
the order from section 0: **server PC first, then one terminal at a time.**
Migration 135 runs four `ALTER TABLE` statements that lock each table while
they rewrite it; the pre-flight check's row counts tell you how long that takes.

After each machine, check its log:

```
C:\ProgramData\Verdix\update.log
```

On the **server PC** look for `🎉 Migration complete! Executed 33 migration(s)`
(the exact count is whatever the pre-flight check reported as pending).

On each **terminal** afterwards, the same line should read `Executed 0
migration(s)`, with the migrations above it listed as `⏭️ already executed`.
That is the correct result — it confirms the terminal is pointed at the same
database the server PC just migrated. If a terminal instead reports a non-zero
count, stop: it is talking to a DIFFERENT database (its own local MySQL,
usually because the full installer was used on it rather than the updater).
Fix its `.env` before going further.

If any machine logs `FAIL: migration step returned 1`, stop — do not start the
app anywhere. Restore the step-2 dump and work out which migration threw before
trying again.

---

## 4. Post-upgrade

Three migrations change behaviour the store will notice immediately. The
pre-flight check told you which apply here; this is how to undo them.

| What changed | Fix |
|---|---|
| **Repackaging, Approvals Board, Workflow Settings gone** from the sidebar (migration 146, only on installs that never configured Page Visibility) | Developer Options → Page Visibility → re-enable |
| **POS no longer opens in a plain browser** (migration 137). Electron terminals unaffected | Developer Options → enable browser POS |
| **Per-user permissions merged into user types** (migration 130). Additive, but a grant to one user now reaches everyone sharing that type | Review Manage User Types |

Those settings live in the shared database, so you change them **once** and
every terminal picks them up.

Then verify, in this order:

1. Log in **on each machine**. This is per-machine, not shared: a desktop
   licence is bound to its own hardware fingerprint (`license.dat`, checked by
   `isMachineMatch` in `lib/licensing/verify.ts`), so one terminal activating
   says nothing about the others. A seat count over the limit is not a blocker
   — the licence server keeps signing rather than withholding a token, so
   checkout is never refused on seats (`lib/licensing/heartbeat-decide.ts`).
2. **Ring up one sale** on the server PC. The selling-units chain (118–121,
   126, 131–133) is the most invasive part of this upgrade; a sale exercises
   base-unit resolution, price-level lookup and batch costing in one go.
3. Open Sales Transactions **on a different terminal** and confirm that sale
   appears with the right total. This is the real multi-terminal check — it
   proves that terminal is reading the same migrated database, not a local one.
4. Ring up a second sale from a terminal, and confirm its SI number follows the
   first without gapping or repeating. BIR numbering is sequential and legally
   significant, and the terminals draw from the same counter.
5. Check a product's Selling Units tab — each product should have exactly one
   base unit, and existing prices should be attached to it.
6. Scan a barcode that the pre-flight `--fix` cleared, if it reported any.
   It should still resolve: the barcode stayed on the default warehouse's row,
   and migration 126 backfills the sibling's base unit from its SKU.

---

## What the migrations actually do

For reference, the substantive groups in 114 → 146:

- **Selling units (118–121, 126, 131–133)** — the big one. Products gain
  per-unit selling definitions (Piece / Box / Case) with their own barcodes,
  costs and prices. Price levels move from per-product to per-selling-unit;
  existing prices are preserved on each product's base unit. Well guarded:
  idempotent, `INSERT IGNORE`/`NOT EXISTS`, migrates data before dropping.
- **Price tiers (128, 134)** — `min_quantity` dropped then restored, so a
  price-level row can carry a quantity break.
- **VAT on documents (123–125)** — adds VAT and cost-at-sale columns to
  invoices and orders.
- **POS auth toggles (136–139, 142)** — browser-POS switch, X/Z-reading and
  discount credential prompts, price-level picker.
- **Quantity precision (135)** — line-item quantities go INT → DECIMAL(15,4) so
  fractional sales (kg, metres) stop being silently rounded. Lossless.
- **Permissions (130)** — one-time merge of per-user grants into user types.
- **Live refresh (145)** — `live_events` table backing cross-terminal refresh.
