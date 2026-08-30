/**
 * WhatsApp Sender Electron - Scheduling Module
 * Backwards-compatibility adapter delegating to Scheduling Vertical Slice (v3.5.6)
 */

const {
  SchedulingController
} = require('../../../../features/scheduling/presentation/scheduling-controller');

function getOrCreateSchedulingController(controller) {
  if (!controller.schedulingController) {
    controller.schedulingController = new SchedulingController({
      stateRef: controller,
      ui: controller.ui,
      ipcClient: controller.ipcClient
    });
  }
  return controller.schedulingController;
}

function bindSchedulingUiEvents(controller) {
  return getOrCreateSchedulingController(controller).bindEvents();
}

function createScheduledMessage(controller) {
  return getOrCreateSchedulingController(controller).createScheduledMessage();
}

function refreshScheduledMessages(controller, options) {
  return getOrCreateSchedulingController(controller).refreshScheduledMessages(options);
}

function cancelScheduledMessage(controller, id) {
  return getOrCreateSchedulingController(controller).cancelScheduledMessage(id);
}

function renderScheduleTargetOptions(controller, mode, contacts, groups, selectedTargetId) {
  return getOrCreateSchedulingController(controller).updateTargetOptions(mode, contacts, groups, selectedTargetId);
}

module.exports = {
  bindSchedulingUiEvents,
  createScheduledMessage,
  refreshScheduledMessages,
  cancelScheduledMessage,
  renderScheduleTargetOptions
};
