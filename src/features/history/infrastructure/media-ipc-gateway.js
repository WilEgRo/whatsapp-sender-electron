/**
 * WhatsApp Sender Electron - History Feature
 * Infrastructure: Media IPC Gateway
 * 
 * Encapsula la comunicación inter-proceso (IPC) para la recuperación
 * bajo demanda de archivos multimedia de mensajes y su posterior limpieza.
 * 
 * Aislamiento estricto: Presentation nunca invoca directamente a ipcRenderer.
 */

class MediaIpcGateway {
  /**
   * @param {Object} [ipcClient=null] - Cliente IPC inyectable para testing
   */
  constructor(ipcClient = null) {
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
      throw new Error('No hay cliente IPC disponible para MediaIpcGateway.');
    }
  }

  /**
   * Solicita la descarga bajo demanda de un archivo multimedia asociado a un mensaje.
   * El Main Process descarga el archivo de WhatsApp Web, lo escribe en disco temporal
   * y devuelve metadatos + ruta temporal (ZERO Base64 en Renderer).
   * 
   * @param {Object} params
   * @param {string} params.chatId
   * @param {string} params.messageId
   * @returns {Promise<{ success: boolean, messageId: string, tempFilePath?: string, mimeType?: string, filename?: string, size?: number, error?: string }>}
   */
  async downloadMedia({ chatId, messageId } = {}) {
    if (!chatId || !messageId) {
      return {
        success: false,
        messageId: messageId || '',
        error: 'Identificadores de chat o mensaje no válidos.'
      };
    }

    try {
      const client = this._getClient();
      const response = await client.invoke('download-chat-media', { chatId, messageId });
      return response || { success: false, messageId, error: 'Respuesta vacía del canal IPC.' };
    } catch (err) {
      return {
        success: false,
        messageId,
        error: err && err.message ? err.message : String(err)
      };
    }
  }

  /**
   * Solicita la eliminación de los archivos temporales generados tras finalizar la exportación.
   * 
   * @param {Object} params
   * @param {Array<string>} params.filePaths - Lista de rutas de archivos temporales a eliminar
   * @returns {Promise<{ success: boolean, removedCount: number }>}
   */
  async cleanupTempMedia({ filePaths = [] } = {}) {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: true, removedCount: 0 };
    }

    try {
      const client = this._getClient();
      const response = await client.invoke('cleanup-export-media', { filePaths });
      return response || { success: true, removedCount: 0 };
    } catch (err) {
      return {
        success: false,
        removedCount: 0,
        error: err && err.message ? err.message : String(err)
      };
    }
  }
}

module.exports = {
  MediaIpcGateway
};
