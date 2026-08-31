const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');

// Deshabilitar aceleración por hardware para evitar colapsos del proceso GPU en Windows
app.disableHardwareAcceleration();

const path = require('path');
const WhatsAppService = require('./services/whatsapp-service');
const { registerIpcHandlers } = require('./ipc/handlers');
const ScheduledMessageService = require('./services/scheduled-message-service');
const { startExpressServer } = require('./http/express-server');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;
let whatsappService = null;
let scheduledMessageService = null;
let expressServer = null;

if (isDev) {
  require('electron-reload')(path.join(__dirname, '..'), {
    electron: path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron'),
    hardResetMethod: 'exit'
  });
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || !mainWindow.webContents) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    startWhatsAppService();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (!whatsappService) {
      return;
    }

    const sessionSnapshot = whatsappService.getSessionStatus();
    sendToRenderer('whatsapp-session-snapshot', sessionSnapshot);

    if (sessionSnapshot.isReady) {
      sendToRenderer('whatsapp-ready');
      if (Array.isArray(sessionSnapshot.groups) && sessionSnapshot.groups.length > 0) {
        sendToRenderer('groups-loaded', sessionSnapshot.groups);
      }
      if (!sessionSnapshot.isSyncingGroups) {
        sendToRenderer('groups-sync-status', {
          state: 'completed',
          total: sessionSnapshot.groupsCount
        });
      }
      return;
    }

    if (sessionSnapshot.status === 'qr' && sessionSnapshot.qrCode) {
      sendToRenderer('whatsapp-qr', sessionSnapshot.qrCode);
      return;
    }

    if (sessionSnapshot.status === 'loading') {
      sendToRenderer('whatsapp-loading-screen', {
        percent: sessionSnapshot.loadingPercent,
        message: sessionSnapshot.loadingMessage
      });
      return;
    }

    if (sessionSnapshot.isAuthenticated) {
      sendToRenderer('whatsapp-authenticated');
      return;
    }

    sendToRenderer('server-ready');
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    if (whatsappService) {
      whatsappService.close();
    }
    mainWindow = null;
  });
}

function startWhatsAppService() {
  whatsappService = new WhatsAppService();

  scheduledMessageService = new ScheduledMessageService({
    repository: whatsappService.messageLogRepository,
    whatsappService
  });
  scheduledMessageService.start();

  if (!expressServer) {
    expressServer = startExpressServer({
      scheduledMessageService,
      whatsappService,
      port: 3210
    });
  }

  sendToRenderer('server-ready');

  whatsappService.on('qr', (qr) => {
    sendToRenderer('whatsapp-qr', qr);
  });

  whatsappService.on('authenticated', () => {
    sendToRenderer('whatsapp-authenticated');
  });

  whatsappService.on('loading_screen', (payload) => {
    sendToRenderer('whatsapp-loading-screen', payload);
  });

  whatsappService.on('ready', () => {
    sendToRenderer('whatsapp-ready');
    sendToRenderer('groups-loaded', whatsappService.groups);
  });

  whatsappService.on('disconnected', (reason) => {
    sendToRenderer('whatsapp-disconnected', reason);
  });

  whatsappService.on('groups-loaded', (groups) => {
    sendToRenderer('groups-loaded', groups);
  });

  whatsappService.on('groups-sync-status', (payload) => {
    sendToRenderer('groups-sync-status', payload);
  });

  whatsappService.start();
}

function createAppMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Salir',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ]);

  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createMainWindow();
  createAppMenu();

  registerIpcHandlers({
    ipcMain,
    dialog,
    getMainWindow: () => mainWindow,
    getWhatsAppService: () => whatsappService,
    getScheduledMessageService: () => scheduledMessageService
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

let isQuitting = false;

async function cleanupAndQuit() {
  if (isQuitting) return;
  isQuitting = true;

  if (scheduledMessageService) {
    scheduledMessageService.stop();
  }

  if (expressServer) {
    try {
      expressServer.close();
    } catch (_) {}
    expressServer = null;
  }

  if (whatsappService) {
    try {
      await whatsappService.close();
    } catch (error) {
      console.warn('[Main] Error cerrando WhatsAppService:', error);
    }
    whatsappService = null;
  }

  app.quit();
}

app.on('before-quit', (event) => {
  if (!isQuitting && whatsappService) {
    event.preventDefault();
    cleanupAndQuit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupAndQuit();
  }
});

process.on('exit', () => {
  if (whatsappService && whatsappService.client && whatsappService.client.pupBrowser) {
    try {
      const proc = typeof whatsappService.client.pupBrowser.process === 'function'
        ? whatsappService.client.pupBrowser.process()
        : null;
      if (proc && !proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch (_) {}
  }
});
