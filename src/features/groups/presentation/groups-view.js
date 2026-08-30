/**
 * WhatsApp Sender Electron - Groups Feature
 * Presentation: Groups View
 * 
 * Gestiona la manipulación visual del DOM para grupos:
 * checklist de grupos, estado de selección, selector de exportación y mensajes.
 * No contiene reglas de negocio complejas ni llamadas IPC.
 */

const {
  formatLastSentTime,
  buildTodayStatusIndicator
} = require('../../../renderer/js/modules/ui/timeline-utils');

/**
 * Renderiza la lista de grupos en el contenedor checklist con estados de selección y envío.
 * @param {HTMLElement} container
 * @param {Object} params
 * @param {Array<Object>} params.groups
 * @param {Set<string>|Array<string>} [params.selectedGroupIds=new Set()]
 * @param {string} [params.searchTerm='']
 */
function renderGroupsChecklistHtml(container, { groups = [], selectedGroupIds = new Set(), searchTerm = '' } = {}) {
  if (!container) return;

  const safeGroups = Array.isArray(groups) ? groups : [];
  const selectedSet = selectedGroupIds instanceof Set ? selectedGroupIds : new Set(Array.isArray(selectedGroupIds) ? selectedGroupIds : []);
  const normalizedTerm = String(searchTerm || '').trim();

  if (!safeGroups.length) {
    container.innerHTML = `
      <p class="group-checklist__empty">${normalizedTerm ? 'Sin resultados para el filtro actual' : 'No se encontraron grupos'}</p>
    `;
    return;
  }

  container.innerHTML = safeGroups
    .map((group) => {
      const groupId = (group && group.id) ? group.id : '';
      const groupName = group ? (group.name ?? group.title ?? group.formattedTitle ?? 'Grupo sin nombre') : 'Grupo sin nombre';
      const isSelected = selectedSet.has(groupId);
      const isSentToday = Boolean(group && group.sentToday);
      const lastSentAt = group ? group.lastSentAt : null;

      return `
        <button type="button" class="group-row ${isSelected ? 'is-selected' : ''}" data-group-id="${groupId}">
          <span class="group-row__check">${isSelected ? '✓' : ''}</span>
          <span class="group-row__name">${groupName}</span>
          <span class="group-row__sent-today">
            ${buildTodayStatusIndicator(isSentToday, lastSentAt)}
            <span class="group-row__sent-today-label">${isSentToday ? `Hoy ${formatLastSentTime(lastSentAt)}` : 'Sin enviar'}</span>
          </span>
        </button>
      `;
    })
    .join('');
}

/**
 * Renderiza las opciones del selector de grupos para exportación.
 * @param {HTMLSelectElement} selectElement
 * @param {Array<{ value: string, label: string, isSelected: boolean }>} options
 */
function renderGroupExportSelectHtml(selectElement, options = []) {
  if (!selectElement) return;

  const htmlOptions = ['<option value="">Selecciona un grupo...</option>'];
  (options || []).forEach((opt) => {
    if (!opt || !opt.value) return;
    htmlOptions.push(`<option value="${opt.value}" ${opt.isSelected ? 'selected' : ''}>${opt.label}</option>`);
  });

  selectElement.innerHTML = htmlOptions.join('');
}

/**
 * Actualiza el mensaje informativo de exportación de integrantes.
 * @param {HTMLElement} infoElement
 * @param {string} message
 * @param {string} [tone='']
 */
function updateGroupMembersInfoText(infoElement, message = '', tone = '') {
  if (!infoElement) return;

  infoElement.textContent = message;
  infoElement.className = `hint ${tone}`.trim();
}

/**
 * Actualiza el contador de grupos visibles en la UI.
 * @param {HTMLElement} counterElement
 * @param {number} totalCount
 */
function updateGroupCounterDisplay(counterElement, totalCount = 0) {
  if (!counterElement) return;
  counterElement.textContent = String(totalCount);
}

module.exports = {
  renderGroupsChecklistHtml,
  renderGroupExportSelectHtml,
  updateGroupMembersInfoText,
  updateGroupCounterDisplay
};
