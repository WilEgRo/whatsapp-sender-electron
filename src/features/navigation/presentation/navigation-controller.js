/**
 * WhatsApp Sender Electron - Navigation Feature
 * Presentation: Navigation Controller
 * 
 * Gestiona la navegación de la interfaz de usuario, activación de pestañas
 * y aplicación de permisos de interfaz para modo Standalone.
 */

class NavigationController {
  /**
   * @param {Object} options
   * @param {Object} [options.ui]
   * @param {Object} [options.stateRef]
   */
  constructor(options = {}) {
    this.ui = options.ui || null;
    this.stateRef = options.stateRef || null;
    this.activeTab = 'contacts';
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
   * Activa visualmente la pestaña y el panel de contenido indicado.
   * @param {string} tab
   */
  activateTab(tab) {
    const target = String(tab || '').trim();
    if (!target) return;

    this.activeTab = target;

    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === target);
    });

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === target);
    });
  }

  /**
   * Habilita los componentes visuales disponibles en la aplicación de escritorio.
   */
  applyEntitlementsToUi() {
    const historyTab = document.getElementById('estadisticasTab');
    const historyPanel = document.getElementById('estadisticasContent');
    if (historyTab) historyTab.classList.remove('hidden');
    if (historyPanel) historyPanel.classList.remove('hidden');

    const statsExportButton = document.getElementById('exportStatsExcelButton');
    if (statsExportButton) {
      statsExportButton.disabled = false;
      statsExportButton.title = '';
    }

    const sendGroupsButton = document.getElementById('enviarGrupos');
    const createScheduleButton = document.getElementById('createScheduleButton');

    [sendGroupsButton, createScheduleButton].forEach((button) => {
      if (button) {
        button.disabled = false;
        button.title = '';
      }
    });
  }

  /**
   * Enlaza los eventos de cambio de pestaña con las acciones del controlador principal.
   * @param {Function} [onTabChange]
   */
  bindTabs(onTabChange) {
    const ui = this._getUi();
    if (!ui || typeof ui.bindTabs !== 'function') return;

    ui.bindTabs((tab) => {
      if (typeof onTabChange === 'function') {
        onTabChange(tab);
      }
    });
  }
}

module.exports = {
  NavigationController
};
