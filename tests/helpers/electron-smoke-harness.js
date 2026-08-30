const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('../../src/main/ipc/handlers');

app.disableHardwareAcceleration();

let win;
const consoleErrors = [];
const cspErrors = [];
const interceptedLicenseRequests = [];
let licenseRequests = 0;

app.whenReady().then(async () => {
  // Monitor all network requests for legacy 4010 or license endpoints
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || '';
    if (/localhost:4010|127\.0\.0\.1:4010|\/license\//i.test(url)) {
      licenseRequests++;
      interceptedLicenseRequests.push(url);
    }
    callback({});
  });

  win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  registerIpcHandlers({
    ipcMain,
    dialog,
    getMainWindow: () => win,
    getWhatsAppService: () => null,
    getScheduledMessageService: () => null
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (/syntaxerror/i.test(message) || /uncaught/i.test(message) || level >= 3) {
      consoleErrors.push({ level, message, line, sourceId });
    }
    if (/content security policy/i.test(message) || /violates the following/i.test(message) || /refused to apply inline style/i.test(message)) {
      cspErrors.push(message);
    }
  });

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
    process.exit(1);
  });

  await win.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  setTimeout(async () => {
    try {
      const state = await win.webContents.executeJavaScript(`
        (() => {
          return {
            hasApp: Boolean(window.app),
            hasCampaignDispatcher: Boolean(window.app && window.app.campaignDispatcher),
            hasTaskDock: Boolean(window.app && window.app.ui && window.app.ui.taskDock),
            hasAppShell: Boolean(document.querySelector('.app-shell')),
            hasDispatcher: Boolean(document.querySelector('.campaign-dispatcher')),
            hasInspector: Boolean(document.querySelector('.safety-inspector-card')),
            hasQrModal: Boolean(document.getElementById('qrModal')),
            hasLicenseModal: Boolean(document.getElementById('licenseModal')),
            hasLicensePill: Boolean(document.querySelector('.sidebar-license-pill')),
            isAppLocked: document.body.classList.contains('app-locked'),
            allPanelsInsideCanvas: (() => {
              const panels = Array.from(document.querySelectorAll('.tab-panel'));
              const canvas = document.getElementById('appCanvas');
              return panels.length >= 5 && panels.every(p => canvas && canvas.contains(p));
            })(),
            currentTitle: document.getElementById('currentSectionTitle') ? document.getElementById('currentSectionTitle').textContent : ''
          };
        })()
      `);

      console.log('SMOKE_RESULT:' + JSON.stringify({
        state,
        licenseRequests,
        interceptedLicenseRequests,
        consoleErrors,
        cspErrors
      }));

      win.destroy();
      app.quit();
    } catch (err) {
      console.error('Execution error:', err);
      process.exit(2);
    }
  }, 1500);
});
