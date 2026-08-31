/**
 * WhatsApp Sender Electron - History Feature
 * Domain: Conversation Rules
 * 
 * Reglas de negocio puras para la gestión y modelado de conversaciones individuales:
 * normalización de destinatarios, resolución de direcciones (incoming/outgoing),
 * ordenamiento cronológico, agrupación por día y formateo temporal.
 * 
 * Aislamiento estricto: Cero dependencias de DOM, Electron, IPC, AppController, fs o SQLite.
 */

/**
 * Normaliza cualquier entidad de contacto o grupo en un objeto objetivo de conversación uniforme.
 * @param {Object|string} target - Entidad de contacto, grupo o id plano
 * @param {string} [defaultType='contacts'] - Tipo por defecto ('contacts' | 'groups')
 * @returns {{ id: string, name: string, type: 'contacts'|'groups', identifier: string }}
 */
function normalizeConversationTarget(target = {}, defaultType = 'contacts') {
  if (!target) {
    return {
      id: '',
      name: 'Destinatario desconocido',
      type: defaultType === 'groups' ? 'groups' : 'contacts',
      identifier: ''
    };
  }

  if (typeof target === 'string') {
    const isGroup = target.endsWith('@g.us');
    return {
      id: target.trim(),
      name: target.trim(),
      type: isGroup ? 'groups' : 'contacts',
      identifier: target.trim()
    };
  }

  const rawId = String(target.id || target.chatId || target.number || '').trim();
  const rawName = String(
    target.name
    || target.title
    || target.formattedTitle
    || target.label
    || target.number
    || 'Destinatario'
  ).trim();

  let resolvedType = String(target.type || defaultType).toLowerCase();
  if (resolvedType !== 'groups' && resolvedType !== 'contacts') {
    resolvedType = rawId.endsWith('@g.us') ? 'groups' : 'contacts';
  }

  const identifier = String(target.number || rawId).trim();

  return {
    id: rawId,
    name: rawName,
    type: resolvedType,
    identifier
  };
}

/**
 * Obtiene el identificador canónico del objetivo de la conversación.
 * @param {Object} target
 * @returns {string}
 */
function getConversationTargetId(target) {
  const normalized = normalizeConversationTarget(target);
  return normalized.id;
}

/**
 * Obtiene el nombre visual para mostrar del objetivo de la conversación.
 * @param {Object} target
 * @returns {string}
 */
function getConversationTargetName(target) {
  const normalized = normalizeConversationTarget(target);
  return normalized.name;
}

/**
 * Extrae el timestamp numérico en milisegundos de un mensaje.
 * @param {Object} message
 * @returns {number}
 */
