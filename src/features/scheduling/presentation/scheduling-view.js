/**
 * WhatsApp Sender Electron - Scheduling Feature
 * Presentation: Scheduling View
 * 
 * Gestiona exclusivamente la manipulación visual del DOM para el programador de mensajes:
 * selector de destinatarios, lista de programaciones pendientes y limpieza de formularios.
 * No contiene reglas de negocio complejas ni llamadas directas a IPC.
 */

const {
  formatScheduleDate
} = require('../domain/scheduling-rules');

/**
 * Renderiza las opciones en el elemento select de destinatarios para programación.
 * @param {HTMLSelectElement} selectElement
 * @param {Array<{ id: string, label: string, selected: boolean }>} options
 */
function renderScheduleTargetOptionsHtml(selectElement, options = []) {
  if (!selectElement) return;

  const htmlOptions = ['<option value="">Selecciona...</option>'];
  (options || []).forEach((item) => {
    if (!item || !item.id) return;
    htmlOptions.push(`<option value="${item.id}" ${item.selected ? 'selected' : ''}>${item.label}</option>`);
  });

  selectElement.innerHTML = htmlOptions.join('');
}

/**
 * Renderiza la lista de mensajes programados en el contenedor.
 * @param {HTMLElement} container
 * @param {HTMLElement} countHintElement
 * @param {Array<Object>} items
 */
function renderScheduledMessagesListHtml(container, countHintElement, items = []) {
  if (!container) return;

  const list = Array.isArray(items) ? items : [];

  if (countHintElement) {
    countHintElement.textContent = `${list.length} programados`;
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="contact-results__empty">No hay mensajes programados pendientes.</p>';
    return;
  }

  container.innerHTML = list.map((item) => {
    const dateLabel = formatScheduleDate(item.scheduledAtIso);
    const typeLabel = item.targetType === 'groups' ? 'Grupo' : 'Contacto';
    const filesCount = Array.isArray(item.files) ? item.files.length : 0;
    const messagePreview = String(item.messageText || '').trim().slice(0, 90);

    return `
      <article class="scheduled-item">
        <div class="scheduled-item__meta">
          <p class="scheduled-item__title">${typeLabel}: ${item.targetLabel || item.targetId}</p>
          <p class="scheduled-item__time">Programado: ${dateLabel}</p>
          <p class="scheduled-item__summary">${messagePreview || 'Sin texto'}${filesCount > 0 ? ` · ${filesCount} archivo(s)` : ''}</p>
        </div>
        <button class="file-chip__remove" type="button" data-cancel-schedule-id="${item.id}">Cancelar</button>
      </article>
    `;
  }).join('');
}

/**
 * Limpia los campos del formulario de programación tras una creación exitosa.
 * @param {Object} elements
 * @param {HTMLInputElement|HTMLTextAreaElement} [elements.messageText]
 * @param {HTMLInputElement} [elements.datetime]
 */
function clearScheduleFormInputs({ messageText, datetime } = {}) {
  if (messageText) {
    messageText.value = '';
  }
  if (datetime) {
    datetime.value = '';
  }
}

module.exports = {
  renderScheduleTargetOptionsHtml,
  renderScheduledMessagesListHtml,
  clearScheduleFormInputs
};
