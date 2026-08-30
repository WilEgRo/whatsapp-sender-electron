/**
 * WhatsApp Sender Electron - Scheduling Feature
 * Application: Manage Schedules
 * 
 * Casos de uso para la administración, filtrado y preparación de destinatarios de mensajes programados.
 * No manipula el DOM ni interactúa directamente con Electron o IPC.
 */

/**
 * Prepara la lista de opciones para el selector de destinatario (contacto o grupo) en el programador.
 * @param {string} mode - 'contacts' | 'groups'
 * @param {Array<Object>} [contacts=[]]
 * @param {Array<Object>} [groups=[]]
 * @param {string} [selectedTargetId='']
 * @returns {Array<{ id: string, label: string, selected: boolean }>}
 */
function buildScheduleTargetOptions(mode, contacts = [], groups = [], selectedTargetId = '') {
  const isGroups = mode === 'groups';
  const cleanSelectedId = String(selectedTargetId || '').trim();

  if (isGroups) {
    return (Array.isArray(groups) ? groups : [])
      .map((item) => {
        if (!item || !item.id) return null;
        const name = item.name ?? item.title ?? item.formattedTitle ?? 'Grupo sin nombre';
        return {
          id: String(item.id),
          label: String(name),
          selected: Boolean(cleanSelectedId && cleanSelectedId === String(item.id))
        };
      })
      .filter(Boolean);
  }

  return (Array.isArray(contacts) ? contacts : [])
    .map((item) => {
      if (!item || !item.id) return null;
      const name = item.name || item.number || 'Contacto';
      const number = item.number ? ` (${item.number})` : '';
      return {
        id: String(item.id),
        label: `${name}${number}`,
        selected: Boolean(cleanSelectedId && cleanSelectedId === String(item.id))
      };
    })
    .filter(Boolean);
}

/**
 * Filtra mensajes programados que tengan estado pendiente.
 * @param {Array<Object>} items
 * @returns {Array<Object>}
 */
function filterPendingSchedules(items = []) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && (item.status === 'pending' || !item.status));
}

/**
 * Remueve una programación por ID retornando una nueva colección.
 * @param {Array<Object>} items
 * @param {number|string} id
 * @returns {Array<Object>}
 */
function removeScheduleById(items = [], id) {
  if (!Array.isArray(items)) return [];
  const targetId = String(id);
  return items.filter((item) => item && String(item.id) !== targetId);
}

module.exports = {
  buildScheduleTargetOptions,
  filterPendingSchedules,
  removeScheduleById
};
