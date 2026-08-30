/**
 * WhatsApp Sender Electron - Contacts Feature
 * Application: Select Contacts
 * 
 * Casos de uso para la selección, alternancia y limpieza de contactos seleccionados.
 * Funciones puras que devuelven nuevas colecciones sin mutar estado global.
 */

/**
 * Alterna la selección de un contacto: si ya estaba seleccionado lo quita, si no, lo agrega.
 * @param {Array<Object>} selectedContacts - Colección actual de seleccionados
 * @param {Array<Object>} contactsCatalog - Catálogo completo de contactos
 * @param {string} contactId - Identificador del contacto
 * @returns {{ selected: Array<Object>, action: 'added'|'removed'|'none', contact: Object|null }}
 */
function toggleContactSelection(selectedContacts = [], contactsCatalog = [], contactId) {
  const current = Array.isArray(selectedContacts) ? selectedContacts.slice() : [];
  const existingIndex = current.findIndex((c) => c && c.id === contactId);

  if (existingIndex >= 0) {
    const removedContact = current[existingIndex];
    current.splice(existingIndex, 1);
    return {
      selected: current,
      action: 'removed',
      contact: removedContact
    };
  }

  const catalog = Array.isArray(contactsCatalog) ? contactsCatalog : [];
  const contact = catalog.find((c) => c && c.id === contactId);

  if (!contact) {
    return {
      selected: current,
      action: 'none',
      contact: null
    };
  }

  current.push(contact);
  return {
    selected: current,
    action: 'added',
    contact
  };
}

/**
 * Quita un contacto de la selección actual.
 * @param {Array<Object>} selectedContacts
 * @param {string} contactId
 * @returns {Array<Object>}
 */
function removeContactSelection(selectedContacts = [], contactId) {
  if (!Array.isArray(selectedContacts)) return [];
  return selectedContacts.filter((c) => c && c.id !== contactId);
}

/**
 * Limpia la colección de contactos seleccionados.
 * @returns {Array<Object>}
 */
function clearAllSelectedContacts() {
  return [];
}

module.exports = {
  toggleContactSelection,
  removeContactSelection,
  clearAllSelectedContacts
};
