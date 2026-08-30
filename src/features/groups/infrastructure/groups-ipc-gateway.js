/**
 * WhatsApp Sender Electron - Groups Feature
 * Infrastructure: Groups IPC Gateway
 * 
 * Encapsula la comunicación inter-proceso (IPC) exclusiva para grupos.
 * No contiene reglas de negocio ni manipulación de interfaz gráfica.
 */

class GroupsIpcGateway {
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
      throw new Error('No hay cliente IPC disponible para GroupsIpcGateway.');
    }
  }

  /**
   * Solicita al proceso principal la lista de grupos sincronizados desde WhatsApp.
   * @returns {Promise<{ success: boolean, groups?: Array<Object>, error?: string }>}
   */
  async getGroups() {
    const client = this._getClient();
    const response = await client.invoke('get-groups');
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Solicita al proceso principal los integrantes de un grupo específico.
   * @param {string} groupId
   * @returns {Promise<{ success: boolean, group?: Object, error?: string }>}
   */
  async getGroupMembers(groupId) {
    const client = this._getClient();
    const response = await client.invoke('get-group-members', { groupId });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Solicita la exportación de los integrantes de un grupo a un archivo Excel o CSV.
   * @param {Object} params
   * @param {string} params.groupId
   * @param {string} [params.format='xlsx']
   * @returns {Promise<{ success: boolean, canceled?: boolean, result?: Object, error?: string }>}
   */
  async exportGroupMembers({ groupId, format = 'xlsx' } = {}) {
    const client = this._getClient();
    const response = await client.invoke('export-group-members', { groupId, format });
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }
}

module.exports = {
  GroupsIpcGateway
};
