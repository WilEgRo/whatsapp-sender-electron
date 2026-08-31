/**
 * WhatsApp Sender Electron - History Feature
 * Domain: History Rules
 * 
 * Reglas de negocio puras para historial de mensajes, normalización de conversaciones,
 * paginación defensiva, eliminación de duplicados y cálculo de estados de entrega diaria.
 * 
 * Aislamiento estricto: Cero dependencias de DOM, Electron ni IPC.
 */

const { sanitizeMessageText, extractMediaMetadata } = require('./conversation-rules');

const DEFAULT_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 200;

/**
 * Normaliza el tamaño de página dentro de límites seguros de memoria.
 * @param {number|string} size
 * @returns {number}
 */
function normalizePageSize(size) {
  const parsed = Number(size);
  if (!Number.isFinite(parsed) || parsed < MIN_PAGE_SIZE) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.floor(parsed));
}

/**
 * Construye la lista unificada de destinatarios disponibles para consulta de historial.
 * @param {Array<Object>} [contacts=[]]
 * @param {Array<Object>} [groups=[]]
 * @returns {Array<{ id: string, type: string, label: string, searchText: string }>}
 */
function buildHistoryChatTargets(contacts = [], groups = []) {
  const contactTargets = (Array.isArray(contacts) ? contacts : []).map((contact) => {
    if (!contact || !contact.id) return null;
    const name = String(contact.name || contact.number || 'Contacto');
    const number = contact.number ? ` (${contact.number})` : '';
    const label = `${name}${number}`;
    return {
      id: String(contact.id),
      type: 'contacts',
      label,
      searchText: `${name} ${contact.number || ''}`.toLowerCase()
    };
  }).filter(Boolean);

  const groupTargets = (Array.isArray(groups) ? groups : []).map((group) => {
    if (!group || !group.id) return null;
    const name = String(group.name || group.title || 'Grupo');
    const label = `[Grupo] ${name}`;
    return {
      id: String(group.id),
      type: 'groups',
      label,
      searchText: name.toLowerCase()
    };
  }).filter(Boolean);

  return [...contactTargets, ...groupTargets].sort((a, b) => a.label.localeCompare(b.label, 'es'));
}

/**
 * Filtra los destinatarios según término de búsqueda textual.
 * @param {Array<Object>} targets
 * @param {string} [searchTerm='']
 * @returns {Array<Object>}
 */
function filterChatTargets(targets = [], searchTerm = '') {
  if (!Array.isArray(targets)) return [];
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return targets;

  return targets.filter((item) => item && typeof item.searchText === 'string' && item.searchText.includes(term));
}

/**
 * Normaliza y formatea un mensaje individual de la conversación.
 * @param {Object} rawMessage
 * @param {string} [fallbackLabel='Contacto']
 * @returns {{ id: string, isOutgoing: boolean, senderLabel: string, timeLabel: string, text: string, timestampIso: string|null }}
 */
function normalizeChatMessage(rawMessage = {}, fallbackLabel = 'Contacto') {
  const isOutgoing = Boolean(rawMessage && (rawMessage.fromMe || rawMessage.isOutgoing));
  const sender = rawMessage && (rawMessage.sender || rawMessage.senderLabel) ? String(rawMessage.sender || rawMessage.senderLabel) : fallbackLabel;
  const senderLabel = isOutgoing ? 'Yo' : sender;

  let timeLabel = '--:--';
  let timestampIso = rawMessage && rawMessage.timestampIso ? String(rawMessage.timestampIso) : null;
  if (!timestampIso && rawMessage && (rawMessage.timestamp || rawMessage.t)) {
    const rawTs = Number(rawMessage.timestamp || rawMessage.t);
    if (rawTs > 0) {
      const ms = rawTs > 1e11 ? rawTs : rawTs * 1000;
      timestampIso = new Date(ms).toISOString();
    }
  }

  if (timestampIso) {
    const parsed = new Date(timestampIso);
    if (!Number.isNaN(parsed.getTime())) {
      timeLabel = parsed.toLocaleString('es-BO', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit'
      });
    }
  }

  const text = sanitizeMessageText(rawMessage);
  const mediaMeta = extractMediaMetadata(rawMessage);

  return {
    id: String((rawMessage && rawMessage.id) || ''),
    isOutgoing,
    senderLabel,
    timeLabel,
    text,
    timestampIso,
    type: mediaMeta.type,
    hasMedia: mediaMeta.hasMedia,
    mediaAvailable: mediaMeta.mediaAvailable,
    caption: mediaMeta.caption,
    mediaMimeType: mediaMeta.mediaMimeType,
    mediaFilename: mediaMeta.mediaFilename
  };
}

/**
 * Fusiona dos listas de mensajes eliminando duplicados por ID de manera inmutable.
 * @param {Array<Object>} existingMessages
 * @param {Array<Object>} newMessages
 * @returns {Array<Object>}
 */
function deduplicateMessages(existingMessages = [], newMessages = []) {
  const safeExisting = Array.isArray(existingMessages) ? existingMessages : [];
  const safeNew = Array.isArray(newMessages) ? newMessages : [];

  const seenIds = new Set();
  const merged = [];

  // Recorremos ambos conjuntos garantizando unicidad estricta por ID
  [...safeExisting, ...safeNew].forEach((msg) => {
    if (!msg) return;
    const id = String(msg.id || `${msg.timestampIso || ''}-${msg.text || ''}`).trim();
    if (!id || seenIds.has(id)) return;

    seenIds.add(id);
    merged.push(msg);
  });

  return merged;
}

