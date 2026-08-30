/**
 * WhatsApp Sender Electron - History Feature
 * Presentation: History Controller
 * 
 * Coordinador de presentación para historial de conversaciones y estado diario de destinatarios.
 * Conecta los eventos de UI con los casos de uso, pasarela IPC y vistas especializadas.
 */

const {
  buildHistoryChatTargets,
  filterChatTargets,
  normalizeDestinationStatuses,
  checkDestinationStatus,
  countAlreadySentTargets
} = require('../domain/history-rules');

const {
  prepareChatHistoryRequest,
  processChatHistoryResponse
} = require('../application/load-chat-history');

const {
  extractDestinationIds,
  calculateMidnightDelay
} = require('../application/manage-destination-status');

const {
  HistoryIpcGateway
} = require('../infrastructure/history-ipc-gateway');

const {
  renderChatHistoryOptionsHtml,
  renderChatHistoryConversationHtml
} = require('./history-view');

class HistoryController {
  /**
   * @param {Object} options
   * @param {Object} [options.ipcClient]
   * @param {Object} [options.ui]
   * @param {Object} [options.stateRef] - Referencia a AppController para sincronización retrocompatible
   */
  constructor(options = {}) {
    this.gateway = new HistoryIpcGateway(options.ipcClient);
    this.ui = options.ui || null;
    this.stateRef = options.stateRef || null;

    this._chatHistoryState = {
      selectedTargetId: '',
      selectedTargetType: 'contacts',
      searchTerm: '',
      filteredTargets: [],
      items: []
    };

    this._sentTodayByMode = {
      contacts: new Set(),
      groups: new Set()
    };

    this._lastSentAtByMode = {
      contacts: {},
      groups: {}
    };

    this.dailyStatusRefreshTimer = null;
  }

  get state() {
    if (this.stateRef && this.stateRef.chatHistoryState) {
      return this.stateRef.chatHistoryState;
    }
    return this._chatHistoryState;
  }

  get sentTodayByMode() {
    if (this.stateRef && this.stateRef.sentTodayByMode) {
      return this.stateRef.sentTodayByMode;
    }
    return this._sentTodayByMode;
  }

  get lastSentAtByMode() {
    if (this.stateRef && this.stateRef.lastSentAtByMode) {
      return this.stateRef.lastSentAtByMode;
    }
    return this._lastSentAtByMode;
  }

  _getUi() {
    if (this.ui) return this.ui;
    if (this.stateRef && this.stateRef.ui) {
      this.ui = this.stateRef.ui;
      return this.ui;
    }
    return null;
  }

  /**
   * Obtiene la lista unificada de destinatarios para historial.
   * @returns {Array<Object>}
   */
  getChatHistoryTargets() {
    const contacts = (this.stateRef && this.stateRef.contacts) || [];
    const groups = (this.stateRef && this.stateRef.groups) || [];
    return buildHistoryChatTargets(contacts, groups);
  }

  /**
   * Actualiza el selector de chats de historial en base al término de búsqueda.
   */
  refreshChatHistoryTargetOptions() {
    const select = document.getElementById('chatHistoryTargetSelect');
    const statusHint = document.getElementById('chatHistoryStatusHint');
    if (!select) return;

    const term = String(this.state.searchTerm || '').trim();
    const allTargets = this.getChatHistoryTargets();
    const filtered = filterChatTargets(allTargets, term);

    this.state.filteredTargets = filtered;

    if (filtered.length === 0) {
      this.state.selectedTargetId = '';
      renderChatHistoryOptionsHtml(select, statusHint, [], '');
      return;
    }

    const previous = String(this.state.selectedTargetId || '').trim();
    const nextSelected = filtered.find((item) => item.id === previous) || filtered[0];

    renderChatHistoryOptionsHtml(select, statusHint, filtered, nextSelected.id);

    this.state.selectedTargetId = nextSelected.id;
    this.state.selectedTargetType = nextSelected.type;
  }

  /**
   * Renderiza el visor de conversación del historial.
   * @param {Array<Object>} items
   * @param {string} [chatLabel='Chat']
   */
  renderChatHistoryConversation(items, chatLabel = 'Chat') {
    const container = document.getElementById('chatHistoryConversation');
    const countHint = document.getElementById('chatHistoryResultCount');
    renderChatHistoryConversationHtml(container, countHint, items, chatLabel);
  }

  /**
   * Solicita al proceso principal la previsualización del historial del chat seleccionado.
   */
  async loadChatHistoryPreview() {
    const select = document.getElementById('chatHistoryTargetSelect');
    const statusHint = document.getElementById('chatHistoryStatusHint');
    const ui = this._getUi();

    const request = prepareChatHistoryRequest({
      chatId: select ? select.value : this.state.selectedTargetId,
      limit: 220
    });

    if (!request.valid) {
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast(request.error, 'warning');
      }
      return;
    }

    const chatId = request.payload.chatId;
    const selected = (this.state.filteredTargets || []).find((item) => item.id === chatId) || null;
    this.state.selectedTargetId = chatId;
    this.state.selectedTargetType = selected ? selected.type : 'contacts';

    if (statusHint) {
      statusHint.textContent = 'Cargando conversacion...';
    }

