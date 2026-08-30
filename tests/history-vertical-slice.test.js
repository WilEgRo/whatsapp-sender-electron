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
        toggle: () => {},
        contains: () => false
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      value: '',
      textContent: '',
      innerHTML: '',
      disabled: false,
      scrollTop: 0,
      scrollHeight: 100
    }),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  };
}

const conversationRules = require('../src/features/history/domain/conversation-rules');
const historyRules = require('../src/features/history/domain/history-rules');
const { loadConversation } = require('../src/features/history/application/load-conversation');
const { loadInitialConversation, loadOlderMessages } = require('../src/features/history/application/paginate-conversation');
const {
  formatConversationTxt,
  formatConversationHtml,
  formatConversationJson,
  exportConversation
} = require('../src/features/history/application/export-conversation');
const { HistoryIpcGateway } = require('../src/features/history/infrastructure/history-ipc-gateway');
const historyView = require('../src/features/history/presentation/history-view');
const { HistoryController } = require('../src/features/history/presentation/history-controller');
const legacyHistory = require('../src/renderer/js/modules/app/history');
const AppController = require('../src/renderer/js/modules/app-controller');

// ==========================================
// 1. DOMAIN: CONVERSATION RULES
// ==========================================
test('Domain 1: Normalización del target produce modelo uniforme para contactos y grupos', () => {
  const contact = conversationRules.normalizeConversationTarget({ id: 'c1', name: 'Wilson', number: '78945612' }, 'contacts');
  assert.equal(contact.id, 'c1');
  assert.equal(contact.name, 'Wilson');
  assert.equal(contact.type, 'contacts');
  assert.equal(contact.identifier, '78945612');

  const groupString = conversationRules.normalizeConversationTarget('123456789@g.us');
  assert.equal(groupString.id, '123456789@g.us');
  assert.equal(groupString.type, 'groups');
});

test('Domain 2: Identificación de contacto/grupo mediante getters semánticos', () => {
  const contact = { id: 'c_99', name: 'Carlos' };
  assert.equal(conversationRules.getConversationTargetId(contact), 'c_99');
  assert.equal(conversationRules.getConversationTargetName(contact), 'Carlos');
});

test('Domain 3: Dirección incoming / outgoing detecta remitente correctamente', () => {
  const msgOut = { fromMe: true, text: 'Hola' };
  const msgIn = { fromMe: false, sender: 'Ana', text: 'Buenas' };

  assert.equal(conversationRules.isOutgoingMessage(msgOut), true);
  assert.equal(conversationRules.isIncomingMessage(msgOut), false);
  assert.equal(conversationRules.getMessageDirection(msgOut), 'outgoing');

  assert.equal(conversationRules.isOutgoingMessage(msgIn), false);
  assert.equal(conversationRules.isIncomingMessage(msgIn), true);
  assert.equal(conversationRules.getMessageDirection(msgIn), 'incoming');
});

test('Domain 4: Ordenamiento cronológico preserva inmutabilidad', () => {
  const m1 = { timestampIso: '2026-08-30T10:00:00Z', text: 'Primero' };
  const m2 = { timestampIso: '2026-08-30T12:00:00Z', text: 'Segundo' };
  const m3 = { timestampIso: '2026-08-30T08:00:00Z', text: 'Antes' };

  const unsorted = [m1, m2, m3];
  const sorted = conversationRules.sortMessagesChronologically(unsorted, 'asc');

  assert.equal(sorted[0].text, 'Antes');
  assert.equal(sorted[1].text, 'Primero');
  assert.equal(sorted[2].text, 'Segundo');
  assert.equal(unsorted[0].text, 'Primero', 'No debe mutar el arreglo original');
});

test('Domain 5: Agrupación por día clasifica mensajes cronológicos bajo el mismo encabezado', () => {
  const msgs = [
    { timestampIso: '2026-08-29T14:00:00Z', text: 'Ayer mensaje 1' },
    { timestampIso: '2026-08-29T15:00:00Z', text: 'Ayer mensaje 2' },
    { timestampIso: '2026-08-30T10:00:00Z', text: 'Hoy mensaje 1' }
  ];

  const grouped = conversationRules.groupMessagesByDay(msgs);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].messages.length, 2);
  assert.equal(grouped[1].messages.length, 1);
});

