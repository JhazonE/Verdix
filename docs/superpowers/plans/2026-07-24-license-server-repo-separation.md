# License Server Repo Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the license server out of the POS monorepo into a standalone git repo at `d:\VERDIX_POS\verdix-license-server\` with its own package.json, node_modules, tsconfig, and Docker/Railway deploy.

**Architecture:** Copy the 13 license-server `.ts` sources into `src/`, copy the shared crypto (`lib/licensing/*`, `lib/crypto/aes-gcm.ts`) into `src/licensing/`, rewrite the 4 cross-repo imports to local paths, give the repo its own package manifest and config, verify it runs and signs licenses using the **existing** key pair, then remove the license-server pieces from the POS repo (keeping `lib/licensing` for POS-side verification).

**Tech Stack:** Node 20, TypeScript, tsx, mysql2, bcryptjs, dotenv, Ed25519 (Node `crypto`).

## Global Constraints

- New repo path: `d:\VERDIX_POS\verdix-license-server\` (sibling of `d:\VERDIX_POS\Verdix_POS`).
- Shell is PowerShell primary; Bash tool available. Paths shown POSIX-style for the Bash tool.
- **Never regenerate keys.** Copy the existing `license-server/keys/{private-key.pem,public-key.pem}`. A fresh key pair invalidates every previously issued license (POS embeds the old public key).
- `keys/` is gitignored in the new repo and must NEVER be committed.
- POS repo cleanup happens ONLY after the new repo is verified working (Task 6 gates Task 7).
- Do NOT remove `lib/licensing/` or `lib/crypto/aes-gcm.ts` from the POS repo — 5 POS API routes verify licenses with them.
- Do NOT rename `railway.pos.json` in the POS repo (out of scope; manual, needs Railway dashboard check).
- Git commits end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

## File Structure (new repo)

```
d:\VERDIX_POS\verdix-license-server\
├── .git/
├── .gitignore
├── package.json
├── tsconfig.json
├── Dockerfile
├── railway.json
├── .env.example
├── README.md
├── keys/                         (gitignored; copied private+public pem)
├── public/                       (app.js, dashboard.html, login.html)
└── src/
    ├── server.ts service.ts auth.ts cache.ts db.ts schema.ts
    │   keygen.ts offline-cli.ts provision-cloud.ts reset-admin.ts
    │   seed-admin.ts keys.ts cloud-config-crypto.ts
    └── licensing/
        ├── core.ts verify.ts machine.ts public-key.ts
        └── crypto/
            └── aes-gcm.ts
