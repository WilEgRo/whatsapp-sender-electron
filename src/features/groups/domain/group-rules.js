/**
 * WhatsApp Sender Electron - Groups Feature
 * Domain: Group Rules
 * 
 * Reglas de negocio puras para la gestión, normalización y deduplicación de grupos.
 * Módulo de dominio independiente sin dependencias externas ni de interfaz gráfica.
 */

/**
 * Obtiene el nombre legible y limpio de un grupo.
 * @param {Object} group
 * @returns {string}
 */
function getGroupName(group) {
  if (!group) return 'Grupo sin nombre';
  const name = group.name ?? group.title ?? group.formattedTitle;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Grupo sin nombre';
}

/**
 * Extrae y valida el ID de un grupo de WhatsApp.
 * @param {Object|string} groupOrId
 * @returns {string}
 */
function getGroupId(groupOrId) {
  if (!groupOrId) return '';
  if (typeof groupOrId === 'string') {
    return groupOrId.trim();
  }
  return String(groupOrId.id || '').trim();
}

/**
 * Verifica si un objeto de grupo es válido (cuenta con identificador no vacío).
 * @param {Object} group
 * @returns {boolean}
 */
function isValidGroup(group) {
  if (!group || typeof group !== 'object') return false;
  const id = getGroupId(group);
  return Boolean(id);
}

/**
 * Verifica si el nombre de un grupo coincide con el término de búsqueda (insensible a mayúsculas).
 * @param {Object} group
 * @param {string} searchTerm
 * @returns {boolean}
 */
function matchesGroupSearch(group, searchTerm) {
  if (!group) return false;
  const term = String(searchTerm || '').trim().toLowerCase();
  if (!term) return true;

  const name = getGroupName(group).toLowerCase();
  return name.includes(term);
}

/**
 * Ordena alfabéticamente una colección de grupos por su nombre.
 * Función pura que no muta el arreglo original.
 * @param {Array<Object>} groups
 * @returns {Array<Object>}
 */
function sortGroupsByName(groups) {
  if (!Array.isArray(groups)) return [];

  return groups.slice().sort((a, b) => {
    const nameA = getGroupName(a);
    const nameB = getGroupName(b);
    return nameA.localeCompare(nameB, 'es');
  });
}

/**
 * Deduplica una lista de grupos según su ID único, preservando el orden original.
 * @param {Array<Object>} groups
 * @returns {Array<Object>}
 */
function deduplicateGroups(groups) {
  if (!Array.isArray(groups)) return [];

  const seen = new Set();
  const result = [];

  for (const group of groups) {
    const id = getGroupId(group);
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(group);
    }
  }

  return result;
}

/**
 * Resuelve el ID del grupo objetivo para exportación al modificarse la selección.
 * @param {string} currentExportGroupId
 * @param {Object} togglePayload
 * @param {string} togglePayload.groupId
 * @param {boolean} togglePayload.isSelected
 * @param {Array<string>} [togglePayload.selectedIds=[]]
 * @returns {string} Nuevo ID de exportación
 */
function resolveExportGroupSelection(currentExportGroupId, togglePayload) {
  if (!togglePayload || !togglePayload.groupId) {
    return currentExportGroupId || '';
  }

  if (togglePayload.isSelected) {
    return togglePayload.groupId;
  }

  if (currentExportGroupId === togglePayload.groupId) {
    const fallback = Array.isArray(togglePayload.selectedIds) ? togglePayload.selectedIds[0] : '';
    return fallback || '';
  }

  return currentExportGroupId || '';
}

module.exports = {
  getGroupName,
  getGroupId,
  isValidGroup,
  matchesGroupSearch,
  sortGroupsByName,
  deduplicateGroups,
  resolveExportGroupSelection
};
