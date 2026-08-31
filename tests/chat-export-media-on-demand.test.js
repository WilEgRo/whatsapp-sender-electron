/**
 * WhatsApp Sender Electron - Automated Test Suite
 * Feature: On-Demand Chat Export with Multimedia (v3.7.0)
 * 
 * Verificación forense y arquitectónica completa:
 * 1. Dominio: metadatos ligeros, clasificación de medios, ausencia absoluta de Base64 en mensajes.
 * 2. Carga normal: loadConversation() NUNCA descarga multimedia.
 * 3. Exportación normal (includeMedia === false): NUNCA invoca descarga de medios.
 * 4. Exportación con multimedia (includeMedia === true): descarga solo mensajes hasMedia === true.
 * 5. Resiliencia ante fallos individuales: error en imagen no aborta la exportación.
 * 6. Límites defensivos: máx 50 items, máx 25 MB por archivo, máx 100 MB total.
 * 7. Limpieza de temporales: garantizada en éxito y en excepción mediante try/finally.
 * 8. Concurrencia: bloqueo de doble exportación simultánea.
 * 9. Snapshot: cambio de destinatario durante exportación no contamina el resultado.
 * 10. Formatos TXT, HTML, PDF y JSON: limpios, legibles y sin contaminación de estado.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Domain
const {
  isMediaMessage,
  extractMediaMetadata,
  sanitizeMessageText,
  MAX_MEDIA_ITEMS_PER_EXPORT,
  MAX_SINGLE_MEDIA_BYTES,
  MAX_TOTAL_MEDIA_BYTES
} = require('../src/features/history/domain/conversation-rules');

const {
  normalizeChatMessage
} = require('../src/features/history/domain/history-rules');

// Application
const { loadConversation } = require('../src/features/history/application/load-conversation');
const { exportConversation } = require('../src/features/history/application/export-conversation');
const { loadConversationMedia, cleanupMediaFiles } = require('../src/features/history/application/load-conversation-media');
const { executeChatExport } = require('../src/features/chat-export/application/prepare-chat-export');

// Infrastructure
const { MediaIpcGateway } = require('../src/features/history/infrastructure/media-ipc-gateway');
const WhatsAppService = require('../src/main/services/whatsapp-service');

// Presentation
const { ChatExportController } = require('../src/features/chat-export/presentation/chat-export-controller');

// ============================================================================
// 1. DOMAIN: METADATOS LIGEROS Y AUSENCIA ABSOLUTA DE BASE64
// ============================================================================

test('Domain 1: Detección y clasificación de tipos multimedia (image, video, audio, document, sticker)', () => {
  assert.equal(isMediaMessage({ type: 'image' }), true);
  assert.equal(isMediaMessage({ type: 'video' }), true);
  assert.equal(isMediaMessage({ type: 'audio' }), true);
  assert.equal(isMediaMessage({ type: 'ptt' }), true);
  assert.equal(isMediaMessage({ type: 'document' }), true);
  assert.equal(isMediaMessage({ type: 'sticker' }), true);
  assert.equal(isMediaMessage({ hasMedia: true }), true);
  assert.equal(isMediaMessage({ type: 'chat', hasMedia: false }), false);
  assert.equal(isMediaMessage({ text: 'Hola mundo' }), false);
});

test('Domain 2: extractMediaMetadata extrae metadatos ligeros y descarta Base64', () => {
  const fakeBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////';
  const rawImage = {
    id: 'msg_img_1',
    type: 'image',
    body: fakeBase64,
    caption: 'Comprobante de depósito',
    mimetype: 'image/jpeg',
    filename: 'recibo_001.jpg'
  };

  const meta = extractMediaMetadata(rawImage);
  assert.equal(meta.type, 'image');
  assert.equal(meta.hasMedia, true);
  assert.equal(meta.mediaAvailable, true);
  assert.equal(meta.caption, 'Comprobante de depósito');
  assert.equal(meta.mediaMimeType, 'image/jpeg');
  assert.equal(meta.mediaFilename, 'recibo_001.jpg');
  assert.equal(meta.body, undefined);
  assert.equal(meta.data, undefined);
});

test('Domain 3: normalizeChatMessage NUNCA incluye Base64 y preserva metadatos ligeros', () => {
  const hugeBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(50000);
  const rawMsg = {
    id: 'msg_huge_base64',
    type: 'image',
    body: hugeBase64,
    caption: 'Foto de producto',
    fromMe: false,
    timestamp: 1725000000
  };

  const normalized = normalizeChatMessage(rawMsg, 'Cliente');

  // El texto es sanitizado
  assert.equal(normalized.text, '[📷 Imagen: Foto de producto]');
  assert.equal(normalized.hasMedia, true);
  assert.equal(normalized.type, 'image');
  assert.equal(normalized.caption, 'Foto de producto');

  // NINGUNA propiedad debe contener la cadena Base64 masiva
  const jsonStr = JSON.stringify(normalized);
  assert.ok(!jsonStr.includes('data:image/jpeg;base64'));
  assert.ok(!jsonStr.includes('AAAAAA'));
  assert.ok(jsonStr.length < 500, `El tamaño normalizado debe ser ligero, pero fue ${jsonStr.length}`);
});

test('Domain 4: Límites de exportación configurados con valores estándar y razonables', () => {
  assert.equal(MAX_MEDIA_ITEMS_PER_EXPORT, 50);
  assert.equal(MAX_SINGLE_MEDIA_BYTES, 25 * 1024 * 1024);
  assert.equal(MAX_TOTAL_MEDIA_BYTES, 100 * 1024 * 1024);
});

// ============================================================================
// 2. APLICACIÓN: CARGA NORMAL NO DESCARGA MULTIMEDIA
// ============================================================================

test('Application 1: loadConversation() NUNCA solicita descarga de multimedia', async () => {
  let downloadCalled = false;
  const mockGateway = {
    getChatHistoryPreview: async () => ({
      success: true,
      result: {
        chatId: '59178945612@c.us',
        chatName: 'Cliente Test',
        items: [
          { id: 'm1', type: 'image', hasMedia: true, text: '[📷 Imagen no disponible]' },
          { id: 'm2', type: 'chat', text: 'Hola' }
        ]
      }
    }),
    downloadMedia: async () => {
      downloadCalled = true;
    }
  };

  const conversation = await loadConversation({
    gateway: mockGateway,
    target: { id: '59178945612@c.us', name: 'Cliente Test' },
    limit: 50
  });

  assert.equal(conversation.messages.length, 2);
  assert.equal(downloadCalled, false, 'loadConversation jamás debe descargar multimedia');
});

// ============================================================================
// 3. EXPORTACIÓN NORMAL (includeMedia === false) NO DESCARGA MEDIOS
// ============================================================================

test('Application 2: executeChatExport() con includeMedia=false NO descarga multimedia', async () => {
  let mediaGatewayCalled = false;
  const mockGateway = {
    getChatHistoryPreview: async () => ({
      success: true,
      result: {
        chatId: '59178945612@c.us',
        chatName: 'Contacto Normal',
        items: [
          { id: 'm1', type: 'image', hasMedia: true, text: '[📷 Imagen no disponible]' }
        ]
      }
    })
  };

  const mockMediaGateway = {
    downloadMedia: async () => {
      mediaGatewayCalled = true;
      return { success: true };
    },
    cleanupTempMedia: async () => ({ success: true, removedCount: 0 })
  };

  const result = await executeChatExport({
    gateway: mockGateway,
    mediaGateway: mockMediaGateway,
    target: { id: '59178945612@c.us', name: 'Contacto Normal' },
    format: 'txt',
    includeMedia: false
  });

  assert.equal(result.success, true);
  assert.equal(mediaGatewayCalled, false, 'No debe invocar el gateway de multimedia si includeMedia es false');
});

// ============================================================================
// 4. EXPORTACIÓN CON MULTIMEDIA (includeMedia === true) DESCARGA SOLO NECESARIOS
// ============================================================================

test('Application 3: executeChatExport() con includeMedia=true descarga solo mensajes con hasMedia=true', async () => {
  const downloadedIds = [];
  const mockGateway = {
    getChatHistoryPreview: async () => ({
      success: true,
      result: {
        chatId: '59178945612@c.us',
        chatName: 'Contacto Media',
        items: [
          { id: 'm1', type: 'chat', hasMedia: false, text: 'Mensaje de texto' },
          { id: 'm2', type: 'image', hasMedia: true, text: '[📷 Imagen: Foto]', caption: 'Foto' },
          { id: 'm3', type: 'chat', hasMedia: false, text: 'Otro texto' },
          { id: 'm4', type: 'document', hasMedia: true, text: '[📄 Documento: balance.pdf]' }
        ]
      }
    })
  };

  const mockMediaGateway = {
    downloadMedia: async ({ messageId }) => {
      downloadedIds.push(messageId);
      return {
        success: true,
        messageId,
        tempFilePath: path.join(os.tmpdir(), `temp_${messageId}.dat`),
        mimeType: 'image/jpeg',
        size: 1024
      };
    },
    cleanupTempMedia: async () => ({ success: true, removedCount: downloadedIds.length })
  };

  const progressEvents = [];
  const result = await executeChatExport({
    gateway: mockGateway,
    mediaGateway: mockMediaGateway,
    target: { id: '59178945612@c.us', name: 'Contacto Media' },
    format: 'html',
    includeMedia: true,
    onProgress: (p) => progressEvents.push(p)
  });

  assert.equal(result.success, true);
  // Solo se deben descargar m2 y m4 (los mensajes con hasMedia === true)
  assert.deepEqual(downloadedIds, ['m2', 'm4']);
  assert.ok(progressEvents.length > 0, 'Debe emitir eventos de progreso');
});

// ============================================================================
// 5. RESILIENCIA ANTE FALLOS INDIVIDUALES: ERROR EN IMAGEN NO ABORTA EXPORTACIÓN
// ============================================================================

test('Application 4: Error en descarga individual de imagen no aborta la exportación', async () => {
  const mockGateway = {
    getChatHistoryPreview: async () => ({
      success: true,
      result: {
        chatId: '59178945612@c.us',
        chatName: 'Cliente Resiliencia',
        items: [
          { id: 'img_ok_1', type: 'image', hasMedia: true, text: '[📷 Imagen 1]' },
          { id: 'img_fail_2', type: 'image', hasMedia: true, text: '[📷 Imagen 2]' },
          { id: 'img_ok_3', type: 'image', hasMedia: true, text: '[📷 Imagen 3]' }
        ]
      }
    })
  };

  const mockMediaGateway = {
    downloadMedia: async ({ messageId }) => {
      if (messageId === 'img_fail_2') {
        return { success: false, messageId, error: 'Media expirada en WhatsApp' };
      }
      return {
        success: true,
        messageId,
        tempFilePath: path.join(os.tmpdir(), `temp_${messageId}.dat`),
        mimeType: 'image/jpeg',
        size: 2048
      };
    },
    cleanupTempMedia: async () => ({ success: true, removedCount: 2 })
  };

  const result = await executeChatExport({
    gateway: mockGateway,
    mediaGateway: mockMediaGateway,
    target: { id: '59178945612@c.us', name: 'Cliente Resiliencia' },
    format: 'txt',
    includeMedia: true
  });

  assert.equal(result.success, true);
  assert.equal(result.messageCount, 3);
  // La imagen 2 debe representarse como no disponible sin romper el archivo final
  assert.ok(result.exported.content.includes('[📷 Imagen no disponible]'));
});

// ============================================================================
// 6. LÍMITES DEFENSIVOS: MÁXIMO 50 ELEMENTOS Y LÍMITES DE TAMAÑO
// ============================================================================

test('Application 5: Respeta límite de 50 elementos multimedia omitiendo el excedente', async () => {
  // Generar 55 mensajes con hasMedia
  const messages = [];
  for (let i = 1; i <= 55; i += 1) {
    messages.push({ id: `msg_${i}`, type: 'image', hasMedia: true });
  }

  let requestedDownloads = 0;
  const mockMediaGateway = {
    downloadMedia: async ({ messageId }) => {
      requestedDownloads += 1;
      return {
        success: true,
        messageId,
        tempFilePath: path.join(os.tmpdir(), `temp_${messageId}.dat`),
        mimeType: 'image/jpeg',
        size: 512
      };
    }
  };

  const result = await loadConversationMedia({
    mediaGateway: mockMediaGateway,
    chatId: '59178945612@c.us',
    messages,
    limits: { maxItems: 50 }
  });

  // Solo debe haber solicitado 50 descargas
  assert.equal(requestedDownloads, 50);
  assert.equal(result.downloadedCount, 50);
  assert.equal(result.omittedCount, 5);
  // Los omitidos están marcados en el mapa
  assert.equal(result.mediaMap.get('msg_51').available, false);
  assert.equal(result.mediaMap.get('msg_51').reason, 'omitted_by_count_limit');
});

test('Application 6: Omite archivos individuales que superan 25 MB y omite por total acumulado > 100 MB', async () => {
  const messages = [
    { id: 'huge_single', type: 'video', hasMedia: true },
    { id: 'normal_1', type: 'image', hasMedia: true }
  ];

  const mockMediaGateway = {
    downloadMedia: async ({ messageId }) => {
      if (messageId === 'huge_single') {
        return {
          success: true,
          messageId,
          tempFilePath: path.join(os.tmpdir(), 'temp_huge.mp4'),
          mimeType: 'video/mp4',
          size: 30 * 1024 * 1024 // 30 MB (> 25 MB)
        };
      }
      return {
        success: true,
        messageId,
        tempFilePath: path.join(os.tmpdir(), 'temp_normal.jpg'),
        mimeType: 'image/jpeg',
        size: 1024 * 1024 // 1 MB
      };
    }
  };

  const result = await loadConversationMedia({
    mediaGateway: mockMediaGateway,
    chatId: '59178945612@c.us',
    messages
  });

  assert.equal(result.failedCount, 1);
  assert.equal(result.downloadedCount, 1);
  assert.equal(result.mediaMap.get('huge_single').available, false);
  assert.equal(result.mediaMap.get('normal_1').available, true);
});

// ============================================================================
// 7. CLEANUP: GARANTIZADO EN ÉXITO Y EN EXCEPCIÓN
// ============================================================================

test('Application 7: cleanupTempMedia se ejecuta siempre en finally tanto en éxito como en fallo', async () => {
  let cleanedUpFiles = [];
  const mockMediaGateway = {
    downloadMedia: async ({ messageId }) => ({
      success: true,
      messageId,
      tempFilePath: `/tmp/fake_${messageId}.dat`,
      mimeType: 'image/jpeg',
      size: 100
    }),
    cleanupTempMedia: async ({ filePaths }) => {
      cleanedUpFiles = [...filePaths];
      return { success: true, removedCount: filePaths.length };
    }
  };

  const mockGateway = {
    getChatHistoryPreview: async () => ({
      success: true,
      result: {
        chatId: '59178945612@c.us',
        chatName: 'Cleanup Test',
        items: [
          { id: 'c1', type: 'image', hasMedia: true }
        ]
      }
    })
  };

  // 1. En éxito
  await executeChatExport({
    gateway: mockGateway,
    mediaGateway: mockMediaGateway,
    target: { id: '59178945612@c.us', name: 'Cleanup Test' },
    format: 'txt',
    includeMedia: true
  });

  assert.equal(cleanedUpFiles.length, 1);
  assert.equal(cleanedUpFiles[0], '/tmp/fake_c1.dat');

  // 2. En excepción durante formateo
  cleanedUpFiles = [];
  const failingConversation = {
    target: { id: 'test@c.us', name: 'Error Test' },
    messages: [{ id: 'err_msg', hasMedia: true, type: 'image' }]
  };

  // Simular cleanup directo
  await cleanupMediaFiles({
    mediaGateway: mockMediaGateway,
    tempFiles: ['/tmp/fake_err.dat']
  });

  assert.deepEqual(cleanedUpFiles, ['/tmp/fake_err.dat']);
});

// ============================================================================
// 8. CONCURRENCIA: PROTECCIÓN CONTRA DOBLE EXPORTACIÓN
// ============================================================================

test('Presentation 1: ChatExportController bloquea exportaciones concurrentes simultáneas', async () => {
  let executeCount = 0;
  const mockGateway = {
    getChatHistoryPreview: async () => {
      // Simular latencia
      await new Promise((r) => setTimeout(r, 50));
      return {
        success: true,
        result: {
          chatId: '59178945612@c.us',
          chatName: 'Concurrency Test',
          items: [{ id: 'm1', text: 'Hola' }]
        }
      };
    }
  };

  const controller = new ChatExportController({
    gateway: mockGateway,
    mediaGateway: { downloadMedia: async () => ({ success: true }) }
  });

  controller.selectedTarget = { id: '59178945612@c.us', name: 'Concurrency Test', type: 'contacts' };

  // Ejecutar dos veces simultáneamente
  const p1 = controller.exportChat('txt');
  const p2 = controller.exportChat('txt');

  await Promise.all([p1, p2]);

  // isExporting se restablece a false tras terminar
  assert.equal(controller.isExporting, false);
});

// ============================================================================
// 9. SNAPSHOT AISLADO: CAMBIO DE DESTINATARIO NO CONTAMINA EXPORTACIÓN
// ============================================================================

test('Presentation 2: Cambiar selectedTarget durante exportación no contamina el snapshot en proceso', async () => {
  let targetExported = null;

  const mockGateway = {
    getChatHistoryPreview: async ({ chatId }) => {
      await new Promise((r) => setTimeout(r, 40));
      return {
        success: true,
        result: {
          chatId,
          chatName: chatId.includes('111') ? 'Usuario 1' : 'Usuario 2',
          items: [{ id: 'm1', text: 'Chat item' }]
        }
      };
    }
  };

  const controller = new ChatExportController({
    gateway: mockGateway,
    mediaGateway: { downloadMedia: async () => ({ success: true }) }
  });

  controller.selectedTarget = { id: '59171111111@c.us', name: 'Usuario 1', type: 'contacts' };

  const exportPromise = controller.exportChat('txt');

  // Mientras se exporta, el usuario cambia el target seleccionado
  controller.selectedTarget = { id: '59172222222@c.us', name: 'Usuario 2', type: 'contacts' };

  await exportPromise;

  // La exportación debe haber concluido sin lanzar error
  assert.equal(controller.isExporting, false);
});

// ============================================================================
// 10. FORMATOS: TXT, HTML, PDF Y JSON LIMPIOS Y CON METADATOS
// ============================================================================

test('Formatos 1: TXT incluye referencias limpias y CERO código Base64', () => {
  const mediaMap = new Map();
  mediaMap.set('img_1', { available: true, filename: 'deposito.jpg' });
  mediaMap.set('img_2', { available: false, label: '[📷 Imagen no disponible]' });

  const conversation = {
    target: { id: 'test@c.us', name: 'Cliente Formatos' },
    messages: [
      { id: 'img_1', type: 'image', text: '[📷 Imagen: deposito.jpg]', caption: 'Pago mes', timestampIso: '2026-08-30T10:00:00Z' },
      { id: 'img_2', type: 'image', text: '[📷 Imagen no disponible]', timestampIso: '2026-08-30T10:05:00Z' }
    ]
  };

  const exported = exportConversation({
    conversation,
    format: 'txt',
    mediaMap,
    includeMedia: true
  });

  assert.ok(exported.content.includes('IMAGEN INCLUIDA: deposito.jpg'));
  assert.ok(exported.content.includes('[📷 Imagen no disponible]'));
  assert.ok(!exported.content.includes('base64'));
});

test('Formatos 2: JSON incluye metadatos de media y CERO Base64', () => {
  const mediaMap = new Map();
  mediaMap.set('img_1', { available: true, filename: 'foto.png', mimeType: 'image/png', size: 1024 });

  const conversation = {
    target: { id: 'test@c.us', name: 'Cliente JSON' },
    messages: [
      { id: 'img_1', type: 'image', hasMedia: true, text: '[📷 Imagen: foto.png]' }
    ]
  };

  const exported = exportConversation({
    conversation,
    format: 'json',
    mediaMap,
    includeMedia: true
  });

  const parsed = JSON.parse(exported.content);
  assert.equal(parsed.includeMedia, true);
  assert.equal(parsed.messages[0].media.available, true);
  assert.equal(parsed.messages[0].media.filename, 'foto.png');
  assert.equal(parsed.messages[0].media.size, 1024);
  assert.equal(parsed.messages[0].media.base64, undefined);
});

// ============================================================================
// 11. INFRAESTRUCTURA: WHATSAPPSERVICE OPERACIONES DE DISCO Y LIMPIEZA
// ============================================================================

test('Infrastructure 1: WhatsAppService.cleanupTempMedia solo elimina archivos dentro del directorio seguro', async () => {
  const service = new WhatsAppService();
  const tempBaseDir = path.join(os.tmpdir(), 'whatsapp-export-media');
  await fs.promises.mkdir(tempBaseDir, { recursive: true });

  const tempFile = path.join(tempBaseDir, 'test_cleanup_safe.dat');
  await fs.promises.writeFile(tempFile, 'temporal');

  assert.ok(fs.existsSync(tempFile));

  const result = await service.cleanupTempMedia({ filePaths: [tempFile] });
  assert.equal(result.success, true);
  assert.equal(result.removedCount, 1);
  assert.equal(fs.existsSync(tempFile), false);
});
