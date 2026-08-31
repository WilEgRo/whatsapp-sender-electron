/**
 * WhatsApp Sender Electron - Chat Export Feature
 * Presentation: Chat Export Controller
 * 
 * Controlador de la pestaña Exportar Chat.
 * Coordina la selección de contactos/grupos, el filtrado local y la exportación
 * bajo demanda en formatos TXT, HTML, PDF y JSON.
 * 
 * REGLA DE MEMORIA: NUNCA carga historiales al abrir la pestaña, ni al buscar,
 * ni al cambiar entre Contactos/Grupos, ni al seleccionar. La consulta al historial
 * solo ocurre al pulsar uno de los botones de exportación y la referencia se libera de inmediato.
 */

const {
  resolveExportTargets,
  selectExportTarget
} = require('../application/manage-export-targets');

const {
  executeChatExport
} = require('../application/prepare-chat-export');

const {
  ChatExportGateway
} = require('../infrastructure/chat-export-gateway');

const {
  MediaIpcGateway
} = require('../../history/infrastructure/media-ipc-gateway');

const {
  getChatExportElements,
  renderTargetTabs,
  renderTargetsList,
  renderSelectedTarget,
  setExportButtonsDisabled,
  renderExportStatus
} = require('./chat-export-view');

class ChatExportController {
  /**
   * @param {Object} [options]
   * @param {Object} [options.stateRef] - Referencia a AppController
   * @param {Object} [options.ui] - UiManager
   * @param {Object} [options.ipcClient] - Cliente IPC
   * @param {ChatExportGateway} [options.gateway] - Gateway inyectable
   * @param {MediaIpcGateway} [options.mediaGateway] - Gateway de multimedia inyectable
   */
  constructor(options = {}) {
    this.stateRef = options.stateRef || null;
    this.ui = options.ui || null;
    this.ipcClient = options.ipcClient || (this.stateRef && this.stateRef.ipcClient) || null;
    this.gateway = options.gateway || new ChatExportGateway(this.ipcClient);
    this.mediaGateway = options.mediaGateway || new MediaIpcGateway(this.ipcClient);

    this.activeType = 'contacts';
    this.searchTerm = '';
    this.selectedTarget = null;
    this.isExporting = false;
    this._activeConversation = null;
    this._elements = null;
    this._cachedTargets = [];
  }

  _getUi() {
    if (this.ui) return this.ui;
    if (this.stateRef && this.stateRef.ui) {
      this.ui = this.stateRef.ui;
      return this.ui;
    }
    return null;
  }

  _getElements() {
    if (!this._elements || !this._elements.panel) {
      if (typeof document !== 'undefined') {
        this._elements = getChatExportElements(document);
      } else {
        this._elements = {};
      }
    }
    return this._elements;
  }

