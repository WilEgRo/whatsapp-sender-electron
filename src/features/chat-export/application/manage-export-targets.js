/**
 * WhatsApp Sender Electron - Chat Export Feature
 * Application: Manage Export Targets
 * 
 * Caso de uso: Filtrado, resolución y selección de destinos para exportación.
 * Desacoplado de DOM, Electron y UI.
 */

const {
  normalizeTargetType,
  normalizeExportTarget,
  isValidTarget,
  filterExportTargets,
  sortExportTargets
} = require('../domain/chat-export-rules');

/**
 * Resuelve y filtra los destinos disponibles según el tipo y búsqueda actual.
 * @param {Object} params
 * @param {Array<Object>} [params.contacts=[]]
 * @param {Array<Object>} [params.groups=[]]
 * @param {'contacts'|'groups'} [params.targetType='contacts']
 * @param {string} [params.query='']
 * @returns {{ targets: Array<Object>, totalAvailable: number, totalFiltered: number, targetType: 'contacts'|'groups' }}
 */
function resolveExportTargets({
  contacts = [],
  groups = [],
  targetType = 'contacts',
  query = ''
} = {}) {
  const safeType = normalizeTargetType(targetType);
  const rawList = safeType === 'groups' ? (Array.isArray(groups) ? groups : []) : (Array.isArray(contacts) ? contacts : []);

  const normalizedList = rawList
    .map((item) => normalizeExportTarget(item, safeType))
    .filter(isValidTarget);

  const filtered = filterExportTargets(normalizedList, query);
  const sorted = sortExportTargets(filtered, 'asc');

  return {
    targets: sorted,
    totalAvailable: normalizedList.length,
    totalFiltered: sorted.length,
    targetType: safeType
  };
}

/**
 * Gestiona la selección de un destino de exportación.
 * @param {Object} params
 * @param {Object|null} [params.currentSelection=null]
 * @param {Object|string} [params.target=null]
 * @param {Array<Object>} [params.availableTargets=[]]
 * @returns {{ selectedTarget: Object|null, isSameAsCurrent: boolean }}
 */
function selectExportTarget({
  currentSelection = null,
  target = null,
  availableTargets = []
} = {}) {
  if (!target) {
    return {
      selectedTarget: null,
      isSameAsCurrent: currentSelection === null
    };
  }

  const normalized = normalizeExportTarget(target);
  if (!isValidTarget(normalized)) {
    throw new Error('El destino seleccionado no contiene un identificador válido.');
  }

  // Buscar coincidencia en disponibles para enriquecer datos si existen
  const found = Array.isArray(availableTargets)
    ? availableTargets.find((item) => item && (item.id === normalized.id || item.identifier === normalized.identifier))
    : null;

  const resolved = found ? { ...normalized, ...found } : normalized;
  const isSameAsCurrent = Boolean(currentSelection && currentSelection.id === resolved.id);

  return {
    selectedTarget: resolved,
    isSameAsCurrent
  };
}

module.exports = {
  resolveExportTargets,
  selectExportTarget
};
