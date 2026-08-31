/**
 * WhatsApp Sender Electron - Chat Export Feature
 * Presentation: Chat Export View
 * 
 * Funciones puras de renderizado y manipulación del DOM para la pestaña Exportar Chat.
 * Respeta CSP: sin estilos inline, sin eval, sin atributos de eventos inline.
 */

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Obtiene las referencias a los elementos DOM de la pantalla de Exportar Chat.
 * @param {Document|HTMLElement} [root=document]
 * @returns {Object}
 */
function getChatExportElements(root = document) {
  return {
    panel: root.getElementById('chatExportContent'),
    btnContacts: root.getElementById('chatExportTabContacts'),
    btnGroups: root.getElementById('chatExportTabGroups'),
    searchInput: root.getElementById('chatExportSearchInput'),
    searchClearBtn: root.getElementById('chatExportSearchClearBtn'),
    resultsCount: root.getElementById('chatExportResultsCount'),
    targetsList: root.getElementById('chatExportTargetsList'),
    selectedCard: root.getElementById('chatExportSelectedCard'),
    selectedName: root.getElementById('chatExportSelectedName'),
    selectedType: root.getElementById('chatExportSelectedType'),
    selectedId: root.getElementById('chatExportSelectedId'),
    selectedEmptyHint: root.getElementById('chatExportSelectedEmptyHint'),
    selectedFilledContainer: root.getElementById('chatExportSelectedFilledContainer'),
    exportTxtBtn: root.getElementById('chatExportTxtBtn'),
    exportHtmlBtn: root.getElementById('chatExportHtmlBtn'),
    exportPdfBtn: root.getElementById('chatExportPdfBtn'),
    exportJsonBtn: root.getElementById('chatExportJsonBtn'),
    includeMediaCheck: root.getElementById('chatExportIncludeMediaCheck'),
    statusBox: root.getElementById('chatExportStatusBox'),
    statusText: root.getElementById('chatExportStatusText'),
    statusSpinner: root.getElementById('chatExportStatusSpinner')
  };
}

/**
 * Renderiza el estado activo de los botones de origen (Contactos / Grupos).
 * @param {Object} elements
 * @param {'contacts'|'groups'} activeType
 */
function renderTargetTabs(elements, activeType = 'contacts') {
  if (elements.btnContacts) {
    elements.btnContacts.classList.toggle('active', activeType === 'contacts');
    elements.btnContacts.setAttribute('aria-selected', activeType === 'contacts' ? 'true' : 'false');
  }
  if (elements.btnGroups) {
    elements.btnGroups.classList.toggle('active', activeType === 'groups');
    elements.btnGroups.setAttribute('aria-selected', activeType === 'groups' ? 'true' : 'false');
  }
  if (elements.searchInput) {
    elements.searchInput.placeholder = activeType === 'groups'
      ? 'Buscar grupo por nombre o identificador...'
      : 'Buscar contacto por nombre o número...';
  }
}

/**
 * Renderiza la lista de destinos en el contenedor.
 * @param {Object} elements
 * @param {Array<Object>} targets
 * @param {string|null} selectedId
 * @param {'contacts'|'groups'} targetType
 */
