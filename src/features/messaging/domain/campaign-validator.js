/**
 * WhatsApp Sender Electron - Messaging Feature
 * Domain: Campaign Validator
 * 
 * Reglas de negocio puras para la validación de campañas y payloads de envío.
 * Módulo de dominio independiente sin dependencias externas ni de interfaz.
 */

const ERROR_CODES = Object.freeze({
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FEATURE_NOT_INCLUDED: 'FEATURE_NOT_INCLUDED',
  WHATSAPP_NOT_READY: 'WHATSAPP_NOT_READY',
  EMPTY_RECIPIENTS: 'EMPTY_RECIPIENTS',
  INVALID_NUMBERS: 'INVALID_NUMBERS',
  EMPTY_CONTENT: 'EMPTY_CONTENT',
  DELAY_MIN_EXCEEDED: 'DELAY_MIN_EXCEEDED',
  DELAY_MAX_EXCEEDED: 'DELAY_MAX_EXCEEDED',
  DELAY_INVALID_RANGE: 'DELAY_INVALID_RANGE',
  UNIT_DELAY_MIN_OUT_OF_RANGE: 'UNIT_DELAY_MIN_OUT_OF_RANGE',
  UNIT_DELAY_MAX_OUT_OF_RANGE: 'UNIT_DELAY_MAX_OUT_OF_RANGE',
  UNIT_DELAY_INVALID_RANGE: 'UNIT_DELAY_INVALID_RANGE'
});

/**
 * Valida un número telefónico (longitud de dígitos normalizados).
 * @param {string} number
 * @returns {boolean}
 */
function isValidPhoneNumber(number) {
  const normalized = String(number || '').replace(/[^0-9]/g, '');
  return normalized.length >= 8 && normalized.length <= 15;
}

/**
 * Valida un modelo de campaña puro.
 * @param {Object} campaign
 * @returns {{ valid: boolean, errors: Array<{ code: string, message: string }> }}
 */
function validateCampaign(campaign = {}) {
  const errors = [];

  const {
    mode = 'contacts',
    payload = {},
    authState = { isValidated: true },
    hasBulkSendFeature = true,
    isWhatsAppReady = true,
    selectedContacts = []
  } = campaign;

  if (!authState || !authState.isValidated) {
    errors.push({
      code: ERROR_CODES.AUTH_REQUIRED,
      message: 'Tu licencia no esta validada. Inicia sesion para continuar.'
    });
  }

  if (!hasBulkSendFeature) {
    errors.push({
      code: ERROR_CODES.FEATURE_NOT_INCLUDED,
      message: 'Tu plan no incluye envio masivo. Actualiza tu suscripcion para continuar.'
    });
  }

  if (!isWhatsAppReady) {
    errors.push({
      code: ERROR_CODES.WHATSAPP_NOT_READY,
      message: 'WhatsApp no esta conectado todavia'
    });
  }

  if (mode === 'contacts') {
    const rawNumbers = typeof payload.numbers === 'string' ? payload.numbers.trim() : '';
    if (!rawNumbers && (!Array.isArray(selectedContacts) || selectedContacts.length === 0)) {
      errors.push({
        code: ERROR_CODES.EMPTY_RECIPIENTS,
        message: 'Ingresa al menos un numero'
      });
    }

    if (Array.isArray(selectedContacts) && selectedContacts.length > 0) {
      const invalid = selectedContacts.filter((contact) => !isValidPhoneNumber(contact.number));
      if (invalid.length > 0) {
        errors.push({
          code: ERROR_CODES.INVALID_NUMBERS,
          message: `Hay ${invalid.length} numeros invalidos. Corrigelos antes de enviar.`,
          count: invalid.length
        });
      }
    }
  }

  if (mode === 'groups') {
    const groupIds = Array.isArray(payload.groupIds) ? payload.groupIds : [];
    if (groupIds.length === 0) {
      errors.push({
        code: ERROR_CODES.EMPTY_RECIPIENTS,
        message: 'Selecciona al menos un grupo'
      });
    }
  }

  const messageList = Array.isArray(payload.messageList) ? payload.messageList : [];
  const hasAnyMessage = messageList.some((item) => String(item || '').trim().length > 0) ||
    Boolean(String(payload.message || '').trim());
  const files = Array.isArray(payload.files) ? payload.files : [];

  if (!hasAnyMessage && files.length === 0) {
    errors.push({
      code: ERROR_CODES.EMPTY_CONTENT,
      message: 'Escribe un mensaje o agrega archivos'
    });
  }

  const delayMin = Number(payload.delayMin);
  const delayMax = Number(payload.delayMax);

  if (delayMin > 24) {
    errors.push({
      code: ERROR_CODES.DELAY_MIN_EXCEEDED,
      message: 'El delay minimo no puede superar 24 segundos'
    });
  }

  if (delayMax > 25) {
    errors.push({
      code: ERROR_CODES.DELAY_MAX_EXCEEDED,
      message: 'El delay maximo no puede superar 25 segundos'
    });
  }

  if (delayMax <= delayMin) {
    errors.push({
      code: ERROR_CODES.DELAY_INVALID_RANGE,
      message: 'El delay maximo debe ser mayor al minimo'
    });
  }

  const unitDelayMin = Number(payload.unitDelayMin);
  const unitDelayMax = Number(payload.unitDelayMax);

  if (Number.isFinite(unitDelayMin)) {
    if (unitDelayMin < 0 || unitDelayMin > 30) {
      errors.push({
        code: ERROR_CODES.UNIT_DELAY_MIN_OUT_OF_RANGE,
        message: 'El delay minimo entre unidades debe estar entre 0 y 30 segundos'
      });
    }
  }

  if (Number.isFinite(unitDelayMax)) {
    if (unitDelayMax < 0 || unitDelayMax > 30) {
      errors.push({
        code: ERROR_CODES.UNIT_DELAY_MAX_OUT_OF_RANGE,
        message: 'El delay maximo entre unidades debe estar entre 0 y 30 segundos'
      });
    }
  }

  if (Number.isFinite(unitDelayMin) && Number.isFinite(unitDelayMax)) {
    if (unitDelayMax < unitDelayMin) {
      errors.push({
        code: ERROR_CODES.UNIT_DELAY_INVALID_RANGE,
        message: 'El delay maximo entre unidades debe ser mayor o igual al minimo'
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  ERROR_CODES,
  isValidPhoneNumber,
  validateCampaign
};
