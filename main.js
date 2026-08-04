const { app, BrowserWindow, shell, ipcMain, screen, session } = require('electron');
const path = require('path');
const printerSdk = require('./printer-sdk');
const epsonSdk = require('./epson-sdk');

// Performance flags — set before app is ready
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

// Single instance lock — prevent duplicate windows
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Port for the bundled Next.js server. Deliberately high and uncommon: 3000 is
// taken by the dev server and 8888 by the Apache in UniServer/WAMP stacks (e.g.
// Cashier V3.0), which the POS would otherwise mistake for its own server.
// Must stay in sync with PORT in start_server.bat and NEXT_PUBLIC_API_BASE_URL.
//
// Unpackaged runs (electron-only/electron-dev) never spawn their own server —
// `appRoot` below is derived from process.resourcesPath, which only points at
// the project root once packaged, and server.js doesn't exist pre-`next build`
// anyway. So in dev we just connect to the `npm run dev` server on port 3000
// instead, and skip the spawn/health-poll-to-47821 path entirely.
const isDev = !app.isPackaged;
const SERVER_PORT = isDev ? 3000 : 47821;
const SERVER_ORIGIN = `http://localhost:${SERVER_PORT}`;

let serverProcess;
let splashWindow;
let logStream;
let customerDisplayWindow = null;

