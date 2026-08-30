/**
 * WhatsApp Sender Electron - Messaging Feature
 * Presentation: Message Composer View
 * 
 * Gestiona el DOM del compositor de mensajes (pestañas A/B/C,
 * inserción de tokens dinámicos y variables personalizadas).
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
 * Obtiene los textareas asociados a un modo de envío.
 * @param {string} mode - 'contacts' | 'groups'
 * @returns {Array<HTMLTextAreaElement>}
 */
function getMessageElements(mode) {
  if (mode === 'contacts') {
    return ['mensaje', 'mensajeContacts2', 'mensajeContacts3']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }

  return ['mensajeGrupo', 'mensajeGrupo2', 'mensajeGrupo3']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

/**
 * Activa visualmente la pestaña y textarea de variante correspondiente.
 * @param {string} safeMode
 * @param {Object} composerState
 */
function applyActiveMessageTab(safeMode, composerState) {
  document.querySelectorAll(`[data-message-tab="${safeMode}"]`).forEach((button) => {
    const idx = Number(button.dataset.messageIndex);
    const isEnabled = composerState.enabledIndices.includes(idx);
    button.classList.toggle('hidden', !isEnabled);
    button.classList.toggle('is-active', idx === composerState.activeIndex);
  });

  document.querySelectorAll(`[data-message-pane="${safeMode}"]`).forEach((textarea) => {
    const idx = Number(textarea.dataset.messageIndex);
    const visible = composerState.enabledIndices.includes(idx) && idx === composerState.activeIndex;
    textarea.classList.toggle('hidden', !visible);
  });

  const addButton = document.querySelector(`[data-add-message-tab="${safeMode}"]`);
  if (addButton) {
    addButton.disabled = composerState.enabledIndices.length >= 3;
  }
}

/**
 * Actualiza la visibilidad de la opción de alternancia o división de mensajes.
 * @param {string} safeMode
 * @param {Object} config
 * @param {boolean} canUseSplit
 */
function applyMessageSplitOptionVisibility(safeMode, config, canUseSplit) {
  if (!config) return;
  const splitOption = document.getElementById(config.sendMessageSplitOptionId);
  const splitRadio = document.getElementById(config.sendMessageSplitId);
  const filesFirstRadio = document.getElementById(config.sendFilesFirstId);

  if (!splitOption || !splitRadio) {
    return;
  }

  splitOption.classList.toggle('hidden', !canUseSplit);

  if (!canUseSplit && splitRadio.checked && filesFirstRadio) {
    filesFirstRadio.checked = true;
  }
}

/**
 * Inserta un token en la posición actual del cursor dentro del textarea activo.
 * @param {HTMLTextAreaElement} textarea
 * @param {string} token
 */
function insertTokenInTextarea(textarea, token) {
  if (!textarea) return;

  const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : textarea.value.length;
  const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : textarea.value.length;
  const currentValue = String(textarea.value || '');
  textarea.value = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`;
  const nextPos = start + token.length;
  textarea.setSelectionRange(nextPos, nextPos);
  textarea.focus();
}

/**
 * Renderiza la lista de chips de variables personalizadas creadas.
 * @param {HTMLElement} listElement
 * @param {string} safeMode
 * @param {Array<{name: string, value: string}>} variables
 */
function renderCustomVariablesList(listElement, safeMode, variables = []) {
  if (!listElement) return;

  if (!Array.isArray(variables) || variables.length === 0) {
    listElement.innerHTML = '';
    return;
  }

  listElement.innerHTML = variables.map((item, idx) => {
    const name = String(item.name || '').trim();
    const value = String(item.value || '').trim();
    return `
      <span class="custom-var-chip">
        {{${escapeHtml(name)}}} = ${escapeHtml(value)}
        <button type="button" data-remove-custom-var="${escapeHtml(safeMode)}" data-custom-var-index="${idx}">x</button>
      </span>
    `;
  }).join('');
}

module.exports = {
  escapeHtml,
  getMessageElements,
  applyActiveMessageTab,
  applyMessageSplitOptionVisibility,
  insertTokenInTextarea,
  renderCustomVariablesList
};
