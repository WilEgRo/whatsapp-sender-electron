const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');

// Setup minimal DOM mock if not already present
if (typeof global.document === 'undefined') {
  global.document = {
    getElementById: (id) => ({
      id,
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false
      },
      setAttribute: () => {},
      getAttribute: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      value: '',
      textContent: '',
      innerHTML: '',
      disabled: false
    }),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  };
}

const WhatsAppService = require('../src/main/services/whatsapp-service');
const { registerIpcHandlers } = require('../src/main/ipc/handlers');
const { SessionController } = require('../src/features/session/presentation/session-controller');

// ============================================================================
// CASO A & B: RECUPERACIÓN DE ESTADO MEDIANTE HANDSHAKE (LATE RENDERER & RELOAD)
// ============================================================================

test('Caso A: WhatsApp ya autenticado y listo -> Renderer inicializa después -> recupera estado vía handshake', async () => {
  // Simular WhatsAppService ya listo
  const service = new WhatsAppService();
  service.isReady = true;
  service.isAuthenticated = true;
  service.sessionState = 'ready';
  service.groups = [{ id: 'g1@g.us', name: 'Grupo VIP' }];

  const status = service.getSessionStatus();
  assert.equal(status.isReady, true);
  assert.equal(status.status, 'ready');
  assert.equal(status.groupsCount, 1);

  // Simular SessionController inicializándose después
  let hiddenQrCalled = false;
  let statusCaptured = '';
  const mockUi = {
    updateStatus: (msg, st) => { statusCaptured = `${msg}:${st}`; },
    hideQr: () => { hiddenQrCalled = true; },
    showSessionLoading: () => {},
    updateSessionLoadingStatus: () => {}
  };

  const mockIpcClient = {
    invoke: async (channel) => {
      if (channel === 'get-whatsapp-session-state') {
        return { success: true, state: service.getSessionStatus() };
      }
      return null;
    }
  };

  const ctrl = new SessionController({ ui: mockUi, ipcClient: mockIpcClient });
  await ctrl.syncSessionState();

  assert.equal(ctrl.isReady, true);
  assert.equal(hiddenQrCalled, true, 'Debe desbloquear la UI inmediatamente si WhatsApp ya está listo');
  assert.equal(statusCaptured, 'WhatsApp conectado:ready');
});

test('Caso B: Force Reload conceptual -> nuevo controller -> recupera estado y evita bloqueo', async () => {
  // Estado previo en Main: WhatsApp conectado y en sync secundaria
  const service = new WhatsAppService();
  service.isReady = true;
  service.isAuthenticated = true;
  service.sessionState = 'ready';
  service.isSyncingGroups = false;
  service.groups = [{ id: 'g1@g.us', name: 'Grupo A' }, { id: 'g2@g.us', name: 'Grupo B' }];

  // Simular recarga: se destruye el controller viejo y se crea uno nuevo
  let modalClosed = false;
  const mockUi = {
    updateStatus: () => {},
    hideQr: () => { modalClosed = true; },
    showSessionLoading: () => {},
    updateSessionLoadingStatus: () => {}
  };

  const mockIpcClient = {
    invoke: async (channel) => {
      if (channel === 'get-whatsapp-session-state') {
        return { success: true, state: service.getSessionStatus() };
      }
      return null;
    }
  };

  const newController = new SessionController({ ui: mockUi, ipcClient: mockIpcClient });
  assert.equal(newController.isReady, false, 'Inicia en falso antes del handshake');

  // El nuevo controller sincroniza estado inmediatamente
  await newController.syncSessionState();

  assert.equal(newController.isReady, true, 'Debe adoptar isReady=true del handshake');
  assert.equal(modalClosed, true, 'El modal de carga debe cerrarse de inmediato tras reload');
});

// ============================================================================
// CASO C: TRANSICIÓN CONSISTENTE AUTHENTICATED -> READY -> GROUPS SYNC
// ============================================================================

test('Caso C: WhatsAppService desacopla evento ready de sincronización secundaria de grupos', async () => {
  const service = new WhatsAppService();
  let readyEmitted = false;
  let loadGroupsStarted = false;

  // Mock del cliente WhatsApp-web.js
  const mockClient = new EventEmitter();
  mockClient.initialize = () => {};
  service.createClient = () => mockClient;
  service.patchSendSeen = async () => {};

  // Reemplazar loadGroups para verificar que no bloquea la emisión de ready
  service.loadGroups = async () => {
    loadGroupsStarted = true;
    // Simula una sincronización larga de 10 segundos
    await new Promise((r) => setTimeout(r, 50));
    service.emit('groups-sync-status', { state: 'completed', total: 10 });
  };

  service.on('ready', () => {
    readyEmitted = true;
  });

  service.start();

  // 1. Simular carga
  mockClient.emit('loading_screen', 99, 'WhatsApp');
  assert.equal(service.sessionState, 'loading');
  assert.equal(service.lastLoadingPercent, 99);

  // 2. Simular autenticación
  mockClient.emit('authenticated');
  assert.equal(service.isAuthenticated, true);
  assert.equal(service.sessionState, 'authenticated');

  // 3. Simular evento ready del cliente de WhatsApp Web
  mockClient.emit('ready');
  await new Promise((r) => setTimeout(r, 10));

  // Debe emitirse ready INMEDIATAMENTE sin esperar a que loadGroups termine (loadGroups toma 50ms)
  assert.equal(service.isReady, true);
  assert.equal(service.sessionState, 'ready');
  assert.equal(readyEmitted, true, 'El evento ready debe emitirse de inmediato');
  assert.equal(loadGroupsStarted, true, 'loadGroups debe haberse iniciado en segundo plano');
});

