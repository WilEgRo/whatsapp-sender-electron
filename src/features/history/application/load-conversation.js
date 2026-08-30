/**
 * WhatsApp Sender Electron - History Feature
 * Application: Load Conversation
 * 
 * Caso de uso: Carga bajo demanda de una conversación para un contacto o grupo específico.
 * Totalmente desacoplado de DOM, Electron y UI. Depende únicamente de la abstracción de Gateway.
 */

const {
  normalizeConversationTarget,
  sortMessagesChronologically
} = require('../domain/conversation-rules');

const {
  DEFAULT_PAGE_SIZE,
  normalizePageSize,
  normalizeChatMessage,
  calculatePagination,
  createConversationMetadata
} = require('../domain/history-rules');

/**
 * Carga el lote inicial de mensajes para el destinatario indicado.
 * @param {Object} params
 * @param {Object} params.gateway - Pasarela de comunicación con el backend (HistoryIpcGateway)
 * @param {Object|string} params.target - Contacto o grupo
 * @param {number} [params.limit=50] - Tamaño de página solicitado
 * @param {number} [params.offset=0] - Desplazamiento inicial
 * @returns {Promise<{ target: Object, messages: Array<Object>, pagination: Object, metadata: Object }>}
 */
async function loadConversation({ gateway, target, limit = DEFAULT_PAGE_SIZE, offset = 0 } = {}) {
  if (!gateway || typeof gateway.getChatHistoryPreview !== 'function') {
    throw new Error('Se requiere una instancia válida de HistoryIpcGateway');
  }

  const normalizedTarget = normalizeConversationTarget(target);
  if (!normalizedTarget.id) {
    throw new Error('Debes seleccionar un destinatario válido para consultar el historial');
  }

  const safeLimit = normalizePageSize(limit);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const response = await gateway.getChatHistoryPreview({
    chatId: normalizedTarget.id,
    limit: safeLimit
  });

  if (!response || !response.success || !response.result) {
    const errorDetail = (response && response.error) || 'No se pudo recuperar el historial de la conversación';
    throw new Error(errorDetail);
  }

  const rawItems = Array.isArray(response.result.items) ? response.result.items : [];
  const chatName = response.result.chatName || normalizedTarget.name;

  if (chatName && chatName !== normalizedTarget.name) {
    normalizedTarget.name = chatName;
  }

  const normalizedMessages = rawItems
    .map((item) => normalizeChatMessage(item, normalizedTarget.name))
    .filter(Boolean);

  const sortedMessages = sortMessagesChronologically(normalizedMessages, 'asc');

  const pagination = calculatePagination({
    limit: safeLimit,
    offset: safeOffset,
    returnedCount: rawItems.length
  });

  const metadata = createConversationMetadata({
    target: normalizedTarget,
    messages: sortedMessages,
    pagination
  });

  return {
    target: normalizedTarget,
    messages: sortedMessages,
    pagination: {
      limit: pagination.limit,
      offset: pagination.offset,
      hasMore: pagination.hasMore,
      totalLoaded: sortedMessages.length
    },
    metadata
  };
}

module.exports = {
  loadConversation
};
