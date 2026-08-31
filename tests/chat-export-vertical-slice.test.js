const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Setup minimal DOM mock for headless testing
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

const chatExportRules = require('../src/features/chat-export/domain/chat-export-rules');
const { resolveExportTargets, selectExportTarget } = require('../src/features/chat-export/application/manage-export-targets');
const { prepareChatExportPayload, executeChatExport } = require('../src/features/chat-export/application/prepare-chat-export');
const { ChatExportGateway } = require('../src/features/chat-export/infrastructure/chat-export-gateway');
const chatExportView = require('../src/features/chat-export/presentation/chat-export-view');
const { ChatExportController } = require('../src/features/chat-export/presentation/chat-export-controller');
const { SessionController } = require('../src/features/session/presentation/session-controller');
const AppController = require('../src/renderer/js/modules/app-controller');

// ============================================================================
// 1. DOMAIN TESTS
// ============================================================================

test('Domain 1: normalización de target produce estructura idéntica para objetos o identificadores planos', () => {
  const normalizedObj = chatExportRules.normalizeExportTarget({
    id: '59170001122@c.us',
    name: 'Juan Pérez',
    number: '59170001122'
  });
  assert.equal(normalizedObj.id, '59170001122@c.us');
  assert.equal(normalizedObj.name, 'Juan Pérez');
  assert.equal(normalizedObj.type, 'contacts');
  assert.equal(normalizedObj.identifier, '59170001122');

  const normalizedStr = chatExportRules.normalizeExportTarget('59174447830');
  assert.equal(normalizedStr.id, '59174447830');
  assert.equal(normalizedStr.name, '59174447830');
  assert.equal(normalizedStr.type, 'contacts');
});

test('Domain 2: Contacto vs Grupo detecta automáticamente el tipo semántico por JID o propiedad', () => {
  const contact = chatExportRules.normalizeExportTarget({ id: '59171112233', type: 'contacts' });
  assert.equal(contact.type, 'contacts');
  assert.equal(chatExportRules.formatTargetTypeLabel(contact.type), 'Contacto');

  const group = chatExportRules.normalizeExportTarget('120363028392193849@g.us');
  assert.equal(group.type, 'groups');
  assert.equal(chatExportRules.formatTargetTypeLabel(group.type), 'Grupo');
});

test('Domain 3: búsqueda filtra insensitivamente por nombre e identificador', () => {
  const targets = [
    { id: '1', name: 'Wilson Eguez', identifier: '59174447830' },
    { id: '2', name: 'María González', identifier: '59171112233' },
    { id: '3', name: 'Carlos Ramos', identifier: '59178889900' }
  ];

  const byName = chatExportRules.filterExportTargets(targets, 'wilson');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].name, 'Wilson Eguez');

  const byNumber = chatExportRules.filterExportTargets(targets, '7111');
  assert.equal(byNumber.length, 1);
  assert.equal(byNumber[0].name, 'María González');

  const emptyQuery = chatExportRules.filterExportTargets(targets, '');
  assert.equal(emptyQuery.length, 3);
});

test('Domain 4: ordenamiento alfabético es inmutable y respeta acentos y mayúsculas', () => {
  const unsorted = [
    { id: '1', name: 'Zulma' },
    { id: '2', name: 'Álvaro' },
    { id: '3', name: 'Beatriz' }
  ];

  const sorted = chatExportRules.sortExportTargets(unsorted, 'asc');
  assert.equal(sorted[0].name, 'Álvaro');
  assert.equal(sorted[1].name, 'Beatriz');
  assert.equal(sorted[2].name, 'Zulma');
  assert.equal(unsorted[0].name, 'Zulma', 'No debe mutar el arreglo original');
});

test('Domain 5: validación rechaza targets nulos, sin id o con id en blanco', () => {
  assert.equal(chatExportRules.isValidTarget(null), false);
  assert.equal(chatExportRules.isValidTarget({}), false);
  assert.equal(chatExportRules.isValidTarget({ id: '' }), false);
  assert.equal(chatExportRules.isValidTarget({ id: '   ' }), false);
  assert.equal(chatExportRules.isValidTarget({ id: 'target_valido' }), true);
});

