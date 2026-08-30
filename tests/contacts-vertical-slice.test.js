const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contactRules = require('../src/features/contacts/domain/contact-rules');
const {
  filterAndRankContacts,
  parseManualNumbersText,
  normalizeImportedContacts,
  recordRecentInteractions
} = require('../src/features/contacts/application/normalize-contacts');
const {
  toggleContactSelection,
  removeContactSelection,
  clearAllSelectedContacts
} = require('../src/features/contacts/application/select-contacts');
const {
  ContactsIpcGateway
} = require('../src/features/contacts/infrastructure/contacts-ipc-gateway');
const {
  ContactsController
} = require('../src/features/contacts/presentation/contacts-controller');
const contactsActions = require('../src/renderer/js/modules/app/contacts');

// ==========================================
// 1. DOMAIN: CONTACT-RULES
// ==========================================
test('Domain Contacts: normalizeNumber limpia caracteres no numéricos', () => {
  assert.equal(contactRules.normalizeNumber('+591 (7) 894-5612'), '59178945612');
  assert.equal(contactRules.normalizeNumber('abc 123 def 456'), '123456');
  assert.equal(contactRules.normalizeNumber(''), '');
  assert.equal(contactRules.normalizeNumber(null), '');
});

test('Domain Contacts: isValidPhoneNumber valida rangos de longitud telefónica', () => {
  assert.equal(contactRules.isValidPhoneNumber('59178945612'), true);
  assert.equal(contactRules.isValidPhoneNumber('7000123'), true); // 7 dígitos
  assert.equal(contactRules.isValidPhoneNumber('123456'), false); // menor a 7
  assert.equal(contactRules.isValidPhoneNumber('1234567890123456'), false); // mayor a 15
});

test('Domain Contacts: deduplicateContacts conserva primera aparición y orden original', () => {
  const input = [
    { id: '1', number: '+591 70001', name: 'Carlos' },
    { id: '2', number: '59170001', name: 'Carlos Duplicado' },
    { id: '3', number: '59170002', name: 'Maria' },
    { id: '4', number: '591-70002', name: 'Maria Repetida' },
    { id: '5', number: '59170003', name: 'Pedro' }
  ];

  const result = contactRules.deduplicateContacts(input);
  assert.equal(result.length, 3);
  assert.equal(result[0].name, 'Carlos');
  assert.equal(result[1].name, 'Maria');
  assert.equal(result[2].name, 'Pedro');
});

test('Domain Contacts: matchesContactSearch evalúa coincidencia insensible a mayúsculas', () => {
  const contact = { id: '1', name: 'Alejandro Morales', number: '59178945612' };
  assert.equal(contactRules.matchesContactSearch(contact, 'alejandro'), true);
  assert.equal(contactRules.matchesContactSearch(contact, 'MORALES'), true);
  assert.equal(contactRules.matchesContactSearch(contact, '78945'), true);
  assert.equal(contactRules.matchesContactSearch(contact, 'rodriguez'), false);
  assert.equal(contactRules.matchesContactSearch(contact, ''), true);
});

test('Domain Contacts: formatContactId construye JID de WhatsApp', () => {
  assert.equal(contactRules.formatContactId('+591 78945612'), '59178945612@c.us');
  assert.equal(contactRules.formatContactId(''), '');
});

test('Domain Contacts: sortContactsByInteraction prioriza interacciones recientes y luego nombre', () => {
  const contacts = [
    { id: '1', name: 'Zulma', number: '59170001' },
    { id: '2', name: 'Andres', number: '59170002' },
    { id: '3', name: 'Beatriz', number: '59170003' }
  ];

  const interactionState = {
    lastInteractionById: { '2': 1000, '3': 2000 },
    lastInteractionByNumber: {}
  };

  const sorted = contactRules.sortContactsByInteraction(contacts, interactionState);
  assert.equal(sorted[0].name, 'Beatriz', 'Beatriz debe ser primera por tener el timestamp más alto');
  assert.equal(sorted[1].name, 'Andres', 'Andres debe ser segundo');
  assert.equal(sorted[2].name, 'Zulma', 'Zulma sin interacción queda al final');
});