```

## Cross-repo imports to rewrite (exact)

| File | Old | New |
|---|---|---|
| `src/cloud-config-crypto.ts:6` | `from '../lib/crypto/aes-gcm'` | `from './licensing/crypto/aes-gcm'` |
| `src/keygen.ts:18` | `from '../lib/licensing/core'` | `from './licensing/core'` |
| `src/offline-cli.ts:24` | `from '../lib/licensing/core'` | `from './licensing/core'` |
| `src/service.ts:15` | `from '../lib/licensing/core'` | `from './licensing/core'` |

## keys.ts path adjustment

`license-server/keys.ts` reads the private key from `process.env.LICENSE_PRIVATE_KEY` first, then falls back to `path.join(__dirname, 'keys', 'private-key.pem')`. After moving sources into `src/`, `__dirname` is `.../src`, so the fallback path must become `path.join(__dirname, '..', 'keys', 'private-key.pem')` to point at the repo-root `keys/` folder.

---

### Task 1: Scaffold the new repo (manifest, config, gitignore)

**Files:**
- Create: `d:\VERDIX_POS\verdix-license-server\package.json`
- Create: `d:\VERDIX_POS\verdix-license-server\tsconfig.json`
- Create: `d:\VERDIX_POS\verdix-license-server\.gitignore`
- Create: `d:\VERDIX_POS\verdix-license-server\.env.example`

**Interfaces:**
- Produces: an npm project whose scripts reference `src/*.ts` (used by all later tasks and by verification).

- [ ] **Step 1: Create the repo directory**

```bash
mkdir -p /d/VERDIX_POS/verdix-license-server/src/licensing/crypto
```

- [ ] **Step 2: Write package.json**

Create `d:\VERDIX_POS\verdix-license-server\package.json`:

```json
{
  "name": "verdix-license-server",
  "version": "1.0.0",
  "private": true,
  "description": "Standalone Ed25519 license management server for Verdix POS",
  "scripts": {
    "keygen": "tsx src/keygen.ts",
    "new": "tsx src/offline-cli.ts",
    "migrate": "tsx src/schema.ts",
    "seed-admin": "tsx src/seed-admin.ts",
    "reset-admin": "tsx src/reset-admin.ts",
    "server": "tsx src/server.ts",
    "provision-cloud": "tsx src/provision-cloud.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "bcryptjs": "^3.0.3",
    "dotenv": "^16.4.5",
    "mysql2": "^3.11.0"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.17.17",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

- [ ] **Step 3: Write tsconfig.json**

Create `d:\VERDIX_POS\verdix-license-server\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Write .gitignore**

Create `d:\VERDIX_POS\verdix-license-server\.gitignore`:

```
# Signing keys are secret. NEVER commit them.
keys/
node_modules/
.env
dist/
*.log
```

- [ ] **Step 5: Write .env.example**

Create `d:\VERDIX_POS\verdix-license-server\.env.example`:

```
# License DB (falls back to CLOUD_DB_* then DB_* then localhost/verdix_license)
LICENSE_DB_HOST=127.0.0.1
LICENSE_DB_PORT=3306
LICENSE_DB_USER=root
LICENSE_DB_PASSWORD=
LICENSE_DB_NAME=verdix_license
LICENSE_DB_SSL=

# HMAC secret for dashboard sessions
LICENSE_ADMIN_SECRET=change-me

# Server port (Railway sets PORT; local defaults to 4100)
LICENSE_UI_PORT=4100

# Production private key (PEM). Local dev uses keys/private-key.pem instead.
LICENSE_PRIVATE_KEY=

# Cloud provisioning (optional — used by provision-cloud)
CLOUD_PROVISION_HOST=
CLOUD_PROVISION_PORT=
CLOUD_PROVISION_USER=
CLOUD_PROVISION_PASSWORD=
CLOUD_PROVISION_REF_DB=
CLOUD_CONFIG_SECRET=
```

- [ ] **Step 6: Verify the directory tree exists**

Run: `ls -la /d/VERDIX_POS/verdix-license-server/ && ls /d/VERDIX_POS/verdix-license-server/src/licensing/crypto`
Expected: package.json, tsconfig.json, .gitignore, .env.example present; `src/licensing/crypto/` directory exists (empty).

---

### Task 2: Copy shared crypto into src/licensing/

**Files:**
- Create: `d:\VERDIX_POS\verdix-license-server\src\licensing\core.ts` (from POS `lib/licensing/core.ts`)
- Create: `d:\VERDIX_POS\verdix-license-server\src\licensing\verify.ts` (from `lib/licensing/verify.ts`)
- Create: `d:\VERDIX_POS\verdix-license-server\src\licensing\machine.ts` (from `lib/licensing/machine.ts`)
- Create: `d:\VERDIX_POS\verdix-license-server\src\licensing\public-key.ts` (from `lib/licensing/public-key.ts`)
- Create: `d:\VERDIX_POS\verdix-license-server\src\licensing\crypto\aes-gcm.ts` (from `lib/crypto/aes-gcm.ts`)

**Interfaces:**
- Produces: `core.ts` exports (`generateKeyPair`, `signLicense`/verify helpers, `LicensePayload`, `PRODUCT_ID`, `LICENSE_FORMAT_VERSION`, `HOSTED_MACHINE_ID`, `normalizeMachineId`); `crypto/aes-gcm.ts` exports (`encryptGcm`, `decryptGcm`, `deriveKey`). These are consumed by Task 3's rewritten imports.

- [ ] **Step 1: Copy the 4 licensing files**

```bash
cp /d/VERDIX_POS/Verdix_POS/lib/licensing/core.ts        /d/VERDIX_POS/verdix-license-server/src/licensing/core.ts
cp /d/VERDIX_POS/Verdix_POS/lib/licensing/verify.ts      /d/VERDIX_POS/verdix-license-server/src/licensing/verify.ts
cp /d/VERDIX_POS/Verdix_POS/lib/licensing/machine.ts     /d/VERDIX_POS/verdix-license-server/src/licensing/machine.ts
cp /d/VERDIX_POS/Verdix_POS/lib/licensing/public-key.ts  /d/VERDIX_POS/verdix-license-server/src/licensing/public-key.ts
```

- [ ] **Step 2: Copy the aes-gcm crypto file**

```bash
cp /d/VERDIX_POS/Verdix_POS/lib/crypto/aes-gcm.ts /d/VERDIX_POS/verdix-license-server/src/licensing/crypto/aes-gcm.ts
```

- [ ] **Step 3: Add a sync-warning comment to core.ts**

At the top of `d:\VERDIX_POS\verdix-license-server\src\licensing\core.ts`, add:

```typescript
// DUPLICATED from the Verdix POS repo (lib/licensing/core.ts).
// This is the Ed25519 signing/verification contract. If the key format or
// algorithm changes here, apply the identical change to lib/licensing/core.ts
// in the POS repo, or previously issued licenses will fail verification.
```

- [ ] **Step 4: Verify no cross-lib imports remain in the copied files**

Run: `grep -rnE "from ['\"]\.\./" /d/VERDIX_POS/verdix-license-server/src/licensing/`
Expected: no output (these files only use Node built-ins — `crypto`, `fs`, `path`, `os`, `child_process`).

---

### Task 3: Copy license-server sources into src/ and rewrite imports

**Files:**
- Create (copy): 13 files `src/{server,service,auth,cache,db,schema,keygen,offline-cli,provision-cloud,reset-admin,seed-admin,keys,cloud-config-crypto}.ts` from `license-server/*.ts`
- Modify: `src/cloud-config-crypto.ts`, `src/keygen.ts`, `src/offline-cli.ts`, `src/service.ts` (rewrite imports)
- Modify: `src/keys.ts` (adjust key fallback path)

**Interfaces:**
- Consumes: `./licensing/core`, `./licensing/crypto/aes-gcm` (from Task 2).
- Produces: a runnable `src/server.ts` entrypoint.

- [ ] **Step 1: Copy all 13 license-server sources**

```bash
cp /d/VERDIX_POS/Verdix_POS/license-server/{server,service,auth,cache,db,schema,keygen,offline-cli,provision-cloud,reset-admin,seed-admin,keys,cloud-config-crypto}.ts /d/VERDIX_POS/verdix-license-server/src/
```

- [ ] **Step 2: Rewrite the aes-gcm import in cloud-config-crypto.ts**

In `d:\VERDIX_POS\verdix-license-server\src\cloud-config-crypto.ts`, change:

```typescript
import { encryptGcm, decryptGcm, deriveKey } from '../lib/crypto/aes-gcm';
```
to:
```typescript
import { encryptGcm, decryptGcm, deriveKey } from './licensing/crypto/aes-gcm';
```

- [ ] **Step 3: Rewrite the core import in keygen.ts**

In `d:\VERDIX_POS\verdix-license-server\src\keygen.ts`, change `from '../lib/licensing/core'` to `from './licensing/core'`.

- [ ] **Step 4: Rewrite the core import in offline-cli.ts**

In `d:\VERDIX_POS\verdix-license-server\src\offline-cli.ts`, change `} from '../lib/licensing/core';` to `} from './licensing/core';`.

- [ ] **Step 5: Rewrite the core import in service.ts**

In `d:\VERDIX_POS\verdix-license-server\src\service.ts`, change `} from '../lib/licensing/core';` to `} from './licensing/core';`.

- [ ] **Step 6: Adjust the key fallback path in keys.ts**

In `d:\VERDIX_POS\verdix-license-server\src\keys.ts`, change:

```typescript
const filePath = path.join(__dirname, 'keys', 'private-key.pem');
```
to:
```typescript
const filePath = path.join(__dirname, '..', 'keys', 'private-key.pem');
```

(Sources now live in `src/`; the keys folder is at the repo root.)

- [ ] **Step 7: Verify no cross-repo imports remain anywhere in src/**

Run: `grep -rnE "from ['\"]\.\./lib/" /d/VERDIX_POS/verdix-license-server/src/`
Expected: no output.

---

### Task 4: Copy assets (public/, keys/) and deploy config

**Files:**
- Create: `verdix-license-server/public/{app.js,dashboard.html,login.html}` (from `license-server/public/`)
- Create: `verdix-license-server/keys/{private-key.pem,public-key.pem}` (from `license-server/keys/`)
- Create: `verdix-license-server/README.md` (from `license-server/README.md`)
- Create: `verdix-license-server/Dockerfile` (adapted from `Dockerfile.license-server`)
- Create: `verdix-license-server/railway.json` (adapted from root `railway.json`)

**Interfaces:**
- Produces: the dashboard static assets and signing key on disk; Docker/Railway build config.

- [ ] **Step 1: Copy public assets and README**

```bash
cp -r /d/VERDIX_POS/Verdix_POS/license-server/public /d/VERDIX_POS/verdix-license-server/public
cp /d/VERDIX_POS/Verdix_POS/license-server/README.md /d/VERDIX_POS/verdix-license-server/README.md
```

- [ ] **Step 2: Copy the EXISTING key pair (do not regenerate)**

```bash
cp -r /d/VERDIX_POS/Verdix_POS/license-server/keys /d/VERDIX_POS/verdix-license-server/keys
ls /d/VERDIX_POS/verdix-license-server/keys
```
Expected: `private-key.pem  public-key.pem`.

- [ ] **Step 3: Write the Dockerfile**

Create `d:\VERDIX_POS\verdix-license-server\Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production=false
COPY . .
EXPOSE 4100
CMD ["npx", "tsx", "src/server.ts"]
```

- [ ] **Step 4: Write railway.json**

Create `d:\VERDIX_POS\verdix-license-server\railway.json`:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- [ ] **Step 5: Verify the asset tree**

Run: `ls /d/VERDIX_POS/verdix-license-server/public && ls /d/VERDIX_POS/verdix-license-server/keys && ls /d/VERDIX_POS/verdix-license-server/*.json /d/VERDIX_POS/verdix-license-server/Dockerfile`
Expected: 3 public files, 2 key files, package.json + railway.json + tsconfig.json + Dockerfile present.

---

### Task 5: Install deps and typecheck the new repo

**Files:**
- Modify: creates `verdix-license-server/node_modules/`, `package-lock.json`

**Interfaces:**
- Consumes: package.json (Task 1), all src (Tasks 2-3).
- Produces: a repo that passes `tsc --noEmit`.

- [ ] **Step 1: Install dependencies**

Run (in the new repo dir): `cd /d/VERDIX_POS/verdix-license-server && npm install`
Expected: installs without errors; `node_modules/` and `package-lock.json` created.

- [ ] **Step 2: Typecheck**

Run: `cd /d/VERDIX_POS/verdix-license-server && npm run typecheck`
Expected: PASS (no errors). If errors reference `../lib/...`, an import rewrite from Task 3 was missed — fix it and re-run.

---

### Task 6: Verify the server runs and signs a license (GATE)

This task gates the POS-repo cleanup. Do not proceed to Task 7 until every step here passes.

**Files:** none (runtime verification). Requires a `.env` — copy `.env.example` to `.env` and fill `LICENSE_DB_*` for the local `verdix_license` DB.

- [ ] **Step 1: Create a local .env**

```bash
cp /d/VERDIX_POS/verdix-license-server/.env.example /d/VERDIX_POS/verdix-license-server/.env
```
Edit `.env`: set `LICENSE_DB_PASSWORD` to the local MySQL root password and `LICENSE_ADMIN_SECRET` to any non-empty value. Leave `LICENSE_PRIVATE_KEY` empty (uses `keys/private-key.pem`).

- [ ] **Step 2: Run migrations against verdix_license**

Run: `cd /d/VERDIX_POS/verdix-license-server && npm run migrate`
Expected: creates/verifies the `verdix_license` tables, exits 0.

- [ ] **Step 3: Start the server**

Run (background): `cd /d/VERDIX_POS/verdix-license-server && npm run server`
Expected: logs the dashboard listening on port 4100.

- [ ] **Step 4: Confirm the dashboard responds**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4100/login.html`
Expected: `200`.

- [ ] **Step 5: Sign an offline license with the existing key**

Run: `cd /d/VERDIX_POS/verdix-license-server && npm run new -- --product-key VRDX-TEST-TEST-TEST --machine "TEST-MACHINE"`
Expected: prints a signed license token (base64/JSON) without error, proving the copied private key and rewritten `./licensing/core` import work together.

- [ ] **Step 6: Stop the server**

Stop the background server process.

- [ ] **Step 7: Initialize git and make the first commit**

```bash
cd /d/VERDIX_POS/verdix-license-server
git init
git add .
git status --short
```
Confirm `keys/`, `node_modules/`, `.env` are NOT staged (gitignored). Then:

```bash
git commit -m "$(printf 'feat: standalone Verdix license server\n\nExtracted from the Verdix POS monorepo into its own repo with its own\npackage.json, tsconfig, and Docker/Railway deploy. Shared Ed25519 crypto\n(licensing/core, licensing/crypto/aes-gcm) is duplicated here; the POS repo\nkeeps its copy for license verification.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Remove license-server pieces from the POS repo

Only after Task 6 fully passes. Work in the POS repo (`d:\VERDIX_POS\Verdix_POS`).

**Files:**
- Delete: `license-server/` (whole folder)
- Delete: `Dockerfile.license-server`
- Delete: `railway.json`
- Modify: `package.json` (remove 7 scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: a POS repo that still typechecks and still verifies licenses via the retained `lib/licensing/`.

- [ ] **Step 1: Delete the license-server folder and its deploy files**

```bash
cd /d/VERDIX_POS/Verdix_POS
git rm -r license-server Dockerfile.license-server railway.json
```

- [ ] **Step 2: Remove the 7 license scripts from package.json**

In `d:\VERDIX_POS\Verdix_POS\package.json`, delete these script lines:

```json
"license:keygen": "tsx license-server/keygen.ts",
"license:new": "tsx license-server/offline-cli.ts",
"license:migrate": "tsx license-server/schema.ts",
"license:seed-admin": "tsx license-server/seed-admin.ts",
"license:reset-admin": "tsx license-server/reset-admin.ts",
"license:server": "tsx license-server/server.ts",
"cloud:provision": "tsx license-server/provision-cloud.ts",
```

- [ ] **Step 3: Confirm lib/licensing and lib/crypto still exist (must NOT be deleted)**

Run: `ls /d/VERDIX_POS/Verdix_POS/lib/licensing/ /d/VERDIX_POS/Verdix_POS/lib/crypto/aes-gcm.ts`
Expected: core.ts, verify.ts, machine.ts, public-key.ts, and aes-gcm.ts all present.

- [ ] **Step 4: Confirm no POS source still imports from license-server**

Run: `grep -rnE "license-server" /d/VERDIX_POS/Verdix_POS/app /d/VERDIX_POS/Verdix_POS/lib 2>/dev/null`
Expected: no output.

- [ ] **Step 5: Typecheck the POS repo**

Run: `cd /d/VERDIX_POS/Verdix_POS && npm run typecheck`
Expected: PASS. The 5 license API routes under `app/api/license/` still resolve `lib/licensing/*`.

- [ ] **Step 6: Confirm railway.pos.json is untouched**

Run: `ls /d/VERDIX_POS/Verdix_POS/railway.pos.json`
Expected: present (the POS deploy config stays).

- [ ] **Step 7: Commit the cleanup**

```bash
cd /d/VERDIX_POS/Verdix_POS
git add -A
git commit -m "$(printf 'chore(license): remove license-server, now a standalone repo\n\nThe license server moved to d:\\\\VERDIX_POS\\\\verdix-license-server. Deleted\nlicense-server/, Dockerfile.license-server, railway.json, and the license:* /\ncloud:provision scripts. lib/licensing and lib/crypto/aes-gcm stay: the POS\napp still verifies licenses with them (app/api/license/*). railway.pos.json\nleft as-is.\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review

**Spec coverage:**
- New repo scaffold (package.json/tsconfig/gitignore/.env.example) → Task 1 ✓
- Duplicate shared crypto + sync comment → Task 2 ✓
- Copy 13 sources + rewrite 4 imports + keys.ts path → Task 3 ✓
- Assets (public, keys), Dockerfile, railway.json → Task 4 ✓
- Own node_modules + typecheck → Task 5 ✓
- Verify runs/signs with existing key (gate) + fresh git init → Task 6 ✓
- POS cleanup, keep lib/licensing, keep railway.pos.json → Task 7 ✓

**Placeholder scan:** No TBD/TODO; every code step shows exact content and exact paths.

**Type consistency:** Import targets `./licensing/core` and `./licensing/crypto/aes-gcm` match the files created in Task 2. The `keys.ts` path change matches the `src/` relocation. Script names in package.json (`server`, `new`, `migrate`) match the verification commands in Task 6.