test('Domain 6: formatos válidos acepta únicamente TXT, HTML, PDF y JSON', () => {
  assert.equal(chatExportRules.isValidExportFormat('txt'), true);
  assert.equal(chatExportRules.isValidExportFormat('html'), true);
  assert.equal(chatExportRules.isValidExportFormat('pdf'), true);
  assert.equal(chatExportRules.isValidExportFormat('json'), true);
  assert.equal(chatExportRules.isValidExportFormat('csv'), false);
  assert.equal(chatExportRules.isValidExportFormat('xml'), false);

  assert.equal(chatExportRules.normalizeExportFormat('HTML'), 'html');
  assert.equal(chatExportRules.normalizeExportFormat('invalido'), 'txt');
});

test('Domain 7: selección y construcción de filename seguro para el sistema de archivos', () => {
  const target = { name: 'Comité de Dirección & Marketing / 2026', id: '123@g.us' };
  const filename = chatExportRules.buildExportFilename(target, 'txt', new Date('2026-08-30T12:00:00Z'));
  assert.ok(filename.startsWith('chat_export_Comite_de_Direccion_Market'));
  assert.ok(filename.endsWith('2026-08-30.txt'));
});

// ============================================================================
// 2. APPLICATION TESTS
// ============================================================================

test('Application 8: filtrado de contactos recupera exclusivamente contactos válidos ordenados', () => {
  const contacts = [
    { id: 'c2', name: 'Zacarías', number: '222' },
    { id: 'c1', name: 'Ana', number: '111' }
  ];

  const result = resolveExportTargets({
    contacts,
    groups: [{ id: 'g1', name: 'Grupo X' }],
    targetType: 'contacts',
    query: ''
  });

  assert.equal(result.targetType, 'contacts');
  assert.equal(result.targets.length, 2);
  assert.equal(result.targets[0].name, 'Ana');
  assert.equal(result.targets[1].name, 'Zacarías');
});

test('Application 9: filtrado de grupos conmuta correctamente a grupos sin incluir contactos', () => {
  const groups = [
    { id: 'g_alpha@g.us', name: 'Grupo Alfa' },
    { id: 'g_beta@g.us', name: 'Grupo Beta' }
  ];

  const result = resolveExportTargets({
    contacts: [{ id: 'c1', name: 'Contacto 1' }],
    groups,
    targetType: 'groups',
    query: 'Alfa'
  });

  assert.equal(result.targetType, 'groups');
  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].name, 'Grupo Alfa');
});

test('Application 10: preparación del target enriquece selección con datos disponibles', () => {
  const available = [
    { id: '59174447830', name: 'Wilson Eguez', type: 'contacts', identifier: '59174447830' }
  ];

  const selection = selectExportTarget({
    currentSelection: null,
    target: { id: '59174447830' },
    availableTargets: available
  });

  assert.equal(selection.isSameAsCurrent, false);
  assert.equal(selection.selectedTarget.name, 'Wilson Eguez');
  assert.equal(selection.selectedTarget.identifier, '59174447830');
});

test('Application 11: preparación de exportación rechaza targets inválidos con error descriptivo', () => {
  assert.throws(() => {
    prepareChatExportPayload({ target: { id: '' }, format: 'txt' });
  }, /Debes seleccionar un contacto o grupo válido/);
});

test('Application 12: payload limpio contiene target normalizado, formato seguro y fecha ISO', () => {
  const payload = prepareChatExportPayload({
    target: { id: 'c_55', name: 'Carlos' },
    format: 'JSON'
  });

  assert.equal(payload.target.id, 'c_55');
  assert.equal(payload.target.name, 'Carlos');
  assert.equal(payload.format, 'json');
  assert.ok(payload.filename.endsWith('.json'));
  assert.ok(typeof payload.preparedAtIso === 'string');
});