    try {
      const response = await this.gateway.getChatHistoryPreview(request.payload);

      if (!response || !response.success || !response.result) {
        throw new Error((response && response.error) || 'No se pudo recuperar el historial');
      }

      const processed = processChatHistoryResponse(
        response.result,
        (selected && selected.label) || 'Chat'
      );

      this.state.items = processed.items;
      this.renderChatHistoryConversation(processed.items, processed.chatName);

      if (statusHint) {
        statusHint.textContent = `Conversacion cargada: ${processed.items.length} mensaje(s) de texto.`;
      }
    } catch (error) {
      console.error('Error cargando historial de chat:', error);
      this.state.items = [];
      this.renderChatHistoryConversation([], (selected && selected.label) || 'Chat');
      if (statusHint) {
        statusHint.textContent = `Error: ${error.message || 'no se pudo cargar el historial'}`;
      }
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('No se pudo cargar el historial de chat.', 'error');
      }
    }
  }

  /**
   * Asocia los eventos visuales para la pestaña de historial de chat.
   */
  bindEvents() {
    const searchInput = document.getElementById('chatHistoryContactSearch');
    const select = document.getElementById('chatHistoryTargetSelect');
    const loadButton = document.getElementById('chatHistoryLoadButton');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.state.searchTerm = String(searchInput.value || '');
        this.refreshChatHistoryTargetOptions();
      });
    }

    if (select) {
      select.addEventListener('change', () => {
        this.state.selectedTargetId = String(select.value || '');
      });

      select.addEventListener('dblclick', () => {
        this.loadChatHistoryPreview();
      });
    }

    if (loadButton) {
      loadButton.addEventListener('click', () => {
        this.loadChatHistoryPreview();
      });
    }
  }

  /**
   * Programa la sincronización automática de estados de entrega al llegar la medianoche.
   */
  scheduleDailyStatusRefresh() {
    if (this.dailyStatusRefreshTimer) {
      clearTimeout(this.dailyStatusRefreshTimer);
      this.dailyStatusRefreshTimer = null;
    }

    const delay = calculateMidnightDelay();

    this.dailyStatusRefreshTimer = setTimeout(async () => {
      try {
        await Promise.all([
          this.refreshDestinationStatuses('contacts', { repaint: true }),
          this.refreshDestinationStatuses('groups', { repaint: true }),
          this.stateRef && typeof this.stateRef.refreshMessageStats === 'function'
            ? this.stateRef.refreshMessageStats({ silent: true })
            : Promise.resolve()
        ]);
      } catch (error) {
        console.error('Error actualizando estado diario a medianoche:', error);
      } finally {
        this.scheduleDailyStatusRefresh();
      }
    }, delay);
  }

  /**
   * Comprueba si un destinatario fue contactado en el día actual.
   * @param {string} mode - 'contacts' | 'groups'
   * @param {string} destinationId
   * @returns {{ sentToday: boolean, lastSentAt: string|null }}
   */
  getDestinationStatus(mode, destinationId) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const sentTodaySet = this.sentTodayByMode[safeMode] || new Set();
    const lastSentMap = this.lastSentAtByMode[safeMode] || {};

    return checkDestinationStatus(destinationId, {
      sentTodaySet,
      lastSentMap,
      mode: safeMode
    });
  }

  /**
   * Devuelve cuántos destinatarios de la selección actual ya recibieron mensaje hoy.
   * @param {string} mode - 'contacts' | 'groups'
   * @returns {number}
   */
  getAlreadySentSelectedTargetsCount(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';

    if (safeMode === 'contacts') {
      const selectedContacts = (this.stateRef && this.stateRef.selectedContacts) || [];
      return countAlreadySentTargets(selectedContacts, {
        sentTodaySet: this.sentTodayByMode.contacts,
        lastSentMap: this.lastSentAtByMode.contacts,
        mode: 'contacts'
      });
    }

    if (safeMode === 'groups') {
      const ui = this._getUi();
      const selectedGroupIds = ui && typeof ui.getSelectedGroupIds === 'function'
        ? ui.getSelectedGroupIds()
        : [];
      const dummyGroupObjects = (Array.isArray(selectedGroupIds) ? selectedGroupIds : []).map((id) => ({ id }));
      return countAlreadySentTargets(dummyGroupObjects, {
        sentTodaySet: this.sentTodayByMode.groups,
        lastSentMap: this.lastSentAtByMode.groups,
        mode: 'groups'
      });
    }

    return 0;
  }

  /**
   * Refresca los estados de entrega diaria para una colección de destinatarios.
   * @param {string} mode - 'contacts' | 'groups'
   * @param {Object} [options]
   * @param {boolean} [options.repaint=true]
   */
  async refreshDestinationStatuses(mode, { repaint = true } = {}) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const destinationIds = extractDestinationIds(safeMode, {
      contacts: (this.stateRef && this.stateRef.contacts) || [],
      groups: (this.stateRef && this.stateRef.groups) || [],
      selectedContacts: (this.stateRef && this.stateRef.selectedContacts) || []
    });

    if (!Array.isArray(destinationIds) || destinationIds.length === 0) {
      return;
    }

    try {
      const response = await this.gateway.getDestinationStatuses({
        destinationType: safeMode,
        destinationIds
      });

      if (!response || !response.success || !response.result || !response.result.byId) {
        return;
      }

      const { sentTodaySet, lastSentMap } = normalizeDestinationStatuses(response.result.byId);

      this.sentTodayByMode[safeMode] = sentTodaySet;
      this.lastSentAtByMode[safeMode] = lastSentMap;

      if (this.stateRef) {
        this.stateRef.sentTodayByMode[safeMode] = sentTodaySet;
        this.stateRef.lastSentAtByMode[safeMode] = lastSentMap;
      }

      if (!repaint) return;

      if (safeMode === 'contacts' && this.stateRef && typeof this.stateRef.applyContactFilter === 'function') {
        this.stateRef.applyContactFilter();
      } else if (safeMode === 'groups' && this.stateRef && typeof this.stateRef.applyGroupFilter === 'function') {
        this.stateRef.applyGroupFilter();
      }
    } catch (error) {
      console.error(`Error cargando estado de destinatarios (${safeMode}):`, error);
    }
  }
}

module.exports = {
  HistoryController
};
