# Cloud Licensing — Pre-Merge Test Plan

Checklist para sa pag-verify sa cloud licensing sa usa ka **tinuod nga Railway deployment**
sa dili pa i-merge ang `feat/cloud-licensing`.

Ang tanan nga lohika na-verify na pinaagi sa unit tests ug pag-execute sa resolution logic.
Ang wala pa ma-test kay ang paglihok niini sa sulod sa usa ka tinuod nga container — lahi
ang filesystem, ang network, ug ang startup sequence didto.

---

## Ang usa ka pangutana nga gitubag niini

**Mo-take over ba gyud ang `license_state` nga row gikan sa `LICENSE_KEY` env var?**

Kung oo — molihok ang monthly renewal ug ang revocation kill switch.
Kung dili — walay molihok, ug dili angay i-merge.

Ang **Test 2** ang tinuod nga tubag niini nga pangutana. Ang uban kay sumpay.

---

## Order sa deployment: POS una, license server ikaduha

I-deploy ang POS branch una. **Dili nimo kinahanglan i-push ang live license server
aron makasugod sa pagtest.**

Ngano nga luwas: ang gi-deploy karon nga license server mobasa ra ug `licenseId` ug
`machineId` gikan sa request body (`src/server.ts`, `/api/validate` handler) — gi-ignore
niya ang wala niya mailhi nga `terminalCount`. Mao nga ang bag-ong POS makig-heartbeat sa
kasamtangan nga server nga walay problema; ang `seat-exceeded` lang ang mag-hulat sa
Task 6 nga deploy.

Ang Tests 1–5 walay risgo sa imong naglihok nga mga customer. Ang Test 6 ra ang motandog
sa live nga server.

---

## Una: ayaw i-test batok sa production license DB

Ang `.env` sa `../verdix-license-server` naka-punto sa **`metro.proxy.rlwy.net`** —
ang live nga production license database, diin naa ang 8 ka tinuod nga lisensya sa
imong mga customer. Ang pag-test batok niini mo-himo ug tinuod nga license rows ug
mo-mutate sa tinuod nga `activations` nga lamesa.

Adunay staging setup na. Gikan sa `../verdix-license-server`:

```bash
./staging.sh server       # dashboard sa localhost:4100, lokal nga DB
./staging.sh reset        # i-wipe ug i-rebuild ang staging DB
./staging.sh psql         # mysql shell sa staging DB
```

Login: `admin` / `staging-only-pw`. Ang script mo-override sa `LICENSE_DB_*` pinaagi
sa environment (dili niya hilabtan ang `.env`), ug mo-refuse modagan kung ang DB name
dili "staging" — mao nga dili kini makasulod sa production bisan masayop.

Para sa Tests 1–5, i-set ang `LICENSE_SERVER_URL` sa POS ngadto sa
`http://localhost:4100` aron maka-heartbeat kini sa staging server.

---

## Pag-andam — usa ka throwaway nga customer

> **Ayaw gamita ang license sa tinuod nga customer para niini nga pagtest.**

- [ ] **1. Himo ug bag-ong customer + license sa dashboard**
  - `max_activations` = **1** — aron dali ma-trigger ang seat guard
  - Expiry = **3 ka adlaw gikan karon** — aron dali ma-test ang renewal

- [ ] **2. Provision ang database niya** (gikan sa `../verdix-license-server`)
  ```bash
  npm run provision-cloud -- --license VRDX-XXXX-XXXX-XXXX
  ```

- [ ] **3. Mint ang hosted token** (gikan sa `../verdix-license-server`)
  ```bash
  npm run new -- --product-key VRDX-XXXX-XXXX-XXXX --web --edition web
  ```

  > **Ayaw gamita ang `--adhoc`.** Ang `validateHeartbeat` mo-return ug `invalid` kung
  > walay DB row para sa license (`src/service.ts`), ug ang tibuok feature naka-depende
  > sa heartbeat. Kinahanglan gyud ang dashboard-issued nga license nga naa'y DB row.

- [ ] **4. Himo ug bag-ong Railway service** gikan sa `feat/cloud-licensing` nga branch

  > **Lit-ag 1:** i-set ang config-as-code path ngadto sa **`railway.pos.json`**.
  > Ang Railway mangita ug `railway.json` by default, nga wala sa POS repo.
  >
  > **Lit-ag 2:** i-set ang `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` ngadto sa usa ka
  > **fixed** nga value. Kung wala, mag-usab kini kada build ug mo-fail ang app sa
  > `Failed to find Server Action`. Himoa kausa:
  > ```bash
  > node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  > ```

- [ ] **5. I-set ang environment variables**
  ```
  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME   # ang gi-provision nga DB
  DB_SSL=true
  LICENSE_KEY=<ang bag-ong mint nga token>
  LICENSE_SERVER_URL=https://vendix-license-server-production.up.railway.app
  ```

---

## Test 1 — Bootstrap handoff

I-load ang app. Kinahanglan mo-load nga licensed (walay activation wall).

Dayon i-query ang DB sa customer:
```sql
SELECT signed_license IS NOT NULL AS has_token, last_validated_at, seat_limit
FROM license_state WHERE id = 1;
```

- [ ] Naa'y row nga `id = 1`
- [ ] `has_token = 1`
- [ ] Bag-o ang `last_validated_at` (sulod sa milabay nga oras)

