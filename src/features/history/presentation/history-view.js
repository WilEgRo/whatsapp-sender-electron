/**
 * WhatsApp Sender Electron - History Feature
 * Presentation: History View
 * 
 * Manipulación exclusiva del DOM para el visor de conversación y el modal de historial.
 * Renderiza encabezado, burbujas por día, botones de paginación, estados de carga/vacío/error
 * y conserva compatibilidad absoluta con funciones previas.
 */

const {
  groupMessagesByDay,
  formatMessageTime
} = require('../domain/conversation-rules');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renderiza el selector de chats disponibles para el historial (compatibilidad).
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
 * Renderiza los globos de mensajes en el visor de conversación legacy (compatibilidad).
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
      const isOutgoing = Boolean(item && (item.isOutgoing || item.fromMe));
      const senderLabel = item && item.senderLabel ? item.senderLabel : (isOutgoing ? 'Yo' : 'Contacto');
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

/**
 * Renderiza las burbujas agrupadas por día en el visor modal conversacional.
 * @param {HTMLElement} container
 * @param {Array<Object>} messages
 */
function renderMessagesListHtml(container, messages = []) {
  if (!container) return;

  if (!Array.isArray(messages) || messages.length === 0) {
    container.innerHTML = `
      <div class="conv-empty-state">
        <span class="conv-empty-state__icon">💬</span>
        <p>No se encontraron mensajes en esta conversación.</p>
      </div>
    `;
    return;
  }

  const days = groupMessagesByDay(messages);

  const html = days
    .map((dayGroup) => {
      const bubbles = dayGroup.messages
        .map((msg) => {
          const isOut = Boolean(msg.isOutgoing || msg.fromMe);
          const sender = msg.senderLabel || (isOut ? 'Yo' : 'Contacto');
          const time = formatMessageTime(msg.timestampIso);
          const text = escapeHtml(msg.text || '').replace(/\n/g, '<br>');

          return `
            <div class="conv-bubble-row ${isOut ? 'conv-bubble-row--outgoing' : 'conv-bubble-row--incoming'}">
              <div class="conv-bubble">
                <span class="conv-bubble__sender">${escapeHtml(sender)}</span>
                <div class="conv-bubble__text">${text}</div>
                <div class="conv-bubble__meta">
                  <span class="conv-bubble__time">${escapeHtml(time)}</span>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <div class="conversation-day-divider">
          <span class="conversation-day-badge">${escapeHtml(dayGroup.dateLabel)}</span>
        </div>
        ${bubbles}
      `;
    })
    .join('');

  container.innerHTML = html;
}

/**
 * Renderiza el estado de carga en el contenedor de mensajes.
 * @param {HTMLElement} container
 * @param {string} [text='Cargando conversación...']
 */
function renderLoadingState(container, text = 'Cargando conversación...') {
  if (!container) return;
  container.innerHTML = `
    <div class="conv-loading-state">
      <span class="conv-loading-spinner">⏳</span>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

/**
 * Renderiza el estado de error con botón de reintento.
 * @param {HTMLElement} container
 * @param {string} errorMessage
 */
function renderErrorState(container, errorMessage = 'Error al cargar mensajes') {
  if (!container) return;
  container.innerHTML = `
    <div class="conv-error-state">
      <span>⚠️</span>
      <p>${escapeHtml(errorMessage)}</p>
      <button type="button" class="conv-retry-btn" id="conversationRetryBtn">Reintentar</button>
    </div>
  `;
}

/**
 * Actualiza la información completa del modal conversacional.
 * @param {Object} elements - Referencias a elementos DOM del modal
 * @param {Object} params
 * @param {Object} params.target - Contacto o grupo
 * @param {Object} [params.conversation] - Conversación cargada
 * @param {boolean} [params.loading=false]
 * @param {boolean} [params.loadingOlder=false]
 * @param {string|null} [params.error=null]
 */
function renderConversationModal(elements = {}, {
  target = {},
  conversation = null,
  loading = false,
  loadingOlder = false,
  error = null
} = {}) {
  const {
    titleEl,
    badgeEl,
    subtitleEl,
    messagesContainer,
    paginationBar,
    loadOlderBtn,
    footerCounter,
    footerStatus
  } = elements;

  const isGroup = target.type === 'groups';

  if (titleEl) {
    titleEl.textContent = target.name || 'Conversación';
  }

  if (badgeEl) {
    badgeEl.textContent = isGroup ? 'Grupo' : 'Contacto';
    if (isGroup) {
      badgeEl.classList.add('conversation-badge--groups');
    } else {
      badgeEl.classList.remove('conversation-badge--groups');
    }
  }

  if (subtitleEl) {
    subtitleEl.textContent = target.identifier || target.id || '';
  }

  if (loading) {
    renderLoadingState(messagesContainer, 'Cargando conversación desde WhatsApp...');
    if (footerStatus) footerStatus.textContent = 'Consultando...';
    if (paginationBar) paginationBar.classList.add('hidden');
    return;
  }

  if (error) {
    renderErrorState(messagesContainer, error);
    if (footerStatus) footerStatus.textContent = 'Error';
    if (paginationBar) paginationBar.classList.add('hidden');
    return;
  }

  const messages = (conversation && Array.isArray(conversation.messages)) ? conversation.messages : [];
  renderMessagesListHtml(messagesContainer, messages);

  // Gestión de botón "Cargar anteriores"
  const hasMore = Boolean(conversation && conversation.pagination && conversation.pagination.hasMore);

  if (paginationBar) {
    if (hasMore) {
      paginationBar.classList.remove('hidden');
    } else {
      paginationBar.classList.add('hidden');
    }
  }

  if (loadOlderBtn) {
    loadOlderBtn.disabled = loadingOlder;
    loadOlderBtn.innerHTML = loadingOlder
      ? '<span>⏳ Cargando mensajes anteriores...</span>'
      : '<span>⬆️ Cargar mensajes anteriores</span>';
  }

  if (footerCounter) {
    footerCounter.textContent = `${messages.length} mensaje(s)`;
  }

  if (footerStatus) {
    footerStatus.textContent = hasMore ? 'Hay mensajes anteriores disponibles' : 'Conversación completa';
  }
}

/**
 * Abre el modal y enfoca la ventana.
 * @param {HTMLElement} modalEl
 */
function openConversationModal(modalEl) {
  if (modalEl) {
    modalEl.classList.remove('hidden');
  }
}

/**
 * Cierra el modal.
 * @param {HTMLElement} modalEl
 */
function closeConversationModal(modalEl) {
  if (modalEl) {
    modalEl.classList.add('hidden');
  }
}

module.exports = {
  escapeHtml,
  renderChatHistoryOptionsHtml,
  renderChatHistoryConversationHtml,
  renderMessagesListHtml,
  renderLoadingState,
  renderErrorState,
  renderConversationModal,
  openConversationModal,
  closeConversationModal
};