// ==========================================
// 2. APPLICATION: NORMALIZE & SELECT
// ==========================================
test('Application Contacts: filterAndRankContacts filtra por término y decora estado de envío', () => {
  const contacts = [
    { id: '1', name: 'Wilson Eguez', number: '59178945612' },
    { id: '2', name: 'Juan Perez', number: '59170000000' }
  ];

  const statusMock = (id) => (id === '1' ? { sentToday: true, lastSentAt: '2026-08-30T00:00:00.000Z' } : { sentToday: false, lastSentAt: null });

  const result = filterAndRankContacts({
    contacts,
    searchTerm: 'wilson',
    getDestinationStatusFn: statusMock
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Wilson Eguez');
  assert.equal(result[0].sentToday, true);
  assert.equal(result[0].lastSentAt, '2026-08-30T00:00:00.000Z');
});

test('Application Contacts: parseManualNumbersText parsea tokens y reconcilia con catálogo', () => {
  const existingContacts = [
    { id: '1', name: 'Wilson Contacto', number: '59178945612' }
  ];
  const currentSelected = [];

  const rawText = '59178945612, 59171112233\n59174445566 123'; // 123 es inválido por <7 dígitos

  const parsed = parseManualNumbersText(rawText, { existingContacts, currentSelected });
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].name, 'Wilson Contacto', 'Debe reconciliar con el contacto existente');
  assert.equal(parsed[1].number, '59171112233');
  assert.equal(parsed[1].id, '59171112233@c.us', 'Debe generar JID automático para nuevos');
  assert.equal(parsed[2].number, '59174445566');
});

test('Application Contacts: toggleContactSelection alterna selección adecuadamente', () => {
  const catalog = [
    { id: 'c1', name: 'Contacto 1', number: '5917001' },
    { id: 'c2', name: 'Contacto 2', number: '5917002' }
  ];

  // Agregar c1
  const step1 = toggleContactSelection([], catalog, 'c1');
  assert.equal(step1.action, 'added');
  assert.equal(step1.selected.length, 1);
  assert.equal(step1.selected[0].id, 'c1');

  // Quitar c1 (al volver a hacer toggle)
  const step2 = toggleContactSelection(step1.selected, catalog, 'c1');
  assert.equal(step2.action, 'removed');
  assert.equal(step2.selected.length, 0);
});

test('Application Contacts: removeContactSelection y clearAllSelectedContacts', () => {
  const current = [
    { id: 'c1', number: '1' },
    { id: 'c2', number: '2' }
  ];

  const afterRemove = removeContactSelection(current, 'c1');
  assert.equal(afterRemove.length, 1);
  assert.equal(afterRemove[0].id, 'c2');

  const afterClear = clearAllSelectedContacts();
  assert.deepEqual(afterClear, []);
});

test('Application Contacts: recordRecentInteractions actualiza timestamps y sets de auditoría', () => {
  const contacts = [{ id: 'c1', number: '59178945612' }];
  const lastInteractionById = {};
  const lastInteractionByNumber = {};
  const sentTodaySet = new Set();
  const lastSentAtMap = {};

  const res = recordRecentInteractions({
    targets: ['59178945612@c.us'],
    contacts,
    lastInteractionById,
    lastInteractionByNumber,
    sentTodaySet,
    lastSentAtMap
  });

  assert.ok(res.now > 0);
  assert.equal(sentTodaySet.has('59178945612'), true);
  assert.equal(sentTodaySet.has('59178945612@c.us'), true);
  assert.equal(lastInteractionById['c1'], res.now);
  assert.equal(lastInteractionByNumber['59178945612'], res.now);
});

