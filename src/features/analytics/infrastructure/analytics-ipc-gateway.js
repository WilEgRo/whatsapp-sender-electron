/**
 * WhatsApp Sender Electron - Analytics Feature
 * Infrastructure: Analytics IPC Gateway
 * 
 * Encapsula la comunicación inter-proceso (IPC) exclusiva para estadísticas y analíticas.
 * No contiene reglas de negocio ni manipulación de la interfaz gráfica.
 */

class AnalyticsIpcGateway {
  /**
   * @param {Object} [ipcClient] - Cliente IPC (inyección de dependencias)
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
      throw new Error('No hay cliente IPC disponible para AnalyticsIpcGateway.');
    }
  }

  /**
   * Solicita el consolidado de estadísticas según el filtro temporal configurado.
   * @param {Object} [options]
   * @param {Object} [options.filter]
   * @returns {Promise<{ success: boolean, stats?: Object, error?: string }>}
   */
  async getMessageStats({ filter = {} } = {}) {
    const client = this._getClient();
    const response = await client.invoke('get-message-stats', { filter });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Solicita la exportación a Excel del consolidado de estadísticas.
   * @param {Object} [options]
   * @param {Object} [options.filter]
   * @returns {Promise<{ success: boolean, canceled?: boolean, filePath?: string, error?: string }>}
   */
  async exportMessageStats({ filter = {} } = {}) {
    const client = this._getClient();
    const response = await client.invoke('export-message-stats', { filter });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }
}

module.exports = {
  AnalyticsIpcGateway
};