test('Domain 6: Formateo de fecha y hora produce cadenas legibles', () => {
  const iso = '2026-08-30T14:35:00Z';
  const timeStr = conversationRules.formatMessageTime(iso);
  assert.ok(timeStr.includes(':'), 'Debe formatear hora como HH:mm');

  const dateStr = conversationRules.formatConversationDate(iso);
  assert.ok(dateStr.length > 0);
});

test('Domain 7: Eliminación de duplicados en history-rules preserva unicidad de IDs', () => {
  const existing = [{ id: '1', text: 'Uno' }, { id: '2', text: 'Dos' }];
  const incoming = [{ id: '2', text: 'Dos repetido' }, { id: '3', text: 'Tres' }];

  const merged = historyRules.deduplicateMessages(existing, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, '1');
  assert.equal(merged[1].id, '2');
  assert.equal(merged[2].id, '3');
});

// ==========================================
// 2. APPLICATION: LOAD, PAGINATE & EXPORT
// ==========================================
test('Application 8 & 12: Carga inicial y normalización de modelo de conversación', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId, limit }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Cliente VIP',
        items: [
          { id: 'm1', fromMe: false, text: 'Hola', timestampIso: '2026-08-30T10:00:00Z' },
          { id: 'm2', fromMe: true, text: 'Hola, ¿en qué ayudo?', timestampIso: '2026-08-30T10:01:00Z' }
        ]
      }
    })
  };

  const result = await loadConversation({
    gateway: mockGateway,
    target: { id: '59178945612@c.us', name: 'Cliente' },
    limit: 50
  });

  assert.equal(result.target.id, '59178945612@c.us');
  assert.equal(result.target.name, 'Cliente VIP');
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[0].isOutgoing, false);
  assert.equal(result.messages[1].isOutgoing, true);
  assert.equal(result.pagination.totalLoaded, 2);
  assert.equal(result.metadata.totalMessages, 2);
});

test('Application 9 & 10: Paginación y cálculo de hasMore', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ limit }) => {
      const items = [];
      for (let i = 0; i < limit; i++) {
        items.push({ id: `msg_${i}`, text: `Msg ${i}`, fromMe: i % 2 === 0, timestampIso: new Date(1700000000000 + i * 1000).toISOString() });
      }
      return { success: true, result: { items } };
    }
  };

  const initial = await loadInitialConversation({
    gateway: mockGateway,
    target: { id: 'target_1' },
    pageSize: 50
  });

  assert.equal(initial.messages.length, 50);
  assert.equal(initial.pagination.hasMore, true);

  const older = await loadOlderMessages({
    gateway: mockGateway,
    currentConversation: initial,
    pageSize: 50
  });

  assert.equal(older.messages.length, 100);
});

test('Application 11 & 13: Cambio de conversación y protección contra duplicados', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        items: [{ id: `${chatId}_m1`, text: `Mensaje de ${chatId}` }]
      }
    })
  };

  const convA = await loadInitialConversation({ gateway: mockGateway, target: { id: 'A' } });
  const convB = await loadInitialConversation({ gateway: mockGateway, target: { id: 'B' } });

  assert.equal(convA.target.id, 'A');
  assert.equal(convB.target.id, 'B');
  assert.notEqual(convA.messages[0].id, convB.messages[0].id);
});

test('Application 14: Preparación de exportación genera TXT, HTML, PDF y JSON legibles', () => {
  const conversation = {
    target: { id: '123', name: 'Martha Gómez', type: 'contacts', identifier: '78945612' },
    messages: [
      { id: '1', text: 'Consulta sobre precios', isOutgoing: false, senderLabel: 'Martha Gómez', timestampIso: '2026-08-30T10:00:00Z' },
      { id: '2', text: 'Aquí tienes la lista completa', isOutgoing: true, senderLabel: 'Yo', timestampIso: '2026-08-30T10:02:00Z' }
    ],
    metadata: {
      firstMessageDate: '2026-08-30T10:00:00Z',
      lastMessageDate: '2026-08-30T10:02:00Z'
    }
  };

  const txt = exportConversation({ conversation, format: 'txt' });
  assert.ok(txt.content.includes('HISTORIAL DE CONVERSACIÓN'));
  assert.ok(txt.content.includes('Martha Gómez'));
  assert.equal(txt.extension, 'txt');

  const html = exportConversation({ conversation, format: 'html' });
  assert.ok(html.content.includes('<!DOCTYPE html>'));
  assert.ok(html.content.includes('Martha Gómez'));
  assert.equal(html.extension, 'html');

  const pdf = exportConversation({ conversation, format: 'pdf' });
  assert.ok(pdf.content.includes('@media print'));

  const json = exportConversation({ conversation, format: 'json' });
  const parsed = JSON.parse(json.content);
  assert.equal(parsed.messages.length, 2);
  assert.equal(json.extension, 'json');
});

