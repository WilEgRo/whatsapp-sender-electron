const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const riskPolicy = require('../src/features/messaging/domain/risk-policy');
const { validateCampaign, isValidPhoneNumber, ERROR_CODES } = require('../src/features/messaging/domain/campaign-validator');
const { prepareCampaignPayload, buildContactContexts } = require('../src/features/messaging/application/prepare-campaign');
const { MessagingIpcGateway } = require('../src/features/messaging/infrastructure/messaging-ipc-gateway');
const riskView = require('../src/features/messaging/presentation/sending-risk-view');
const sendingActions = require('../src/renderer/js/modules/app/sending');

// ==========================================
// 1. RISK-POLICY (DOMINIO PURO)
// ==========================================
test('Domain Risk Policy: SAFE_PRESETS contiene perfiles new, medium y mature inmutables', () => {
  assert.ok(riskPolicy.SAFE_PRESETS.new, 'Debe existir perfil new');
  assert.ok(riskPolicy.SAFE_PRESETS.medium, 'Debe existir perfil medium');
  assert.ok(riskPolicy.SAFE_PRESETS.mature, 'Debe existir perfil mature');

  assert.equal(riskPolicy.SAFE_PRESETS.new.maxBatch, 18);
  assert.equal(riskPolicy.SAFE_PRESETS.medium.maxBatch, 35);
  assert.equal(riskPolicy.SAFE_PRESETS.mature.maxBatch, 60);

  assert.ok(Object.isFrozen(riskPolicy.SAFE_PRESETS), 'SAFE_PRESETS debe estar congelado');
  assert.ok(Object.isFrozen(riskPolicy.SAFE_PRESETS.new), 'Perfil new debe estar congelado');
  assert.ok(Object.isFrozen(riskPolicy.SAFE_PRESETS.medium), 'Perfil medium debe estar congelado');
  assert.ok(Object.isFrozen(riskPolicy.SAFE_PRESETS.mature), 'Perfil mature debe estar congelado');
});

test('Domain Risk Policy: getRiskLevel clasifica los puntajes correctamente', () => {
  assert.deepEqual(riskPolicy.getRiskLevel(25), { level: 'green', text: 'VERDE' });
  assert.deepEqual(riskPolicy.getRiskLevel(40), { level: 'yellow', text: 'AMARILLO' });
  assert.deepEqual(riskPolicy.getRiskLevel(69), { level: 'yellow', text: 'AMARILLO' });
  assert.deepEqual(riskPolicy.getRiskLevel(70), { level: 'red', text: 'ROJO' });
  assert.deepEqual(riskPolicy.getRiskLevel(100), { level: 'red', text: 'ROJO' });
});

test('Domain Risk Policy: formatDuration convierte segundos a texto legible', () => {
  assert.equal(riskPolicy.formatDuration(0), '0 seg');
  assert.equal(riskPolicy.formatDuration(-5), '0 seg');
  assert.equal(riskPolicy.formatDuration(30), '30 seg');
  assert.equal(riskPolicy.formatDuration(120), '~2 min');
  assert.equal(riskPolicy.formatDuration(3660), '~1 h 1 min');
});

test('Domain Risk Policy: evaluateRisk evalúa factores de riesgo y genera recomendaciones', () => {
  const safeEval = riskPolicy.evaluateRisk({
    targetCount: 15,
    delayMin: 12,
    delayMax: 22,
    unitDelayMin: 1,
    unitDelayMax: 3,
    complianceMode: true,
    hasFiles: false,
    profile: 'medium'
  });

  assert.equal(safeEval.level.level, 'green');
  assert.ok(safeEval.score < 40);
  assert.ok(safeEval.suggestion.includes('max 35 por tanda'));

  // Riesgo alto por sobrevolumen y delays muy bajos
  const highRiskEval = riskPolicy.evaluateRisk({
    targetCount: 100,
    delayMin: 1,
    delayMax: 2,
    complianceMode: false,
    profile: 'new'
  });

  assert.equal(highRiskEval.level.level, 'red');
  assert.ok(highRiskEval.score >= 70);
});

