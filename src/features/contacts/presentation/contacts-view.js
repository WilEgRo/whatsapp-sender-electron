/**
 * WhatsApp Sender Electron - Contacts Feature
 * Presentation: Contacts View
 * 
 * Gestiona exclusivamente la manipulación visual del DOM para contactos:
 * listados de resultados, chips de selección, contadores y badges de estado.
 * No contiene reglas de negocio complejas.
 */

const {
  formatLastSentTime,
  buildTodayBadge,
  buildTodayStatusIndicator
} = require('../../../renderer/js/modules/ui/timeline-utils');

/**
 * Actualiza el indicador textual del filtro y cantidad de resultados de contactos.
 * @param {HTMLElement} filterInfoEl
 * @param {HTMLElement} countEl
 * @param {Object} params
 * @param {number} params.filteredCount
 * @param {number|null} [params.totalCount=null]
 * @param {string} [params.searchTerm='']
 */
function updateContactFilterInfo(filterInfoEl, countEl, { filteredCount = 0, totalCount = null, searchTerm = '' } = {}) {
  if (countEl) {
    countEl.textContent = `${filteredCount} resultados`;
  }

  if (!filterInfoEl) return;

  const term = String(searchTerm || '').trim();
  if (!term) {
    filterInfoEl.textContent = 'Escribe para filtrar contactos en tiempo real.';
    return;
  }

  if (totalCount !== null && totalCount !== undefined) {
    filterInfoEl.textContent = `Filtro "${term}": ${filteredCount} de ${totalCount}.`;
    return;
  }

  filterInfoEl.textContent = `Filtro "${term}": ${filteredCount} resultados.`;
}

/**
 * Actualiza el contador total de contactos en la interfaz.
 * @param {HTMLElement} totalElement
 * @param {string} numbersRaw
 * @param {number} [importedTotal=0]
 */
function updateContactCounter(totalElement, numbersRaw = '', importedTotal = 0) {
  if (!totalElement) return;

  const safeImported = Number.isFinite(Number(importedTotal)) ? Number(importedTotal) : 0;
  if (safeImported > 0) {
    totalElement.textContent = String(safeImported);
    return;
  }

  const selectedCount = String(numbersRaw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean).length;

  totalElement.textContent = String(selectedCount);
}

/**
 * Renderiza los contactos en el contenedor de resultados de búsqueda.
 * @param {HTMLElement} container
 * @param {Object} params
 * @param {Array<Object>} params.contacts
 * @param {Set<string>} [params.selectedContactIds=new Set()]
 */
function renderContactResultsHtml(container, { contacts = [], selectedContactIds = new Set() } = {}) {
  if (!container) return;

  if (!contacts.length) {
    container.innerHTML = '<p class="contact-results__empty">No hay contactos para mostrar.</p>';
    return;
  }

  container.innerHTML = contacts
    .map((contact) => {
      const selected = selectedContactIds.has(contact.id);
      const isSentToday = Boolean(contact.sentToday);
      const lastSentAt = contact.lastSentAt || null;

      return `
        <button type="button" class="contact-row ${selected ? 'is-selected' : ''}" data-contact-id="${contact.id}">
          <span class="contact-row__name">${contact.name || contact.number}</span>
          <span class="contact-row__number">${contact.number}</span>
          <span class="contact-row__today">
            ${buildTodayStatusIndicator(isSentToday, lastSentAt)}
            <span class="contact-row__today-label">${isSentToday ? `Hoy ${formatLastSentTime(lastSentAt)}` : 'Sin enviar'}</span>
          </span>
        </button>
      `;
    })
    .join('');
}

/**
 * Renderiza los chips de contactos seleccionados y sincroniza el textarea de números.
 * @param {HTMLElement} chipsContainer
 * @param {HTMLElement} countElement
 * @param {HTMLInputElement|HTMLTextAreaElement} numbersField
 * @param {Object} params
 * @param {Array<Object>} params.contacts
 * @param {boolean} [params.updateNumbersField=true]
 * @param {Function} [params.getDestinationStatusFn=null]
 */
function renderSelectedContactsHtml(
  chipsContainer,
  countElement,
  numbersField,
  { contacts = [], updateNumbersField = true, getDestinationStatusFn = null } = {}
) {
  if (!chipsContainer) return;

  if (!contacts.length) {
    chipsContainer.innerHTML = '<p class="contact-results__empty">Sin contactos seleccionados.</p>';
    if (countElement) {
      countElement.textContent = '0 seleccionados';
    }
    if (numbersField && updateNumbersField) {
      numbersField.value = '';
    }
    return;
  }

  chipsContainer.innerHTML = contacts
    .map((contact) => {
      let isSentToday = Boolean(contact.sentToday);
      let lastSentAt = contact.lastSentAt || null;

      if (typeof getDestinationStatusFn === 'function') {
        const status = getDestinationStatusFn(contact.id || contact.number);
        isSentToday = Boolean(status && status.sentToday);
        lastSentAt = (status && status.lastSentAt) || lastSentAt;
      }

      return `
        <article class="contact-chip">
          <div class="contact-chip__meta">
            <p class="contact-chip__name">${contact.name || contact.number}</p>
            <p class="contact-chip__number">${contact.number}</p>
            <span class="target-status-tags">
              ${isSentToday ? buildTodayBadge(lastSentAt) : ''}
            </span>
          </div>
          <button type="button" class="contact-chip__remove" data-remove-contact-id="${contact.id}">x</button>
        </article>
      `;
    })
    .join('');

  if (countElement) {
    countElement.textContent = `${contacts.length} seleccionados`;
  }

  if (numbersField && updateNumbersField) {
    numbersField.value = contacts.map((c) => c.number).join(',');
  }
}

module.exports = {
  updateContactFilterInfo,
  updateContactCounter,
  renderContactResultsHtml,
  renderSelectedContactsHtml
};
