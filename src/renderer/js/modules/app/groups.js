/**
 * WhatsApp Sender Electron - Groups Module
 * Backwards-compatibility adapter delegating to Groups Vertical Slice (v3.5.5)
 */

const {
  GroupsController
} = require('../../../../features/groups/presentation/groups-controller');

function getOrCreateGroupsController(controller) {
  if (!controller.groupsController) {
    controller.groupsController = new GroupsController({
      stateRef: controller,
      ui: controller.ui,
      ipcClient: controller.ipcClient
    });
  }
  return controller.groupsController;
}

function applyGroupFilter(controller) {
  return getOrCreateGroupsController(controller).applyGroupFilter();
}

function syncExportSelectionWithGroup(controller, togglePayload) {
  return getOrCreateGroupsController(controller).syncExportSelection(togglePayload);
}

function loadGroups(controller) {
  return getOrCreateGroupsController(controller).loadGroups();
}

function exportGroupMembers(controller, groupId, format) {
  return getOrCreateGroupsController(controller).exportGroupMembers(groupId, format);
}

module.exports = {
  applyGroupFilter,
  syncExportSelectionWithGroup,
  loadGroups,
  exportGroupMembers
};