function createSplashScreen() {
  const { BrowserWindow } = require('electron');
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
    }
  });

  const splashHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          margin: 0;
          background: #1e1e2e;
          color: #cdd6f4;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          border-radius: 12px;
          overflow: hidden;
          border: 1px solid #313244;
        }
        .title {
          font-size: 28px;
          font-weight: bold;
          margin-bottom: 8px;
          color: #f5c2e7;
          letter-spacing: 1px;
        }
        .subtitle {
          font-size: 14px;
          color: #a6adc8;
          margin-bottom: 24px;
        }
        .spinner {
          border: 4px solid #313244;
          border-top: 4px solid #f5c2e7;
          border-radius: 50%;
          width: 36px;
          height: 36px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="title">Vendix</div>
      <div class="subtitle">Starting background services...</div>
      <div class="spinner"></div>
    </body>
    </html>
  `;

  splashWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(splashHtml));
}

function loadWindowState(stateKey) {
  const fs = require('fs');
  const statePath = path.join(app.getPath('userData'), `window-state-${stateKey}.json`);
  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch (_) {}
  return null;
}

function saveWindowState(win, stateKey) {
  const fs = require('fs');
  const statePath = path.join(app.getPath('userData'), `window-state-${stateKey}.json`);
  if (!win.isMinimized() && !win.isFullScreen()) {
    try {
      fs.writeFileSync(statePath, JSON.stringify(win.getBounds()), 'utf8');
    } catch (_) {}
  }
}

function createWindow() {
  // Parse command line arguments
  const args = process.argv;
  let startRoute = '/pos';
  let roleName = 'POS Terminal';

  args.forEach(arg => {
    if (arg.startsWith('--route=')) startRoute = arg.split('=')[1];
    if (arg.startsWith('--role=')) roleName = arg.split('=')[1];
  });

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.vendix.pos');
  }

  const isAdmin = roleName === 'Admin Dashboard' || startRoute.includes('dashboard');
  const stateKey = isAdmin ? 'admin' : 'pos';
  const savedState = isAdmin ? loadWindowState(stateKey) : null;

  const win = new BrowserWindow({
    width: savedState?.width ?? 1200,
    height: savedState?.height ?? 800,
    x: savedState?.x,
    y: savedState?.y,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [isAdmin ? '--is-admin=true' : '--is-admin=false'],
      backgroundThrottling: false,
      spellcheck: false,
    },
    title: `Vendix - ${roleName}`,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'public', 'verdix_logo.png'),
    fullscreen: !isAdmin,
    frame: isAdmin,
    resizable: true,
    show: false, // show after ready-to-show to avoid blank flash
  });

  win.once('ready-to-show', () => win.show());

  if (isAdmin) {
    if (!savedState) win.maximize();
    win.on('close', () => saveWindowState(win, stateKey));
  }

  win.setIcon(path.join(__dirname, 'public', 'verdix_logo.png'));

  const startUrl = `${SERVER_ORIGIN}${startRoute}`;
  win.loadURL(startUrl);

  // Retry loading if it fails (e.g. server not ready yet)
  win.webContents.on('did-fail-load', () => {
    console.log('Failed to load, retrying in 2 seconds...');
    setTimeout(() => {
      win.loadURL(startUrl);
    }, 2000);
  });

  // PREVENT navigating away from the app
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== 'localhost') {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch (e) {
      // Ignored
    }
  });

  // Also handle links that try to open new windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== 'localhost') {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    } catch (e) {
      // Ignored
    }
    return { action: 'allow' };
  });

  // win.webContents.openDevTools(); // Force open for debugging

  win.on('closed', () => {
    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
      customerDisplayWindow.close();
    }
    app.quit();
  });
}

// Window Controls IPC Handlers
ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isFullScreen()) {
      win.setFullScreen(false);
    } else if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.handle('window:open-customer-display', () => {
  // If already open, just focus it
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    customerDisplayWindow.focus();
    return { success: true, action: 'focused' };
  }

  const allDisplays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const secondDisplay = allDisplays.find(d => d.id !== primaryDisplay.id);
  const targetDisplay = secondDisplay || primaryDisplay;
  const { x, y, width, height } = targetDisplay.bounds;

  customerDisplayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    fullscreen: true,
    icon: path.join(__dirname, 'public', 'verdix_logo.png'),
    title: 'Customer Display',
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
    show: false,
  });

  customerDisplayWindow.setIcon(path.join(__dirname, 'public', 'verdix_logo.png'));
  customerDisplayWindow.loadURL(`${SERVER_ORIGIN}/pos/customer-display`);
  customerDisplayWindow.once('ready-to-show', () => customerDisplayWindow.show());
  customerDisplayWindow.on('closed', () => { customerDisplayWindow = null; });

  return { success: true, action: 'opened', hasSecondDisplay: !!secondDisplay };
});

ipcMain.handle('window:close-customer-display', () => {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    customerDisplayWindow.close();
  }
  return { success: true };
});

// Cache IPC Handler — clears the Chromium HTTP/asset cache only.
// This does NOT touch the MySQL database or localStorage (handled in the renderer).
ipcMain.handle('cache:clear', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const ses = win ? win.webContents.session : session.defaultSession;
    // Clear HTTP cache (cached responses, JS/CSS assets)
    await ses.clearCache();
    // Clear in-memory code/render caches without removing cookies or storage
    await ses.clearCodeCaches({ urls: [] });
    return { success: true };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
});

// Printer SDK IPC Handlers
ipcMain.handle('printer:list', async () => {
  return await printerSdk.listPrinters();
});

ipcMain.handle('printer:connect', async (event, portSetting) => {
  return await printerSdk.connectPrinter(portSetting);
});

ipcMain.handle('printer:print', async (event, buffer) => {
  return await printerSdk.printData(buffer);
});

ipcMain.handle('printer:disconnect', async (event) => {
  return await printerSdk.disconnectPrinter();
});

// Epson SDK IPC Handlers
ipcMain.handle('epson-printer:list', async () => {
  return await epsonSdk.listPrinters();
});

ipcMain.handle('epson-printer:connect', async (event, portSetting) => {
  return await epsonSdk.connectPrinter(portSetting);
});

ipcMain.handle('epson-printer:print', async (event, buffer) => {
  return await epsonSdk.printData(buffer);
});

ipcMain.handle('epson-printer:disconnect', async (event) => {
  return await epsonSdk.disconnectPrinter();
});

ipcMain.handle('epson-printer:cut', async () => {
  return epsonSdk.cutPaper();
});

ipcMain.handle('epson-printer:open-drawer', async () => {
  return epsonSdk.openCashDrawer();
});

app.whenReady().then(async () => {
  const { dialog } = require('electron');
  
  createSplashScreen();
  
  // Database setup removed as per user request to use working DB
  
  const http = require('http');
  const fs = require('fs');
  const logPath = path.join(app.getPath('userData'), 'server.log');
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  
  logStream.write(`\n\n--- App started at ${new Date().toISOString()} ---\n`);

  // Resolves true only when OUR server answers. Any HTTP 200 used to count,
  // which meant an unrelated web server on the port (Apache from a UniServer/WAMP
  // install) looked like a healthy POS: we skipped spawning and then loaded the
  // wrong app. Checking the /api/health signature makes the answer unambiguous.
  function checkServerRunning() {
    return new Promise((resolve) => {
      const req = http.get(`${SERVER_ORIGIN}/api/health`, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body).service === 'verdix-pos');
          } catch {
            resolve(false);
          }
        });
      });
      req.on('error', () => {
        resolve(false);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  try {
    const isRunning = await checkServerRunning();
    
    if (isRunning) {
      logStream.write(`Server is already running on port ${SERVER_PORT}. Skipping spawn.\n`);
      console.log(`Server is already running on port ${SERVER_PORT}. Skipping spawn.`);
    } else if (isDev) {
      // Nothing to spawn: server.js only exists after `next build`. The dev
      // server has to already be running (run `npm run dev` first, or use
      // `npm run electron-dev` which starts it for you).
      logStream.write('Dev server not detected on port 3000. Waiting for `npm run dev`...\n');
      console.log('Dev server not detected on port 3000. Waiting for `npm run dev`...');
    } else {
      logStream.write('Server not detected. Spawning Next.js server...\n');
      console.log('Server not detected. Spawning Next.js server...');

      const { spawn } = require('child_process');
      const dotenv = require('dotenv');
      const appRoot = path.join(process.resourcesPath, '..');
      const envPath = path.join(appRoot, '.env');
      let envConfig = {};

      if (fs.existsSync(envPath)) {
        envConfig = dotenv.parse(fs.readFileSync(envPath));
        logStream.write(`Loaded .env from: ${envPath}\n`);
      } else {
        logStream.write(`.env file not found at: ${envPath}\n`);
      }

      // Prefer the bundled node.exe (shipped next to the app) so the server
      // does not depend on a system-wide Node.js installation.
      const bundledNode = path.join(appRoot, 'node.exe');
      const nodeBin = fs.existsSync(bundledNode) ? bundledNode : 'node';

      // Detach stdio to the log file. We must NOT pipe to the parent's
      // streams: a pipe keeps a live handle back to Electron, which would
      // prevent the server from outliving the app.
      const outFd = fs.openSync(logPath, 'a');
      const errFd = fs.openSync(logPath, 'a');

      // detached + unref() breaks the server out of Electron's Windows job
      // object, so closing the app no longer kills the Next.js server.
      serverProcess = spawn(nodeBin, ['server.js'], {
        cwd: appRoot,
        env: {
          ...process.env,
          ...envConfig,
          // server.js binds process.env.PORT || 3000. Everything on this side
          // talks to SERVER_PORT, so without this the server listens on 3000 and
          // the poll below times out at 30s even though startup succeeded.
          PORT: String(SERVER_PORT),
          // Where the Next.js server writes BIR e-journal .txt files (per date/terminal).
          VERDIX_EJOURNAL_DIR: path.join(app.getPath('userData'), 'EJournals'),
        },
        detached: true,
        windowsHide: true,
        stdio: ['ignore', outFd, errFd],
      });

      serverProcess.on('error', (err) => {
        dialog.showErrorBox('Server Error', 'Failed to start Next.js server. Please ensure Node.js/NPM is installed.\n\nError: ' + err.message);
      });

      // Allow the Electron process to exit independently of the server.
      serverProcess.unref();
    }

    // Wait for the server — poll every 300ms, up to 30s total
    logStream.write('Waiting for server to become responsive...\n');
    let attempts = 0;
    let ready = false;
    while (attempts < 100) {
      ready = await checkServerRunning();
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 300));
      attempts++;
    }

    if (ready) {
      logStream.write('Server is ready. Creating window.\n');
      createWindow();
      if (splashWindow) splashWindow.close();
    } else {
      logStream.write('Server failed to respond within timeout.\n');
      if (splashWindow) splashWindow.close();
      dialog.showErrorBox(
        'Server Error',
        isDev
          ? 'No dev server responded on http://localhost:3000 within 30 seconds. Run `npm run dev` in another terminal first, or use `npm run electron-dev`.'
          : 'Next.js server failed to respond within 30 seconds. Please check server.log.'
      );
    }
  } catch (serverErr) {
    dialog.showErrorBox('Server Error', 'Exception while checking/starting server: ' + serverErr.message);
  }
});

// Focus existing window when a second instance is launched
app.on('second-instance', () => {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    const win = wins[0];
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (logStream) logStream.end();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Server persists after quit as per user request

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
