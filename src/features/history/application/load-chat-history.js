/**
 * WhatsApp Sender Electron - History Feature
 * Application: Load Chat History
 * 
 * Casos de uso para preparar la consulta de historial de chat
 * y transformar la respuesta recibida sin manipular el DOM.
 */

const {
  normalizeChatMessage
} = require('../domain/history-rules');

/**
 * Valida y prepara la solicitud de previsualización de historial de chat.
 * @param {Object} params
 * @param {string} params.chatId
 * @param {number} [params.limit=220]
 * @returns {{ valid: boolean, payload?: { chatId: string, limit: number }, error?: string }}
 */
function prepareChatHistoryRequest({ chatId, limit = 220 } = {}) {
  const cleanId = String(chatId || '').trim();
  if (!cleanId) {
    return {
      valid: false,
      error: 'Selecciona un chat para ver la conversacion.'
    };
  }

  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 220));

  return {
    valid: true,
    payload: {
      chatId: cleanId,
      limit: safeLimit
    }
  };
}

/**
 * Procesa la respuesta de mensajes del backend y la transforma para visualización.
 * @param {Object} result
 * @param {string} [fallbackLabel='Chat']
 * @returns {{ chatName: string, items: Array<Object> }}
 */
function processChatHistoryResponse(result = {}, fallbackLabel = 'Chat') {
  const rawItems = result && Array.isArray(result.items) ? result.items : [];
  const chatName = (result && result.chatName) || fallbackLabel;

  const items = rawItems.map((msg) => normalizeChatMessage(msg, chatName));

  return {
    chatName,
    items
  };
}

module.exports = {
  prepareChatHistoryRequest,
  processChatHistoryResponse
};
