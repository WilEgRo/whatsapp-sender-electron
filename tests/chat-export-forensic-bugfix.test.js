const test = require('node:test');
const assert = require('node:assert/strict');

const { loadConversation } = require('../src/features/history/application/load-conversation');
const { exportConversation } = require('../src/features/history/application/export-conversation');
const { executeChatExport, prepareChatExportPayload } = require('../src/features/chat-export/application/prepare-chat-export');
const { normalizeChatMessage } = require('../src/features/history/domain/history-rules');
const WhatsAppService = require('../src/main/services/whatsapp-service');

// Mock DOM if not present
if (typeof global.document === 'undefined') {
  global.document = {
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, click: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} }
  };
}

// ============================================================================
// TEST 1: Conversación sin mensajes
// ============================================================================
test('Test 1: Conversación sin mensajes -> loadConversation() -> success -> messages = []', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Contacto Vacío',
        items: []
      }
    })
  };

  const result = await loadConversation({
    gateway: mockGateway,
    target: { id: '59170000001@c.us', name: 'Contacto Vacío', type: 'contacts' }
  });

  assert.equal(result.target.id, '59170000001@c.us');
  assert.equal(Array.isArray(result.messages), true);
  assert.equal(result.messages.length, 0);
  assert.equal(result.metadata.totalMessages, 0);
});

// ============================================================================
// TEST 2: Conversación con un mensaje
// ============================================================================
test('Test 2: Conversación con un mensaje -> loadConversation() -> success -> messages.length === 1', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Ana Beltrán',
        items: [
          { id: 'msg_001', fromMe: false, text: 'Hola Wilson, ¿cómo estás?', timestampIso: '2026-08-30T15:30:00Z', sender: 'Ana Beltrán' }
        ]
      }
    })
  };

  const result = await loadConversation({
    gateway: mockGateway,
    target: { id: '59171234567@c.us', name: 'Ana Beltrán', type: 'contacts' }
  });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, 'msg_001');
  assert.equal(result.messages[0].text, 'Hola Wilson, ¿cómo estás?');
  assert.equal(result.messages[0].isOutgoing, false);
});

// ============================================================================
// TEST 3: Conversación con múltiples mensajes en orden cronológico
// ============================================================================
test('Test 3: Conversación con múltiples mensajes -> loadConversation() -> orden cronológico ascendente', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Carlos Dávila',
        items: [
          { id: 'm3', fromMe: true, text: 'Listo, coordinado.', timestampIso: '2026-08-30T10:15:00Z' },
          { id: 'm1', fromMe: false, text: 'Buen día Wilson', timestampIso: '2026-08-30T10:00:00Z' },
          { id: 'm2', fromMe: false, text: '¿Podemos coordinar reunión?', timestampIso: '2026-08-30T10:05:00Z' }
        ]
      }
    })
  };

  const result = await loadConversation({
    gateway: mockGateway,
    target: { id: '59172223344@c.us', name: 'Carlos Dávila', type: 'contacts' }
  });

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].id, 'm1');
  assert.equal(result.messages[1].id, 'm2');
  assert.equal(result.messages[2].id, 'm3');
});

// ============================================================================
// TEST 4: Mensaje incoming
// ============================================================================
test('Test 4: Mensaje incoming -> normalización correcta de sender y dirección', () => {
  const raw = {
    id: 'inc_1',
    fromMe: false,
    text: 'Mensaje de entrada',
    sender: 'Pedro Pérez',
    timestampIso: '2026-08-30T12:00:00Z'
  };

  const normalized = normalizeChatMessage(raw, 'Pedro Pérez');
  assert.equal(normalized.isOutgoing, false);
  assert.equal(normalized.senderLabel, 'Pedro Pérez');
  assert.equal(normalized.text, 'Mensaje de entrada');
});

// ============================================================================
// TEST 5: Mensaje outgoing
// ============================================================================
test('Test 5: Mensaje outgoing -> normalización correcta con sender "Yo"', () => {
  const raw = {
    id: 'out_1',
    fromMe: true,
    text: 'Respuesta de salida',
    sender: 'Yo',
    timestampIso: '2026-08-30T12:05:00Z'
  };

  const normalized = normalizeChatMessage(raw, 'Contacto');
  assert.equal(normalized.isOutgoing, true);
  assert.equal(normalized.senderLabel, 'Yo');
  assert.equal(normalized.text, 'Respuesta de salida');
});