function getMessageTimestamp(message) {
  if (!message) return 0;

  if (message.timestampIso) {
    const parsed = new Date(message.timestampIso).getTime();
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  if (typeof message.timestamp === 'number' && message.timestamp > 0) {
    return message.timestamp > 1e11 ? message.timestamp : message.timestamp * 1000;
  }

  if (typeof message.t === 'number' && message.t > 0) {
    return message.t > 1e11 ? message.t : message.t * 1000;
  }

  if (message.createdAtIso) {
    const parsed = new Date(message.createdAtIso).getTime();
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  return 0;
}

/**
 * Determina si el mensaje fue enviado por el usuario actual ('outgoing').
 * @param {Object} message
 * @returns {boolean}
 */
function isOutgoingMessage(message) {
  if (!message) return false;
  if (typeof message.fromMe === 'boolean') return message.fromMe;
  if (message.direction === 'outgoing' || message.direction === 'out') return true;
  if (message.sender === 'Yo' || message.senderLabel === 'Yo') return true;
  return false;
}

/**
 * Determina si el mensaje fue recibido del contacto o integrante ('incoming').
 * @param {Object} message
 * @returns {boolean}
 */
function isIncomingMessage(message) {
  return !isOutgoingMessage(message);
}

/**
 * Determina la dirección textual del mensaje ('outgoing' | 'incoming').
 * @param {Object} message
 * @returns {'outgoing'|'incoming'}
 */
function getMessageDirection(message) {
  return isOutgoingMessage(message) ? 'outgoing' : 'incoming';
}

/**
 * Ordena una lista de mensajes cronológicamente sin mutar el arreglo original.
 * @param {Array<Object>} messages
 * @param {'asc'|'desc'} [order='asc']
 * @returns {Array<Object>}
 */
function sortMessagesChronologically(messages = [], order = 'asc') {
  if (!Array.isArray(messages)) return [];

  const copy = messages.slice();
  return copy.sort((a, b) => {
    const timeA = getMessageTimestamp(a);
    const timeB = getMessageTimestamp(b);
    return order === 'desc' ? timeB - timeA : timeA - timeB;
  });
}

/**
 * Formatea una fecha o cadena ISO en formato de fecha legible en español.
 * @param {string|number|Date} dateOrIso
 * @returns {string}
 */
function formatConversationDate(dateOrIso) {
  if (!dateOrIso) return 'Fecha desconocida';

  const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(date.getTime())) return 'Fecha desconocida';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return 'Hoy';
  if (isYesterday) return 'Ayer';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

/**
 * Formatea una fecha o cadena ISO en hora simple HH:mm.
 * @param {string|number|Date} dateOrIso
 * @returns {string}
 */
function formatMessageTime(dateOrIso) {
  if (!dateOrIso) return '--:--';

  const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(date.getTime())) return '--:--';

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
}

/**
 * Agrupa mensajes cronológicos por día calendario para renderizar separadores de día.
 * @param {Array<Object>} messages - Lista de mensajes ya ordenados cronológicamente
 * @returns {Array<{ dateKey: string, dateLabel: string, messages: Array<Object> }>}
 */
function groupMessagesByDay(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const groupsMap = new Map();

  messages.forEach((msg) => {
    const timestamp = getMessageTimestamp(msg);
    const dateObj = timestamp > 0 ? new Date(timestamp) : new Date();

    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;

    if (!groupsMap.has(dateKey)) {
      groupsMap.set(dateKey, {
        dateKey,
        dateLabel: formatConversationDate(dateObj),
        messages: []
      });
    }

    groupsMap.get(dateKey).messages.push(msg);
  });

  return Array.from(groupsMap.values());
}

/**
 * Detecta y procesa contenido de medios (imágenes, stickers, audios, videos) o cadenas base64 gigantes,
 * reemplazándolas por un indicador limpio como '[📷 Imagen: caption]' o '[📷 Imagen no disponible]'.
 * @param {Object|string} rawMessage
 * @returns {string}
 */
function sanitizeMessageText(rawMessage = {}) {
  if (typeof rawMessage === 'string') {
    rawMessage = { text: rawMessage };
  }
  const type = String((rawMessage && rawMessage.type) || (rawMessage && rawMessage._data && rawMessage._data.type) || '').toLowerCase();
  const caption = String((rawMessage && rawMessage.caption) || (rawMessage && rawMessage._data && rawMessage._data.caption) || '').trim();
  const rawBody = String(
    (rawMessage && (rawMessage.text || rawMessage.body)) ||
    (rawMessage && rawMessage._data && (rawMessage._data.text || rawMessage._data.body)) ||
    ''
  ).trim();

  const isBase64Data = (str = '') => {
    if (!str || typeof str !== 'string') return false;
    if (str.startsWith('data:image/') || str.startsWith('data:application/') || str.startsWith('data:video/')) return true;
    if (str.startsWith('/9j/') && str.length > 40) return true;
    if (str.startsWith('iVBORw') && str.length > 40) return true;
    if (str.startsWith('UklGR') && str.length > 40) return true;
    if (str.length > 100 && !/\s/.test(str) && /^[A-Za-z0-9+/=_-]+$/.test(str)) return true;
    return false;
  };

  const isMedia = Boolean(rawMessage && (rawMessage.hasMedia || ['image', 'sticker', 'video', 'audio', 'ptt', 'document'].includes(type)));

  if (type === 'image' || (isMedia && (!type || type === 'image')) || isBase64Data(rawBody)) {
    if (caption) {
      return `[📷 Imagen: ${caption}]`;
    }
    return '[📷 Imagen no disponible]';
  }

  if (type === 'sticker') {
    return '[Sticker]';
  }

  if (type === 'video') {
    if (caption) {
      return `[🎥 Video: ${caption}]`;
    }
    return '[🎥 Video no disponible]';
  }

  if (type === 'audio' || type === 'ptt') {
    return '[🎵 Audio]';
  }

  if (type === 'document') {
    const filename = String((rawMessage && rawMessage.filename) || (rawMessage && rawMessage._data && rawMessage._data.filename) || caption || 'Documento adjunto');
    return `[📄 Documento: ${filename}]`;
  }

  if (caption && isBase64Data(rawBody)) {
    return `[📷 Imagen: ${caption}]`;
  }

  if (isBase64Data(rawBody)) {
    return '[📷 Imagen no disponible]';
  }

  return rawBody || caption || '';
}

const MAX_MEDIA_ITEMS_PER_EXPORT = 50;
const MAX_SINGLE_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_TOTAL_MEDIA_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Comprueba si un mensaje representa o contiene contenido multimedia.
 * @param {Object} message
 * @returns {boolean}
 */
function isMediaMessage(message = {}) {
  if (!message || typeof message !== 'object') return false;
  if (message.hasMedia === true) return true;
  const type = String(message.type || (message._data && message._data.type) || '').toLowerCase();
  return ['image', 'sticker', 'video', 'audio', 'ptt', 'document'].includes(type);
}

/**
 * Extrae metadatos ligeros de un mensaje multimedia sin conservar Base64 ni buffers.
 * @param {Object} rawMessage
 * @returns {{ type: string, hasMedia: boolean, mediaAvailable: boolean, caption: string, mediaMimeType: string, mediaFilename: string }}
 */
function extractMediaMetadata(rawMessage = {}) {
  if (!rawMessage || typeof rawMessage !== 'object') {
    return {
      type: 'chat',
      hasMedia: false,
      mediaAvailable: false,
      caption: '',
      mediaMimeType: '',
      mediaFilename: ''
    };
  }

  const rawType = String(rawMessage.type || (rawMessage._data && rawMessage._data.type) || '').toLowerCase();
  const hasMedia = Boolean(rawMessage.hasMedia || ['image', 'sticker', 'video', 'audio', 'ptt', 'document'].includes(rawType));
  const caption = String(rawMessage.caption || (rawMessage._data && rawMessage._data.caption) || '').trim();
  const mediaMimeType = String(rawMessage.mimetype || rawMessage.mediaMimeType || (rawMessage._data && rawMessage._data.mimetype) || '').trim();
  const mediaFilename = String(
    rawMessage.filename
    || rawMessage.mediaFilename
    || (rawMessage._data && rawMessage._data.filename)
    || ''
  ).trim();

  let resolvedType = hasMedia ? (rawType || 'image') : (rawType || 'chat');
  if (resolvedType === 'ptt') resolvedType = 'audio';

  return {
    type: resolvedType,
    hasMedia,
    mediaAvailable: hasMedia,
    caption,
    mediaMimeType,
    mediaFilename
  };
}

module.exports = {
  normalizeConversationTarget,
  getConversationTargetId,
  getConversationTargetName,
  getMessageTimestamp,
  isOutgoingMessage,
  isIncomingMessage,
  getMessageDirection,
  sortMessagesChronologically,
  formatConversationDate,
  formatMessageTime,
  groupMessagesByDay,
  sanitizeMessageText,
  MAX_MEDIA_ITEMS_PER_EXPORT,
  MAX_SINGLE_MEDIA_BYTES,
  MAX_TOTAL_MEDIA_BYTES,
  isMediaMessage,
  extractMediaMetadata
};
