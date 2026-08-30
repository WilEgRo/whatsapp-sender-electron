/**
 * WhatsApp Sender Electron - Scheduling Feature
 * Application: Schedule Campaign
 * 
 * Caso de uso para la preparación y validación del modelo de mensaje programado.
 * No manipula el DOM ni interactúa directamente con Electron o IPC.
 */

const {
  validateScheduleInput,
  toIsoFromDatetimeLocal
} = require('../domain/scheduling-rules');

/**
 * Prepara y valida el payload limpio para registrar un mensaje programado en el sistema.
 * @param {Object} input
 * @param {string} [input.targetType='contacts']
 * @param {string} input.targetId
 * @param {string} [input.targetLabel='']
 * @param {string} [input.messageText='']
 * @param {Array<Object|string>} [input.files=[]]
 * @param {boolean} [input.sendFilesFirst=true]
 * @param {number} [input.delayMin=3]
 * @param {number} [input.delayMax=6]
 * @param {string} input.scheduledAt
 * @returns {{ valid: boolean, payload?: Object, errors?: Array<{ code: string, message: string }> }}
 */
function prepareSchedulePayload({
  targetType = 'contacts',
  targetId,
  targetLabel = '',
  messageText = '',
  files = [],
  sendFilesFirst = true,
  delayMin = 3,
  delayMax = 6,
  scheduledAt
} = {}) {
  const validation = validateScheduleInput({
    targetId,
    messageText,
    files,
    scheduledAt,
    delayMin,
    delayMax
  });

  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors
    };
  }

  const safeTargetType = targetType === 'groups' ? 'groups' : 'contacts';
  const cleanTargetId = String(targetId || '').trim();
  const cleanTargetLabel = String(targetLabel || '').trim() || cleanTargetId;
  const cleanMessageText = String(messageText || '').trim();

  const filePaths = (Array.isArray(files) ? files : [])
    .map((item) => (item && typeof item === 'object' && item.path ? item.path : String(item || '')))
    .filter(Boolean);

  const scheduledAtIso = toIsoFromDatetimeLocal(scheduledAt);

  return {
    valid: true,
    payload: {
      targetType: safeTargetType,
      targetId: cleanTargetId,
      targetLabel: cleanTargetLabel,
      messageText: cleanMessageText,
      files: filePaths,
      sendFilesFirst: sendFilesFirst !== false,
      delayMin: Number(delayMin || 3),
      delayMax: Number(delayMax || 6),
      scheduledAt: scheduledAtIso
    }
  };
}

module.exports = {
  prepareSchedulePayload
};