  /**
   * Enlaza los eventos de usuario para la pestaña Exportar Chat.
   */
  bindEvents() {
    const elements = this._getElements();
    if (!elements.panel) return;

    // 1. Selector de tipo: Contactos
    if (elements.btnContacts) {
      elements.btnContacts.addEventListener('click', () => {
        this.switchTargetType('contacts');
      });
    }

    // 2. Selector de tipo: Grupos
    if (elements.btnGroups) {
      elements.btnGroups.addEventListener('click', () => {
        this.switchTargetType('groups');
      });
    }

    // 3. Buscador en tiempo real (solo filtra en memoria local)
    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (event) => {
        const value = event.target ? event.target.value : '';
        this.handleSearch(value);
      });
    }

    // 4. Botón limpiar búsqueda
    if (elements.searchClearBtn) {
      elements.searchClearBtn.addEventListener('click', () => {
        if (elements.searchInput) {
          elements.searchInput.value = '';
        }
        this.handleSearch('');
      });
    }

    // 5. Clic en la lista de resultados para seleccionar un target
    if (elements.targetsList) {
      elements.targetsList.addEventListener('click', (event) => {
        const itemEl = event.target.closest('[data-target-id]');
        if (!itemEl) return;

        const targetId = itemEl.dataset.targetId;
        const target = this._cachedTargets.find((t) => t && (t.id === targetId || t.identifier === targetId));
        if (target) {
          this.selectTarget(target);
        }
      });
    }

    // 6. Botones de exportación (disparan la carga bajo demanda)
    if (elements.exportTxtBtn) {
      elements.exportTxtBtn.addEventListener('click', () => this.exportChat('txt'));
    }
    if (elements.exportHtmlBtn) {
      elements.exportHtmlBtn.addEventListener('click', () => this.exportChat('html'));
    }
    if (elements.exportPdfBtn) {
      elements.exportPdfBtn.addEventListener('click', () => this.exportChat('pdf'));
    }
    if (elements.exportJsonBtn) {
      elements.exportJsonBtn.addEventListener('click', () => this.exportChat('json'));
    }

    // Render inicial
    this.refreshAvailableTargets();
  }

  /**
   * Cambia el modo entre Contactos y Grupos.
   * MEMORIA: NO consulta historial.
   * @param {'contacts'|'groups'} type
   */
  switchTargetType(type) {
    if (this.activeType === type) return;
    this.activeType = type;
    this.selectedTarget = null; // Reiniciar selección al cambiar de origen
    this.searchTerm = '';

    const elements = this._getElements();
    if (elements.searchInput) {
      elements.searchInput.value = '';
    }

    this.refreshAvailableTargets();
  }

  /**
   * Maneja el término de búsqueda para filtrar la lista visible.
   * MEMORIA: NO consulta historial.
   * @param {string} term
   */
  handleSearch(term = '') {
    this.searchTerm = String(term || '');
    this.refreshAvailableTargets();
  }

  /**
   * Selecciona un contacto o grupo para preparar su exportación.
   * MEMORIA: NO consulta historial.
   * @param {Object} target
   */
  selectTarget(target) {
    const { selectedTarget } = selectExportTarget({
      currentSelection: this.selectedTarget,
      target,
      availableTargets: this._cachedTargets
    });

    this.selectedTarget = selectedTarget;

    const elements = this._getElements();
    renderSelectedTarget(elements, this.selectedTarget);
    renderTargetsList(
      elements,
      this._cachedTargets,
      this.selectedTarget ? this.selectedTarget.id : null,
      this.activeType
    );
    renderExportStatus(elements, { state: 'idle', message: '' });
  }

  /**
   * Actualiza la lista de destinos disponibles en base a los datos existentes en memoria.
   * MEMORIA: NO consulta historial.
   */
  refreshAvailableTargets() {
    const elements = this._getElements();
    if (!elements.panel) return;

    const contacts = (this.stateRef && Array.isArray(this.stateRef.contacts)) ? this.stateRef.contacts : [];
    const groups = (this.stateRef && Array.isArray(this.stateRef.groups)) ? this.stateRef.groups : [];

    const resolved = resolveExportTargets({
      contacts,
      groups,
      targetType: this.activeType,
      query: this.searchTerm
    });

    this._cachedTargets = resolved.targets;

    renderTargetTabs(elements, this.activeType);
    renderTargetsList(
      elements,
      this._cachedTargets,
      this.selectedTarget ? this.selectedTarget.id : null,
      this.activeType
    );
    renderSelectedTarget(elements, this.selectedTarget);
  }

  /**
   * Ejecuta la exportación bajo demanda del chat seleccionado en el formato indicado.
   * CARGA BAJO DEMANDA Y LIBERACIÓN INMEDIATA DE MEMORIA.
   * @param {'txt'|'html'|'pdf'|'json'} format
   */
  async exportChat(format = 'txt') {
    const ui = this._getUi();
    const elements = this._getElements();

    if (!this.selectedTarget || !this.selectedTarget.id) {
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('Por favor selecciona una conversación antes de exportar.', 'warning');
      }
      return;
    }

    if (this.isExporting) {
      return; // Prevenir múltiples llamadas simultáneas
    }

    this.isExporting = true;
    setExportButtonsDisabled(elements, true);

    // Snapshot aislado del destinatario seleccionado (evita que un cambio de selección contamine la exportación)
    const targetSnapshot = { ...this.selectedTarget };
    const includeMedia = Boolean(elements.includeMediaCheck && elements.includeMediaCheck.checked);

    renderExportStatus(elements, {
      loading: true,
      state: 'loading',
      message: `Recuperando historial para ${targetSnapshot.name}...`
    });

    const onProgress = (prog) => {
      renderExportStatus(elements, {
        loading: true,
        state: 'loading',
        message: prog && prog.message ? prog.message : 'Procesando exportación...'
      });
    };

    try {
      // 1. Ejecutar exportación bajo demanda
      const result = await executeChatExport({
        gateway: this.gateway,
        mediaGateway: this.mediaGateway,
        target: targetSnapshot,
        format,
        limit: 1000,
        includeMedia,
        onProgress
      });

      const { exported, messageCount } = result;

      // 2. Despachar descarga en el Renderer
      if (format === 'pdf' && typeof window !== 'undefined' && typeof window.open === 'function') {
        const printWin = window.open('', '_blank');
        if (printWin) {
          printWin.document.write(exported.content);
          printWin.document.close();
          printWin.focus();
          setTimeout(() => {
            printWin.print();
          }, 300);
          if (ui && typeof ui.showToast === 'function') {
            ui.showToast('Ventana de impresión lista para guardar como PDF.', 'success');
          }
        }
      } else if (typeof document !== 'undefined' && typeof Blob !== 'undefined') {
        const blob = new Blob([exported.content], { type: exported.mimeType });
        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = exported.filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);

        if (ui && typeof ui.showToast === 'function') {
          ui.showToast(`Conversación exportada exitosamente como ${format.toUpperCase()} (${messageCount} mensajes).`, 'success');
        }
      }

      renderExportStatus(elements, {
        loading: false,
        state: 'success',
        message: `¡Conversación exportada en formato ${format.toUpperCase()}! (${messageCount} mensajes procesados)`
      });
    } catch (error) {
      console.error('[ChatExportController] Error en exportación:', error);
      const errorMsg = error && error.message ? error.message : 'No se pudo exportar la conversación.';
      renderExportStatus(elements, {
        loading: false,
        state: 'error',
        message: `Error al exportar: ${errorMsg}`
      });
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast(`Error al exportar: ${errorMsg}`, 'error');
      }
    } finally {
      // 3. LIBERACIÓN INMEDIATA DE REFERENCIAS (Regla de Memoria)
      this._activeConversation = null;
      this.isExporting = false;
      setExportButtonsDisabled(elements, !this.selectedTarget);
    }
  }
}

module.exports = {
  ChatExportController
};
