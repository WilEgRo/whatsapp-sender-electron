/**
 * WhatsApp Sender Electron - Chat Export Feature
 * Application: Prepare Chat Export
 * 
 * Caso de uso: Preparación y ejecución de la exportación documental de conversaciones.
 * REUTILIZA la lógica establecida de History (loadConversation y exportConversation)
 * sin duplicar el almacenamiento ni los algoritmos de formateo.
 */

const {
  normalizeExportTarget,
  isValidTarget,
  normalizeExportFormat,
  buildExportFilename
} = require('../domain/chat-export-rules');

// Reutilización directa del vertical slice History v3.6.0
const { loadConversation } = require('../../history/application/load-conversation');
const { exportConversation } = require('../../history/application/export-conversation');

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
 * @param {Object} params
 * @param {Object} params.gateway - Pasarela IPC compatible con HistoryIpcGateway
 * @param {Object} params.target - Contacto o grupo
 * @param {'txt'|'html'|'pdf'|'json'} [params.format='txt']
 * @param {number} [params.limit=1000] - Límite de mensajes a exportar
 * @returns {Promise<{ success: boolean, target: Object, format: string, exported: Object, messageCount: number }>}
 */
async function executeChatExport({
  gateway,
  target,
  format = 'txt',
  limit = 1000
} = {}) {
  const payload = prepareChatExportPayload({ target, format });

  if (!gateway || typeof gateway.getChatHistoryPreview !== 'function') {
    throw new Error('Se requiere una pasarela válida de historial para exportar el chat.');
  }

  // 1. Carga bajo demanda del historial reutilizando History Application
  const conversationResult = await loadConversation({
    gateway,
    target: payload.target,
    limit,
    offset: 0
  });

  if (!conversationResult || !Array.isArray(conversationResult.messages)) {
    throw new Error('No se pudo recuperar el historial de la conversación.');
  }

  // 2. Generación del documento formateado reutilizando History Application
  const exported = exportConversation({
    conversation: conversationResult,
    format: payload.format
  });

  return {
    success: true,
    target: conversationResult.target || payload.target,
    format: payload.format,
    exported,
    messageCount: conversationResult.messages.length,
    metadata: conversationResult.metadata || {}
  };
}

module.exports = {
  prepareChatExportPayload,
  executeChatExport
};