// ==========================================
// 3. INFRASTRUCTURE: GATEWAY
// ==========================================
test('Infrastructure 15: HistoryIpcGateway invoca canales IPC correspondientes', async () => {
  const calls = [];
  const mockIpc = {
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      return { success: true, result: { items: [] } };
    }
  };

  const gateway = new HistoryIpcGateway(mockIpc);
  await gateway.getChatHistoryPreview({ chatId: 'chat_123', limit: 50 });
  await gateway.getConversation({ targetId: 'chat_456', limit: 30 });
  await gateway.getDestinationStatuses({ destinationType: 'contacts', destinationIds: ['c1'] });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].channel, 'get-chat-history-preview');
  assert.equal(calls[0].payload.chatId, 'chat_123');
  assert.equal(calls[1].channel, 'get-chat-history-preview');
  assert.equal(calls[1].payload.chatId, 'chat_456');
  assert.equal(calls[2].channel, 'get-destination-statuses');
});

// ==========================================
// 4. PRESENTATION: HISTORY VIEW
// ==========================================
test('Presentation 16, 17, 18, 19: Renderizado de estados en HistoryView', () => {
  const mockContainer = { innerHTML: '' };

  // Render vacío
  historyView.renderMessagesListHtml(mockContainer, []);
  assert.ok(mockContainer.innerHTML.includes('conv-empty-state'));

  // Render mensajes
  historyView.renderMessagesListHtml(mockContainer, [
    { id: '1', isOutgoing: true, text: 'Hola', timestampIso: '2026-08-30T10:00:00Z' }
  ]);
  assert.ok(mockContainer.innerHTML.includes('conv-bubble-row--outgoing'));
  assert.ok(mockContainer.innerHTML.includes('Hola'));

  // Render carga
  historyView.renderLoadingState(mockContainer, 'Cargando datos...');
  assert.ok(mockContainer.innerHTML.includes('conv-loading-state'));
  assert.ok(mockContainer.innerHTML.includes('Cargando datos...'));

  // Render error
  historyView.renderErrorState(mockContainer, 'Fallo de red');
  assert.ok(mockContainer.innerHTML.includes('conv-error-state'));
  assert.ok(mockContainer.innerHTML.includes('Fallo de red'));
});

// ==========================================
// 5. ARCHITECTURE & REFACTOR VALIDATIONS
// ==========================================
test('Architecture 20: domain/conversation-rules.js no contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/history/domain/conversation-rules.js'),
    'utf8'
  );
  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('sqlite3'), 'No debe referenciar sqlite3');
});

test('Architecture 21: application/load-conversation.js no contiene referencias a DOM ni Electron', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/history/application/load-conversation.js'),
    'utf8'
  );
  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
});

test('Architecture 22: infrastructure/history-ipc-gateway.js encapsula IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/history/infrastructure/history-ipc-gateway.js'),
    'utf8'
  );
  assert.ok(code.includes('getChatHistoryPreview'));
  assert.ok(code.includes('getDestinationStatuses'));
});

test('Architecture 23: legacy modules/app/history.js delega a HistoryController', () => {
  assert.equal(typeof legacyHistory.openConversation, 'function');
  assert.equal(typeof legacyHistory.exportConversation, 'function');
  assert.equal(typeof legacyHistory.bindChatHistoryEvents, 'function');
  assert.equal(typeof legacyHistory.getDestinationStatus, 'function');
});

test('Architecture 24: AppController no contiene consultas directas SQLite ni lógica procedural de historial', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app-controller.js'),
    'utf8'
  );
  assert.ok(!code.includes("invoke('get-chat-history-preview'"), 'No debe invocar IPC directo');
  assert.ok(!code.includes('sqlite3'), 'No debe contener SQL');
});

// ==========================================
// 6. MEMORY & DEFENSIVE LIMITS
// ==========================================
test('Memory 25: HistoryController inicia sin conversaciones cargadas en memoria', () => {
  const ctrl = new HistoryController();
  assert.equal(ctrl.conversation, null, 'Al iniciar, conversation debe ser null');
  assert.equal(ctrl.activeTarget, null, 'Al iniciar, activeTarget debe ser null');
  assert.equal(ctrl.loading, false);
});