// ============================================================================
// 3. INFRASTRUCTURE TESTS
// ============================================================================

test('Infrastructure 13: gateway reutiliza HistoryIpcGateway y canal get-chat-history-preview', async () => {
  let invokedChannel = null;
  let invokedPayload = null;

  const mockIpcClient = {
    invoke: async (channel, payload) => {
      invokedChannel = channel;
      invokedPayload = payload;
      return {
        success: true,
        result: {
          chatId: payload.chatId,
          items: [{ id: 'm1', body: 'Mensaje de prueba', fromMe: false, timestamp: 1788100000 }]
        }
      };
    }
  };

  const gateway = new ChatExportGateway(mockIpcClient);
  const response = await gateway.getChatHistoryPreview({ chatId: '59174447830', limit: 200 });

  assert.equal(invokedChannel, 'get-chat-history-preview');
  assert.equal(invokedPayload.chatId, '59174447830');
  assert.equal(invokedPayload.limit, 200);
  assert.equal(response.success, true);
  assert.equal(response.result.items.length, 1);
});

test('Infrastructure 14: no duplica IPC innecesariamente y permite inyectar gateway existente', () => {
  const existingHistoryGateway = {
    getChatHistoryPreview: async () => ({ success: true, result: { items: [] } })
  };

  const exportGateway = new ChatExportGateway(existingHistoryGateway);
  assert.equal(exportGateway.getHistoryGateway(), existingHistoryGateway);
});

// ============================================================================
// 4. PRESENTATION TESTS
// ============================================================================

test('Presentation 15: render de tabs actualiza clases y atributos aria-selected', () => {
  let contactsActive = false;
  let groupsActive = false;

  const mockElements = {
    btnContacts: {
      classList: { toggle: (cls, state) => { if (cls === 'active') contactsActive = state; } },
      setAttribute: () => {}
    },
    btnGroups: {
      classList: { toggle: (cls, state) => { if (cls === 'active') groupsActive = state; } },
      setAttribute: () => {}
    },
    searchInput: { placeholder: '' }
  };

  chatExportView.renderTargetTabs(mockElements, 'groups');
  assert.equal(contactsActive, false);
  assert.equal(groupsActive, true);
  assert.ok(mockElements.searchInput.placeholder.includes('grupo'));
});

test('Presentation 16: render de resultados genera lista accesible con avatares y badges', () => {
  let renderedHtml = '';
  const mockElements = {
    targetsList: {
      set innerHTML(html) { renderedHtml = html; },
      get innerHTML() { return renderedHtml; }
    },
    resultsCount: { textContent: '' }
  };

  const targets = [
    { id: '123@c.us', name: 'Laura', identifier: '123', type: 'contacts' }
  ];

  chatExportView.renderTargetsList(mockElements, targets, null, 'contacts');
  assert.ok(renderedHtml.includes('Laura'));
  assert.ok(renderedHtml.includes('badge--contact'));
  assert.ok(renderedHtml.includes('data-target-id="123@c.us"'));
});

test('Presentation 17: render de estados vacíos cuando no hay resultados de búsqueda', () => {
  let renderedHtml = '';
  const mockElements = {
    targetsList: {
      set innerHTML(html) { renderedHtml = html; },
      get innerHTML() { return renderedHtml; }
    },
    resultsCount: { textContent: '' }
  };

  chatExportView.renderTargetsList(mockElements, [], null, 'contacts');
  assert.ok(renderedHtml.includes('chat-export-empty-state'));
  assert.ok(renderedHtml.includes('No se encontraron conversaciones'));
});