// ============================================================================
// CASO D: RENDERER-READY NO ENVÍA DESCONEXIÓN PREMATURA DURANTE STARTUP
// ============================================================================

test('Caso D: canal renderer-ready responde con snapshot y NO envía whatsapp-disconnected si está iniciando', async () => {
  const service = new WhatsAppService();
  service.sessionState = 'loading';
  service.lastLoadingPercent = 95;
  service.lastLoadingMessage = 'Descargando mensajes';

  let sentChannel = null;
  let sentPayload = null;
  const mockIpcMain = new EventEmitter();
  mockIpcMain.handle = () => {};

  const mockMainWindow = {
    webContents: {
      send: (ch, data) => {
        sentChannel = ch;
        sentPayload = data;
      }
    }
  };

  registerIpcHandlers({
    ipcMain: mockIpcMain,
    dialog: {},
    getMainWindow: () => mockMainWindow,
    getWhatsAppService: () => service,
    getScheduledMessageService: () => null
  });

  // Disparar renderer-ready mientras WhatsApp está cargando (95%)
  mockIpcMain.emit('renderer-ready');

  assert.equal(sentChannel, 'whatsapp-loading-screen', 'Debe enviar whatsapp-loading-screen');
  assert.equal(sentPayload.percent, 95);
  assert.notEqual(sentChannel, 'whatsapp-disconnected', 'NO debe enviar whatsapp-disconnected');
});

// ============================================================================
// CASO E: START() IDEMPOTENTE EVITA MÚLTIPLES INICIALIZACIONES
// ============================================================================

test('Caso E: start() llamado dos veces es idempotente y no crea múltiples clientes', () => {
  const service = new WhatsAppService();
  let createdCount = 0;

  service.createClient = () => {
    createdCount++;
    const mock = new EventEmitter();
    mock.initialize = () => {};
    return mock;
  };

  service.start();
  assert.equal(createdCount, 1);
  assert.equal(service.isStarting, true);

  // Segunda llamada mientras está iniciando
  service.start();
  assert.equal(createdCount, 1, 'No debe crear un segundo cliente si ya está iniciando');

  // Tercera llamada una vez listo
  service.isReady = true;
  service.start();
  assert.equal(createdCount, 1, 'No debe crear un segundo cliente si ya está listo');
});

// ============================================================================
// CASO F: BINDIPCEVENTS IDEMPOTENTE EVITA DUPLICACIÓN DE LISTENERS
// ============================================================================

test('Caso F: bindIpcEvents es idempotente y evita registrar listeners duplicados', () => {
  const listenerCounts = {};
  const mockIpcClient = {
    on: (evt) => {
      listenerCounts[evt] = (listenerCounts[evt] || 0) + 1;
    }
  };

  const ctrl = new SessionController({ ipcClient: mockIpcClient });
  ctrl.bindIpcEvents();
  ctrl.bindIpcEvents();
  ctrl.bindIpcEvents();

  Object.entries(listenerCounts).forEach(([evt, count]) => {
    assert.equal(count, 1, `Evento '${evt}' solo debe registrarse 1 vez`);
  });
});

// ============================================================================
// CASO G: CLOSE() LIBERA RECURSOS Y PROCESOS DE PUPPETEER SIN BLOQUEOS
// ============================================================================

test('Caso G: close() destruye el cliente y apaga flags de forma segura', async () => {
  const service = new WhatsAppService();
  let destroyed = false;
  let browserKilled = false;

  service.client = {
    destroy: async () => { destroyed = true; },
    pupBrowser: {
      process: () => ({
        killed: false,
        kill: () => { browserKilled = true; }
      })
    }
  };
  service.isReady = true;
  service.isAuthenticated = true;
  service.sessionState = 'ready';

  await service.close();

  assert.equal(destroyed, true, 'Debe invocar client.destroy()');
  assert.equal(service.client, null, 'Debe limpiar la referencia a client');
  assert.equal(service.isReady, false, 'isReady debe ser false');
  assert.equal(service.isAuthenticated, false, 'isAuthenticated debe ser false');
  assert.equal(service.sessionState, 'disconnected', 'sessionState debe ser disconnected');
});