/**
 * Calcula los metadatos de paginación defensiva.
 * @param {Object} params
 * @param {number} params.limit
 * @param {number} params.offset
 * @param {number} params.returnedCount
 * @returns {{ limit: number, offset: number, hasMore: boolean, returnedCount: number }}
 */
function calculatePagination({ limit = DEFAULT_PAGE_SIZE, offset = 0, returnedCount = 0 } = {}) {
  const safeLimit = normalizePageSize(limit);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeReturned = Math.max(0, Number(returnedCount) || 0);

  // Si la cantidad de elementos devueltos iguala el límite solicitado, es factible que existan más
  const hasMore = safeReturned >= safeLimit;

  return {
    limit: safeLimit,
    offset: safeOffset,
    hasMore,
    returnedCount: safeReturned
  };
}

/**
 * Genera metadatos estadísticos inmutables sobre una conversación cargada.
 * @param {Object} params
 * @param {Object} params.target
 * @param {Array<Object>} params.messages
 * @param {Object} [params.pagination]
 * @returns {Object}
 */
function createConversationMetadata({ target = {}, messages = [], pagination = {} } = {}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const totalMessages = safeMessages.length;

  let outgoingCount = 0;
  let incomingCount = 0;

  safeMessages.forEach((msg) => {
    if (msg && (msg.fromMe || msg.isOutgoing)) {
      outgoingCount += 1;
    } else {
      incomingCount += 1;
    }
  });

  const firstMessage = safeMessages[0] || null;
  const lastMessage = safeMessages[safeMessages.length - 1] || null;

  return Object.freeze({
    targetId: String(target.id || ''),
    targetName: String(target.name || 'Chat'),
    targetType: String(target.type || 'contacts'),
    totalMessages,
    outgoingCount,
    incomingCount,
    firstMessageDate: firstMessage ? firstMessage.timestampIso : null,
    lastMessageDate: lastMessage ? lastMessage.timestampIso : null,
    hasMore: Boolean(pagination && pagination.hasMore)
  });
}

/**
 * Normaliza la respuesta del repositorio de estados de destinatarios en estructuras indexadas.
 * @param {Object} byId - Diccionario de estados por ID devuelto por el proceso principal
 * @returns {{ sentTodaySet: Set<string>, lastSentMap: Object }}
 */
function normalizeDestinationStatuses(byId = {}) {
  const sentTodaySet = new Set();
  const lastSentMap = Object.create(null);

  if (!byId || typeof byId !== 'object') {
    return { sentTodaySet, lastSentMap };
  }

  Object.keys(byId).forEach((id) => {
    const item = byId[id] || {};
    if (item.sentToday) {
      sentTodaySet.add(String(id));
    }
    if (item.lastSentAt) {
      lastSentMap[String(id)] = String(item.lastSentAt);
    }
  });

  return { sentTodaySet, lastSentMap };
}

/**
 * Comprueba si un destinatario específico (contacto o grupo) ya recibió un mensaje hoy.
 * @param {string} destinationId
 * @param {Object} options
 * @param {Set<string>} options.sentTodaySet
 * @param {Object} options.lastSentMap
 * @param {string} [options.mode='contacts']
 * @returns {{ sentToday: boolean, lastSentAt: string|null }}
 */
function checkDestinationStatus(destinationId, { sentTodaySet, lastSentMap, mode = 'contacts' } = {}) {
  const safeId = String(destinationId || '').trim();
  if (!safeId || !sentTodaySet) {
    return { sentToday: false, lastSentAt: null };
  }

  const map = lastSentMap || {};

  if (sentTodaySet.has(safeId)) {
    return { sentToday: true, lastSentAt: map[safeId] || null };
  }

  if (mode === 'contacts') {
    const numDigits = safeId.replace(/[^0-9]/g, '');
    if (numDigits) {
      const altId = `${numDigits}@c.us`;
      if (sentTodaySet.has(altId)) {
        return { sentToday: true, lastSentAt: map[altId] || null };
      }
      if (sentTodaySet.has(numDigits)) {
        return { sentToday: true, lastSentAt: map[numDigits] || null };
      }
    }
  }

  return { sentToday: false, lastSentAt: null };
}

/**
 * Calcula el total de destinatarios de una lista que ya recibieron mensaje hoy.
 * @param {Array<Object>} targets
 * @param {Object} statusOptions
 * @returns {number}
 */
function countAlreadySentTargets(targets = [], statusOptions = {}) {
  if (!Array.isArray(targets)) return 0;
  return targets.filter((target) => {
    const id = target && (target.id || target.number);
    const status = checkDestinationStatus(id, statusOptions);
    return Boolean(status && status.sentToday);
  }).length;
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MIN_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePageSize,
  buildHistoryChatTargets,
  filterChatTargets,
  normalizeChatMessage,
  deduplicateMessages,
  calculatePagination,
  createConversationMetadata,
  normalizeDestinationStatuses,
  checkDestinationStatus,
  countAlreadySentTargets
};
