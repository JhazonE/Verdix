# License Server → Standalone Repo Separation

**Date:** 2026-07-24
**Status:** Approved (design)

## Purpose

Move the license management server out of the POS monorepo (`d:\VERDIX_POS\Verdix_POS\license-server\`, which currently shares the POS repo's `package.json`, `node_modules`, TypeScript config, and `lib/`) into its own standalone git repository at `d:\VERDIX_POS\verdix-license-server\`.

Today the license server "has its own folder" but is not truly independent:

- It has **no** `package.json` / `node_modules` / `tsconfig.json` of its own — it borrows the POS root's.
- Its scripts live in the POS root `package.json` as `license:*` and `cloud:provision`.
- Its `.ts` files import shared crypto from the POS repo: `../lib/licensing/core` and `../lib/crypto/aes-gcm`.
- Its Docker image (`Dockerfile.license-server`) does `COPY . .` — copying the **entire POS repo** just to run one server file.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Shared `lib/licensing` code | **Duplicate** — copy into the new repo; POS keeps its own copy |
| Git history | **Fresh start** — new repo, single initial commit |
| POS repo cleanup | **Remove** license-server files after the new repo is verified working |
| New repo location | `d:\VERDIX_POS\verdix-license-server\` (sibling of the POS repo) |
| Internal layout | `src/` for TS sources; shared crypto under `src/licensing/` |

### Why duplicate (not shared npm package)

The shared crypto core (`lib/licensing/core.ts`, ~4.8KB) is the Ed25519 signing/verification contract — it changes only on an algorithm or key-format change, which is rare. A shared npm package would add a registry/versioning/publish workflow for a tiny, stable body of code used by exactly two consumers. That's YAGNI. Duplication's only risk (key-format drift) is mitigated by a "keep in sync" comment in both copies; the key **pair** itself is never duplicated (private key stays with the server; POS embeds only the public key).

## Architecture — new repo

```
d:\VERDIX_POS\verdix-license-server\
├── .git/                      (fresh init, one initial commit)
├── .gitignore                 (keys/, node_modules, .env, dist)
├── package.json               (own: tsx, typescript, bcryptjs, dotenv, mysql2)
├── tsconfig.json              (own)
├── Dockerfile                 (from Dockerfile.license-server)
├── railway.json               (from root railway.json — dockerfilePath: "Dockerfile")
├── .env.example               (LICENSE_DB_*, LICENSE_ADMIN_SECRET, LICENSE_UI_PORT)
├── README.md
├── keys/                      (gitignored — COPIED private key, never committed)
├── public/                    (dashboard UI, from license-server/public/)
└── src/
    ├── server.ts service.ts auth.ts cache.ts db.ts schema.ts
    │   keygen.ts offline-cli.ts provision-cloud.ts reset-admin.ts
    │   seed-admin.ts keys.ts cloud-config-crypto.ts
    └── licensing/             (COPIED from POS)
        ├── core.ts            (from lib/licensing/core.ts — shared crypto)
        ├── verify.ts machine.ts public-key.ts
        └── crypto/aes-gcm.ts  (from lib/crypto/aes-gcm.ts)
```

### Import rewrites

In the copied license-server sources:

- `../lib/licensing/core` → `./licensing/core`
- `../lib/crypto/aes-gcm` → `./licensing/crypto/aes-gcm`

The `lib/licensing/*` files themselves have no cross-`lib` imports (only Node built-ins: `crypto`, `fs`, `path`, `os`, `child_process`), so they copy cleanly with no further rewrites.

### package.json scripts (new repo)

```json
{
  "keygen":          "tsx src/keygen.ts",
  "new":             "tsx src/offline-cli.ts",
  "migrate":         "tsx src/schema.ts",
  "seed-admin":      "tsx src/seed-admin.ts",
  "reset-admin":     "tsx src/reset-admin.ts",
  "server":          "tsx src/server.ts",
  "provision-cloud": "tsx src/provision-cloud.ts"
}
```

Dependencies: `bcryptjs`, `dotenv`, `mysql2`. Dev: `tsx`, `typescript`, `@types/*`.

## Files to copy (exhaustive)

From `license-server/` → `src/`: server.ts, service.ts, auth.ts, cache.ts, db.ts, schema.ts, keygen.ts, offline-cli.ts, provision-cloud.ts, reset-admin.ts, seed-admin.ts, keys.ts, cloud-config-crypto.ts.
From `license-server/`: README.md, public/, keys/ (private key — copy, don't regenerate).
From POS `lib/`: `lib/licensing/{core,verify,machine,public-key}.ts` → `src/licensing/`; `lib/crypto/aes-gcm.ts` → `src/licensing/crypto/aes-gcm.ts`.
From POS root: `Dockerfile.license-server` → `Dockerfile`; `railway.json` → `railway.json`.

## POS repo cleanup (after new repo verified)

**Remove:**
- `license-server/` folder
- `Dockerfile.license-server`
- `railway.json` (the license config)
- Root `package.json` scripts: `license:keygen`, `license:new`, `license:migrate`, `license:seed-admin`, `license:reset-admin`, `license:server`, `cloud:provision`

**Keep (POS still verifies licenses):**
- `lib/licensing/` — used by 5 POS API routes: `app/api/license/{activate,activate-online,deactivate,heartbeat,status}/route.ts`
- `lib/crypto/aes-gcm.ts`

**Railway note (see railway-deploy-config memory):** the POS Railway service is config-as-code pointed at `railway.pos.json` (the root `railway.json` points at `Dockerfile.license-server`, i.e. the license image). Safe default: delete `railway.json` + `Dockerfile.license-server` and **leave `railway.pos.json` as-is** — the POS deploy keeps working because its service references `railway.pos.json`. Renaming `railway.pos.json` → `railway.json` is optional cleanup that requires re-checking the Railway dashboard service setting first; not done automatically.

## Verification (BEFORE removing the POS copy)

1. New repo: `npm install`.
2. Copy the **existing** `keys/` (private key) from `license-server/keys/` — do NOT run keygen fresh. A new key pair would invalidate every previously issued license (POS embeds the old public key).
3. `npm run server` → starts on port 4100, dashboard reachable.
4. `npm run new -- --product-key VRDX-… --machine "…"` → produces a signed license token.
5. POS repo after cleanup: `npm run typecheck` passes (no dangling imports to `license-server/` or removed scripts).

## Data flow (unchanged)

Runtime relationship is HTTP-only and unaffected by the repo split:

POS `POST /api/license/activate-online` → license server (:4100) signs with the private key → POS verifies with its embedded public key.

No shared build/code at runtime — only a copied, stable crypto contract on each side.

## Out of scope

- Preserving git history (fresh start chosen).
- Converting shared crypto into a published npm package.
- Any change to the license signing/verification algorithm or key format.
- Renaming `railway.pos.json` in the POS repo (optional, manual).
