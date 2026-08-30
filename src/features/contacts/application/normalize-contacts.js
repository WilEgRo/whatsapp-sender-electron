/**
 * WhatsApp Sender Electron - Contacts Feature
 * Application: Normalize Contacts
 * 
 * Casos de uso para el procesamiento, filtrado, normalización y deduplicación de contactos.
 * No manipula el DOM ni interactúa directamente con Electron o IPC.
 */

const {
  normalizeNumber,
  isValidPhoneNumber,
  sortContactsByInteraction,
  deduplicateContacts,
  matchesContactSearch,
  formatContactId
} = require('../domain/contact-rules');

/**
 * Filtra, ordena por interacción previa y decora el estado de envío de una colección de contactos.
 * @param {Object} params
 * @param {Array<Object>} params.contacts
 * @param {string} [params.searchTerm='']
 * @param {Object} [params.interactionState={}]
 * @param {Function} [params.getDestinationStatusFn=null]
 * @param {number} [params.limit=200]
 * @returns {Array<Object>}
 */
function filterAndRankContacts({
  contacts = [],
  searchTerm = '',
  interactionState = {},
  getDestinationStatusFn = null,
  limit = 200
} = {}) {
  const term = String(searchTerm || '').trim().toLowerCase();
  const orderedContacts = sortContactsByInteraction(contacts, interactionState);

  const decorateStatus = (contact) => {
    if (!contact) return null;
    const status = typeof getDestinationStatusFn === 'function'
      ? getDestinationStatusFn(contact.id || contact.number)
      : { sentToday: false, lastSentAt: null };

    return {
      ...contact,
      sentToday: Boolean(status && status.sentToday),
      lastSentAt: (status && status.lastSentAt) || null
    };
  };

  if (term) {
    return orderedContacts
      .filter((contact) => matchesContactSearch(contact, term))
      .map(decorateStatus)
      .filter(Boolean);
  }

  return orderedContacts
    .slice(0, limit)
    .map(decorateStatus)
    .filter(Boolean);
}

/**
 * Parsea y normaliza una cadena de texto manual (números separados por salto de línea, coma o espacio).
 * Reconcilia con contactos conocidos o genera nuevos contactos estructurados.
 * @param {string} textValue
 * @param {Object} [options]
 * @param {Array<Object>} [options.existingContacts=[]]
 * @param {Array<Object>} [options.currentSelected=[]]
 * @returns {Array<Object>} Lista actualizada de contactos seleccionados
 */
function parseManualNumbersText(textValue, { existingContacts = [], currentSelected = [] } = {}) {
  const rawTokens = String(textValue || '')
    .split(/[\n,\s]+/)
    .map((token) => normalizeNumber(token))
    .filter((num) => isValidPhoneNumber(num, 7, 15));

  const existingMap = new Map();
  (existingContacts || []).forEach((c) => {
    if (c && c.number) existingMap.set(normalizeNumber(c.number), c);
  });
  (currentSelected || []).forEach((c) => {
    if (c && c.number) {
      const num = normalizeNumber(c.number);
      if (!existingMap.has(num)) {
        existingMap.set(num, c);
      }
    }
  });

  const updatedSelected = [];
  const seen = new Set();

  rawTokens.forEach((num) => {
    if (!seen.has(num)) {
      seen.add(num);
      const existing = existingMap.get(num);
      if (existing) {
        updatedSelected.push(existing);
      } else {
        updatedSelected.push({
          id: formatContactId(num),
          name: num,
          number: num
        });
      }
    }
  });

  return updatedSelected;
}

/**
 * Normaliza y deduplica una lista de contactos importados (por ejemplo desde Excel),
 * conservando el orden de inserción original.
 * @param {Array<Object>} importedList
 * @returns {Array<Object>}
 */
function normalizeImportedContacts(importedList = []) {
  return deduplicateContacts(importedList);
}

/**
 * Registra interacciones recientes en las estructuras de auditoría y estado.
 * @param {Object} params
 * @param {Array<string>} params.targets
 * @param {Array<Object>} params.contacts
 * @param {Object} params.lastInteractionById
 * @param {Object} params.lastInteractionByNumber
 * @param {Set<string>} params.sentTodaySet
 * @param {Object} params.lastSentAtMap
 * @returns {{ now: number, nowIso: string }}
 */
function recordRecentInteractions({
  targets = [],
  contacts = [],
  lastInteractionById = {},
  lastInteractionByNumber = {},
  sentTodaySet = new Set(),
  lastSentAtMap = {}
} = {}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { now: Date.now(), nowIso: new Date().toISOString() };
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const normalizedSet = new Set(
    targets.map((target) => normalizeNumber(String(target).replace('@c.us', ''))).filter(Boolean)
  );
  const targetIdSet = new Set(
    targets.map((target) => String(target || '').trim()).filter(Boolean)
  );

  targets.forEach((target) => {
    const safeTarget = String(target || '').trim();
    if (!safeTarget) return;
    const numDigits = normalizeNumber(safeTarget);

    sentTodaySet.add(safeTarget);
    lastSentAtMap[safeTarget] = nowIso;

    if (numDigits) {
      sentTodaySet.add(numDigits);
      sentTodaySet.add(formatContactId(numDigits));
      lastSentAtMap[numDigits] = nowIso;
      lastSentAtMap[formatContactId(numDigits)] = nowIso;
    }
  });

  (contacts || []).forEach((contact) => {
    if (!contact) return;
    const contactNumber = normalizeNumber(contact.number);
    const contactIdNumber = normalizeNumber(String(contact.id || '').replace('@c.us', ''));

    if (targetIdSet.has(contact.id) || normalizedSet.has(contactNumber) || normalizedSet.has(contactIdNumber)) {
      if (contact.id) {
        lastInteractionById[contact.id] = now;
        sentTodaySet.add(contact.id);
        lastSentAtMap[contact.id] = nowIso;
      }
      if (contactNumber) {
        lastInteractionByNumber[contactNumber] = now;
      }
    }
  });

  return { now, nowIso };
}

module.exports = {
  filterAndRankContacts,
  parseManualNumbersText,
  normalizeImportedContacts,
  recordRecentInteractions
};
