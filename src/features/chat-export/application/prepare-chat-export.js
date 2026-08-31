/**
 * WhatsApp Sender Electron - Chat Export Feature
 * Application: Prepare Chat Export
 * 
 * Caso de uso: Preparación y ejecución de la exportación documental de conversaciones.
 * REUTILIZA la lógica establecida de History (loadConversation y exportConversation)
 * e integra la recuperación de multimedia bajo demanda sin duplicar almacenamiento ni algoritmos.
 */

const {
  normalizeExportTarget,
  isValidTarget,
  normalizeExportFormat,
  buildExportFilename
} = require('../domain/chat-export-rules');

// Reutilización directa del vertical slice History
const { loadConversation } = require('../../history/application/load-conversation');
const { exportConversation } = require('../../history/application/export-conversation');
const { loadConversationMedia, cleanupMediaFiles } = require('../../history/application/load-conversation-media');

/**
 * Prepara y valida el payload de solicitud de exportación.
 * @param {Object} params
 * @param {Object} params.target
 * @param {'txt'|'html'|'pdf'|'json'} [params.format='txt']
 * @returns {{ target: Object, format: string, filename: string, preparedAtIso: string }}
 */
function prepareChatExportPayload({ target, format = 'txt' } = {}) {
  const normalizedTarget = normalizeExportTarget(target);
  if (!isValidTarget(normalizedTarget)) {
    throw new Error('Debes seleccionar un contacto o grupo válido para exportar la conversación.');
  }

  const safeFormat = normalizeExportFormat(format);
  const filename = buildExportFilename(normalizedTarget, safeFormat);

  return {
    target: normalizedTarget,
    format: safeFormat,
    filename,
    preparedAtIso: new Date().toISOString()
  };
}

/**
 * Ejecuta la exportación completa de un chat bajo demanda.
 * Carga el historial del chat mediante el gateway y lo procesa en el formato requerido.
 * Si se solicita includeMedia, descarga la multimedia requerida a archivos temporales,
 * genera el documento y limpia los temporales en el bloque finally.
 * 
 * @param {Object} params
 * @param {Object} params.gateway - Pasarela IPC compatible con HistoryIpcGateway
 * @param {Object} [params.mediaGateway] - Pasarela IPC compatible con MediaIpcGateway
 * @param {Object} params.target - Contacto o grupo
 * @param {'txt'|'html'|'pdf'|'json'} [params.format='txt']
 * @param {number} [params.limit=1000] - Límite de mensajes a exportar
 * @param {boolean} [params.includeMedia=false] - Indica si se debe recuperar la multimedia
 * @param {Function} [params.onProgress] - Callback de progreso
 * @returns {Promise<{ success: boolean, target: Object, format: string, exported: Object, messageCount: number }>}
 */
async function executeChatExport({
  gateway,
  mediaGateway = null,
  target,
  format = 'txt',
  limit = 1000,
  includeMedia = false,
  onProgress = null
} = {}) {
  const payload = prepareChatExportPayload({ target, format });

  if (!gateway || typeof gateway.getChatHistoryPreview !== 'function') {
    throw new Error('Se requiere una pasarela válida de historial para exportar el chat.');
  }

  if (typeof onProgress === 'function') {
    onProgress({ current: 0, total: 0, state: 'loading_history', message: `Recuperando mensajes para ${payload.target.name}...` });
  }

  // 1. Carga bajo demanda del historial reutilizando History Application (ligera, sin multimedia)
  let conversationResult;
  try {
    conversationResult = await loadConversation({
      gateway,
      target: payload.target,
      limit,
      offset: 0
    });
  } catch (loadError) {
    const errorMsg = loadError && loadError.message ? loadError.message : String(loadError);
    throw new Error(`Fallo al obtener conversación para exportar (${payload.target.name || payload.target.id}): ${errorMsg}`);
  }

  if (!conversationResult || !Array.isArray(conversationResult.messages)) {
    throw new Error('No se pudo recuperar el historial de la conversación.');
  }

  // 2. Descarga opcional de multimedia bajo demanda
  let mediaMap = null;
  let tempFiles = [];

  if (includeMedia && mediaGateway) {
    try {
      const mediaResult = await loadConversationMedia({
        mediaGateway,
        chatId: payload.target.id,
        messages: conversationResult.messages,
        onProgress
      });
      mediaMap = mediaResult.mediaMap;
      tempFiles = mediaResult.tempFiles;
    } catch (mediaErr) {
      console.warn('[prepare-chat-export] Error recuperando multimedia, continuando con exportación base:', mediaErr);
    }
  }

  // 3. Generación del documento formateado y limpieza garantizada de temporales
  try {
    if (typeof onProgress === 'function') {
      onProgress({ current: 0, total: 0, state: 'generating', message: `Preparando documento ${payload.format.toUpperCase()}...` });
    }

    const exported = exportConversation({
      conversation: conversationResult,
      format: payload.format,
      mediaMap,
      includeMedia
    });

    return {
      success: true,
      target: conversationResult.target || payload.target,
      format: payload.format,
      exported,
      messageCount: conversationResult.messages.length,
      metadata: conversationResult.metadata || {}
    };
  } finally {
    if (tempFiles.length > 0 && mediaGateway) {
      await cleanupMediaFiles({ mediaGateway, tempFiles }).catch(() => {});
    }
  }
}

module.exports = {
  prepareChatExportPayload,
  executeChatExport
};