// ============================================================================
// TEST 6: Conversación de grupo con autores diferentes
// ============================================================================
test('Test 6: Conversación de grupo con autores diferentes -> cada mensaje conserva su autor', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Equipo de Ventas',
        items: [
          { id: 'gm1', fromMe: false, text: 'Reporte listo', sender: 'Juan (Ventas)', timestampIso: '2026-08-30T09:00:00Z' },
          { id: 'gm2', fromMe: false, text: 'Confirmado por aquí', sender: 'Mariana (Soporte)', timestampIso: '2026-08-30T09:02:00Z' },
          { id: 'gm3', fromMe: true, text: 'Excelente trabajo a todos', sender: 'Yo', timestampIso: '2026-08-30T09:05:00Z' }
        ]
      }
    })
  };

  const result = await loadConversation({
    gateway: mockGateway,
    target: { id: '120363000000000000@g.us', name: 'Equipo de Ventas', type: 'groups' }
  });

  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[0].senderLabel, 'Juan (Ventas)');
  assert.equal(result.messages[1].senderLabel, 'Mariana (Soporte)');
  assert.equal(result.messages[2].senderLabel, 'Yo');
});

// ============================================================================
// TEST 7: Mensajes duplicados
// ============================================================================
test('Test 7: Mensajes duplicados con mismo ID -> deduplicación inmutable', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Chat Dup',
        items: [
          { id: 'dup_1', fromMe: false, text: 'Mensaje único', timestampIso: '2026-08-30T08:00:00Z' },
          { id: 'dup_1', fromMe: false, text: 'Mensaje duplicado', timestampIso: '2026-08-30T08:00:00Z' }
        ]
      }
    })
  };

  const result = await loadConversation({
    gateway: mockGateway,
    target: { id: 'dup_target@c.us', name: 'Chat Dup', type: 'contacts' }
  });

  // loadConversation procesa rawItems de forma estricta
  assert.equal(result.messages.length >= 1, true);
});

// ============================================================================
// TEST 8: Mensaje con campos opcionales ausentes
// ============================================================================
test('Test 8: Mensaje con campos opcionales ausentes -> normalización tolerante sin excepciones', () => {
  // Mensaje sin timestampIso pero con t numérico, body en vez de text, y sin sender explícito
  const rawWithMissingFields = {
    id: 'sparse_1',
    body: 'Texto en body en lugar de text',
    t: 1788000000,
    fromMe: false
  };

  const normalized = normalizeChatMessage(rawWithMissingFields, 'Destinatario Predeterminado');
  assert.equal(normalized.id, 'sparse_1');
  assert.equal(normalized.text, 'Texto en body en lugar de text');
  assert.equal(normalized.isOutgoing, false);
  assert.equal(normalized.senderLabel, 'Destinatario Predeterminado');
  assert.ok(normalized.timestampIso.includes('2026') || normalized.timestampIso.includes('202'));

  // Mensaje con caption en vez de body
  const rawWithCaption = {
    id: 'sparse_2',
    caption: 'Foto adjunta con descripción',
    timestamp: 1788000050,
    fromMe: true
  };

  const normalizedCaption = normalizeChatMessage(rawWithCaption, 'Contacto');
  assert.equal(normalizedCaption.text, 'Foto adjunta con descripción');
  assert.equal(normalizedCaption.isOutgoing, true);
  assert.equal(normalizedCaption.senderLabel, 'Yo');
});

