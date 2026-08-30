/**
 * WhatsApp Sender Electron - Messaging Feature
 * Application: Prepare Campaign
 * 
 * Transforma y normaliza los datos de entrada en un modelo de campaña limpio para el envío.
 * No manipula el DOM ni ejecuta efectos secundarios.
 */

/**
 * Normaliza los contextos de contacto para personalización de mensajes.
 * @param {Array<Object>} selectedContacts
 * @returns {Array<Object>}
 */
function buildContactContexts(selectedContacts = []) {
  if (!Array.isArray(selectedContacts)) {
    return [];
  }

  return selectedContacts.map((contact) => {
    const fullName = String((contact && contact.name) || '').trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const number = String((contact && contact.number) || '').trim();
    const id = (contact && contact.id) || `${number}@c.us`;

    return {
      id,
      number,
      numero: number,
      full_name: fullName,
      nombre_completo: fullName,
      name: parts[0] || fullName || number,
      nombre: parts[0] || fullName || number,
      last_name: parts.length > 1 ? parts.slice(1).join(' ') : '',
      apellido: parts.length > 1 ? parts.slice(1).join(' ') : '',
      ...((contact && contact.context) || {})
    };
  });
}

/**
 * Prepara el modelo/payload de campaña para su validación y posterior envío por IPC.
 * @param {Object} params
 * @returns {Object} payload limpio
 */
function prepareCampaignPayload({
  mode = 'contacts',
  delayMin = 2,
  delayMax = 8,
  unitDelayMin = 0,
  unitDelayMax = 0,
  complianceMode = true,
  riskProfile = 'medium',
  sendFilesFirst = true,
  sendOrderMode = 'files-first',
  messagePayload = {},
  files = [],
  selectedContacts = [],
  selectedGroupIds = []
} = {}) {
  const messagePrimary = String((messagePayload && messagePayload.messagePrimary) || '').trim();
  const rawMessageList = (messagePayload && Array.isArray(messagePayload.messageList))
    ? messagePayload.messageList
    : [messagePrimary].filter(Boolean);

  const messageList = rawMessageList.map((item) => String(item || '').trim()).filter(Boolean);
  const customVariables = (messagePayload && typeof messagePayload.customVariables === 'object')
    ? messagePayload.customVariables
    : {};
  const randomTags = (messagePayload && Array.isArray(messagePayload.randomTags))
    ? messagePayload.randomTags
    : [];

  const filePaths = Array.isArray(files)
    ? files.map((f) => (typeof f === 'string' ? f : (f && f.path) || '')).filter(Boolean)
    : [];

  const payload = {
    targetType: mode,
    message: messagePrimary,
    messageList,
    customVariables,
    randomTags,
    files: filePaths,
    sendFilesFirst: Boolean(sendFilesFirst),
    sendOrderMode: String(sendOrderMode || 'files-first'),
    delayMin: Number(delayMin),
    delayMax: Number(delayMax),
    unitDelayMin: Number(unitDelayMin),
    unitDelayMax: Number(unitDelayMax),
    complianceMode: Boolean(complianceMode),
    riskProfile: String(riskProfile || 'medium')
  };

  if (mode === 'contacts') {
    const contacts = Array.isArray(selectedContacts) ? selectedContacts : [];
    payload.numbers = contacts.map((c) => (c && c.number) || '').filter(Boolean).join(',');
    payload.contactContexts = buildContactContexts(contacts);
  }

  if (mode === 'groups') {
    payload.groupIds = Array.isArray(selectedGroupIds) ? [...selectedGroupIds] : [];
    payload.groupContexts = (messagePayload && Array.isArray(messagePayload.groupContexts))
      ? messagePayload.groupContexts
      : [];
  }

  return payload;
}

module.exports = {
  buildContactContexts,
  prepareCampaignPayload
};
