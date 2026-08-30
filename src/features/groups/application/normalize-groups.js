/**
 * WhatsApp Sender Electron - Groups Feature
 * Application: Normalize Groups
 * 
 * Casos de uso para el procesamiento, filtrado, normalización y preparación de grupos.
 * No manipula el DOM ni interactúa directamente con Electron o IPC.
 */

const {
  getGroupName,
  getGroupId,
  isValidGroup,
  matchesGroupSearch,
  deduplicateGroups
} = require('../domain/group-rules');

/**
 * Filtra, deduplica y decora el estado de envío diario de una colección de grupos.
 * @param {Object} params
 * @param {Array<Object>} params.groups
 * @param {string} [params.searchTerm='']
 * @param {Function} [params.getDestinationStatusFn=null]
 * @returns {Array<Object>} Lista de grupos filtrados y decorados
 */
function filterAndDecorateGroups({
  groups = [],
  searchTerm = '',
  getDestinationStatusFn = null
} = {}) {
  const safeGroups = Array.isArray(groups) ? deduplicateGroups(groups) : [];
  const term = String(searchTerm || '').trim().toLowerCase();

  const decorateStatus = (group) => {
    if (!isValidGroup(group)) return null;
    const groupId = getGroupId(group);
    const status = typeof getDestinationStatusFn === 'function'
      ? getDestinationStatusFn(groupId)
      : { sentToday: false, lastSentAt: null };

    return {
      ...group,
      id: groupId,
      name: getGroupName(group),
      sentToday: Boolean(status && status.sentToday),
      lastSentAt: (status && status.lastSentAt) || null
    };
  };

  const decorated = safeGroups.map(decorateStatus).filter(Boolean);

  if (term) {
    return decorated.filter((group) => matchesGroupSearch(group, term));
  }

  return decorated;
}

/**
 * Prepara las opciones del selector de grupos para exportación.
 * @param {Array<Object>} groups
 * @param {string} [selectedGroupId='']
 * @returns {Array<{ value: string, label: string, isSelected: boolean }>}
 */
function prepareGroupExportOptions(groups = [], selectedGroupId = '') {
  const safeGroups = Array.isArray(groups) ? deduplicateGroups(groups) : [];
  const cleanSelectedId = String(selectedGroupId || '').trim();

  return safeGroups.map((group) => {
    const id = getGroupId(group);
    const name = getGroupName(group);
    return {
      value: id,
      label: name,
      isSelected: Boolean(id && cleanSelectedId && id === cleanSelectedId)
    };
  });
}

module.exports = {
  filterAndDecorateGroups,
  prepareGroupExportOptions
};
