/**
 * WhatsApp Sender Electron - History Feature
 * Presentation: History View
 * 
 * Manipulación del DOM para la vista de historial de chat y mensajes de conversación.
 * Sin dependencias de IPC ni de reglas de negocio complejas.
 */

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renderiza el selector de chats disponibles para el historial.
 * @param {HTMLSelectElement} select
 * @param {HTMLElement} statusHint
 * @param {Array<Object>} filtered
 * @param {string} selectedId
 */
function renderChatHistoryOptionsHtml(select, statusHint, filtered = [], selectedId = '') {
  if (!select) return;

  if (!Array.isArray(filtered) || filtered.length === 0) {
    select.innerHTML = '';
    if (statusHint) {
      statusHint.textContent = 'No se encontraron chats para ese filtro.';
    }
    return;
  }

  const nextSelected = filtered.find((item) => item && item.id === selectedId) || filtered[0];

  select.innerHTML = filtered
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`)
    .join('');

  if (nextSelected) {
    select.value = nextSelected.id;
  }

  if (statusHint) {
    statusHint.textContent = `${filtered.length} chat(s) disponible(s).`;
  }
}

/**
 * Renderiza los globos de mensajes en el visor de conversación.
 * @param {HTMLElement} container
 * @param {HTMLElement} countHint
 * @param {Array<Object>} items
 */
function renderChatHistoryConversationHtml(container, countHint, items = []) {
  if (!container) return;

  const safeItems = Array.isArray(items) ? items : [];

  if (countHint) {
    countHint.textContent = `${safeItems.length} mensajes de texto`;
  }

  if (safeItems.length === 0) {
    container.innerHTML = '<p class="chat-history-empty">No se encontraron mensajes de texto en este chat.</p>';
    return;
  }

  container.innerHTML = safeItems
    .map((item) => {
      const isOutgoing = Boolean(item && item.isOutgoing);
      const senderLabel = item && item.senderLabel ? item.senderLabel : 'Contacto';
      const timeLabel = item && item.timeLabel ? item.timeLabel : '--:--';
      const text = item && item.text ? item.text : '';

      return `
        <article class="chat-message ${isOutgoing ? 'chat-message--outgoing' : 'chat-message--incoming'}">
          <div class="chat-message__meta">
            <span>${escapeHtml(senderLabel)}</span>
            <span>${escapeHtml(timeLabel)}</span>
          </div>
          <p class="chat-message__text">${escapeHtml(text)}</p>
        </article>
      `;
    })
    .join('');
}

module.exports = {
  escapeHtml,
  renderChatHistoryOptionsHtml,
  renderChatHistoryConversationHtml
};
