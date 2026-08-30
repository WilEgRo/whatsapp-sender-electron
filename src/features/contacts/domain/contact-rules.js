/**
 * WhatsApp Sender Electron - Contacts Feature
 * Domain: Contact Rules
 * 
 * Reglas de negocio puras para la gestión, normalización y deduplicación de contactos.
 * Módulo de dominio independiente sin dependencias externas ni de interfaz.
 */

/**
 * Elimina todos los caracteres no numéricos de un valor.
 * @param {string|number} value
 * @returns {string} Dígitos normalizados
 */
function normalizeNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

/**
 * Valida si un número telefónico tiene una longitud válida de dígitos.
 * @param {string|number} value
 * @param {number} [minLength=7]
 * @param {number} [maxLength=15]
 * @returns {boolean}
 */
function isValidPhoneNumber(value, minLength = 7, maxLength = 15) {
  const digits = normalizeNumber(value);
  return digits.length >= minLength && digits.length <= maxLength;
}

/**
 * Obtiene el timestamp más reciente de interacción registrado para un contacto.
 * @param {Object} contact
 * @param {Object} [interactionState]
 * @param {Object} [interactionState.lastInteractionById]
 * @param {Object} [interactionState.lastInteractionByNumber]
 * @returns {number}
 */
function getInteractionTimestamp(contact, { lastInteractionById = {}, lastInteractionByNumber = {} } = {}) {
  if (!contact) return 0;
  const byId = (contact.id && lastInteractionById[contact.id]) || 0;
  const num = normalizeNumber(contact.number);
  const byNumber = (num && lastInteractionByNumber[num]) || 0;
  return Math.max(byId, byNumber);
}

/**
 * Ordena una colección de contactos por interacción más reciente y luego alfabéticamente por nombre.
 * Función pura que no muta el arreglo original.
 * @param {Array<Object>} contacts
 * @param {Object} [interactionState]
 * @returns {Array<Object>}
 */
function sortContactsByInteraction(contacts, interactionState = {}) {
  if (!Array.isArray(contacts)) return [];

  return contacts.slice().sort((a, b) => {
    const tA = getInteractionTimestamp(a, interactionState);
    const tB = getInteractionTimestamp(b, interactionState);

    if (tA !== tB) {
      return tB - tA;
    }

    const nameA = String((a && a.name) || '');
    const nameB = String((b && b.name) || '');
    return nameA.localeCompare(nameB, 'es');
  });
}

/**
 * Deduplica una lista de contactos conservando el orden de primera aparición según su número telefónico.
 * @param {Array<Object>} contacts
 * @returns {Array<Object>}
 */
function deduplicateContacts(contacts) {
  if (!Array.isArray(contacts)) return [];

  const seen = new Set();
  const result = [];

  for (const contact of contacts) {
    if (!contact) continue;
    const num = normalizeNumber(contact.number);
    if (!num) continue;

    if (!seen.has(num)) {
      seen.add(num);
      result.push(contact);
    }
  }

  return result;
}

/**
 * Verifica si un contacto coincide con un término de búsqueda (en nombre o número).
 * @param {Object} contact
 * @param {string} searchTerm
 * @returns {boolean}
 */
function matchesContactSearch(contact, searchTerm) {
  if (!contact) return false;
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return true;

  const nameStr = String(contact.name || '').toLowerCase();
  const numberStr = String(contact.number || '').toLowerCase();
  return nameStr.includes(term) || numberStr.includes(term);
}

/**
 * Genera el identificador estándar de WhatsApp (JID) para un número.
 * @param {string|number} number
 * @returns {string}
 */
function formatContactId(number) {
  const digits = normalizeNumber(number);
  return digits ? `${digits}@c.us` : '';
}

module.exports = {
  normalizeNumber,
  isValidPhoneNumber,
  getInteractionTimestamp,
  sortContactsByInteraction,
  deduplicateContacts,
  matchesContactSearch,
  formatContactId
};