test('Memory 26: Cambio de conversación libera inmediatamente la conversación anterior de memoria', async () => {
  let requestedChat = '';
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => {
      requestedChat = chatId;
      return {
        success: true,
        result: {
          chatId,
          items: [{ id: `${chatId}_1`, text: `Mensaje de ${chatId}` }]
        }
      };
    }
  };

  const ctrl = new HistoryController();
  ctrl.gateway = mockGateway;

  // Abrir A
  await ctrl.openConversation({ id: 'contacto_A', name: 'Contacto A' });
  assert.equal(ctrl.activeTarget.id, 'contacto_A');
  assert.equal(ctrl.conversation.target.id, 'contacto_A');
  assert.equal(ctrl.conversation.messages[0].id, 'contacto_A_1');

  // Abrir B: comprueba que el estado de A fue reemplazado por completo
  await ctrl.openConversation({ id: 'contacto_B', name: 'Contacto B' });
  assert.equal(ctrl.activeTarget.id, 'contacto_B');
  assert.equal(ctrl.conversation.target.id, 'contacto_B');
  assert.equal(ctrl.conversation.messages[0].id, 'contacto_B_1');

  // Cerrar: comprueba que la memoria se libera a null
  ctrl.closeConversation();
  assert.equal(ctrl.activeTarget, null);
  assert.equal(ctrl.conversation, null);
});

test('Memory 27: Tamaño de página tiene límites defensivos normalizados', () => {
  assert.equal(historyRules.normalizePageSize(5), historyRules.DEFAULT_PAGE_SIZE);
  assert.equal(historyRules.normalizePageSize(500), historyRules.MAX_PAGE_SIZE);
  assert.equal(historyRules.normalizePageSize('NaN'), historyRules.DEFAULT_PAGE_SIZE);
  assert.equal(historyRules.normalizePageSize(75), 75);
});

test('Memory 28: No se acumulan mensajes de conversaciones distintas en la activa', async () => {
  const ctrl = new HistoryController();
  ctrl.gateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        items: [{ id: `${chatId}_m`, text: `Texto ${chatId}` }]
      }
    })
  };

  await ctrl.openConversation({ id: 'ChatX' });
  await ctrl.openConversation({ id: 'ChatY' });

  // Solo debe existir ChatY en mensajes
  assert.equal(ctrl.conversation.messages.length, 1);
  assert.equal(ctrl.conversation.messages[0].id, 'ChatY_m');
});

// ==========================================
// 7. RACE CONDITIONS PROTECTION
// ==========================================
test('Race Conditions 29: Respuesta tardía de petición previa no sobrescribe la conversación activa más nueva', async () => {
  let resolveA;
  const promiseA = new Promise((resolve) => {
    resolveA = resolve;
  });

  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => {
      if (chatId === 'target_lento') {
        await promiseA;
        return {
          success: true,
          result: {
            chatId: 'target_lento',
            items: [{ id: 'm_lento', text: 'Respuesta lenta de A' }]
          }
        };
      }

      return {
        success: true,
        result: {
          chatId: 'target_rapido',
          items: [{ id: 'm_rapido', text: 'Respuesta rápida de B' }]
        }
      };
    }
  };

  const ctrl = new HistoryController();
  ctrl.gateway = mockGateway;

  // El usuario solicita abrir el target lento (A)
  const taskA = ctrl.openConversation({ id: 'target_lento' });

  // Inmediatamente después, el usuario cambia y solicita abrir el target rápido (B)
  const taskB = ctrl.openConversation({ id: 'target_rapido' });
  await taskB;

  // En este momento, B ya está activa
  assert.equal(ctrl.activeTarget.id, 'target_rapido');
  assert.equal(ctrl.conversation.target.id, 'target_rapido');
  assert.equal(ctrl.conversation.messages[0].id, 'm_rapido');

  // Ahora finalmente responde A
  resolveA();
  await taskA;

  // La conversación activa DEBE seguir siendo B, A no debe haber sobreescrito nada
  assert.equal(ctrl.activeTarget.id, 'target_rapido', 'A no debe sobreescribir a B');
  assert.equal(ctrl.conversation.target.id, 'target_rapido');
  assert.equal(ctrl.conversation.messages[0].id, 'm_rapido');
});
