/**
 * WhatsApp Sender Electron - History Feature
 * Application: Manage Destination Status
 * 
 * Casos de uso para preparar consultas de estado de entrega diaria
 * y cálculo de sincronizaciones periódicas a medianoche.
 */

/**
 * Extrae los identificadores únicos de destinatarios para consultar su estado en lote.
 * @param {string} mode - 'contacts' | 'groups'
 * @param {Object} options
 * @param {Array<Object>} [options.contacts=[]]
 * @param {Array<Object>} [options.groups=[]]
 * @param {Array<Object>} [options.selectedContacts=[]]
 * @returns {Array<string>}
 */
function extractDestinationIds(mode, { contacts = [], groups = [], selectedContacts = [] } = {}) {
  const safeMode = mode === 'groups' ? 'groups' : 'contacts';

  if (safeMode === 'contacts') {
    const idsFromContacts = (Array.isArray(contacts) ? contacts : []).map((c) => c && c.id);
    const idsFromSelected = (Array.isArray(selectedContacts) ? selectedContacts : []).map((c) => c && (c.id || c.number));
    const uniqueSet = new Set([...idsFromContacts, ...idsFromSelected].filter(Boolean));
    return Array.from(uniqueSet).map(String);
  }

  return (Array.isArray(groups) ? groups : [])
    .map((g) => g && g.id)
    .filter(Boolean)
    .map(String);
}

/**
 * Calcula el retardo en milisegundos hasta la siguiente medianoche (más 4 segundos de margen).
 * @param {Date} [referenceDate=new Date()]
 * @returns {number}
 */
function calculateMidnightDelay(referenceDate = new Date()) {
  const now = new Date(referenceDate);
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 4, 0);
  return Math.max(1000, nextMidnight.getTime() - now.getTime());
}

module.exports = {
  extractDestinationIds,
  calculateMidnightDelay
};