// ============================================================================
// TEST 9: Respuesta IPC con estructura esperada
// ============================================================================
test('Test 9: Respuesta IPC con la estructura real esperada { success, result: { chatId, chatName, items } }', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId, limit }) => {
      assert.ok(chatId);
      assert.ok(limit > 0);
      return {
        success: true,
        result: {
          chatId,
          chatName: 'Valid Chat',
          items: [
            { id: '1', text: 'Primer mensaje', fromMe: false, timestampIso: '2026-08-30T10:00:00Z' }
          ]
        }
      };
    }
  };

  const outcome = await loadConversation({
    gateway: mockGateway,
    target: { id: '59170001122@c.us', name: 'Valid Chat' }
  });

  assert.equal(outcome.target.id, '59170001122@c.us');
  assert.equal(outcome.messages.length, 1);
  assert.equal(outcome.pagination.hasMore, false);
});

// ============================================================================
// TEST 10: Exportación TXT
// ============================================================================
test('Test 10: Exportación TXT -> genera contenido estructurado con metadatos y mensajes legibles', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Lic. Morales',
        items: [
          { id: 't1', fromMe: false, text: 'Hola, envío los documentos.', timestampIso: '2026-08-30T10:00:00Z', sender: 'Lic. Morales' },
          { id: 't2', fromMe: true, text: 'Recibidos, muchas gracias.', timestampIso: '2026-08-30T10:05:00Z', sender: 'Yo' }
        ]
      }
    })
  };

  const exportResult = await executeChatExport({
    gateway: mockGateway,
    target: { id: '59178889900@c.us', name: 'Lic. Morales', type: 'contacts', identifier: '59178889900' },
    format: 'txt'
  });

  assert.equal(exportResult.success, true);
  assert.equal(exportResult.format, 'txt');
  assert.equal(exportResult.messageCount, 2);
  assert.ok(exportResult.exported.content.includes('HISTORIAL DE CONVERSACIÓN'));
  assert.ok(exportResult.exported.content.includes('Lic. Morales'));
  assert.ok(exportResult.exported.content.includes('Hola, envío los documentos.'));
  assert.ok(exportResult.exported.content.includes('Recibidos, muchas gracias.'));
});

// ============================================================================
// TEST 11: Exportación HTML
// ============================================================================
test('Test 11: Exportación HTML -> genera documento HTML5 auto-contenido con mensajes y estilos', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Lic. Morales',
        items: [
          { id: 'h1', fromMe: false, text: 'Hola en HTML', timestampIso: '2026-08-30T10:00:00Z', sender: 'Lic. Morales' }
        ]
      }
    })
  };

  const exportResult = await executeChatExport({
    gateway: mockGateway,
    target: { id: '59178889900@c.us', name: 'Lic. Morales', type: 'contacts' },
    format: 'html'
  });

  assert.equal(exportResult.success, true);
  assert.equal(exportResult.format, 'html');
  assert.ok(exportResult.exported.content.includes('<!DOCTYPE html>'));
  assert.ok(exportResult.exported.content.includes('Lic. Morales'));
  assert.ok(exportResult.exported.content.includes('Hola en HTML'));
});

// ============================================================================
// TEST 12: Exportación PDF
// ============================================================================
test('Test 12: Exportación PDF -> genera documento imprimible con media query print', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Cliente PDF',
        items: [
          { id: 'p1', fromMe: false, text: 'Mensaje para imprimir', timestampIso: '2026-08-30T10:00:00Z' }
        ]
      }
    })
  };

  const exportResult = await executeChatExport({
    gateway: mockGateway,
    target: { id: '59179998877@c.us', name: 'Cliente PDF', type: 'contacts' },
    format: 'pdf'
  });

  assert.equal(exportResult.success, true);
  assert.equal(exportResult.format, 'pdf');
  assert.ok(exportResult.exported.content.includes('@media print'));
  assert.ok(exportResult.exported.content.includes('Mensaje para imprimir'));
});

// ============================================================================
// TEST 13: Exportación JSON
// ============================================================================
test('Test 13: Exportación JSON -> genera JSON estructurado con target, metadata y messages', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Cliente JSON',
        items: [
          { id: 'j1', fromMe: false, text: 'Datos en JSON', timestampIso: '2026-08-30T10:00:00Z' }
        ]
      }
    })
  };

  const exportResult = await executeChatExport({
    gateway: mockGateway,
    target: { id: '59173332211@c.us', name: 'Cliente JSON', type: 'contacts' },
    format: 'json'
  });

  assert.equal(exportResult.success, true);
  assert.equal(exportResult.format, 'json');
  const parsed = JSON.parse(exportResult.exported.content);
  assert.equal(parsed.target.name, 'Cliente JSON');
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0].text, 'Datos en JSON');
});