test('Presentation 18: interacción de selección habilita botones y actualiza tarjeta de destino', () => {
  const disabledButtons = [];
  const mockElements = {
    selectedEmptyHint: { classList: { toggle: () => {} } },
    selectedFilledContainer: { classList: { toggle: () => {} } },
    selectedName: { textContent: '' },
    selectedType: { textContent: '', className: '' },
    selectedId: { textContent: '' },
    exportTxtBtn: { set disabled(val) { disabledButtons.push(val); } },
    exportHtmlBtn: { set disabled(val) { disabledButtons.push(val); } },
    exportPdfBtn: { set disabled(val) { disabledButtons.push(val); } },
    exportJsonBtn: { set disabled(val) { disabledButtons.push(val); } }
  };

  const target = { id: 'g1@g.us', name: 'Grupo Ventas', type: 'groups', identifier: 'g1@g.us' };
  chatExportView.renderSelectedTarget(mockElements, target);

  assert.equal(mockElements.selectedName.textContent, 'Grupo Ventas');
  assert.ok(mockElements.selectedType.textContent.includes('Grupo'));
  assert.equal(mockElements.selectedId.textContent, 'g1@g.us');
  // Todos los botones de exportación deben haber sido habilitados (disabled = false)
  assert.ok(disabledButtons.every(val => val === false));
});

test('Presentation 19: botones de exportación quedan deshabilitados si no hay selección', () => {
  const disabledValues = [];
  const mockElements = {
    selectedEmptyHint: { classList: { toggle: () => {} } },
    selectedFilledContainer: { classList: { toggle: () => {} } },
    exportTxtBtn: { set disabled(val) { disabledValues.push(val); } },
    exportHtmlBtn: { set disabled(val) { disabledValues.push(val); } },
    exportPdfBtn: { set disabled(val) { disabledValues.push(val); } },
    exportJsonBtn: { set disabled(val) { disabledValues.push(val); } }
  };

  chatExportView.renderSelectedTarget(mockElements, null);
  assert.ok(disabledValues.every(val => val === true));
});

// ============================================================================
// 5. ARCHITECTURE TESTS
// ============================================================================

test('Architecture 20: domain (chat-export-rules.js) NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/chat-export/domain/chat-export-rules.js'),
    'utf8'
  );

  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes('electron'), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('ipcMain'), 'No debe referenciar ipcMain');
  assert.ok(!code.includes('sqlite3'), 'No debe importar sqlite3');
});

test('Architecture 21: application (manage-export-targets.js y prepare-chat-export.js) son independientes del DOM', () => {
  const manageCode = fs.readFileSync(
    path.resolve(__dirname, '../src/features/chat-export/application/manage-export-targets.js'),
    'utf8'
  );
  const prepareCode = fs.readFileSync(
    path.resolve(__dirname, '../src/features/chat-export/application/prepare-chat-export.js'),
    'utf8'
  );

  [manageCode, prepareCode].forEach((code) => {
    assert.ok(!code.includes('document.'), 'Application no debe manipular DOM');
    assert.ok(!code.includes('window.'), 'Application no debe usar window');
    assert.ok(!code.includes('electron'), 'Application no debe importar electron');
  });
});

test('Architecture 22: infrastructure (chat-export-gateway.js) encapsula comunicación sin acoplamiento a DOM', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/chat-export/infrastructure/chat-export-gateway.js'),
    'utf8'
  );

  assert.ok(!code.includes('document.'), 'Infrastructure no debe usar DOM');
  assert.ok(!code.includes('window.'), 'Infrastructure no debe usar window');
  assert.ok(code.includes('class ChatExportGateway'), 'Debe definir la clase ChatExportGateway');
});

test('Architecture 23: AppController no contiene lógica procedural de exportación de chat (solo delegación)', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app-controller.js'),
    'utf8'
  );

  // AppController debe delegar en this.chatExportController
  assert.ok(code.includes('this.chatExportController = new ChatExportController'), 'Debe instanciar ChatExportController');
  assert.ok(code.includes('this.chatExportController.exportChat'), 'Debe delegar en exportChat');
  assert.ok(!code.includes('formatConversationTxt('), 'No debe contener formateo de texto en AppController');
  assert.ok(!code.includes('formatConversationHtml('), 'No debe contener formateo HTML en AppController');
});

