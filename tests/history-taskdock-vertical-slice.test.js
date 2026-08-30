const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const historyRules = require('../src/features/history/domain/history-rules');
const {
  prepareChatHistoryRequest,
  processChatHistoryResponse
} = require('../src/features/history/application/load-chat-history');
const {
  extractDestinationIds,
  calculateMidnightDelay
} = require('../src/features/history/application/manage-destination-status');
const {
  HistoryIpcGateway
} = require('../src/features/history/infrastructure/history-ipc-gateway');
const {
  HistoryController
} = require('../src/features/history/presentation/history-controller');
const historyActions = require('../src/renderer/js/modules/app/history');

const taskdockRules = require('../src/features/taskdock/domain/taskdock-rules');
const {
  createTaskDockModel,
  transitionTaskDockModel
} = require('../src/features/taskdock/application/manage-taskdock');
const {
  TaskDock
} = require('../src/features/taskdock/presentation/taskdock-controller');
const taskdockFacade = require('../src/renderer/js/modules/ui/task-dock');

// ==========================================
// 1. DOMAIN: HISTORY-RULES
// ==========================================
test('Domain History: buildHistoryChatTargets unifica y ordena contactos y grupos', () => {
  const contacts = [
    { id: 'c2', name: 'Zara', number: '70002' },
    { id: 'c1', name: 'Ana', number: '70001' }
  ];
  const groups = [
    { id: 'g1', name: 'Betas' }
  ];

  const targets = historyRules.buildHistoryChatTargets(contacts, groups);
  assert.equal(targets.length, 3);
  assert.equal(targets[0].label, '[Grupo] Betas');
  assert.equal(targets[1].label, 'Ana (70001)');
  assert.equal(targets[2].label, 'Zara (70002)');
});

test('Domain History: filterChatTargets filtra por texto de búsqueda insensible a mayúsculas', () => {
  const targets = [
    { id: '1', label: 'Ana (70001)', searchText: 'ana 70001' },
    { id: '2', label: 'Juan (70002)', searchText: 'juan 70002' }
  ];

  const filtered = historyRules.filterChatTargets(targets, '70002');
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, '2');

  const all = historyRules.filterChatTargets(targets, '');
  assert.equal(all.length, 2);
});

test('Domain History: normalizeChatMessage estructura mensajes y etiquetas temporales', () => {
  const incoming = historyRules.normalizeChatMessage({
    id: 'm1',
    fromMe: false,
    sender: 'Cliente VIP',
    text: 'Hola necesito soporte',
    timestampIso: '2026-08-30T10:15:00.000Z'
  });
  assert.equal(incoming.isOutgoing, false);
  assert.equal(incoming.senderLabel, 'Cliente VIP');
  assert.equal(incoming.text, 'Hola necesito soporte');
  assert.ok(incoming.timeLabel !== '--:--');

  const outgoing = historyRules.normalizeChatMessage({
    id: 'm2',
    fromMe: true,
    text: 'Enseguida le atendemos'
  });
  assert.equal(outgoing.isOutgoing, true);
  assert.equal(outgoing.senderLabel, 'Yo');
});

test('Domain History: normalizeDestinationStatuses y checkDestinationStatus detectan envíos diarios', () => {
  const byId = {
    '5917001': { sentToday: true, lastSentAt: '2026-08-30T09:00:00.000Z' },
    'g-100': { sentToday: false, lastSentAt: null }
  };

  const { sentTodaySet, lastSentMap } = historyRules.normalizeDestinationStatuses(byId);
  assert.ok(sentTodaySet.has('5917001'));
  assert.ok(!sentTodaySet.has('g-100'));

  const statusContact = historyRules.checkDestinationStatus('5917001@c.us', {
    sentTodaySet,
    lastSentMap,
    mode: 'contacts'
  });
  assert.equal(statusContact.sentToday, true);
  assert.equal(statusContact.lastSentAt, '2026-08-30T09:00:00.000Z');

  const statusUnknown = historyRules.checkDestinationStatus('9999999', {
    sentTodaySet,
    lastSentMap,
    mode: 'contacts'
  });
  assert.equal(statusUnknown.sentToday, false);
});

test('Domain History: countAlreadySentTargets totaliza destinatarios ya contactados', () => {
  const sentTodaySet = new Set(['c1', 'c2']);
  const targets = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

  const count = historyRules.countAlreadySentTargets(targets, { sentTodaySet, lastSentMap: {} });
  assert.equal(count, 2);
});

// ==========================================
// 2. APPLICATION: HISTORY
// ==========================================
test('Application History: prepareChatHistoryRequest valida chatId y normaliza límites', () => {
  const valid = prepareChatHistoryRequest({ chatId: '5917001@c.us', limit: 50 });
  assert.equal(valid.valid, true);
  assert.equal(valid.payload.chatId, '5917001@c.us');
  assert.equal(valid.payload.limit, 50);

  const invalid = prepareChatHistoryRequest({ chatId: '' });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.error);
});

test('Application History: processChatHistoryResponse procesa y asigna chatName', () => {
  const raw = {
    chatName: 'Chat Clientes',
    items: [
      { id: '1', text: 'Mensaje 1', fromMe: false }
    ]
  };

  const processed = processChatHistoryResponse(raw);
  assert.equal(processed.chatName, 'Chat Clientes');
  assert.equal(processed.items.length, 1);
  assert.equal(processed.items[0].senderLabel, 'Chat Clientes');
});

