/**
 * WhatsApp Sender Electron - Contacts Feature
 * Infrastructure: Contacts IPC Gateway
 * 
 * Encapsula la comunicación inter-proceso (IPC) exclusiva para contactos.
 * No contiene reglas de negocio ni manipulación de interfaz gráfica.
 */

class ContactsIpcGateway {
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
      throw new Error('No hay cliente IPC disponible para ContactsIpcGateway.');
    }
  }

  /**
   * Obtiene la lista de contactos sincronizados desde WhatsApp en el proceso Main.
   * @returns {Promise<{ success: boolean, contacts?: Array<Object>, error?: string }>}
   */
  async getContacts() {
    const client = this._getClient();
    const response = await client.invoke('get-contacts');
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }

  /**
   * Dispara el diálogo de importación de contactos desde archivo Excel en el proceso Main.
   * @returns {Promise<{ success: boolean, contacts?: Array<Object>, canceled?: boolean, error?: string }>}
   */
  async importExcelContacts() {
    const client = this._getClient();
    const response = await client.invoke('import-excel-contacts');
    return response && typeof response === 'object' ? response : { success: false, error: 'Respuesta inválida' };
  }
}

module.exports = {
  ContactsIpcGateway
};
