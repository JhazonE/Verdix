# Railway Deployment Guide for verdix Server

Kini nga giya mag-tudlo kanimo kung unsaon pag-deploy sa verdix Central Server sa Railway para sa cloud access ug syncing.

## Mga Kinahanglanon (Prerequisites)
1.  **GitHub Account** - Kinahanglan naka-upload ang imong source code sa usa ka GitHub repository.
2.  **Railway Account** - Paghimo ug account sa [railway.app](https://railway.app).
3.  **Database Backup** - I-export ang imong working database ngadto sa usa ka `.sql` file.

---

## Mga Lakang sa Pag-deploy

### Lakang 1: Paghimo ug Project sa Railway
1.  Log in sa Railway.
2.  I-click ang **New Project** -> **Deploy from GitHub repo**.
3.  Pilia ang imong `verdix` repository.
4.  I-click ang **Deploy Now**.

### Lakang 2: Pag-dugang ug MySQL Database
1.  Sa imong project dashboard sa Railway, i-click ang **New** -> **Database** -> **Add MySQL**.
2.  Mag-himo ang Railway ug bag-ong MySQL service.

### Lakang 3: Pag-set sa Environment Variables
1.  I-click ang imong **Web service** (katong gikan sa GitHub).
2.  Adto sa **Variables** tab.
3.  I-dugang kini nga mga variables (Para awtomatiko nga makuha ang data gikan sa MySQL service, gamita kini nga format):
    *   `DB_HOST`: `${{MySQL.MYSQLHOST}}`
    *   `DB_PORT`: `${{MySQL.MYSQLPORT}}`
    *   `DB_USER`: `${{MySQL.MYSQLUSER}}`
    *   `DB_PASSWORD`: `${{MySQL.MYSQLPASSWORD}}`
    *   `DB_NAME`: `${{MySQL.MYSQLDATABASE}}`
    *   `DB_SSL`: `true`  ← kinahanglan sa Railway MySQL proxy (TLS)
    *   `PORT`: `3000`
4.  I-dugang usab kini — **importante kaayo**:
    *   `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`: usa ka fixed nga 32-byte base64 nga key

    Himua ang key gamit kini:
    ```bash
    node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    ```

    **Ngano kinahanglan ni:** ang Server Action IDs gikan mismo niini nga key.
    Kung wala ni gi-set, random ang key kada build — lahi ang action IDs sa
    matag deploy ug sa matag replica, mao nga motungha ang error nga
    `Failed to find Server Action "..."` ug dili mo-load ang app. Na-verify ni:
    duha ka build nga parehas ang key = parehas ang 84 ka action IDs; kung
    walay key = walay bisan usa nga managsama.

    I-set ni **kausa ra** ug ayaw na usba. Kung usbon nimo, mapakyas ang mga
    page nga na-load na sa mga user hangtod mo-refresh sila.

### Lakang 4: Pag-import sa Database Schema
1.  I-click ang **MySQL** service sa Railway dashboard.
2.  Adto sa **Connect** tab para makuha ang connection details (Host, User, Password, Port).
3.  Gamit ang Database Tool (sama sa DBeaver, MySQL Workbench, or HeidiSQL) sa imong computer, i-connect kini sa Railway MySQL gamit ang nakuha nga details.
4.  I-run ang imong gi-export nga `.sql` file para ma-create ang mga tables sa Railway database.

### Lakang 5: Pag-kuha sa Public URL
1.  Inig human ug build (gamit ang atong `Dockerfile`), i-click ang imong Web service.
2.  Adto sa **Settings** tab.
3.  Sa parting **Public Networking**, i-click ang **Generate Domain** para makakuha ka ug public URL (pananglitan: `https://verdix.up.railway.app`).

---

## Pag-connect sa Local POS padulong sa Railway

Human nimo ma-deploy sa Railway, i-connect na nato ang imong mga Local POS:

1.  I-open ang Local POS application (Electron or browser localhost).
2.  Adto sa **Settings** -> **External API** (or open `http://localhost:3000/settings/external-api`).
3.  Ibutang ang imong Railway Public URL sa field nga **API Endpoint** (Siguroha nga naay `/api` sa tumoy kung gikinahanglan sa imong server logic, pananglitan: `https://verdix.up.railway.app/api`).
4.  I-set ang status to **Enabled** ug i-save!

*Ang Sync Worker maga-padala na ug data padulong sa imong Railway server matag 2 ka minuto.*
