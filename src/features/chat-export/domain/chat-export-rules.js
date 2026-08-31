/**
 * WhatsApp Sender Electron - Chat Export Feature
 * Domain: Chat Export Rules
 * 
 * Reglas de negocio puras para la exportación de conversaciones de chat.
 * Totalmente desacoplado de DOM, Electron, IPC, UI y Node.js APIs.
 */

const SUPPORTED_EXPORT_FORMATS = Object.freeze(['txt', 'html', 'pdf', 'json']);

/**
 * Normaliza el tipo de destinatario ('contacts' o 'groups').
 * @param {string} type
 * @returns {'contacts'|'groups'}
 */
function normalizeTargetType(type) {
  const safe = String(type || '').trim().toLowerCase();
  if (safe === 'group' || safe === 'groups' || safe.endsWith('@g.us')) {
    return 'groups';
  }
  return 'contacts';
}

/**
 * Normaliza cualquier objeto o identificador de destino en una estructura uniforme.
 * @param {Object|string} target
 * @param {'contacts'|'groups'} [defaultType='contacts']
 * @returns {{ id: string, name: string, type: 'contacts'|'groups', identifier: string }}
 */
function normalizeExportTarget(target, defaultType = 'contacts') {
  if (!target) {
    return {
      id: '',
      name: 'Destinatario desconocido',
      type: normalizeTargetType(defaultType),
      identifier: ''
    };
  }

  if (typeof target === 'string') {
    const trimmed = target.trim();
    const isGroup = trimmed.endsWith('@g.us');
    return {
      id: trimmed,
      name: trimmed,
      type: isGroup ? 'groups' : normalizeTargetType(defaultType),
      identifier: trimmed
    };
  }

  const id = String(target.id || target.chatId || target.serialized || target.number || '').trim();
  const isGroup = target.type === 'groups' || (id && id.endsWith('@g.us'));
  const type = isGroup ? 'groups' : normalizeTargetType(target.type || defaultType);
  const name = String(target.name || target.pushname || target.formattedTitle || target.number || id || 'Sin nombre').trim();
  const identifier = String(target.identifier || target.number || id || '').trim();

  return {
    id,
    name,
    type,
    identifier
  };
}

/**
 * Valida si un destino contiene un identificador válido para consulta.
 * @param {Object} target
 * @returns {boolean}
 */
function isValidTarget(target) {
  if (!target || typeof target !== 'object') {
    return false;
  }
  return typeof target.id === 'string' && target.id.trim().length > 0;
}

/**
 * Retorna la etiqueta legible del tipo de destino.
 * @param {'contacts'|'groups'} type
 * @returns {string}
 */
function formatTargetTypeLabel(type) {
  return normalizeTargetType(type) === 'groups' ? 'Grupo' : 'Contacto';
}

/**
 * Filtra una lista de destinos en base a un término de búsqueda (nombre o identificador).
 * Inmutable: retorna un nuevo arreglo.
 * @param {Array<Object>} targets
 * @param {string} [query='']
 * @returns {Array<Object>}
 */
function filterExportTargets(targets = [], query = '') {
  if (!Array.isArray(targets)) {
    return [];
  }

  const cleanQuery = String(query || '').trim().toLowerCase();
  if (!cleanQuery) {
    return [...targets];
  }

  return targets.filter((target) => {
    if (!target) return false;
    const name = String(target.name || '').toLowerCase();
    const identifier = String(target.identifier || target.id || '').toLowerCase();
    return name.includes(cleanQuery) || identifier.includes(cleanQuery);
  });
}

/**
 * Ordena destinos alfabéticamente por nombre de forma inmutable.
 * @param {Array<Object>} targets
 * @param {'asc'|'desc'} [direction='asc']
 * @returns {Array<Object>}
 */
function sortExportTargets(targets = [], direction = 'asc') {
  if (!Array.isArray(targets)) {
    return [];
  }

  const modifier = direction === 'desc' ? -1 : 1;
  return [...targets].sort((a, b) => {
    const nameA = String((a && a.name) || '');
    const nameB = String((b && b.name) || '');
    return nameA.localeCompare(nameB, 'es', { sensitivity: 'base' }) * modifier;
  });
}

/**
 * Valida si el formato de exportación solicitado es admitido.
 * @param {string} format
 * @returns {boolean}
 */
function isValidExportFormat(format) {
  if (typeof format !== 'string') return false;
  return SUPPORTED_EXPORT_FORMATS.includes(format.trim().toLowerCase());
}

/**
 * Normaliza el formato de exportación solicitado, recurriendo a 'txt' por defecto.
 * @param {string} format
 * @returns {'txt'|'html'|'pdf'|'json'}
 */
function normalizeExportFormat(format) {
  const safe = String(format || 'txt').trim().toLowerCase();
  return isValidExportFormat(safe) ? safe : 'txt';
}

/**
 * Construye un nombre de archivo normalizado para la descarga.
 * @param {Object} target
 * @param {'txt'|'html'|'pdf'|'json'} [format='txt']
 * @param {Date|string} [date]
 * @returns {string}
 */
function buildExportFilename(target = {}, format = 'txt', date = new Date()) {
  const safeFormat = normalizeExportFormat(format);
  const extension = safeFormat === 'pdf' ? 'html' : safeFormat; // PDF exportado como HTML listo para impresión o PDF
  const safeName = String(target.name || 'conversacion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 30);

  const dateObj = date instanceof Date ? date : new Date(date);
  const dateStr = !isNaN(dateObj.getTime())
    ? dateObj.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return `chat_export_${safeName}_${dateStr}.${extension}`;
}

module.exports = {
  SUPPORTED_EXPORT_FORMATS,
  normalizeTargetType,
  normalizeExportTarget,
  isValidTarget,
  formatTargetTypeLabel,
  filterExportTargets,
  sortExportTargets,
  isValidExportFormat,
  normalizeExportFormat,
  buildExportFilename
};
