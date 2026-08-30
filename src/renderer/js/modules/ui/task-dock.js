/**
 * WhatsApp Sender Pro — Task Dock Module
 * Backwards-compatibility adapter delegating to TaskDock Vertical Slice (v3.5.8)
 */

const {
  TaskDock
} = require('../../../../features/taskdock/presentation/taskdock-controller');

const {
  TASK_DOCK_STATES
} = require('../../../../features/taskdock/domain/taskdock-rules');

module.exports = {
  TaskDock,
  TASK_DOCK_STATES
};