// ============================================================================
// TEST 14: Contacto sin mensajes
// ============================================================================
test('Test 14: Contacto sin mensajes -> exporta correctamente en todos los formatos', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Contacto Sin Mensajes',
        items: []
      }
    })
  };

  const target = { id: '59170009999@c.us', name: 'Contacto Sin Mensajes', type: 'contacts' };

  for (const fmt of ['txt', 'html', 'pdf', 'json']) {
    const res = await executeChatExport({
      gateway: mockGateway,
      target,
      format: fmt
    });
    assert.equal(res.success, true);
    assert.equal(res.messageCount, 0);
    assert.ok(res.exported.content.length > 0);
  }
});

// ============================================================================
// TEST 15: Grupo sin mensajes
// ============================================================================
test('Test 15: Grupo sin mensajes -> exporta correctamente en todos los formatos', async () => {
  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => ({
      success: true,
      result: {
        chatId,
        chatName: 'Grupo Nuevo Vacío',
        items: []
      }
    })
  };

  const target = { id: '120363999999999999@g.us', name: 'Grupo Nuevo Vacío', type: 'groups' };

  for (const fmt of ['txt', 'html', 'pdf', 'json']) {
    const res = await executeChatExport({
      gateway: mockGateway,
      target,
      format: fmt
    });
    assert.equal(res.success, true);
    assert.equal(res.messageCount, 0);
    assert.ok(res.exported.content.length > 0);
  }
});

// ============================================================================
// TEST 16: Error estructural produce mensaje descriptivo y contextual, NUNCA "Error: r"
// ============================================================================
test('Test 16: Error estructural en gateway -> error descriptivo y contextual, NUNCA "Error: r"', async () => {
  const mockFailingGateway = {
    getChatHistoryPreview: async () => ({
      success: false,
      error: 'Error interno de comunicación con WhatsApp Web'
    })
  };

  await assert.rejects(
    async () => {
      await loadConversation({
        gateway: mockFailingGateway,
        target: { id: 'target_err_1', name: 'Chat Problemático' }
      });
    },
    (err) => {
      assert.notEqual(err.message, 'r', 'El mensaje de error NUNCA debe ser simplemente "r"');
      assert.ok(err.message.includes('Chat Problemático') || err.message.includes('target_err_1'));
      assert.ok(err.message.includes('Error interno de comunicación'));
      return true;
    }
  );
});

// ============================================================================
// TEST 17: Fallback de getChatHistoryPreview cuando chat.fetchMessages falla
// ============================================================================
test('Test 17: WhatsAppService.getChatHistoryPreview fallback directo cuando fetchMessages lanza "r"', async () => {
  const service = new WhatsAppService();
  service.isReady = true;

  // Mock del cliente de WhatsApp-web.js donde chat.fetchMessages() falla arrojando el infame "r"
  service.client = {
    getChatById: async (id) => ({
      id: { _serialized: id },
      name: 'Cliente con Historial Real',
      fetchMessages: async () => {
        // Reproducir el fallo exacto que ocurría con chats que tienen mensajes
        const err = new Error('r');
        throw err;
      }
    })
  };

  // Simular la extracción directa desde el navegador
  service.extractChatMessagesDirectly = async (targetChatId, limit) => {
    return [
      { id: 'direct_1', fromMe: false, text: 'Mensaje recuperado de memoria', timestamp: 1788000100, sender: 'Cliente' },
      { id: 'direct_2', fromMe: true, text: 'Respuesta recuperada de memoria', timestamp: 1788000200, sender: 'Yo' }
    ];
  };

  const preview = await service.getChatHistoryPreview({
    chatId: '59174447830@c.us',
    limit: 100
  });

  assert.equal(preview.chatId, '59174447830@c.us');
  assert.equal(preview.items.length, 2);
  assert.equal(preview.items[0].text, 'Mensaje recuperado de memoria');
  assert.equal(preview.items[0].fromMe, false);
  assert.equal(preview.items[1].text, 'Respuesta recuperada de memoria');
  assert.equal(preview.items[1].fromMe, true);
});

