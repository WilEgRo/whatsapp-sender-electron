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
  groupMessagesByDay
};
