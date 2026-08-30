/**
 * WhatsApp Sender Electron - Scheduling Feature
 * Domain: Scheduling Rules
 * 
 * Reglas de negocio puras para la validación, normalización y cálculo temporal de programaciones.
 * Módulo de dominio independiente sin dependencias de infraestructura ni controladores externos.
 */

const ERROR_CODES = Object.freeze({
  EMPTY_TARGET: 'EMPTY_TARGET',
  EMPTY_CONTENT: 'EMPTY_CONTENT',
  INVALID_DATETIME: 'INVALID_DATETIME',
  INVALID_DELAY_RANGE: 'INVALID_DELAY_RANGE'
});

/**
 * Convierte un valor de input datetime-local o cadena de fecha a formato ISO 8601 UTC.
 * @param {string|number|Date} datetimeLocal
 * @returns {string|null}
 */
function toIsoFromDatetimeLocal(datetimeLocal) {
  const value = String(datetimeLocal || '').trim();
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

/**
 * Valida los parámetros requeridos para crear una programación de mensaje.
 * @param {Object} params
 * @param {string} params.targetId
 * @param {string} [params.messageText='']
 * @param {Array<any>} [params.files=[]]
 * @param {string} params.scheduledAt
 * @param {number} [params.delayMin=3]
 * @param {number} [params.delayMax=6]
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string }> }}
 */
function validateScheduleInput({
  targetId,
  messageText = '',
  files = [],
  scheduledAt,
  delayMin = 3,
  delayMax = 6
} = {}) {
  const errors = [];

  const cleanTargetId = String(targetId || '').trim();
  if (!cleanTargetId) {
    errors.push({
      code: ERROR_CODES.EMPTY_TARGET,
      message: 'Debes seleccionar un destinatario para programar el envío'
    });
  }

  const cleanText = String(messageText || '').trim();
  const safeFiles = Array.isArray(files) ? files : [];
  if (!cleanText && safeFiles.length === 0) {
    errors.push({
      code: ERROR_CODES.EMPTY_CONTENT,
      message: 'Debes ingresar un mensaje de texto o adjuntar al menos un archivo'
    });
  }

  const iso = toIsoFromDatetimeLocal(scheduledAt);
  if (!iso) {
    errors.push({
      code: ERROR_CODES.INVALID_DATETIME,
      message: 'Fecha y hora programada inválida o no seleccionada'
    });
  }

  const numMin = Number(delayMin);
  const numMax = Number(delayMax);
  if (Number.isFinite(numMin) && Number.isFinite(numMax)) {
    if (numMin < 0 || numMax < numMin) {
      errors.push({
        code: ERROR_CODES.INVALID_DELAY_RANGE,
        message: 'El intervalo de delay mínimo debe ser menor o igual al máximo y mayor o igual a cero'
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Normaliza la estructura en memoria del borrador de programación.
 * @param {Object} draft
 * @returns {{ targetType: string, targetId: string, files: Array<any>, sendFilesFirst: boolean }}
 */
function normalizeScheduleDraft(draft = {}) {
  const targetType = draft && draft.targetType === 'groups' ? 'groups' : 'contacts';
  const targetId = draft && typeof draft.targetId === 'string' ? draft.targetId.trim() : '';
  const files = draft && Array.isArray(draft.files) ? draft.files.slice(0, 3) : [];
  const sendFilesFirst = draft && draft.sendFilesFirst !== undefined ? Boolean(draft.sendFilesFirst) : true;

  return {
    targetType,
    targetId,
    files,
    sendFilesFirst
  };
}

/**
 * Formatea una fecha ISO para visualización en español.
 * @param {string|number|Date} dateOrIso
 * @param {string} [locale='es-BO']
 * @returns {string}
 */
function formatScheduleDate(dateOrIso, locale = 'es-BO') {
  if (!dateOrIso) return '-';
  const parsed = new Date(dateOrIso);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString(locale);
}

/**
 * Comprueba si una programación ha alcanzado o superado su hora de ejecución.
 * @param {string|number|Date} scheduledAtIso
 * @param {number} [referenceTimestamp=Date.now()]
 * @returns {boolean}
 */
function isScheduleDue(scheduledAtIso, referenceTimestamp = Date.now()) {
  if (!scheduledAtIso) return false;
  const time = new Date(scheduledAtIso).getTime();
  if (Number.isNaN(time)) return false;
  return time <= referenceTimestamp;
}

/**
 * Ordena una lista de mensajes programados cronológicamente por su fecha programada.
 * Función pura que no muta el arreglo original.
 * @param {Array<Object>} items
 * @returns {Array<Object>}
 */
function sortSchedulesByDate(items) {
  if (!Array.isArray(items)) return [];

  return items.slice().sort((a, b) => {
    const tA = a && a.scheduledAtIso ? new Date(a.scheduledAtIso).getTime() : 0;
    const tB = b && b.scheduledAtIso ? new Date(b.scheduledAtIso).getTime() : 0;
    return tA - tB;
  });
}

module.exports = {
  ERROR_CODES,
  toIsoFromDatetimeLocal,
  validateScheduleInput,
  normalizeScheduleDraft,
  formatScheduleDate,
  isScheduleDue,
  sortSchedulesByDate
};