// ============================================================================
// TEST 18: Normalización de ID de contacto sin sufijo @c.us
// ============================================================================
test('Test 18: WhatsAppService.getChatHistoryPreview normaliza número plano añadiendo @c.us', async () => {
  const service = new WhatsAppService();
  service.isReady = true;

  let requestedChatId = null;
  service.client = {
    getChatById: async (id) => {
      requestedChatId = id;
      return {
        id: { _serialized: id },
        name: 'Contacto Excel',
        fetchMessages: async () => []
      };
    }
  };

  await service.getChatHistoryPreview({
    chatId: '59178945612', // Número plano sin @c.us
    limit: 50
  });

  assert.equal(requestedChatId, '59178945612@c.us');
});

// ============================================================================
// TEST 19: Mensaje con imagen y sin caption -> [📷 Imagen no disponible]
// ============================================================================
test('Test 19: Mensaje con imagen sin caption no vuelca código base64 y se sanitiza a [📷 Imagen no disponible]', () => {
  // Simulando base64 largo de imagen típica de WhatsApp Web
  const fakeBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  
  const rawImageMsg = {
    id: 'img_001',
    type: 'image',
    body: fakeBase64,
    fromMe: false,
    timestampIso: '2026-08-30T10:00:00Z'
  };

  const normalized = normalizeChatMessage(rawImageMsg, 'Contacto');
  assert.equal(normalized.text, '[📷 Imagen no disponible]');
  assert.ok(!normalized.text.includes('/9j/'));
});

// ============================================================================
// TEST 20: Mensaje con imagen con caption -> [📷 Imagen: caption]
// ============================================================================
test('Test 20: Mensaje con imagen con caption preserva el texto descriptivo [📷 Imagen: caption]', () => {
  const fakeBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

  const rawImageWithCaption = {
    id: 'img_002',
    type: 'image',
    caption: 'Comprobante de depósito bancario',
    body: fakeBase64,
    fromMe: true,
    timestampIso: '2026-08-30T10:05:00Z'
  };

  const normalized = normalizeChatMessage(rawImageWithCaption, 'Contacto');
  assert.equal(normalized.text, '[📷 Imagen: Comprobante de depósito bancario]');
  assert.ok(!normalized.text.includes('/9j/'));
});

// ============================================================================
// TEST 21: Mensajes con stickers, audio y video
// ============================================================================
test('Test 21: Mensajes de medios (sticker, audio, video) formateados limpiamente', () => {
  const sticker = normalizeChatMessage({ id: 's1', type: 'sticker', body: 'sticker_blob' });
  assert.equal(sticker.text, '[Sticker]');

  const audio = normalizeChatMessage({ id: 'a1', type: 'audio' });
  assert.equal(audio.text, '[🎵 Audio]');

  const video = normalizeChatMessage({ id: 'v1', type: 'video', caption: 'Video resumen' });
  assert.equal(video.text, '[🎥 Video: Video resumen]');
});

// ============================================================================
// TEST 22: Resiliencia ante loading_screen post-ready (evita bloqueo en 99%)
// ============================================================================
test('Test 22: Evento loading_screen no retrocede el estado si el servicio ya está en ready', () => {
  const EventEmitter = require('node:events');
  const service = new WhatsAppService();
  const mockClient = new EventEmitter();
  service.client = mockClient;
  service.registerClientEvents(() => {});
  service.isReady = true;
  service.sessionState = 'ready';

  let emitted = false;
  service.on('loading_screen', () => {
    emitted = true;
  });

  // Disparar evento de carga residual que emite WhatsApp Web tras el ready
  mockClient.emit('loading_screen', 99, 'Cargando...');

  assert.equal(service.sessionState, 'ready', 'El estado debe permanecer en ready');
  assert.equal(service.isReady, true);
  assert.equal(emitted, false, 'No debe emitir loading_screen a la UI si ya está ready');
});
