const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const feedbackPath = path.resolve(__dirname, '../src/renderer/js/modules/ui/feedback.js');

test('Feedback: feedback.js puede ser parseado y evaluado sin SyntaxError', () => {
  const code = fs.readFileSync(feedbackPath, 'utf8');
  assert.doesNotThrow(() => {
    new vm.Script(code, { filename: feedbackPath });
  }, 'feedback.js no debe contener errores de sintaxis');
});

test('Feedback: exporta todas las funciones de feedback requeridas', () => {
  const feedback = require('../src/renderer/js/modules/ui/feedback');
  assert.equal(typeof feedback.showProgress, 'function');
  assert.equal(typeof feedback.hideProgress, 'function');
  assert.equal(typeof feedback.updateSendProgress, 'function');
  assert.equal(typeof feedback.updateStatus, 'function');
  assert.equal(typeof feedback.showToast, 'function');
  assert.equal(typeof feedback.showQrCanvas, 'function');
  assert.equal(typeof feedback.showSessionLoading, 'function');
  assert.equal(typeof feedback.hideQr, 'function');
});

test('Feedback: showProgress y updateSendProgress integran correctamente con TaskDock', () => {
  const feedback = require('../src/renderer/js/modules/ui/feedback');

  const dockStates = [];
  const mockTaskDock = {
    setState: (state, payload) => {
      dockStates.push({ state, payload });
    },
    getState: () => 'running'
  };

  const mockContext = {
    progressText: { textContent: '' },
    progressFill: { style: { width: '' } },
    progressPercent: { textContent: '' },
    progressCounts: { textContent: '' },
    progressCurrent: { textContent: '' },
    progressDelay: { textContent: '' },
    progressSecurity: { textContent: '' },
    progressSummary: { textContent: '' },
    cancelSendBtn: { disabled: false, innerHTML: '' },
    progressModal: { classList: { add: () => {}, remove: () => {} } },
    taskDock: mockTaskDock,
    TASK_DOCK_STATES: {
      RUNNING: 'running',
      PAUSED: 'paused',
      COMPLETED: 'completed',
      ERROR: 'error',
      HIDDEN: 'hidden'
    }
  };

  // showProgress
  feedback.showProgress.call(mockContext, 'Iniciando campaña test');
  assert.equal(dockStates.length, 1);
  assert.equal(dockStates[0].state, 'running');
  assert.equal(dockStates[0].payload.title, 'Iniciando campaña test');

  // updateSendProgress con estado running
  feedback.updateSendProgress.call(mockContext, {
    percent: 50,
    total: 10,
    processed: 5,
    success: 5,
    failed: 0,
    status: 'running',
    currentLabel: '59174447830'
  });

  assert.ok(dockStates.length >= 2);
  const lastState = dockStates[dockStates.length - 1];
  assert.equal(lastState.state, 'running');
  assert.equal(lastState.payload.percent, 50);

  // updateSendProgress con cooldown / paused
  feedback.updateSendProgress.call(mockContext, {
    percent: 50,
    total: 10,
    processed: 5,
    success: 5,
    failed: 0,
    status: 'cooldown',
    waitSeconds: 15
  });
  const cooldownState = dockStates[dockStates.length - 1];
  assert.equal(cooldownState.state, 'paused');

  // updateSendProgress con completed
  feedback.updateSendProgress.call(mockContext, {
    percent: 100,
    total: 10,
    processed: 10,
    success: 10,
    failed: 0,
    status: 'completed'
  });
  const completedState = dockStates[dockStates.length - 1];
  assert.equal(completedState.state, 'completed');
});

test('Feedback: showQrCanvas, showSessionLoading y hideQr gestionan el modal de autenticación QR', () => {
  const feedback = require('../src/renderer/js/modules/ui/feedback');

  const classes = {
    qrModal: new Set(['hidden']),
    qrContentArea: new Set(),
    sessionLoadingArea: new Set(['hidden'])
  };

  const createClassList = (name) => ({
    add: (cls) => classes[name].add(cls),
    remove: (cls) => classes[name].delete(cls),
    contains: (cls) => classes[name].has(cls)
  });

  const children = [];
  const mockContext = {
    qrModal: { classList: createClassList('qrModal') },
    qrContentArea: { classList: createClassList('qrContentArea') },
    sessionLoadingArea: { classList: createClassList('sessionLoadingArea') },
    qrContainer: {
      innerHTML: '',
      appendChild: (child) => children.push(child)
    },
    sessionLoadingStatusText: { textContent: '' },
    sessionSyncCounter: { textContent: '' },
    sessionProgressFill: { style: { width: '' } },
    sessionLoadingPercentText: { textContent: '' }
  };

  // Mostrar QR Canvas
  const mockCanvas = { tag: 'canvas', id: 'qr-canvas-test' };
  feedback.showQrCanvas.call(mockContext, mockCanvas);

  assert.equal(children.length, 1);
  assert.equal(children[0], mockCanvas);
  assert.equal(classes.qrModal.has('hidden'), false, 'qrModal debe ser visible');
  assert.equal(classes.qrContentArea.has('hidden'), false, 'qrContentArea debe ser visible');
  assert.equal(classes.sessionLoadingArea.has('hidden'), true, 'sessionLoadingArea debe estar oculto');

  // Mostrar Session Loading
  feedback.showSessionLoading.call(mockContext, 'Sincronizando chats...', 'Descargando datos', 65);
  assert.equal(classes.qrContentArea.has('hidden'), true, 'qrContentArea debe ocultarse');
  assert.equal(classes.sessionLoadingArea.has('hidden'), false, 'sessionLoadingArea debe mostrarse');
  assert.equal(mockContext.sessionLoadingStatusText.textContent, 'Sincronizando chats...');
  assert.equal(mockContext.sessionProgressFill.style.width, '65%');

  // Ocultar QR al completar autenticación
  feedback.hideQr.call(mockContext);
  assert.equal(classes.qrModal.has('hidden'), true, 'qrModal debe estar oculto tras hideQr()');
});

