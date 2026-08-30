const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schedulingRules = require('../src/features/scheduling/domain/scheduling-rules');
const {
  prepareSchedulePayload
} = require('../src/features/scheduling/application/schedule-campaign');
const {
  buildScheduleTargetOptions,
  filterPendingSchedules,
  removeScheduleById
} = require('../src/features/scheduling/application/manage-schedules');
const {
  SchedulingIpcGateway
} = require('../src/features/scheduling/infrastructure/scheduling-ipc-gateway');
const {
  SchedulingController
} = require('../src/features/scheduling/presentation/scheduling-controller');
const schedulingActions = require('../src/renderer/js/modules/app/scheduling');

// ==========================================
// 1. DOMAIN: SCHEDULING-RULES
// ==========================================
test('Domain Scheduling: toIsoFromDatetimeLocal convierte cadenas válidas a ISO UTC', () => {
  const iso = schedulingRules.toIsoFromDatetimeLocal('2026-10-15T14:30');
  assert.ok(iso);
  assert.ok(iso.includes('2026-10-15T'));
  assert.equal(schedulingRules.toIsoFromDatetimeLocal(''), null);
  assert.equal(schedulingRules.toIsoFromDatetimeLocal('fecha-invalida'), null);
});

test('Domain Scheduling: validateScheduleInput valida campos obligatorios y rangos', () => {
  // Caso exitoso
  const validResult = schedulingRules.validateScheduleInput({
    targetId: '5917001@c.us',
    messageText: 'Recordatorio de reunión',
    scheduledAt: '2026-10-15T14:30',
    delayMin: 3,
    delayMax: 6
  });
  assert.equal(validResult.valid, true);
  assert.equal(validResult.errors.length, 0);

  // Faltando destinatario
  const noTarget = schedulingRules.validateScheduleInput({
    targetId: '',
    messageText: 'Texto',
    scheduledAt: '2026-10-15T14:30'
  });
  assert.equal(noTarget.valid, false);
  assert.ok(noTarget.errors.some((e) => e.code === schedulingRules.ERROR_CODES.EMPTY_TARGET));

  // Faltando contenido (sin texto ni archivos)
  const noContent = schedulingRules.validateScheduleInput({
    targetId: '123',
    messageText: '',
    files: [],
    scheduledAt: '2026-10-15T14:30'
  });
  assert.equal(noContent.valid, false);
  assert.ok(noContent.errors.some((e) => e.code === schedulingRules.ERROR_CODES.EMPTY_CONTENT));

  // Fecha inválida
  const invalidDate = schedulingRules.validateScheduleInput({
    targetId: '123',
    messageText: 'Texto',
    scheduledAt: 'invalido'
  });
  assert.equal(invalidDate.valid, false);
  assert.ok(invalidDate.errors.some((e) => e.code === schedulingRules.ERROR_CODES.INVALID_DATETIME));

  // Delay inválido (delayMin > delayMax)
  const invalidDelay = schedulingRules.validateScheduleInput({
    targetId: '123',
    messageText: 'Texto',
    scheduledAt: '2026-10-15T14:30',
    delayMin: 10,
    delayMax: 2
  });
  assert.equal(invalidDelay.valid, false);
  assert.ok(invalidDelay.errors.some((e) => e.code === schedulingRules.ERROR_CODES.INVALID_DELAY_RANGE));
});

test('Domain Scheduling: normalizeScheduleDraft sanea y limita archivos', () => {
  const draft = schedulingRules.normalizeScheduleDraft({
    targetType: 'invalid-type',
    targetId: '  5917001  ',
    files: [1, 2, 3, 4, 5],
    sendFilesFirst: false
  });

  assert.equal(draft.targetType, 'contacts');
  assert.equal(draft.targetId, '5917001');
  assert.equal(draft.files.length, 3, 'Debe limitar a un máximo de 3 archivos adjuntos');
  assert.equal(draft.sendFilesFirst, false);
});

