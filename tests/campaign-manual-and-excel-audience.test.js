/**
 * WhatsApp Sender Electron - Automated Test Suite
 * Feature: Campaign Dispatcher Manual Input and External/Excel Audience Recognition (v3.7.1)
 * 
 * Verificación:
 * 1. Extracción inteligente de tokens telefónicos con espacios (+591 7444 7830), comas y saltos de línea.
 * 2. parseManualNumbersText crea contactos válidos para números no guardados en la agenda.
 * 3. renderSelectedContacts respeta updateNumbersField=false para permitir escritura manual fluida sin borrado.
 * 4. updateContactCounter cuenta correctamente números con comas, saltos de línea y espacios.
 * 5. Importación de Excel y sincronización manual disparan onSelectionChange.
 * 6. CampaignAudience y Safety Inspector reconocen los destinatarios aunque no estén en la agenda.
 * 7. validateCampaign y prepareCampaignPayload procesan destinatarios externos (7 a 15 dígitos).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// Domain & Application
const {
  extractNumberTokens,
  parseManualNumbersText,
  normalizeImportedContacts
} = require('../src/features/contacts/application/normalize-contacts');

const {
  CampaignAudience
} = require('../src/renderer/js/modules/campaign/campaign-audience');

const {
  inspectCampaignSafety,
  SAFETY_STATUS
} = require('../src/features/messaging/domain/risk-policy');

const {
  validateCampaign
} = require('../src/features/messaging/domain/campaign-validator');

const {
  prepareCampaignPayload,
  buildContactContexts
} = require('../src/features/messaging/application/prepare-campaign');

// Presentation
const {
  ContactsController
} = require('../src/features/contacts/presentation/contacts-controller');

const renderers = require('../src/renderer/js/modules/ui/renderers');

// ============================================================================
// 1. EXTRACCIÓN Y PARSEO INTELIGENTE DE NÚMEROS MANUALES
// ============================================================================

test('Manual Input 1: extractNumberTokens maneja números con espacios internos, prefijos y saltos de línea', () => {
  const input = `+591 7444 7830, 591 7111 2233
78945612
+54 9 11 2345 6789; 591-70001122`;

  const tokens = extractNumberTokens(input);
  assert.deepEqual(tokens, [
    '59174447830',
    '59171112233',
    '78945612',
    '5491123456789',
    '59170001122'
  ]);
});

test('Manual Input 2: extractNumberTokens no genera tokens inválidos si el usuario apenas está escribiendo', () => {
  assert.deepEqual(extractNumberTokens('5'), []);
  assert.deepEqual(extractNumberTokens('591'), []);
  assert.deepEqual(extractNumberTokens(''), []);
  assert.deepEqual(extractNumberTokens('   '), []);
});

test('Manual Input 3: parseManualNumbersText crea contactos estructurados para números no guardados en la agenda', () => {
  const existingContacts = [
    { id: '59170000000@c.us', name: 'Contacto Guardado', number: '59170000000' }
  ];

  // El usuario ingresa 1 número guardado y 2 números no registrados
  const rawText = '59170000000, 59174447830, 59171112233';
  const selected = parseManualNumbersText(rawText, { existingContacts });

  assert.equal(selected.length, 3);
  assert.equal(selected[0].name, 'Contacto Guardado'); // Reconciliado
  assert.equal(selected[1].number, '59174447830'); // Externo
  assert.equal(selected[1].id, '59174447830@c.us');
  assert.equal(selected[2].number, '59171112233'); // Externo
  assert.equal(selected[2].id, '59171112233@c.us');
});

// ============================================================================
// 2. ESCRITURA EN EL TEXTAREA SIN BORRADO (updateNumbersField = false)
// ============================================================================

test('UI Input 1: renderSelectedContacts respeta updateNumbersField=false y no sobreescribe el textarea mientras se escribe', () => {
  const fakeContext = {
    selectedContactsChips: { innerHTML: '' },
    selectedContactsCount: { textContent: '' },
    numbersField: { value: '591' }, // Usuario tipeando
    totalContactsElement: { textContent: '' }
  };

  // Cuando contacts está vacío y updateNumbersField=false (escribiendo el primer dígito)
  renderers.renderSelectedContacts.call(fakeContext, [], false);

  // El valor del textarea NO debe ser borrado
  assert.equal(fakeContext.numbersField.value, '591');
  assert.equal(fakeContext.selectedContactsCount.textContent, '0 seleccionados');

  // Cuando updateNumbersField=true (ej: click en limpiar todo)
  renderers.renderSelectedContacts.call(fakeContext, [], true);
  assert.equal(fakeContext.numbersField.value, '');
});

test('UI Input 2: updateContactCounter calcula correctamente con saltos de línea y comas', () => {
  const fakeContext = {
    totalContactsElement: { textContent: '' }
  };

  renderers.updateContactCounter.call(fakeContext, '59174447830, 59171112233');
  assert.equal(fakeContext.totalContactsElement.textContent, '2');

  renderers.updateContactCounter.call(fakeContext, "59174447830\n59171112233\n59170001122");
  assert.equal(fakeContext.totalContactsElement.textContent, '3');
});

// ============================================================================
// 3. SELECCIÓN, IMPORTACIÓN DE EXCEL Y NOTIFICACIÓN DE AUDIENCIA
// ============================================================================

test('ContactsController 1: syncManualNumbers dispara onSelectionChange con los destinatarios externos', () => {
  let notifiedContacts = null;
  const controller = new ContactsController({
    onSelectionChange: (contacts) => {
      notifiedContacts = contacts;
    }
  });

  controller.syncManualNumbers('59174447830, 59171112233');

  assert.ok(Array.isArray(notifiedContacts));
  assert.equal(notifiedContacts.length, 2);
  assert.equal(notifiedContacts[0].number, '59174447830');
  assert.equal(notifiedContacts[1].number, '59171112233');
});

test('ContactsController 2: importExcelContacts actualiza selectedContacts y notifica onSelectionChange aunque no existan en contacts', async () => {
  let notifiedContacts = null;
  const mockGateway = {
    importExcelContacts: async () => ({
      success: true,
      contacts: [
        { id: '59171234567@c.us', name: 'Cliente Potencial 1', number: '59171234567' },
        { id: '59179876543@c.us', name: 'Cliente Potencial 2', number: '59179876543' }
      ]
    })
  };

  const controller = new ContactsController({
    onSelectionChange: (contacts) => {
      notifiedContacts = contacts;
    }
  });
  controller.gateway = mockGateway;
  controller.contacts = []; // Ningún contacto en la agenda de WhatsApp

  await controller.importExcelContacts();

  assert.equal(controller.selectedContacts.length, 2);
  assert.ok(Array.isArray(notifiedContacts));
  assert.equal(notifiedContacts.length, 2);
  assert.equal(notifiedContacts[0].name, 'Cliente Potencial 1');
  assert.equal(notifiedContacts[1].name, 'Cliente Potencial 2');
});

// ============================================================================
// 4. CAMPAIGN AUDIENCE Y SEGURIDAD PARA DESTINATARIOS EXTERNOS
// ============================================================================

test('CampaignAudience 1: Reconoce y totaliza destinatarios no registrados en la agenda', () => {
  const audience = new CampaignAudience();
  audience.setSource('contacts');

  // Destinatarios sin libreta de contactos
  audience.setSelectedContacts([
    { id: '59174447830@c.us', name: '59174447830', number: '59174447830' },
    { id: '59171112233@c.us', name: '59171112233', number: '59171112233' }
  ]);

  assert.equal(audience.getContactsCount(), 2);
  assert.equal(audience.getActiveRecipientsCount(), 2);
  assert.equal(audience.isValid(), true);
});

test('Safety Inspector 1: Habilita el despacho (READY) y aprueba audiencia para destinatarios externos', () => {
  const targetCount = 2; // Dos destinatarios externos
  const inspection = inspectCampaignSafety({
    targetCount,
    alreadySentCount: 0,
    delayMin: 12,
    delayMax: 22,
    complianceMode: true,
    hasFiles: false,
    profile: 'medium'
  });

  assert.equal(inspection.status, SAFETY_STATUS.READY);
  assert.equal(inspection.checks.audience.valid, true);
  assert.equal(inspection.checks.audience.label, '2 destinatario(s) seleccionado(s)');
  assert.ok(inspection.score < 40);
});

// ============================================================================
// 5. VALIDACIÓN Y PREPARACIÓN DE PAYLOAD CON DESTINATARIOS EXTERNOS
// ============================================================================

test('Payload & Validation 1: validateCampaign aprueba campaña con números válidos de 7 a 15 dígitos', () => {
  const selectedContacts = [
    { id: '74447830@c.us', name: 'Local 8 digitos', number: '74447830' },
    { id: '59171112233@c.us', name: 'Con codigo de pais', number: '59171112233' }
  ];

  const payload = prepareCampaignPayload({
    mode: 'contacts',
    selectedContacts,
    delayMin: 12,
    delayMax: 22,
    messagePayload: {
      messagePrimary: 'Hola {{nombre}}, recordatorio de charla',
      messageList: ['Hola {{nombre}}, recordatorio de charla']
    }
  });

  assert.equal(payload.numbers, '74447830,59171112233');
  assert.equal(payload.contactContexts.length, 2);

  const validation = validateCampaign({
    mode: 'contacts',
    payload,
    selectedContacts,
    authState: { isValidated: true },
    isWhatsAppReady: true
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
});

test('MessagingController: sendBatch resuelve correctamente el módulo sending sin errores de require', async () => {
  const { MessagingController } = require('../src/features/messaging/presentation/messaging-controller');
  const controller = new MessagingController();

  global.document = {
    getElementById: () => ({ value: '12', checked: true })
  };

  controller.stateRef = {
    modeConfig: require('../src/renderer/js/modules/app/mode-config'),
    campaignRiskByMode: { contacts: { level: 'green' } },
    ui: {
      showToast: () => {},
      showProgress: () => {},
      hideProgress: () => {},
      getSelectedGroupIds: () => []
    },
    filesByMode: { contacts: [] },
    selectedContacts: [],
    authState: { isValidated: false }
  };

  try {
    // No debe lanzar "Cannot find module"
    await controller.sendBatch('contacts');
  } finally {
    delete global.document;
  }
});

test('MessagingController: selectFiles carga y renderiza archivos recibidos como Array desde IPC', async () => {
  const { MessagingController } = require('../src/features/messaging/presentation/messaging-controller');
  const controller = new MessagingController();

  controller.gateway = {
    selectFiles: async () => [
      { path: 'C:/docs/brochure.pdf', name: 'brochure.pdf' },
      { path: 'C:/docs/promo.png', name: 'promo.png' }
    ]
  };

  let renderedMode = null;
  let renderedFiles = null;
  controller.ui = {
    renderFiles: (mode, files) => {
      renderedMode = mode;
      renderedFiles = files;
    },
    showToast: () => {}
  };
  controller.refreshRiskPanel = () => {};

  await controller.selectFiles('contacts');

  assert.equal(renderedMode, 'contacts');
  assert.ok(Array.isArray(renderedFiles));
  assert.equal(renderedFiles.length, 2);
  assert.equal(renderedFiles[0].name, 'brochure.pdf');
  assert.equal(renderedFiles[1].name, 'promo.png');
  assert.equal(controller.filesByMode.contacts.length, 2);
});

test('MessagingController: selectFiles evita duplicados y respeta límite de maxFiles', async () => {
  const { MessagingController } = require('../src/features/messaging/presentation/messaging-controller');
  const controller = new MessagingController({
    modeConfig: {
      contacts: { maxFiles: 3 }
    }
  });

  controller.filesByMode = {
    contacts: [{ path: 'C:/docs/file1.pdf', name: 'file1.pdf' }],
    groups: []
  };

  controller.gateway = {
    selectFiles: async () => [
      { path: 'C:/docs/file1.pdf', name: 'file1.pdf' },
      { path: 'C:/docs/file2.pdf', name: 'file2.pdf' },
      { path: 'C:/docs/file3.pdf', name: 'file3.pdf' },
      { path: 'C:/docs/file4.pdf', name: 'file4.pdf' }
    ]
  };

  controller.ui = { renderFiles: () => {}, showToast: () => {} };
  controller.refreshRiskPanel = () => {};

  await controller.selectFiles('contacts');

  assert.equal(controller.filesByMode.contacts.length, 3);
  assert.equal(controller.filesByMode.contacts[0].name, 'file1.pdf');
  assert.equal(controller.filesByMode.contacts[1].name, 'file2.pdf');
  assert.equal(controller.filesByMode.contacts[2].name, 'file3.pdf');
});