// ==========================================
// 2. CAMPAIGN-VALIDATOR (DOMINIO PURO)
// ==========================================
test('Domain Campaign Validator: isValidPhoneNumber valida formato numérico', () => {
  assert.equal(isValidPhoneNumber('59178945612'), true);
  assert.equal(isValidPhoneNumber('+591 7894-5612'), true);
  assert.equal(isValidPhoneNumber('12345'), false); // Muy corto
  assert.equal(isValidPhoneNumber('12345678901234567'), false); // Muy largo
});

test('Domain Campaign Validator: valida campaña exitosa con contactos', () => {
  const result = validateCampaign({
    mode: 'contacts',
    payload: {
      numbers: '59178945612',
      message: 'Hola prueba',
      delayMin: 5,
      delayMax: 10,
      unitDelayMin: 1,
      unitDelayMax: 2,
      files: []
    },
    authState: { isValidated: true },
    hasBulkSendFeature: true,
    isWhatsAppReady: true,
    selectedContacts: [{ id: '1', number: '59178945612', name: 'Juan' }]
  });

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('Domain Campaign Validator: detecta mensaje y adjuntos vacíos', () => {
  const result = validateCampaign({
    mode: 'contacts',
    payload: {
      numbers: '59178945612',
      message: '',
      messageList: [],
      files: [],
      delayMin: 5,
      delayMax: 10
    },
    authState: { isValidated: true },
    hasBulkSendFeature: true,
    isWhatsAppReady: true,
    selectedContacts: [{ id: '1', number: '59178945612' }]
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((err) => err.code === ERROR_CODES.EMPTY_CONTENT));
});

test('Domain Campaign Validator: detecta rangos de delay inválidos', () => {
  const result = validateCampaign({
    mode: 'contacts',
    payload: {
      numbers: '59178945612',
      message: 'Hola',
      delayMin: 20,
      delayMax: 15 // Menor que delayMin
    },
    authState: { isValidated: true },
    hasBulkSendFeature: true,
    isWhatsAppReady: true,
    selectedContacts: [{ id: '1', number: '59178945612' }]
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((err) => err.code === ERROR_CODES.DELAY_INVALID_RANGE));
});

// ==========================================
// 3. PREPARE-CAMPAIGN (APLICACIÓN)
// ==========================================
test('Application Prepare Campaign: buildContactContexts normaliza nombres y partes', () => {
  const contacts = [
    { id: '1', number: '59170001', name: 'Carlos Alberto Perez' },
    { id: '2', number: '59170002', name: 'Maria' }
  ];

  const contexts = buildContactContexts(contacts);
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].name, 'Carlos');
  assert.equal(contexts[0].last_name, 'Alberto Perez');
  assert.equal(contexts[1].name, 'Maria');
  assert.equal(contexts[1].last_name, '');
});

test('Application Prepare Campaign: prepareCampaignPayload construye modelo limpio', () => {
  const payload = prepareCampaignPayload({
    mode: 'contacts',
    delayMin: 4,
    delayMax: 12,
    messagePayload: {
      messagePrimary: 'Mensaje base',
      messageList: ['Mensaje 1', 'Mensaje 2']
    },
    files: [{ path: 'C:/docs/file.pdf' }],
    selectedContacts: [{ number: '59170001', name: 'Carlos' }]
  });

  assert.equal(payload.targetType, 'contacts');
  assert.equal(payload.message, 'Mensaje base');
  assert.deepEqual(payload.messageList, ['Mensaje 1', 'Mensaje 2']);
  assert.deepEqual(payload.files, ['C:/docs/file.pdf']);
  assert.equal(payload.numbers, '59170001');
  assert.equal(payload.delayMin, 4);
  assert.equal(payload.delayMax, 12);
});

// ==========================================
// 4. MESSAGING-IPC-GATEWAY (INFRAESTRUCTURA)
// ==========================================
test('Infrastructure Messaging IPC Gateway: canaliza llamadas select-files y send-batch-message', async () => {
  const calls = [];
  const mockIpcClient = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'select-files') {
        return [{ name: 'img.jpg', path: 'C:/img.jpg', size: 1024 }];
      }
      if (channel === 'send-batch-message') {
        return { success: true, result: [{ status: 'success', number: '123' }] };
      }
      return null;
    }
  };

  const gateway = new MessagingIpcGateway(mockIpcClient);
  const files = await gateway.selectFiles();
  assert.equal(files.length, 1);
  assert.equal(calls[0].channel, 'select-files');

  const batchResult = await gateway.sendBatchMessage({ test: true });
  assert.equal(batchResult.success, true);
  assert.equal(calls[1].channel, 'send-batch-message');
});