test('Application History: extractDestinationIds y calculateMidnightDelay', () => {
  const ids = extractDestinationIds('contacts', {
    contacts: [{ id: '1' }],
    selectedContacts: [{ id: '2' }, { number: '3' }]
  });
  assert.equal(ids.length, 3);
  assert.ok(ids.includes('1') && ids.includes('2') && ids.includes('3'));

  const delay = calculateMidnightDelay(new Date('2026-08-30T23:59:50.000Z'));
  assert.ok(delay >= 1000);
});

// ==========================================
// 3. INFRASTRUCTURE: HISTORY
// ==========================================
test('Infrastructure History IPC Gateway: invoca canales preview, statuses y log', async () => {
  const calls = [];
  const mockIpc = {
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'get-chat-history-preview') return { success: true, result: { items: [] } };
      if (channel === 'get-destination-statuses') return { success: true, result: { byId: {} } };
      if (channel === 'get-message-log-history') return { success: true, items: [] };
      return null;
    }
  };

  const gateway = new HistoryIpcGateway(mockIpc);
  const preview = await gateway.getChatHistoryPreview({ chatId: '123' });
  assert.equal(preview.success, true);
  assert.equal(calls[0].channel, 'get-chat-history-preview');

  const statuses = await gateway.getDestinationStatuses({ destinationType: 'contacts', destinationIds: ['123'] });
  assert.equal(statuses.success, true);
  assert.equal(calls[1].channel, 'get-destination-statuses');

  const log = await gateway.getMessageLogHistory({ limit: 100 });
  assert.equal(log.success, true);
  assert.equal(calls[2].channel, 'get-message-log-history');
});

// ==========================================
// 4. DOMAIN & APPLICATION: TASKDOCK
// ==========================================
test('Domain TaskDock: validación de estados, clamping de progreso y badges', () => {
  assert.equal(taskdockRules.isValidDockState('running'), true);
  assert.equal(taskdockRules.isValidDockState('invalid'), false);

  assert.equal(taskdockRules.clampProgress(120), 100);
  assert.equal(taskdockRules.clampProgress(-10), 0);
  assert.equal(taskdockRules.clampProgress(45.6), 46);

  const runningStyle = taskdockRules.resolveBadgeStyle(taskdockRules.TASK_DOCK_STATES.RUNNING);
  assert.equal(runningStyle.label, 'En ejecución');
  assert.equal(runningStyle.showPause, true);
  assert.equal(runningStyle.showCancel, true);

  const completedStyle = taskdockRules.resolveBadgeStyle(taskdockRules.TASK_DOCK_STATES.COMPLETED);
  assert.equal(completedStyle.label, 'Completado');
  assert.equal(completedStyle.showClose, true);
});

test('Application TaskDock: modelado y transiciones de estado', () => {
  const model = createTaskDockModel(taskdockRules.TASK_DOCK_STATES.RUNNING, {
    title: 'Envío Masivo',
    percent: 30
  });
  assert.equal(model.state, 'running');
  assert.equal(model.title, 'Envío Masivo');
  assert.equal(model.percent, 30);

  const updated = transitionTaskDockModel(model, taskdockRules.TASK_DOCK_STATES.COMPLETED, {
    percent: 100
  });
  assert.equal(updated.state, 'completed');
  assert.equal(updated.percent, 100);
  assert.equal(updated.title, 'Envío Masivo');
});

// ==========================================
// 5. REGRESIÓN ARQUITECTÓNICA
// ==========================================
test('Arquitectura History: history-rules.js NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/history/domain/history-rules.js'),
    'utf8'
  );
  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('AppController'), 'No debe referenciar controladores externos');
});

test('Arquitectura TaskDock: taskdock-rules.js NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/taskdock/domain/taskdock-rules.js'),
    'utf8'
  );
  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('AppController'), 'No debe referenciar controladores externos');
});

test('Arquitectura History & TaskDock: fachadas delgadas (< 100 líneas)', () => {
  const codeHistory = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app/history.js'),
    'utf8'
  );
  const codeTaskDock = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/ui/task-dock.js'),
    'utf8'
  );

  assert.ok(codeHistory.split('\n').length < 100, 'history.js debe ser fachada < 100 líneas');
  assert.ok(codeTaskDock.split('\n').length < 100, 'task-dock.js debe ser fachada < 100 líneas');
});

test('Compatibilidad: history.js y task-dock.js exponen contratos requeridos', () => {
  assert.equal(typeof historyActions.bindChatHistoryEvents, 'function');
  assert.equal(typeof historyActions.refreshChatHistoryTargetOptions, 'function');
  assert.equal(typeof historyActions.loadChatHistoryPreview, 'function');
  assert.equal(typeof historyActions.getDestinationStatus, 'function');
  assert.equal(typeof historyActions.getAlreadySentSelectedTargetsCount, 'function');
  assert.equal(typeof historyActions.refreshDestinationStatuses, 'function');

  assert.equal(typeof taskdockFacade.TaskDock, 'function');
  assert.ok(taskdockFacade.TASK_DOCK_STATES);
});
