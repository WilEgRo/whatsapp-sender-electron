/**
 * WhatsApp Sender Electron - History Feature
 * Infrastructure: History IPC Gateway
 * 
 * Encapsula la comunicación inter-proceso (IPC) para historial de conversaciones,
 * registros de mensajes y estados de destinatarios.
 */

class HistoryIpcGateway {
  /**
   * @param {Object} [ipcClient] - Cliente IPC inyectable para testing
   */
  constructor(ipcClient) {
    this._ipcClient = ipcClient || null;
  }

  /**
   * Obtiene el cliente IPC disponible.
   * @private
   */
  _getClient() {
    if (this._ipcClient) {
      return this._ipcClient;
    }

    try {
      const { ipcRenderer } = require('electron');
      return {
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
      };
    } catch {
      throw new Error('No hay cliente IPC disponible para HistoryIpcGateway.');
    }
  }

  /**
   * Obtiene los mensajes previos de un chat para previsualización.
   * @param {Object} params
   * @param {string} params.chatId
   * @param {number} [params.limit=220]
   * @returns {Promise<{ success: boolean, result?: Object, error?: string }>}
   */
  async getChatHistoryPreview({ chatId, limit = 220 } = {}) {
    const client = this._getClient();
    const response = await client.invoke('get-chat-history-preview', { chatId, limit });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Obtiene la conversación de un destinatario específico con paginación semántica.
   * @param {Object} params
   * @param {string} params.targetId
   * @param {number} [params.limit=50]
   * @param {number} [params.offset=0]
   * @returns {Promise<{ success: boolean, result?: Object, error?: string }>}
   */
  async getConversation({ targetId, limit = 50, offset = 0 } = {}) {
    return this.getChatHistoryPreview({ chatId: targetId, limit });
  }

  /**
   * Obtiene mensajes más antiguos para paginación incremental.
   * @param {Object} params
   * @param {string} params.targetId
   * @param {number} [params.limit=50]
   * @param {number} [params.offset=0]
   * @returns {Promise<{ success: boolean, result?: Object, error?: string }>}
   */
  async getOlderMessages({ targetId, limit = 50, offset = 0 } = {}) {
    return this.getChatHistoryPreview({ chatId: targetId, limit });
  }

  /**
   * Consulta el estado de envío diario para una lista de destinatarios.
   * @param {Object} params
   * @param {string} params.destinationType - 'contacts' | 'groups'
   * @param {Array<string>} params.destinationIds
   * @param {string} [params.referenceDate]
   * @returns {Promise<{ success: boolean, result?: { byId: Object }, error?: string }>}
   */
  async getDestinationStatuses({ destinationType, destinationIds, referenceDate } = {}) {
    const client = this._getClient();
    const response = await client.invoke('get-destination-statuses', {
      destinationType,
      destinationIds,
      referenceDate
    });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Obtiene los registros históricos consolidados de mensajes.
   * @param {Object} [options]
   * @param {number} [options.limit=200000]
   * @returns {Promise<{ success: boolean, items?: Array<Object>, error?: string }>}
   */
  async getMessageLogHistory({ limit = 200000 } = {}) {
    const client = this._getClient();
    const response = await client.invoke('get-message-log-history', { limit });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }
}

module.exports = {
  HistoryIpcGateway
};
