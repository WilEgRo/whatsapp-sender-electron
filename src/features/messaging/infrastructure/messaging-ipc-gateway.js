/**
 * WhatsApp Sender Electron - Messaging Feature
 * Infrastructure: Messaging IPC Gateway
 * 
 * Encapsula la comunicación inter-proceso (IPC) exclusiva del envío de mensajes.
 * No contiene reglas de negocio ni manipulación del DOM.
 */

class MessagingIpcGateway {
  /**
   * @param {Object} [ipcClient] - Cliente IPC opcional (inyección de dependencias)
   */
  constructor(ipcClient) {
    this._ipcClient = ipcClient || null;
  }

  /**
   * Obtiene el cliente IPC disponible (inyectado o global de electron).
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
      throw new Error('No hay cliente IPC disponible para MessagingIpcGateway.');
    }
  }

  /**
   * Invoca el diálogo de selección de archivos a través del proceso Main.
   * @returns {Promise<Array<{ name: string, path: string, size: number }>>}
   */
  async selectFiles() {
    const client = this._getClient();
    const result = await client.invoke('select-files');
    return Array.isArray(result) ? result : [];
  }

  /**
   * Despacha el lote de mensajes hacia el motor de envío en el proceso Main.
   * @param {Object} payload - Modelo de campaña preparado
   * @returns {Promise<{ success: boolean, cancelled?: boolean, result?: Array<Object>, error?: string }>}
   */
  async sendBatchMessage(payload) {
    const client = this._getClient();
    return await client.invoke('send-batch-message', payload);
  }
}

module.exports = {
  MessagingIpcGateway
};
