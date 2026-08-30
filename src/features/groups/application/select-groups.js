/**
 * WhatsApp Sender Electron - Groups Feature
 * Application: Select Groups
 * 
 * Casos de uso para la gestión y sincronización de grupos seleccionados.
 * Funciones puras que devuelven nuevas colecciones sin mutar estado global.
 */

const {
  getGroupId,
  resolveExportGroupSelection
} = require('../domain/group-rules');

/**
 * Alterna la selección de un grupo (agrega si no está, remueve si está).
 * @param {Array<string>|Set<string>} currentSelectedIds
 * @param {string} groupId
 * @returns {{ selectedIds: Array<string>, isSelected: boolean }}
 */
function toggleGroupSelection(currentSelectedIds = [], groupId) {
  const cleanId = getGroupId(groupId);
  if (!cleanId) {
    const list = Array.from(currentSelectedIds || []);
    return { selectedIds: list, isSelected: false };
  }

  const set = new Set(Array.from(currentSelectedIds || []));
  let isSelected = false;

  if (set.has(cleanId)) {
    set.delete(cleanId);
    isSelected = false;
  } else {
    set.add(cleanId);
    isSelected = true;
  }

  return {
    selectedIds: Array.from(set),
    isSelected
  };
}

/**
 * Quita un grupo de la selección actual.
 * @param {Array<string>|Set<string>} currentSelectedIds
 * @param {string} groupId
 * @returns {Array<string>}
 */
function removeGroupSelection(currentSelectedIds = [], groupId) {
  const cleanId = getGroupId(groupId);
  const set = new Set(Array.from(currentSelectedIds || []));
  if (cleanId) {
    set.delete(cleanId);
  }
  return Array.from(set);
}

/**
 * Limpia la colección de grupos seleccionados.
 * @returns {Array<string>}
 */
function clearAllSelectedGroups() {
  return [];
}

/**
 * Sincroniza la selección de exportación al modificar los grupos marcados.
 * @param {string} currentExportId
 * @param {Object} togglePayload
 * @returns {string}
 */
function syncExportSelectionState(currentExportId, togglePayload) {
  return resolveExportGroupSelection(currentExportId, togglePayload);
}

module.exports = {
  toggleGroupSelection,
  removeGroupSelection,
  clearAllSelectedGroups,
  syncExportSelectionState
};