// ==========================================
// 5. SENDING-RISK-VIEW (PRESENTACIÓN)
// ==========================================
test('Presentation Sending Risk View: expone todas las funciones requeridas', () => {
  assert.equal(typeof riskView.applyRiskVisual, 'function');
  assert.equal(typeof riskView.updateSendAvailability, 'function');
  assert.equal(typeof riskView.setRiskPanelText, 'function');
  assert.equal(typeof riskView.updateTargetCounter, 'function');
  assert.equal(typeof riskView.updateGroupPreflightInspector, 'function');
  assert.equal(typeof riskView.renderDelayOptions, 'function');
  assert.equal(typeof riskView.renderRiskPanel, 'function');
  assert.equal(typeof riskView.showForceSendConfirmation, 'function');
  assert.equal(typeof riskView.showDailyResendConfirmation, 'function');
});

// ==========================================
// 6. TEST DE REGRESIÓN ARQUITECTÓNICA
// ==========================================
test('Arquitectura: risk-policy.js NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/messaging/domain/risk-policy.js'),
    'utf8'
  );

  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('AppController'), 'No debe referenciar AppController');
});

test('Arquitectura: campaign-validator.js NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/messaging/domain/campaign-validator.js'),
    'utf8'
  );

  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('AppController'), 'No debe referenciar AppController');
});

test('Arquitectura: sending.js NO contiene duplicación de SAFE_PRESETS ni motor duplicado de riesgo', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app/sending.js'),
    'utf8'
  );

  assert.ok(!code.includes('const SAFE_PRESETS = {'), 'sending.js no debe redeclarar SAFE_PRESETS');
  assert.ok(code.includes("require('../../../../features/messaging/domain/risk-policy')"), 'sending.js debe importar risk-policy');
  assert.ok(code.includes("require('../../../../features/messaging/domain/campaign-validator')"), 'sending.js debe importar campaign-validator');
  assert.ok(code.includes("require('../../../../features/messaging/application/prepare-campaign')"), 'sending.js debe importar prepare-campaign');
  assert.ok(code.includes("require('../../../../features/messaging/infrastructure/messaging-ipc-gateway')"), 'sending.js debe importar messaging-ipc-gateway');
  assert.ok(code.includes("require('../../../../features/messaging/presentation/sending-risk-view')"), 'sending.js debe importar sending-risk-view');
});

test('Arquitectura: campaign-safety.js delega en risk-policy.js sin duplicar lógica', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/campaign/campaign-safety.js'),
    'utf8'
  );

  assert.ok(!code.includes('const SAFE_PRESETS = {'), 'campaign-safety.js no debe redeclarar SAFE_PRESETS');
  assert.ok(code.includes('riskPolicy'), 'campaign-safety.js debe delegar en riskPolicy');
});

test('Compatibilidad: sending.js preserva su firma pública para AppController', () => {
  assert.equal(typeof sendingActions.selectFiles, 'function');
  assert.equal(typeof sendingActions.updateDelayOptions, 'function');
  assert.equal(typeof sendingActions.sendBatch, 'function');
  assert.equal(typeof sendingActions.bindRiskControls, 'function');
  assert.equal(typeof sendingActions.refreshRiskPanel, 'function');
  assert.ok(sendingActions.SAFE_PRESETS, 'Debe exportar SAFE_PRESETS');
  assert.equal(typeof sendingActions.evaluateRisk, 'function');
});