test('Architecture 24: fachada legacy y controladores mantienen tamaño acotado', () => {
  const controllerCode = fs.readFileSync(
    path.resolve(__dirname, '../src/features/chat-export/presentation/chat-export-controller.js'),
    'utf8'
  );
  const lines = controllerCode.split('\n').length;
  assert.ok(lines < 400, `ChatExportController debe tener < 400 líneas. Actual: ${lines}`);
});

// ============================================================================
// 6. MEMORY TESTS (ON-DEMAND LOADING & LEAK PREVENTION)
// ============================================================================

test('Memory 25: abrir o refrescar pestaña ChatExport NO carga historial ni invoca gateway', () => {
  let gatewayCalled = false;
  const mockGateway = {
    getChatHistoryPreview: async () => {
      gatewayCalled = true;
      return { success: true, result: { items: [] } };
    }
  };

  const ctrl = new ChatExportController({
    stateRef: { contacts: [{ id: 'c1', name: 'Contacto 1' }], groups: [] },
    gateway: mockGateway
  });

  ctrl.refreshAvailableTargets();
  assert.equal(gatewayCalled, false, 'Abrir pestaña NO debe invocar el gateway de historial');
});

test('Memory 26: buscar en la lista de conversaciones NO dispara consulta de historial', () => {
  let gatewayCalls = 0;
  const mockGateway = {
    getChatHistoryPreview: async () => {
      gatewayCalls++;
      return { success: true, result: { items: [] } };
    }
  };

  const ctrl = new ChatExportController({
    stateRef: { contacts: [{ id: 'c1', name: 'Ana' }, { id: 'c2', name: 'Carlos' }] },
    gateway: mockGateway
  });

  ctrl.handleSearch('Ana');
  ctrl.handleSearch('Car');
  ctrl.handleSearch('');

  assert.equal(gatewayCalls, 0, 'La búsqueda solo opera en memoria y NO debe cargar historial');
});

test('Memory 27: conmutar entre Contactos y Grupos NO dispara consulta de historial', () => {
  let gatewayCalls = 0;
  const mockGateway = {
    getChatHistoryPreview: async () => {
      gatewayCalls++;
      return { success: true, result: { items: [] } };
    }
  };

  const ctrl = new ChatExportController({
    stateRef: { contacts: [{ id: 'c1' }], groups: [{ id: 'g1@g.us' }] },
    gateway: mockGateway
  });

  ctrl.switchTargetType('groups');
  ctrl.switchTargetType('contacts');
  ctrl.switchTargetType('groups');

  assert.equal(gatewayCalls, 0, 'El cambio de pestaña de origen NO debe cargar historial');
});

test('Memory 28: seleccionar un elemento NO carga historial; solo la acción de exportar lo dispara', async () => {
  let historyLoadedFor = null;
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => {
      historyLoadedFor = chatId;
      return {
        success: true,
        result: {
          chatId,
          items: [{ id: 'msg1', body: 'Hola', fromMe: false, timestamp: 1788000000 }]
        }
      };
    }
  };

  const ctrl = new ChatExportController({
    stateRef: { contacts: [{ id: 'c_target_1', name: 'Target Test' }] },
    gateway: mockGateway
  });

  // 1. Selección
  ctrl.selectTarget({ id: 'c_target_1', name: 'Target Test' });
  assert.equal(historyLoadedFor, null, 'Seleccionar NO debe disparar la carga');

  // 2. Exportación
  await ctrl.exportChat('txt');
  assert.equal(historyLoadedFor, 'c_target_1', 'Exportar SÍ debe cargar el historial bajo demanda');
});

test('Memory 29: referencias a conversaciones exportadas son liberadas inmediatamente de memoria', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        items: [{ id: 'm1', body: 'Mensaje pesado', fromMe: true, timestamp: 1788000000 }]
      }
    })
  };

  const ctrl = new ChatExportController({
    gateway: mockGateway
  });

  ctrl.selectTarget({ id: 'target_limpieza', name: 'Limpieza' });
  await ctrl.exportChat('txt');

  assert.equal(ctrl._activeConversation, null, 'La referencia debe ser limpiada a null tras exportar');
  assert.equal(ctrl.isExporting, false);
});

