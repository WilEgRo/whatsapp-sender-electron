/**
 * WhatsApp Sender Electron - History Feature
 * Application: Load Conversation Media
 * 
 * Caso de uso específico para la recuperación controlada de archivos multimedia
 * bajo demanda durante la exportación autorizada por el usuario.
 * 
 * Principios:
 * 1. ZERO Base64 en el modelo de conversación o en el estado global.
 * 2. Límites defensivos estrictos (máx 50 items, máx 25 MB/archivo, máx 100 MB total).
 * 3. Tolerancia a fallos individuales: un medio corrupto/no disponible no aborta la exportación.
 * 4. Concurrencia controlada para evitar saturación de recursos.
 * 5. Reporte continuo de progreso.
 * 
 * Aislamiento estricto: Cero dependencias de DOM, Electron ni IPC directo.
 */

const {
  MAX_MEDIA_ITEMS_PER_EXPORT,
  MAX_SINGLE_MEDIA_BYTES,
  MAX_TOTAL_MEDIA_BYTES,
  isMediaMessage
} = require('../domain/conversation-rules');

/**
 * Descarga bajo demanda los archivos multimedia de los mensajes seleccionados.
 * 
 * @param {Object} params
 * @param {Object} params.mediaGateway - Pasarela IPC especializada (MediaIpcGateway)
 * @param {string} params.chatId - Identificador del chat
 * @param {Array<Object>} params.messages - Lista de mensajes de la conversación
 * @param {Function} [params.onProgress] - Callback de progreso: ({ current, total, state, message }) => void
 * @param {Object} [params.limits] - Límites configurables opcionales
 * @returns {Promise<{ mediaMap: Map<string, Object>, downloadedCount: number, failedCount: number, omittedCount: number, tempFiles: Array<string> }>}
 */
