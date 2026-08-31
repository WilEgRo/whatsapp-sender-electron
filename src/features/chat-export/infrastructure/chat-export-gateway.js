/**
 * WhatsApp Sender Electron - Chat Export Feature
 * Infrastructure: Chat Export Gateway
 * 
 * Encapsula la obtención de historial para exportación.
 * REUTILIZA directamente HistoryIpcGateway y los canales IPC existentes
 * ('get-chat-history-preview') sin duplicar canales ni lógica de red.
 */

const { HistoryIpcGateway } = require('../../history/infrastructure/history-ipc-gateway');

class ChatExportGateway {
  /**
   * @param {Object} [historyGatewayOrIpcClient] - Gateway existente o cliente IPC inyectable
   */
  constructor(historyGatewayOrIpcClient) {
    if (historyGatewayOrIpcClient && typeof historyGatewayOrIpcClient.getChatHistoryPreview === 'function') {
      this._historyGateway = historyGatewayOrIpcClient;
    } else {
      this._historyGateway = new HistoryIpcGateway(historyGatewayOrIpcClient);
    }
  }

  /**
   * Obtiene la pasarela subyacente de historial.
   * @returns {HistoryIpcGateway}
   */
  getHistoryGateway() {
    return this._historyGateway;
  }

  /**
   * Recupera los mensajes del chat solicitado para exportación.
   * @param {Object} params
   * @param {string} params.chatId - ID del contacto o grupo
   * @param {number} [params.limit=1000]
   * @returns {Promise<{ success: boolean, result?: Object, error?: string }>}
   */
  async getChatHistoryPreview({ chatId, limit = 1000 } = {}) {
    return this._historyGateway.getChatHistoryPreview({ chatId, limit });
  }

  /**
   * Consulta el historial completo para exportación.
   * @param {Object} params
   * @param {string} params.targetId
   * @param {number} [params.limit=1000]
   * @returns {Promise<{ success: boolean, result?: Object, error?: string }>}
   */
  async getConversation({ targetId, limit = 1000 } = {}) {
    return this.getChatHistoryPreview({ chatId: targetId, limit });
  }
}

module.exports = {
  ChatExportGateway
};