test('Domain Scheduling: isScheduleDue determina vencimiento temporal', () => {
  const past = '2020-01-01T00:00:00.000Z';
  const future = '2099-01-01T00:00:00.000Z';
  const now = Date.now();

  assert.equal(schedulingRules.isScheduleDue(past, now), true);
  assert.equal(schedulingRules.isScheduleDue(future, now), false);
  assert.equal(schedulingRules.isScheduleDue(null, now), false);
});

test('Domain Scheduling: sortSchedulesByDate ordena cronológicamente sin mutar', () => {
  const items = [
    { id: 2, scheduledAtIso: '2026-12-01T00:00:00.000Z' },
    { id: 1, scheduledAtIso: '2026-05-01T00:00:00.000Z' },
    { id: 3, scheduledAtIso: '2026-08-01T00:00:00.000Z' }
  ];

  const sorted = schedulingRules.sortSchedulesByDate(items);
  assert.equal(sorted[0].id, 1);
  assert.equal(sorted[1].id, 3);
  assert.equal(sorted[2].id, 2);
  assert.equal(items[0].id, 2, 'El arreglo original no debe mutarse');
});

// ==========================================
// 2. APPLICATION: SCHEDULE-CAMPAIGN & MANAGE
// ==========================================
test('Application Scheduling: prepareSchedulePayload genera payload limpio normalizado', () => {
  const res = prepareSchedulePayload({
    targetType: 'contacts',
    targetId: '5917001',
    targetLabel: 'Juan Perez',
    messageText: '  Hola Juan  ',
    files: [{ path: '/tmp/test.pdf' }],
    sendFilesFirst: true,
    delayMin: 4,
    delayMax: 8,
    scheduledAt: '2026-10-15T14:30'
  });

  assert.equal(res.valid, true);
  assert.equal(res.payload.targetType, 'contacts');
  assert.equal(res.payload.targetId, '5917001');
  assert.equal(res.payload.targetLabel, 'Juan Perez');
  assert.equal(res.payload.messageText, 'Hola Juan');
  assert.deepEqual(res.payload.files, ['/tmp/test.pdf']);
  assert.equal(res.payload.delayMin, 4);
  assert.equal(res.payload.delayMax, 8);
  assert.ok(res.payload.scheduledAt.includes('2026-10-15T'));
});

test('Application Scheduling: buildScheduleTargetOptions formatea contactos y grupos para el select', () => {
  const contacts = [{ id: 'c1', name: 'Maria', number: '70001' }];
  const groups = [{ id: 'g1', name: 'Clientes VIP' }];

  const contactOpts = buildScheduleTargetOptions('contacts', contacts, groups, 'c1');
  assert.equal(contactOpts.length, 1);
  assert.equal(contactOpts[0].label, 'Maria (70001)');
  assert.equal(contactOpts[0].selected, true);

  const groupOpts = buildScheduleTargetOptions('groups', contacts, groups, 'g1');
  assert.equal(groupOpts.length, 1);
  assert.equal(groupOpts[0].label, 'Clientes VIP');
  assert.equal(groupOpts[0].selected, true);
});

test('Application Scheduling: filterPendingSchedules y removeScheduleById', () => {
  const items = [
    { id: 1, status: 'pending' },
    { id: 2, status: 'sent' },
    { id: 3, status: 'pending' }
  ];

  const pending = filterPendingSchedules(items);
  assert.equal(pending.length, 2);
  assert.equal(pending[0].id, 1);
  assert.equal(pending[1].id, 3);

  const remaining = removeScheduleById(items, 1);
  assert.equal(remaining.length, 2);
  assert.ok(!remaining.some((i) => i.id === 1));
});