// ============================================================================
// 7. STARTUP LOADING UX TESTS
// ============================================================================

test('Startup 30: estado inicial de loading correctamente definido con mensaje explícito', () => {
  let loadingShown = false;
  let statusCaptured = '';
  let detailsCaptured = '';
  let percentCaptured = 0;
  let optionsCaptured = null;

  const mockUi = {
    showSessionLoading: (statusText, detailsText, percent, options) => {
      loadingShown = true;
      statusCaptured = statusText;
      detailsCaptured = detailsText;
      percentCaptured = percent;
      optionsCaptured = options;
    }
  };

  const sessionCtrl = new SessionController({ ui: mockUi });
  sessionCtrl.showStartupLoading();

  assert.equal(loadingShown, true);
  assert.ok(statusCaptured.includes('WhatsApp se está iniciando'), `Debe indicar inicio explícito. Recibido: ${statusCaptured}`);
  assert.ok(detailsCaptured.includes('Conectando con WhatsApp Web'));
  assert.equal(percentCaptured, 10);
  assert.equal(optionsCaptured.title, 'Iniciando WhatsApp');
});

test('Startup 31: no existe dependencia de timers arbitrarios para simular progreso (event-driven)', () => {
  let currentPercent = 0;
  let currentStatus = '';

  const mockUi = {
    showSessionLoading: () => {},
    updateSessionLoadingStatus: (status, details, percent) => {
      currentStatus = status;
      currentPercent = percent;
    },
    updateStatus: () => {}
  };

  const ipcHandlers = {};
  const mockIpcClient = {
    on: (evt, handler) => { ipcHandlers[evt] = handler; }
  };

  const sessionCtrl = new SessionController({ ui: mockUi, ipcClient: mockIpcClient });
  sessionCtrl.bindIpcEvents();

  // El progreso lo dicta estrictamente WhatsApp Web a través de eventos IPC reales
  assert.ok(typeof ipcHandlers['whatsapp-loading-screen'] === 'function');

  // Simular evento real al 42%
  ipcHandlers['whatsapp-loading-screen']({}, { percent: 42, message: 'Descargando chats' });
  assert.equal(currentPercent, 42);
  assert.ok(currentStatus.includes('42%'));

  // Simular evento real al 99%
  ipcHandlers['whatsapp-loading-screen']({}, { percent: 99, message: 'Finalizando descarga' });
  assert.equal(currentPercent, 99);
  assert.ok(currentStatus.includes('99%'));
});

test('Startup 32: transición loading -> ready correctamente representada al completar sincronización', () => {
  let modalHidden = false;
  let readyStatusUpdated = false;

  const mockUi = {
    showSessionLoading: () => {},
    updateSessionLoadingStatus: () => {},
    updateStatus: (text, state) => {
      if (state === 'ready') readyStatusUpdated = true;
    },
    hideQr: () => { modalHidden = true; },
    renderGroupExportOptions: () => {},
    renderScheduleTargetOptions: () => {}
  };

  const ipcHandlers = {};
  const mockIpcClient = {
    on: (evt, handler) => { ipcHandlers[evt] = handler; }
  };

  const sessionCtrl = new SessionController({ ui: mockUi, ipcClient: mockIpcClient });
  sessionCtrl.bindIpcEvents();

  // 1. WhatsApp reporta ready
  ipcHandlers['whatsapp-ready']();
  assert.equal(sessionCtrl.isReady, true);
  assert.equal(readyStatusUpdated, true);

  // 2. Grupos reportan sincronización completada al 100%
  ipcHandlers['groups-sync-status']({}, { state: 'completed', total: 15 });
  assert.equal(sessionCtrl.isReady, true);
});