**Kung walay row, HUNONG.** Ang tanan nga sunod nga test naka-depende niini. Susiha ang
container logs para sa heartbeat errors ug ang `LICENSE_SERVER_URL`.

---

## Test 2 — Ang tinuod nga pruweba: tangtanga ang `LICENSE_KEY`

Sa Railway → Variables, **tangtanga ang `LICENSE_KEY`**, dayon i-redeploy.

- [ ] Licensed gihapon ang app human sa redeploy

Kini ang tibuok punto sa buhat. Sa daan nga code, ma-lock kini dayon kay wala nay
mabasa. Nag-prove sad kini nga **mo-survive sa redeploy ang DB row** — nga mao ang
guba sukad pa sa sinugdanan (ephemeral ang container filesystem).

> Human niini nga test, pwede nimo ibalik ang `LICENSE_KEY` o pasagdan — dili na kini
> gamiton pag-usab gawas kung mawala ang DB row.

---

## Test 3 — Renewal, walay Railway nga usab

Sa dashboard, i-extend ang expiry ug 1 ka tuig. Hulata ang sunod nga heartbeat
(≤1 oras sa cloud), o i-restart ang container aron pugson dayon.

- [ ] Nausab ang expiry nga makita sa app
- [ ] **Wala gyud nimo gihilabtan ang Railway variables**

Kini ang nag-prove sa pangako sa runbook: ang monthly renewal kay usa ka dashboard
action lang, dili pag-re-paste ug token.

---

## Test 4 — Revocation (ang kill switch)

Sa dashboard, i-revoke ang license. Hulata ang heartbeat (≤1 oras).

- [ ] Ma-lock ang app
- [ ] Ang mensahe nag-ingon nga **revoked** — DILI "cannot reach the license server"
- [ ] ```sql
      SELECT lock_reason FROM license_state WHERE id = 1;   -- 'revoked'
      ```

Ang duha ka mensahe kinahanglan lahi gyud, aron mahibaw-an sa suporta kung
revocation ba o connectivity nga problema.

Dayon i-un-revoke:
- [ ] Mobalik nga molihok human sa sunod nga heartbeat
- [ ] `lock_reason` mibalik sa `NULL`

---

## Test 5 — Seat guard

Ang `max_activations = 1` ug naa nay 1 ka aktibo nga terminal. Sulayi pagdugang ug ikaduha.

- [ ] Ma-refuse ang pagdugang (403) nga may mensahe nga naghisgot sa count ug limit
- [ ] **Padayon nga molihok ang checkout** ug ang naa nang terminal

> **Kung ma-lock ang checkout, kini usa ka Critical nga bug — ayaw i-merge.**
> Ang pag-lock sa usa ka nagbayad nga tindahan tungod sa seat count kay dili dawaton.

> Ang tinuod nga `seat-exceeded` gikan sa server dili pa mo-fire hangtod sa Test 6.
> Kini nga test nag-verify sa client-side guard lang.

---

## Test 6 — Human ma-deploy ang license server

Kini ra nga lakang ang motandog sa **live** nga license server. Buhata kini kung
nagsalig na ka sa Tests 1–5.

I-push ug i-deploy ang commit `e1713ab` gikan sa `../verdix-license-server`.

- [ ] **Ang naglihok nga desktop installations padayon gihapon** ← ang backward-compat
      nga risgo. Ang `terminalCount` optional, mao nga ang mga daan nga client dili
      unta maapektuhan — pero i-verify gyud sa usa ka tinuod nga desktop.
- [ ] Ang `seat_limit` mo-populate na sa `license_state` human sa heartbeat
- [ ] Sa over-seat nga kahimtang, mo-return ug `seat-exceeded` ang server — ug
      **padayon gihapon ang checkout**

---

## Grace window — ayaw i-test sa tinuod

Ang 7-adlaw nga grace kinahanglan ug 7 ka adlaw nga outage. **Ayaw i-block ang license
server sa usa ka live nga sistema aron lang matest.** I-simulate:

```sql
UPDATE license_state SET last_validated_at = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE id = 1;
```

- [ ] I-reload — kinahanglan mo-lock nga may mensahe nga **"cannot reach the license server"**
- [ ] Ibalik: `UPDATE license_state SET last_validated_at = NOW() WHERE id = 1;`

---

## Rollback

Kung mapakyas ang bisan unsa:

1. Ibalik ang `LICENSE_KEY` env var
2. I-redeploy ang daan nga branch

Ang `license_state` nga lamesa kay additive — walay laing lamesa nga giusab, ug ang
daan nga code mag-ignore lang niini. Walay data nga mawala.

---

## Nahibal-an nga limitasyon

- **Walay in-app banner** nga mo-warning sa admin nga sobra na sa seat count. Ang refusal
  sa pagdugang ug terminal ra ang signal. Follow-up work kini (tan-awa ang
  `CLOUD-LICENSING-RUNBOOK.md` §9).
- Ang hosted token kay **bearer credential** — bisan kinsa nga mo-paste niini sa laing
  host kay licensed hangtod ma-revoke. Revocation ra ang kill switch.

---

**Related:** [CLOUD-LICENSING-RUNBOOK.md](CLOUD-LICENSING-RUNBOOK.md) — ang per-customer
nga onboarding procedure.
