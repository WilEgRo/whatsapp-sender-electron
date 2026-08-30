/**
 * WhatsApp Sender Electron - History Feature
 * Domain: History Rules
 * 
 * Reglas de negocio puras para historial de mensajes, normalización de conversaciones
 * y cálculo de estados de entrega diaria sin dependencias de DOM, Electron ni IPC.
 */

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
  const isOutgoing = Boolean(rawMessage && rawMessage.fromMe);
  const sender = rawMessage && rawMessage.sender ? String(rawMessage.sender) : fallbackLabel;
  const senderLabel = isOutgoing ? 'Yo' : sender;

  let timeLabel = '--:--';
  const timestampIso = rawMessage && rawMessage.timestampIso ? String(rawMessage.timestampIso) : null;
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

  return {
    id: String((rawMessage && rawMessage.id) || ''),
    isOutgoing,
    senderLabel,
    timeLabel,
    text: String((rawMessage && rawMessage.text) || ''),
    timestampIso
  };
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
  buildHistoryChatTargets,
  filterChatTargets,
  normalizeChatMessage,
  normalizeDestinationStatuses,
  checkDestinationStatus,
  countAlreadySentTargets
};
