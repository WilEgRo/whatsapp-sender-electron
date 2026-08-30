/**
 * WhatsApp Sender Electron - History Feature
 * Application: Paginate Conversation
 * 
 * Caso de uso: Paginación incremental y carga de mensajes anteriores bajo demanda.
 * Evita duplicados, garantiza orden cronológico estricto y maneja el ciclo de vida
 * de una única conversación activa para proteger la memoria.
 */

const {
  loadConversation
} = require('./load-conversation');

const {
  DEFAULT_PAGE_SIZE,
  normalizePageSize,
  deduplicateMessages,
  normalizeChatMessage,
  createConversationMetadata
} = require('../domain/history-rules');

const {
  sortMessagesChronologically
} = require('../domain/conversation-rules');

/**
 * Inicia la carga de la primera página de una conversación para un destinatario.
 * @param {Object} params
 * @param {Object} params.gateway
 * @param {Object|string} params.target
 * @param {number} [params.pageSize=DEFAULT_PAGE_SIZE]
 * @returns {Promise<Object>}
 */
async function loadInitialConversation({ gateway, target, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const safeSize = normalizePageSize(pageSize);
  return loadConversation({
    gateway,
    target,
    limit: safeSize,
    offset: 0
  });
}

/**
 * Carga un lote adicional de mensajes más antiguos para la conversación actualmente activa.
 * @param {Object} params
 * @param {Object} params.gateway
 * @param {Object} params.currentConversation - Estado de la conversación actual
 * @param {number} [params.pageSize=DEFAULT_PAGE_SIZE]
 * @returns {Promise<Object>}
 */
async function loadOlderMessages({ gateway, currentConversation, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  if (!currentConversation || !currentConversation.target || !currentConversation.target.id) {
    throw new Error('No hay una conversación activa para paginar');
  }

  const existingMessages = Array.isArray(currentConversation.messages)
    ? currentConversation.messages
    : [];

  // Si ya se determinó que no hay más mensajes disponibles
  if (currentConversation.pagination && currentConversation.pagination.hasMore === false) {
    return currentConversation;
  }

  const safePageSize = normalizePageSize(pageSize);
  const currentCount = existingMessages.length;
  const requestedLimit = currentCount + safePageSize;

  const targetId = currentConversation.target.id;
  const targetName = currentConversation.target.name || 'Chat';

  const response = await gateway.getChatHistoryPreview({
    chatId: targetId,
    limit: requestedLimit
  });

  if (!response || !response.success || !response.result) {
    const errorMsg = (response && response.error) || 'Error al cargar mensajes anteriores';
    throw new Error(errorMsg);
  }

  const rawItems = Array.isArray(response.result.items) ? response.result.items : [];
  const normalizedIncoming = rawItems
    .map((item) => normalizeChatMessage(item, targetName))
    .filter(Boolean);

  // Fusionamos y eliminamos duplicados manteniendo mensajes existentes
  const mergedMessages = deduplicateMessages(existingMessages, normalizedIncoming);
  const sortedMessages = sortMessagesChronologically(mergedMessages, 'asc');

  // Si no se obtuvieron nuevos mensajes efectivos respecto al total previo, hasMore es falso
  const hasMore = rawItems.length >= requestedLimit && sortedMessages.length > currentCount;

  const pagination = {
    limit: safePageSize,
    offset: sortedMessages.length,
    hasMore,
    totalLoaded: sortedMessages.length
  };

  const metadata = createConversationMetadata({
    target: currentConversation.target,
    messages: sortedMessages,
    pagination
  });

  return {
    target: currentConversation.target,
    messages: sortedMessages,
    pagination,
    metadata
  };
}

module.exports = {
  loadInitialConversation,
  loadOlderMessages
};
