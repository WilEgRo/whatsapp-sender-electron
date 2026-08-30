/**
 * WhatsApp Sender Electron - Analytics Feature
 * Presentation: Analytics Controller
 * 
 * Coordinador de presentación para métricas y estadísticas.
 * Conecta los eventos de UI con los casos de uso de Analytics, la pasarela IPC y las vistas.
 */

const {
  normalizeStatsFilter
} = require('../domain/analytics-rules');

const {
  AnalyticsIpcGateway
} = require('../infrastructure/analytics-ipc-gateway');

class AnalyticsController {
  /**
   * @param {Object} options
   * @param {Object} [options.ipcClient]
   * @param {Object} [options.ui]
   * @param {Object} [options.stateRef] - Referencia a AppController para sincronización retrocompatible
   */
  constructor(options = {}) {
    this.gateway = new AnalyticsIpcGateway(options.ipcClient);
    this.ui = options.ui || null;
    this.stateRef = options.stateRef || null;

    this._statsFilter = {
      preset: 'last-30',
      customFrom: '',
      customTo: ''
    };
    this.statsRefreshTimer = null;
    this.latestStats = null;
  }

  get filter() {
    if (this.stateRef && this.stateRef.statsFilter) {
      return this.stateRef.statsFilter;
    }
    return this._statsFilter;
  }

  set filter(val) {
    const clean = normalizeStatsFilter(val);
    this._statsFilter = clean;
    if (this.stateRef) {
      this.stateRef.statsFilter = clean;
    }
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
   * Asocia las acciones de usuario sobre controles de estadísticas.
   */
  bindEvents() {
    const ui = this._getUi();
    if (!ui || typeof ui.bindStatsActions !== 'function') return;

    ui.bindStatsActions(
      () => this.refreshMessageStats({ silent: false }),
      () => this.exportMessageStatsExcel(),
      (rangePreset) => {
        this.filter.preset = String(rangePreset || 'last-30');
        if (ui && typeof ui.setHistoryCustomRangeVisible === 'function') {
          ui.setHistoryCustomRangeVisible(this.filter.preset === 'custom');
        }
        if (this.stateRef && typeof this.stateRef.saveFormData === 'function') {
          this.stateRef.saveFormData();
        }
        if (this.filter.preset !== 'custom') {
          this.refreshMessageStats({ silent: false });
        }
      },
      ({ customFrom, customTo }) => {
        this.filter.customFrom = String(customFrom || '');
        this.filter.customTo = String(customTo || '');
        if (this.stateRef && typeof this.stateRef.saveFormData === 'function') {
          this.stateRef.saveFormData();
        }
        this.refreshMessageStats({ silent: false });
      }
    );
  }

  /**
   * Inicia el refresco periódico en segundo plano de las estadísticas.
   * @param {number} [intervalMs=30000]
   */
  startStatsAutoRefresh(intervalMs = 30000) {
    if (this.statsRefreshTimer) {
      clearInterval(this.statsRefreshTimer);
      this.statsRefreshTimer = null;
    }

    this.statsRefreshTimer = setInterval(() => {
      this.refreshMessageStats({ silent: true });
    }, intervalMs);
  }

  /**
   * Detiene el refresco periódico en segundo plano.
   */
  stopStatsAutoRefresh() {
    if (this.statsRefreshTimer) {
      clearInterval(this.statsRefreshTimer);
      this.statsRefreshTimer = null;
    }
  }

  /**
   * Solicita el consolidado de estadísticas y actualiza los paneles visuales.
   * @param {Object} [options]
   * @param {boolean} [options.silent=true]
   */
  async refreshMessageStats({ silent = true } = {}) {
    const ui = this._getUi();
    if (ui && typeof ui.setStatsLoading === 'function') {
      ui.setStatsLoading(true);
    }

    try {
      const response = await this.gateway.getMessageStats({
        filter: this.filter
      });

      if (!response || !response.success || !response.stats) {
        if (!silent && ui && typeof ui.showToast === 'function') {
          ui.showToast('No se pudieron cargar las estadisticas', 'warning');
        }
        return;
      }

      this.latestStats = response.stats;
      if (this.stateRef) {
        this.stateRef.latestStats = response.stats;
      }

      if (ui) {
        if (typeof ui.renderMessageStats === 'function') {
          ui.renderMessageStats(response.stats);
        }
        if (typeof ui.renderMessageStatsHistory === 'function') {
          ui.renderMessageStatsHistory(response.stats);
        }
        if (typeof ui.renderHistoryCharts === 'function') {
          ui.renderHistoryCharts(response.stats);
        }
      }
    } catch (error) {
      console.error('Error cargando estadisticas:', error);
      if (!silent && ui && typeof ui.showToast === 'function') {
        ui.showToast('Error cargando estadisticas', 'error');
      }
    } finally {
      if (ui && typeof ui.setStatsLoading === 'function') {
        ui.setStatsLoading(false);
      }
    }
  }

  /**
   * Solicita la exportación del consolidado de estadísticas a un archivo Excel.
   */
  async exportMessageStatsExcel() {
    const ui = this._getUi();

    if (this.stateRef && typeof this.stateRef.hasFeature === 'function' && !this.stateRef.hasFeature('advanced_exports')) {
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('La exportacion avanzada requiere plan Pro o superior.', 'warning');
      }
      return;
    }

    if (ui && typeof ui.setStatsLoading === 'function') {
      ui.setStatsLoading(true);
    }

    try {
      const response = await this.gateway.exportMessageStats({
        filter: this.filter
      });

      if (!response || !response.success) {
        const errorMsg = (response && response.error) || 'error desconocido';
        if (ui && typeof ui.showToast === 'function') {
          ui.showToast(`No se pudo exportar reporte: ${errorMsg}`, 'error');
        }
        return;
      }

      if (response.canceled) {
        if (ui && typeof ui.showToast === 'function') {
          ui.showToast('Exportacion cancelada', 'warning');
        }
        return;
      }

      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('Reporte de estadisticas exportado en Excel', 'success');
      }
    } catch (error) {
      console.error('Error exportando estadisticas:', error);
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('Error inesperado al exportar estadisticas', 'error');
      }
    } finally {
      if (ui && typeof ui.setStatsLoading === 'function') {
        ui.setStatsLoading(false);
      }
    }
  }
}

module.exports = {
  AnalyticsController
};
