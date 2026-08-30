/**
 * WhatsApp Sender Electron - History Module
 * Backwards-compatibility adapter delegating to History Vertical Slice (v3.5.8)
 */

const {
  HistoryController
} = require('../../../../features/history/presentation/history-controller');

function getOrCreateHistoryController(controller) {
  if (!controller.historyController) {
    controller.historyController = new HistoryController({
      stateRef: controller,
      ui: controller.ui,
      ipcClient: controller.ipcClient
    });
  }
  return controller.historyController;
}

function bindChatHistoryEvents(controller) {
  return getOrCreateHistoryController(controller).bindEvents();
}

function refreshChatHistoryTargetOptions(controller) {
  return getOrCreateHistoryController(controller).refreshChatHistoryTargetOptions();
}

function loadChatHistoryPreview(controller) {
  return getOrCreateHistoryController(controller).loadChatHistoryPreview();
}

function scheduleDailyStatusRefresh(controller) {
  return getOrCreateHistoryController(controller).scheduleDailyStatusRefresh();
}

function getDestinationStatus(controller, mode, id) {
  return getOrCreateHistoryController(controller).getDestinationStatus(mode, id);
}

function getAlreadySentSelectedTargetsCount(controller, mode) {
  return getOrCreateHistoryController(controller).getAlreadySentSelectedTargetsCount(mode);
}

function refreshDestinationStatuses(controller, mode, options) {
  return getOrCreateHistoryController(controller).refreshDestinationStatuses(mode, options);
}

function openConversation(controller, target) {
  return getOrCreateHistoryController(controller).openConversation(target);
}

function exportConversation(controller, format) {
  return getOrCreateHistoryController(controller).exportConversation(format);
}

module.exports = {
  bindChatHistoryEvents,
  refreshChatHistoryTargetOptions,
  loadChatHistoryPreview,
  scheduleDailyStatusRefresh,
  getDestinationStatus,
  getAlreadySentSelectedTargetsCount,
  refreshDestinationStatuses,
  openConversation,
  exportConversation,
  getOrCreateHistoryController
};