// ==========================================
// 3. INFRASTRUCTURE: SCHEDULING-IPC-GATEWAY
// ==========================================
test('Infrastructure Scheduling IPC Gateway: canaliza llamadas create, get, cancel y select-files', async () => {
  const calls = [];
  const mockIpcClient = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'create-scheduled-message') {
        return { success: true, item: { id: 10 } };
      }
      if (channel === 'get-scheduled-messages') {
        return { success: true, items: [{ id: 10, status: 'pending' }] };
      }
      if (channel === 'cancel-scheduled-message') {
        return { success: true, result: { id: 10, cancelled: true } };
      }
      if (channel === 'select-files') {
        return [{ path: '/img.png', name: 'img.png', size: 100 }];
      }
      return null;
    }
  };

  const gateway = new SchedulingIpcGateway(mockIpcClient);

  const createRes = await gateway.createScheduledMessage({ targetId: '123' });
  assert.equal(createRes.success, true);
  assert.equal(calls[0].channel, 'create-scheduled-message');

  const listRes = await gateway.getScheduledMessages({ status: 'pending' });
  assert.equal(listRes.success, true);
  assert.equal(calls[1].channel, 'get-scheduled-messages');

  const cancelRes = await gateway.cancelScheduledMessage(10);
  assert.equal(cancelRes.success, true);
  assert.equal(calls[2].channel, 'cancel-scheduled-message');

  const files = await gateway.selectFiles();
  assert.equal(files.length, 1);
  assert.equal(calls[3].channel, 'select-files');
});

// ==========================================
// 4. PRESENTATION: SCHEDULING-CONTROLLER
// ==========================================
test('Presentation SchedulingController: coordina draft y operaciones manteniendo sincronía', async () => {
  const stateRef = {
    scheduleDraft: {
      targetType: 'contacts',
      targetId: '',
      files: [],
      sendFilesFirst: true
    },
    contacts: [{ id: 'c1', name: 'Wilson', number: '78945612' }],
    groups: [],
    ui: {
      renderScheduleTargetOptions: () => {},
      renderFiles: () => {},
      renderScheduledMessages: () => {},
      showToast: () => {}
    }
  };

  const mockIpc = {
    invoke: async (channel) => {
      if (channel === 'get-scheduled-messages') {
        return { success: true, items: [{ id: 1, targetLabel: 'Test' }] };
      }
      return null;
    }
  };

  const controller = new SchedulingController({
    stateRef,
    ipcClient: mockIpc
  });

  assert.equal(controller.draft.targetType, 'contacts');
  controller.draft.targetId = 'c1';
  assert.equal(stateRef.scheduleDraft.targetId, 'c1', 'stateRef debe mantenerse sincronizado');

  await controller.refreshScheduledMessages({ silent: true });
});

// ==========================================
// 5. REGRESIÓN ARQUITECTÓNICA
// ==========================================
test('Arquitectura Scheduling: scheduling-rules.js NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/scheduling/domain/scheduling-rules.js'),
    'utf8'
  );

  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('AppController'), 'No debe referenciar AppController');
});

test('Arquitectura Scheduling: schedule-campaign.js y manage-schedules.js son independientes del DOM', () => {
  const codeCampaign = fs.readFileSync(
    path.resolve(__dirname, '../src/features/scheduling/application/schedule-campaign.js'),
    'utf8'
  );
  const codeManage = fs.readFileSync(
    path.resolve(__dirname, '../src/features/scheduling/application/manage-schedules.js'),
    'utf8'
  );

  assert.ok(!codeCampaign.includes('document.'), 'schedule-campaign no debe referenciar document');
  assert.ok(!codeCampaign.includes('window.'), 'schedule-campaign no debe referenciar window');
  assert.ok(!codeManage.includes('document.'), 'manage-schedules no debe referenciar document');
  assert.ok(!codeManage.includes('window.'), 'manage-schedules no debe referenciar window');
});

test('Arquitectura Scheduling: scheduling.js actúa como fachada delgada (< 100 líneas)', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app/scheduling.js'),
    'utf8'
  );

  const lines = code.split('\n').length;
  assert.ok(lines < 100, `scheduling.js debe tener menos de 100 líneas, tiene ${lines}`);
  assert.ok(code.includes('SchedulingController'), 'scheduling.js debe delegar a SchedulingController');
});

test('Compatibilidad Scheduling: scheduling.js y AppController exponen contratos requeridos', () => {
  assert.equal(typeof schedulingActions.bindSchedulingUiEvents, 'function');
  assert.equal(typeof schedulingActions.createScheduledMessage, 'function');
  assert.equal(typeof schedulingActions.refreshScheduledMessages, 'function');
  assert.equal(typeof schedulingActions.cancelScheduledMessage, 'function');
  assert.equal(typeof schedulingActions.renderScheduleTargetOptions, 'function');
});
