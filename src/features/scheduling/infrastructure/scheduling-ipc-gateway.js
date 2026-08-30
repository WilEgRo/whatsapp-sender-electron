/**
 * WhatsApp Sender Electron - Scheduling Feature
 * Infrastructure: Scheduling IPC Gateway
 * 
 * Encapsula la comunicación inter-proceso (IPC) exclusiva para el módulo de programación.
 * No contiene reglas de negocio ni manipulación de interfaz gráfica.
 */

class SchedulingIpcGateway {
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
      throw new Error('No hay cliente IPC disponible para SchedulingIpcGateway.');
    }
  }

  /**
   * Envía la solicitud para registrar un nuevo mensaje programado en la base de datos.
   * @param {Object} payload
   * @returns {Promise<{ success: boolean, item?: Object, error?: string }>}
   */
  async createScheduledMessage(payload) {
    const client = this._getClient();
    const response = await client.invoke('create-scheduled-message', payload);
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Obtiene la lista de mensajes programados según su estado (por defecto: pending).
   * @param {Object} [filter={ status: 'pending' }]
   * @returns {Promise<{ success: boolean, items?: Array<Object>, error?: string }>}
   */
  async getScheduledMessages({ status = 'pending' } = {}) {
    const client = this._getClient();
    const response = await client.invoke('get-scheduled-messages', { status });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Cancela una programación pendiente por su identificador.
   * @param {number|string} id
   * @returns {Promise<{ success: boolean, result?: any, error?: string }>}
   */
  async cancelScheduledMessage(id) {
    const client = this._getClient();
    const response = await client.invoke('cancel-scheduled-message', { id });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Abre el diálogo nativo para seleccionar archivos adjuntos para la programación.
   * @returns {Promise<Array<{ path: string, name: string, size: number }>>}
   */
  async selectFiles() {
    const client = this._getClient();
    const response = await client.invoke('select-files');
    return Array.isArray(response) ? response : [];
  }
}

module.exports = {
  SchedulingIpcGateway
};
