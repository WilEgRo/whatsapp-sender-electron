/**
 * WhatsApp Sender Electron - History Feature
 * Presentation: History Controller
 * 
 * Coordinador de presentación para historial de conversaciones, paginación defensiva,
 * visor modal bajo demanda y cálculo de estados diarios de destinatarios.
 * 
 * Arquitectura de Memoria:
 * - Mantiene ÚNICAMENTE la conversación activa seleccionada en memoria.
 * - Al cerrar o cambiar de contacto/grupo, libera inmediatamente los mensajes previos.
 * - Protección contra condiciones de carrera (Race Conditions) mediante sequence tokens.
 */

const {
  normalizeConversationTarget,
  getConversationTargetId,
  getConversationTargetName
} = require('../domain/conversation-rules');

const {
  DEFAULT_PAGE_SIZE,
  buildHistoryChatTargets,
  filterChatTargets,
  normalizeDestinationStatuses,
  checkDestinationStatus,
  countAlreadySentTargets
} = require('../domain/history-rules');

const {
  loadConversation
} = require('../application/load-conversation');

const {
  loadInitialConversation,
  loadOlderMessages: loadOlderMessagesUseCase
} = require('../application/paginate-conversation');

const {
  exportConversation: exportConversationUseCase
} = require('../application/export-conversation');

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
  renderChatHistoryConversationHtml,
  renderConversationModal,
  openConversationModal,
  closeConversationModal
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

    // Estado exclusivo de la conversación activa bajo demanda (Protección de memoria)
    this.activeTarget = null;
    this.conversation = null;
    this.loading = false;
    this.loadingOlder = false;
    this.error = null;
    this.pageSize = DEFAULT_PAGE_SIZE;

    // Token secuencial contra Race Conditions
    this._activeRequestId = 0;

    // Estado retrocompatible
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
   * Obtiene referencias a los elementos DOM del visor modal de conversación.
   * @private
   */
  _getModalElements() {
    return {
      modal: document.getElementById('conversationViewerModal'),
      titleEl: document.getElementById('conversationViewerTitle'),
      badgeEl: document.getElementById('conversationViewerTypeBadge'),
      subtitleEl: document.getElementById('conversationViewerSubtitle'),
      messagesContainer: document.getElementById('conversationMessagesContainer'),
      paginationBar: document.getElementById('conversationPaginationBar'),
      loadOlderBtn: document.getElementById('conversationLoadOlderBtn'),
      closeBtn: document.getElementById('conversationViewerCloseBtn'),
      footerCounter: document.getElementById('conversationFooterCounter'),
      footerStatus: document.getElementById('conversationFooterStatus'),
      exportTxtBtn: document.getElementById('conversationExportTxtBtn'),
      exportHtmlBtn: document.getElementById('conversationExportHtmlBtn'),
      exportPdfBtn: document.getElementById('conversationExportPdfBtn'),
      exportJsonBtn: document.getElementById('conversationExportJsonBtn')
    };
  }

  /**
   * Abre y consulta bajo demanda el historial de conversación para un contacto o grupo.
   * Si cambia el destinatario, libera inmediatamente de memoria la conversación anterior.
   * Protegido contra respuestas asíncronas desfasadas.
   * @param {Object|string} target
   */
  async openConversation(target) {
    const normalizedTarget = normalizeConversationTarget(target);
    if (!normalizedTarget.id) {
      const ui = this._getUi();
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('No se puede abrir el historial sin un destinatario válido.', 'warning');
      }
      return;
    }

    // 1. Incrementamos el token de petición para invalidar cualquier petición previa en vuelo
    this._activeRequestId += 1;
    const currentRequestId = this._activeRequestId;

    // 2. Liberación estricta de memoria: descartamos la conversación anterior
    this.conversation = null;
    this.activeTarget = normalizedTarget;
    this.loading = true;
    this.loadingOlder = false;
    this.error = null;

    const elements = this._getModalElements();
    openConversationModal(elements.modal);

    renderConversationModal(elements, {
      target: normalizedTarget,
      conversation: null,
      loading: true,
      loadingOlder: false,
      error: null
    });

    try {
      const result = await loadInitialConversation({
        gateway: this.gateway,
        target: normalizedTarget,
        pageSize: this.pageSize
      });

      // 3. Protección contra Race Condition: si el usuario cambió de conversación o cerró el modal
      if (currentRequestId !== this._activeRequestId) {
        return;
      }

      this.conversation = result;
      this.loading = false;

      renderConversationModal(elements, {
        target: normalizedTarget,
        conversation: result,
        loading: false,
        loadingOlder: false,
        error: null
      });

      // Scroll al final para ver los mensajes más recientes
      if (elements.messagesContainer) {
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
      }
    } catch (err) {
      if (currentRequestId !== this._activeRequestId) {
        return;
      }

      this.loading = false;
      this.error = err.message || 'Error al recuperar conversación';

      renderConversationModal(elements, {
        target: normalizedTarget,
        conversation: null,
        loading: false,
        loadingOlder: false,
        error: this.error
      });
    }
  }

  /**
   * Carga un lote anterior de mensajes para la conversación actualmente abierta.
   */
  async loadOlderMessages() {
    if (!this.conversation || !this.activeTarget || this.loadingOlder) {
      return;
    }

    const elements = this._getModalElements();
    this.loadingOlder = true;

    if (elements.loadOlderBtn) {
      elements.loadOlderBtn.disabled = true;
      elements.loadOlderBtn.innerHTML = '<span>⏳ Cargando mensajes anteriores...</span>';
    }

    const currentRequestId = this._activeRequestId;

    try {
      const updated = await loadOlderMessagesUseCase({
        gateway: this.gateway,
        currentConversation: this.conversation,
        pageSize: this.pageSize
      });

      if (currentRequestId !== this._activeRequestId) {
        return;
      }

      this.conversation = updated;
      this.loadingOlder = false;

      renderConversationModal(elements, {
        target: this.activeTarget,
        conversation: updated,
        loading: false,
        loadingOlder: false,
        error: null
      });
    } catch (err) {
      if (currentRequestId !== this._activeRequestId) {
        return;
      }

      this.loadingOlder = false;
      const ui = this._getUi();
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast(`Error al cargar mensajes anteriores: ${err.message}`, 'error');
      }

      renderConversationModal(elements, {
        target: this.activeTarget,
        conversation: this.conversation,
        loading: false,
        loadingOlder: false,
        error: null
      });
    }
  }

  /**
   * Cierra el visor modal y libera de memoria la conversación actual.
   */
  closeConversation() {
    // Incrementamos token para cancelar callbacks en progreso
    this._activeRequestId += 1;

    // Liberamos estado en memoria
    this.activeTarget = null;
    this.conversation = null;
    this.loading = false;
    this.loadingOlder = false;
    this.error = null;

    const elements = this._getModalElements();
    closeConversationModal(elements.modal);
  }

  /**
   * Exporta la conversación actualmente cargada en el formato seleccionado.
   * @param {'txt'|'html'|'pdf'|'json'} [format='txt']
   */
  exportConversation(format = 'txt') {
    const ui = this._getUi();

    if (!this.conversation || !Array.isArray(this.conversation.messages) || this.conversation.messages.length === 0) {
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('No hay mensajes en la conversación activa para exportar.', 'warning');
      }
      return;
    }

    try {
      const exported = exportConversationUseCase({
        conversation: this.conversation,
        format
      });

      // Si es formato PDF o impresión, si estamos en navegador podemos abrir ventana de impresión
      if (format === 'pdf' && typeof window !== 'undefined' && typeof window.open === 'function') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(exported.content);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => {
            printWindow.print();
          }, 300);
          if (ui && typeof ui.showToast === 'function') {
            ui.showToast('Ventana de impresión abierta para generar PDF.', 'success');
          }
          return;
        }
      }

      // Descarga de archivo Blob estándar en Electron Renderer
      if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
        const blob = new Blob([exported.content], { type: exported.mimeType });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = exported.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);

        if (ui && typeof ui.showToast === 'function') {
          ui.showToast(`Conversación exportada como ${exported.extension.toUpperCase()}.`, 'success');
        }
      }
    } catch (error) {
      console.error('[HistoryController] Error exportando conversación:', error);
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('No se pudo exportar la conversación.', 'error');
      }
    }
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
   * Renderiza el visor de conversación del historial legacy.
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
   * Asocia los eventos visuales para la pestaña de historial y el visor modal de conversación.
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

    // Eventos del modal de conversación
    const elements = this._getModalElements();

    if (elements.closeBtn) {
      elements.closeBtn.addEventListener('click', () => {
        this.closeConversation();
      });
    }

    if (elements.loadOlderBtn) {
      elements.loadOlderBtn.addEventListener('click', () => {
        this.loadOlderMessages();
      });
    }

    if (elements.exportTxtBtn) {
      elements.exportTxtBtn.addEventListener('click', () => {
        this.exportConversation('txt');
      });
    }

    if (elements.exportHtmlBtn) {
      elements.exportHtmlBtn.addEventListener('click', () => {
        this.exportConversation('html');
      });
    }

    if (elements.exportPdfBtn) {
      elements.exportPdfBtn.addEventListener('click', () => {
        this.exportConversation('pdf');
      });
    }

    if (elements.exportJsonBtn) {
      elements.exportJsonBtn.addEventListener('click', () => {
        this.exportConversation('json');
      });
    }

    // Cierre al hacer click en el backdrop del modal
    if (elements.modal) {
      elements.modal.addEventListener('click', (event) => {
        if (event.target === elements.modal) {
          this.closeConversation();
        }
      });
    }

    // Cierre con Escape
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && elements.modal && !elements.modal.classList.contains('hidden')) {
        this.closeConversation();
      }
    });

    // Reintento en caso de error
    if (elements.messagesContainer) {
      elements.messagesContainer.addEventListener('click', (event) => {
        if (event.target && event.target.id === 'conversationRetryBtn') {
          if (this.activeTarget) {
            this.openConversation(this.activeTarget);
          }
        }
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
        console.error('[History] Error en la sincronizacion de medianoche:', error);
      } finally {
        this.scheduleDailyStatusRefresh();
      }
    }, delay);
  }

  /**
   * Comprueba el estado de envío de hoy para un destino específico.
   * @param {string} destinationId
   * @param {string} [mode='contacts']
   * @returns {{ sentToday: boolean, lastSentAt: string|null }}
   */
  getDestinationStatus(destinationId, mode = 'contacts') {
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
   * Obtiene la cantidad de destinatarios seleccionados que ya recibieron mensaje hoy.
   * @param {string} [mode='contacts']
   * @returns {number}
   */
  getAlreadySentSelectedTargetsCount(mode = 'contacts') {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    let targets = [];
    if (safeMode === 'groups') {
      const selectedGroupIds = (this.stateRef && this.stateRef.ui && typeof this.stateRef.ui.getSelectedGroupIds === 'function')
        ? this.stateRef.ui.getSelectedGroupIds()
        : [];
      targets = selectedGroupIds.map((id) => ({ id }));
    } else {
      targets = (this.stateRef && this.stateRef.selectedContacts) || [];
    }

    return countAlreadySentTargets(targets, {
      sentTodaySet: this.sentTodayByMode[safeMode] || new Set(),
      lastSentMap: this.lastSentAtByMode[safeMode] || {},
      mode: safeMode
    });
  }

  /**
   * Sincroniza desde el backend los estados de envío de hoy para la lista activa de contactos o grupos.
   * @param {string} mode - 'contacts' | 'groups'
   * @param {Object} [options]
   * @param {boolean} [options.repaint=false]
   * @returns {Promise<boolean>}
   */
  async refreshDestinationStatuses(mode = 'contacts', { repaint = false } = {}) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const destinationIds = extractDestinationIds(safeMode, {
      contacts: (this.stateRef && this.stateRef.contacts) || [],
      groups: (this.stateRef && this.stateRef.groups) || [],
      selectedContacts: (this.stateRef && this.stateRef.selectedContacts) || []
    });

    if (!Array.isArray(destinationIds) || !destinationIds.length) {
      return false;
    }

    try {
      const response = await this.gateway.getDestinationStatuses({
        destinationType: safeMode,
        destinationIds
      });

      if (!response || !response.success || !response.result || !response.result.byId) {
        return false;
      }

      const { sentTodaySet, lastSentMap } = normalizeDestinationStatuses(response.result.byId);
      this.sentTodayByMode[safeMode] = sentTodaySet;
      this.lastSentAtByMode[safeMode] = lastSentMap;

      if (this.stateRef) {
        if (!this.stateRef.sentTodayByMode) this.stateRef.sentTodayByMode = {};
        if (!this.stateRef.lastSentAtByMode) this.stateRef.lastSentAtByMode = {};
        this.stateRef.sentTodayByMode[safeMode] = sentTodaySet;
        this.stateRef.lastSentAtByMode[safeMode] = lastSentMap;
      }

      if (repaint) {
        if (safeMode === 'contacts' && this.stateRef && typeof this.stateRef.applyContactFilter === 'function') {
          this.stateRef.applyContactFilter();
        } else if (safeMode === 'groups' && this.stateRef && typeof this.stateRef.applyGroupFilter === 'function') {
          this.stateRef.applyGroupFilter();
        }
      }

      return true;
    } catch (error) {
      console.error(`[History] Error sincronizando estados de destinatarios (${safeMode}):`, error);
      return false;
    }
  }
}

module.exports = {
  HistoryController
};
