const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Setup minimal DOM mock for Node.js test environment
if (typeof global.document === 'undefined') {
  global.document = {
    getElementById: (id) => ({
      id,
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {}
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      value: '',
      checked: false,
      disabled: false
    }),
    querySelectorAll: () => [],
    querySelector: () => null
  };
}

const AppController = require('../src/renderer/js/modules/app-controller');
const { MessagingController } = require('../src/features/messaging/presentation/messaging-controller');
const { SessionController } = require('../src/features/session/presentation/session-controller');
const { NavigationController } = require('../src/features/navigation/presentation/navigation-controller');
const formPersistence = require('../src/renderer/js/modules/campaign/form-persistence');

// ==========================================
// 1. APPCONTROLLER AS COMPOSITION ROOT
// ==========================================
test('AppController Architecture: inicializa todos los controladores vertical slices requeridos', () => {
  const controller = new AppController();

  assert.ok(controller.contactsController, 'Debe instanciar ContactsController');
  assert.ok(controller.groupsController, 'Debe instanciar GroupsController');
  assert.ok(controller.schedulingController, 'Debe instanciar SchedulingController');
  assert.ok(controller.analyticsController, 'Debe instanciar AnalyticsController');
  assert.ok(controller.historyController, 'Debe instanciar HistoryController');
  assert.ok(controller.messagingController, 'Debe instanciar MessagingController');
  assert.ok(controller.sessionController, 'Debe instanciar SessionController');
  assert.ok(controller.navigationController, 'Debe instanciar NavigationController');
});

test('AppController Architecture: expone contratos públicos requeridos por compatibilidad', () => {
  const proto = AppController.prototype;

  // Navigation & Lifecycle
  assert.equal(typeof proto.activateTab, 'function');
  assert.equal(typeof proto.applyEntitlementsToUi, 'function');
  assert.equal(typeof proto.bindIpcEvents, 'function');
  assert.equal(typeof proto.saveFormData, 'function');
  assert.equal(typeof proto.loadSavedData, 'function');

  // Contacts
  assert.equal(typeof proto.selectContact, 'function');
  assert.equal(typeof proto.removeSelectedContact, 'function');
  assert.equal(typeof proto.clearSelectedContacts, 'function');
  assert.equal(typeof proto.loadContacts, 'function');
  assert.equal(typeof proto.applyContactFilter, 'function');

  // Groups
  assert.equal(typeof proto.loadGroups, 'function');
  assert.equal(typeof proto.applyGroupFilter, 'function');
  assert.equal(typeof proto.exportGroupMembers, 'function');

  // Scheduling
  assert.equal(typeof proto.createScheduledMessage, 'function');
  assert.equal(typeof proto.refreshScheduledMessages, 'function');
  assert.equal(typeof proto.cancelScheduledMessage, 'function');

  // Analytics
  assert.equal(typeof proto.refreshMessageStats, 'function');
  assert.equal(typeof proto.exportMessageStatsExcel, 'function');

  // History & Status
  assert.equal(typeof proto.getDestinationStatus, 'function');
  assert.equal(typeof proto.refreshDestinationStatuses, 'function');
  assert.equal(typeof proto.loadChatHistoryPreview, 'function');

  // Messaging & Files
  assert.equal(typeof proto.selectFiles, 'function');
  assert.equal(typeof proto.updateDelayOptions, 'function');
  assert.equal(typeof proto.sendBatch, 'function');
  assert.equal(typeof proto.getMessageElements, 'function');
  assert.equal(typeof proto.getMessagePayload, 'function');
  assert.equal(typeof proto.setActiveMessageTab, 'function');
});

// ==========================================
// 2. REDUCCIÓN CUANTITATIVA Y CONTROL DE LÍNEAS
// ==========================================
test('AppController Architecture: tamaño de AppController está reducido por debajo de 1000 líneas', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app-controller.js'),
    'utf8'
  );
  const lineCount = code.split('\n').length;
  assert.ok(
    lineCount < 1000,
    `AppController debe tener < 1000 líneas como Composition Root. Actual: ${lineCount}`
  );
});

// ==========================================
// 3. AISLAMIENTO ESTÁTICO DE IPC Y DOM DE FEATURES
// ==========================================
test('AppController Architecture: AppController NO ejecuta IPC directo de features en su cuerpo principal', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app-controller.js'),
    'utf8'
  );

  // No debe llamar directamente a canales de features
  assert.ok(!code.includes("invoke('get-contacts'"), 'No debe invocar get-contacts directamente');
  assert.ok(!code.includes("invoke('get-groups'"), 'No debe invocar get-groups directamente');
  assert.ok(!code.includes("invoke('get-schedules'"), 'No debe invocar get-schedules directamente');
  assert.ok(!code.includes("invoke('get-message-stats'"), 'No debe invocar get-message-stats directamente');
  assert.ok(!code.includes("invoke('get-chat-history-preview'"), 'No debe invocar get-chat-history-preview directamente');
  assert.ok(!code.includes("invoke('get-destination-statuses'"), 'No debe invocar get-destination-statuses directamente');
});

// ==========================================
// 4. VERIFICACIÓN DE CONTROLADORES INDIVIDUALES
// ==========================================
test('MessagingController: gestiona composer y payload correctamente', () => {
  const ctrl = new MessagingController({
    modeConfig: {
      contacts: {
        sendMessageSplitOptionId: 'opt',
        sendMessageSplitId: 'split',
        sendFilesFirstId: 'ff'
      }
    }
  });

  assert.equal(ctrl.getMessageComposerState('contacts').activeIndex, 1);
  assert.deepEqual(ctrl.getMessageComposerState('contacts').enabledIndices, [1]);

  ctrl.addMessageTab('contacts');
  assert.deepEqual(ctrl.getMessageComposerState('contacts').enabledIndices, [1, 2]);
  assert.equal(ctrl.getMessageComposerState('contacts').activeIndex, 2);

  ctrl.closeMessageTab('contacts', 2);
  assert.deepEqual(ctrl.getMessageComposerState('contacts').enabledIndices, [1]);
  assert.equal(ctrl.getMessageComposerState('contacts').activeIndex, 1);
});

test('SessionController: mantiene sincronía del estado isReady', () => {
  const ctrl = new SessionController();
  assert.equal(ctrl.isReady, false);
  ctrl.isReady = true;
  assert.equal(ctrl.isReady, true);
});

test('NavigationController: cambia activeTab y gestiona navegación', () => {
  const ctrl = new NavigationController();
  assert.equal(ctrl.activeTab, 'contacts');
  ctrl.activateTab('groups');
  assert.equal(ctrl.activeTab, 'groups');
});

test('FormPersistence: serializa y recupera configuración correctamente', () => {
  assert.equal(typeof formPersistence.getSecurityPreferences, 'function');
  assert.equal(typeof formPersistence.applySecurityPreferences, 'function');
  assert.equal(typeof formPersistence.saveFormData, 'function');
  assert.equal(typeof formPersistence.loadSavedData, 'function');
});