function renderTargetsList(elements, targets = [], selectedId = null, targetType = 'contacts') {
  if (!elements.targetsList) return;

  const count = Array.isArray(targets) ? targets.length : 0;
  if (elements.resultsCount) {
    elements.resultsCount.textContent = `${count} ${targetType === 'groups' ? 'grupos' : 'contactos'} disponibles`;
  }

  if (count === 0) {
    elements.targetsList.innerHTML = `
      <div class="chat-export-empty-state">
        <span class="empty-icon">🔍</span>
        <p class="empty-title">No se encontraron conversaciones</p>
        <small class="empty-desc">Intenta con otro término de búsqueda o verifica que WhatsApp esté conectado.</small>
      </div>
    `;
    return;
  }

  const isGroup = targetType === 'groups';
  const html = targets.map((target) => {
    const isSelected = selectedId && (target.id === selectedId || target.identifier === selectedId);
    const safeName = escapeHtml(target.name || 'Sin nombre');
    const safeId = escapeHtml(target.identifier || target.id || '');
    const badgeText = isGroup ? 'Grupo' : 'Contacto';
    const badgeClass = isGroup ? 'badge--group' : 'badge--contact';
    const avatar = isGroup ? '👥' : '👤';

    return `
      <div class="chat-export-target-item ${isSelected ? 'is-selected' : ''}" data-target-id="${escapeHtml(target.id)}" tabindex="0" role="button" aria-pressed="${isSelected ? 'true' : 'false'}">
        <div class="target-item-avatar">${avatar}</div>
        <div class="target-item-info">
          <div class="target-item-title-row">
            <span class="target-item-name">${safeName}</span>
            <span class="target-item-badge ${badgeClass}">${badgeText}</span>
          </div>
          <span class="target-item-id">${safeId}</span>
        </div>
        <div class="target-item-radio ${isSelected ? 'checked' : ''}" aria-hidden="true"></div>
      </div>
    `;
  }).join('');

  elements.targetsList.innerHTML = html;
}

/**
 * Renderiza la conversación seleccionada en el banner de pre-exportación.
 * @param {Object} elements
 * @param {Object|null} target
 */
function renderSelectedTarget(elements, target = null) {
  const hasTarget = Boolean(target && target.id);

  if (elements.selectedEmptyHint) {
    elements.selectedEmptyHint.classList.toggle('hidden', hasTarget);
  }
  if (elements.selectedFilledContainer) {
    elements.selectedFilledContainer.classList.toggle('hidden', !hasTarget);
  }

  if (hasTarget) {
    if (elements.selectedName) {
      elements.selectedName.textContent = target.name || 'Conversación seleccionada';
    }
    if (elements.selectedType) {
      const isGroup = target.type === 'groups';
      elements.selectedType.textContent = isGroup ? 'Grupo de WhatsApp' : 'Contacto individual';
      elements.selectedType.className = `status-badge ${isGroup ? 'status-badge--neutral' : 'status-badge--info'}`;
    }
    if (elements.selectedId) {
      elements.selectedId.textContent = target.identifier || target.id || '';
    }
  }

  setExportButtonsDisabled(elements, !hasTarget);
}

/**
 * Habilita o deshabilita los 4 botones de exportación.
 * @param {Object} elements
 * @param {boolean} disabled
 */
function setExportButtonsDisabled(elements, disabled = true) {
  const buttons = [
    elements.exportTxtBtn,
    elements.exportHtmlBtn,
    elements.exportPdfBtn,
    elements.exportJsonBtn
  ];

  buttons.forEach((btn) => {
    if (btn) {
      btn.disabled = Boolean(disabled);
    }
  });
}

/**
 * Renderiza el estado de la operación de exportación (cargando, éxito, error).
 * @param {Object} elements
 * @param {Object} status
 * @param {boolean} [status.loading=false]
 * @param {string} [status.message='']
 * @param {string} [status.state='idle'] - 'idle'|'loading'|'success'|'error'
 */
function renderExportStatus(elements, { loading = false, message = '', state = 'idle' } = {}) {
  if (!elements.statusBox) return;

  if (state === 'idle' && !message) {
    elements.statusBox.classList.add('hidden');
    return;
  }

  elements.statusBox.classList.remove('hidden');
  elements.statusBox.className = `chat-export-status-box status-box--${state}`;

  if (elements.statusSpinner) {
    elements.statusSpinner.classList.toggle('hidden', !loading);
  }
  if (elements.statusText) {
    elements.statusText.textContent = message || (loading ? 'Procesando exportación...' : '');
  }
}

module.exports = {
  getChatExportElements,
  renderTargetTabs,
  renderTargetsList,
  renderSelectedTarget,
  setExportButtonsDisabled,
  renderExportStatus
};
