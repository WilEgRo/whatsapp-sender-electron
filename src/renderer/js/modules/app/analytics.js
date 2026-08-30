/**
 * WhatsApp Sender Electron - Analytics Module
 * Backwards-compatibility adapter delegating to Analytics Vertical Slice (v3.5.7)
 */

const {
  AnalyticsController
} = require('../../../../features/analytics/presentation/analytics-controller');

function getOrCreateAnalyticsController(controller) {
  if (!controller.analyticsController) {
    controller.analyticsController = new AnalyticsController({
      stateRef: controller,
      ui: controller.ui,
      ipcClient: controller.ipcClient
    });
  }
  return controller.analyticsController;
}

function bindStatsEvents(controller) {
  return getOrCreateAnalyticsController(controller).bindEvents();
}

function startStatsAutoRefresh(controller, intervalMs) {
  return getOrCreateAnalyticsController(controller).startStatsAutoRefresh(intervalMs);
}

function stopStatsAutoRefresh(controller) {
  return getOrCreateAnalyticsController(controller).stopStatsAutoRefresh();
}

function refreshMessageStats(controller, options) {
  return getOrCreateAnalyticsController(controller).refreshMessageStats(options);
}

function exportMessageStatsExcel(controller) {
  return getOrCreateAnalyticsController(controller).exportMessageStatsExcel();
}

module.exports = {
  bindStatsEvents,
  startStatsAutoRefresh,
  stopStatsAutoRefresh,
  refreshMessageStats,
  exportMessageStatsExcel,
  getOrCreateAnalyticsController
};