// ==========================================
// 3. INFRASTRUCTURE: CONTACTS-IPC-GATEWAY
// ==========================================
test('Infrastructure Contacts IPC Gateway: canaliza llamadas get-contacts e import-excel-contacts', async () => {
  const calls = [];
  const mockIpcClient = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'get-contacts') {
        return { success: true, contacts: [{ id: '1', number: '123' }] };
      }
      if (channel === 'import-excel-contacts') {
        return { success: true, contacts: [{ number: '456', name: 'Excel' }] };
      }
      return null;
    }
  };

  const gateway = new ContactsIpcGateway(mockIpcClient);

  const getRes = await gateway.getContacts();
  assert.equal(getRes.success, true);
  assert.equal(calls[0].channel, 'get-contacts');

  const importRes = await gateway.importExcelContacts();
  assert.equal(importRes.success, true);
  assert.equal(calls[1].channel, 'import-excel-contacts');
});

// ==========================================
// 4. PRESENTATION: CONTACTS-CONTROLLER
// ==========================================
test('Presentation ContactsController: coordina carga, filtrado y selección manteniendo sincronía', async () => {
  const stateRef = {
    contacts: [],
    filteredContacts: [],
    selectedContacts: [],
    contactSearchTerm: '',
    lastInteractionById: {},
    lastInteractionByNumber: {},
    saveFormData: () => {}
  };

  const mockIpc = {
    invoke: async (channel) => {
      if (channel === 'get-contacts') {
        return {
          success: true,
          contacts: [
            { id: 'c1', name: 'Beatriz', number: '5917001' },
            { id: 'c2', name: 'Carlos', number: '5917002' }
          ]
        };
      }
      return null;
    }
  };

  const controller = new ContactsController({
    stateRef,
    ipcClient: mockIpc
  });

  await controller.loadContacts();
  assert.equal(controller.contacts.length, 2);
  assert.equal(stateRef.contacts.length, 2, 'stateRef debe mantenerse sincronizado');

  controller.selectContact('c1');
  assert.equal(controller.selectedContacts.length, 1);
  assert.equal(stateRef.selectedContacts.length, 1);

  controller.searchTerm = 'carlos';
  controller.applyContactFilter();
  assert.equal(controller.filteredContacts.length, 1);
  assert.equal(controller.filteredContacts[0].name, 'Carlos');
});

// ==========================================
// 5. REGRESIÓN ARQUITECTÓNICA
// ==========================================
test('Arquitectura Contacts: contact-rules.js NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/contacts/domain/contact-rules.js'),
    'utf8'
  );

  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('AppController'), 'No debe referenciar AppController');
});

test('Arquitectura Contacts: normalize-contacts.js y select-contacts.js son independientes del DOM', () => {
  const codeNormalize = fs.readFileSync(
    path.resolve(__dirname, '../src/features/contacts/application/normalize-contacts.js'),
    'utf8'
  );
  const codeSelect = fs.readFileSync(
    path.resolve(__dirname, '../src/features/contacts/application/select-contacts.js'),
    'utf8'
  );

  assert.ok(!codeNormalize.includes('document.'), 'normalize-contacts no debe referenciar document');
  assert.ok(!codeNormalize.includes('window.'), 'normalize-contacts no debe referenciar window');
  assert.ok(!codeSelect.includes('document.'), 'select-contacts no debe referenciar document');
  assert.ok(!codeSelect.includes('window.'), 'select-contacts no debe referenciar window');
});

test('Arquitectura Contacts: contacts.js actúa como adaptador delgado (< 100 líneas)', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app/contacts.js'),
    'utf8'
  );

  const lines = code.split('\n').length;
  assert.ok(lines < 100, `contacts.js debe tener menos de 100 líneas, tiene ${lines}`);
  assert.ok(code.includes('ContactsController'), 'contacts.js debe delegar a ContactsController');
});

test('Compatibilidad Contacts: AppController y contacts.js exponen todos los contratos públicos esperados', () => {
  assert.equal(typeof contactsActions.applyContactFilter, 'function');
  assert.equal(typeof contactsActions.selectContact, 'function');
  assert.equal(typeof contactsActions.removeSelectedContact, 'function');
  assert.equal(typeof contactsActions.clearSelectedContacts, 'function');
  assert.equal(typeof contactsActions.syncManualNumbers, 'function');
  assert.equal(typeof contactsActions.importExcelContacts, 'function');
  assert.equal(typeof contactsActions.loadContacts, 'function');
  assert.equal(typeof contactsActions.markContactsAsRecentlyMessaged, 'function');
});