async function loadConversationMedia({
  mediaGateway,
  chatId,
  messages = [],
  onProgress = null,
  limits = {}
} = {}) {
  const maxItems = typeof limits.maxItems === 'number' ? limits.maxItems : MAX_MEDIA_ITEMS_PER_EXPORT;
  const maxTotalBytes = typeof limits.maxTotalBytes === 'number' ? limits.maxTotalBytes : MAX_TOTAL_MEDIA_BYTES;
  const maxSingleBytes = typeof limits.maxSingleBytes === 'number' ? limits.maxSingleBytes : MAX_SINGLE_MEDIA_BYTES;

  const mediaMap = new Map();
  const tempFiles = [];

  if (!mediaGateway || typeof mediaGateway.downloadMedia !== 'function') {
    throw new Error('Se requiere una pasarela de multimedia válida (mediaGateway).');
  }

  if (!chatId) {
    throw new Error('Se requiere un identificador de chat válido para descargar multimedia.');
  }

  // 1. Filtrar mensajes que representan o contienen medios
  const mediaMessages = (Array.isArray(messages) ? messages : []).filter((msg) => isMediaMessage(msg));
  const totalCandidateItems = mediaMessages.length;

  if (totalCandidateItems === 0) {
    if (typeof onProgress === 'function') {
      onProgress({ current: 0, total: 0, state: 'ready', message: 'No hay multimedia en esta conversación.' });
    }
    return {
      mediaMap,
      downloadedCount: 0,
      failedCount: 0,
      omittedCount: 0,
      tempFiles
    };
  }

  // 2. Aplicar límite de cantidad máxima de elementos por exportación
  const allowedMessages = mediaMessages.slice(0, maxItems);
  const omittedByCount = totalCandidateItems - allowedMessages.length;

  // Registrar los omitidos de antemano
  for (let i = maxItems; i < totalCandidateItems; i += 1) {
    const omittedMsg = mediaMessages[i];
    if (omittedMsg && omittedMsg.id) {
      mediaMap.set(omittedMsg.id, {
        available: false,
        messageId: omittedMsg.id,
        reason: 'omitted_by_count_limit',
        label: '[📎 Multimedia omitida por límite de exportación]'
      });
    }
  }

  let downloadedCount = 0;
  let failedCount = 0;
  let omittedByBytesCount = 0;
  let totalBytesDownloaded = 0;

  const totalToDownload = allowedMessages.length;

  // 3. Descarga controlada (concurrencia de 2)
  const CONCURRENCY = 2;
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < allowedMessages.length) {
      const index = currentIndex;
      currentIndex += 1;

      const msg = allowedMessages[index];
      if (!msg || !msg.id) continue;

      // Verificar límite de bytes totales acumulados
      if (totalBytesDownloaded >= maxTotalBytes) {
        omittedByBytesCount += 1;
        mediaMap.set(msg.id, {
          available: false,
          messageId: msg.id,
          reason: 'omitted_by_size_limit',
          label: '[📎 Multimedia omitida por límite de tamaño de exportación]'
        });
        continue;
      }

      if (typeof onProgress === 'function') {
        onProgress({
          current: index + 1,
          total: totalToDownload,
          state: 'downloading',
          message: `Descargando multimedia ${index + 1}/${totalToDownload}...`
        });
      }

      try {
        const result = await mediaGateway.downloadMedia({
          chatId,
          messageId: msg.id
        });

        if (result && result.success && result.tempFilePath) {
          const fileSize = Number(result.size) || 0;

          if (fileSize > maxSingleBytes) {
            failedCount += 1;
            mediaMap.set(msg.id, {
              available: false,
              messageId: msg.id,
              error: 'El archivo excede el tamaño individual máximo (25 MB).',
              label: '[📷 Archivo demasiado grande no disponible]'
            });
            if (result.tempFilePath) {
              tempFiles.push(result.tempFilePath);
            }
          } else {
            downloadedCount += 1;
            totalBytesDownloaded += fileSize;
            tempFiles.push(result.tempFilePath);

            mediaMap.set(msg.id, {
              available: true,
              messageId: msg.id,
              tempFilePath: result.tempFilePath,
              mimeType: result.mimeType || 'application/octet-stream',
              filename: result.filename || '',
              size: fileSize
            });
          }
        } else {
          failedCount += 1;
          const errorDetail = (result && result.error) || 'Media no disponible';
          mediaMap.set(msg.id, {
            available: false,
            messageId: msg.id,
            error: errorDetail,
            label: '[📷 Imagen no disponible]'
          });
        }
      } catch (err) {
        failedCount += 1;
        mediaMap.set(msg.id, {
          available: false,
          messageId: msg.id,
          error: err && err.message ? err.message : String(err),
          label: '[📷 Imagen no disponible]'
        });
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, allowedMessages.length);
  const workers = [];
  for (let w = 0; w < workerCount; w += 1) {
    workers.push(worker());
  }

  await Promise.all(workers);

  if (typeof onProgress === 'function') {
    onProgress({
      current: totalToDownload,
      total: totalToDownload,
      state: 'completed',
      message: `Multimedia completada: ${downloadedCount} descargadas, ${failedCount} no disponibles.`
    });
  }

  return {
    mediaMap,
    downloadedCount,
    failedCount,
    omittedCount: omittedByCount + omittedByBytesCount,
    tempFiles
  };
}

/**
 * Limpia de forma segura los archivos temporales asociados a una exportación.
 * 
 * @param {Object} params
 * @param {Object} params.mediaGateway
 * @param {Array<string>} params.tempFiles
 * @returns {Promise<{ success: boolean, removedCount: number }>}
 */
async function cleanupMediaFiles({ mediaGateway, tempFiles = [] } = {}) {
  if (!mediaGateway || typeof mediaGateway.cleanupTempMedia !== 'function') {
    return { success: true, removedCount: 0 };
  }
  if (!Array.isArray(tempFiles) || tempFiles.length === 0) {
    return { success: true, removedCount: 0 };
  }

  try {
    return await mediaGateway.cleanupTempMedia({ filePaths: tempFiles });
  } catch (_) {
    return { success: false, removedCount: 0 };
  }
}

module.exports = {
  loadConversationMedia,
  cleanupMediaFiles
};
