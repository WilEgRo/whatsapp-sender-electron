const bindings = require('./ui/bindings');
const renderers = require('./ui/renderers');
const feedback = require('./ui/feedback');
const { TaskDock, TASK_DOCK_STATES } = require('./ui/task-dock');

class UiManager {
  constructor() {
    this.taskDock = new TaskDock(document.getElementById('taskDock'));
    this.TASK_DOCK_STATES = TASK_DOCK_STATES;
    this.statusText = document.getElementById('statusText');
    this.statusDot = document.getElementById('statusDot');
    this.toastContainer = document.getElementById('toastContainer');
    this.progressModal = document.getElementById('progressModal');
    this.progressText = document.getElementById('progressText');
    this.progressDelay = document.getElementById('progressDelay');
    this.progressSecurity = document.getElementById('progressSecurity');
    this.qrModal = document.getElementById('qrModal');
    this.qrContainer = document.getElementById('qrContainer');
    this.qrContentArea = document.getElementById('qrContentArea');
    this.sessionLoadingArea = document.getElementById('sessionLoadingArea');
    this.sessionLoadingStatusText = document.getElementById('sessionLoadingStatusText');
    this.sessionSyncCounter = document.getElementById('sessionSyncCounter');
    this.sessionProgressFill = document.getElementById('sessionProgressFill');
    this.sessionLoadingPercentText = document.getElementById('sessionLoadingPercentText');
    this.sessionLoadingTitle = document.getElementById('sessionLoadingTitle');
    this.sessionLoadingSubtitle = document.getElementById('sessionLoadingSubtitle');
    this.totalGroupsElement = document.getElementById('totalGroups');
    this.totalContactsElement = document.getElementById('totalContacts');
    this.groupFilterInfo = document.getElementById('groupFilterInfo');
    this.groupSearchInput = document.getElementById('groupSearchInput');
    this.groupsChecklist = document.getElementById('gruposChecklist');
    this.groupExportSelect = document.getElementById('groupExportSelect');
    this.groupMembersInfo = document.getElementById('groupMembersInfo');
    this.contactSearchInput = document.getElementById('contactSearchInput');
    this.contactFilterInfo = document.getElementById('contactFilterInfo');
    this.contactResultsCount = document.getElementById('contactResultsCount');
    this.contactResultsList = document.getElementById('contactResultsList');
    this.selectedContactsCount = document.getElementById('selectedContactsCount');
    this.selectedContactsChips = document.getElementById('selectedContactsChips');
    this.numbersField = document.getElementById('numeros');
    this.progressFill = document.getElementById('progressFill');
    this.progressPercent = document.getElementById('progressPercent');
    this.progressCounts = document.getElementById('progressCounts');
    this.progressCurrent = document.getElementById('progressCurrent');
    this.progressTimerBox = document.getElementById('progressTimerBox');
    this.progressTimerText = document.getElementById('progressTimerText');
    this.progressSummary = document.getElementById('progressSummary');
    this.cancelSendBtn = document.getElementById('cancelSendBtn');
    this.countdownInterval = null;
    this.historyCustomRange = document.getElementById('historyCustomRange');
    this.historyStartDate = document.getElementById('historyStartDate');
    this.historyEndDate = document.getElementById('historyEndDate');
    this.historyTrendChartEl = document.getElementById('historyTrendChart');
    this.historyWeeklyChartEl = document.getElementById('historyWeeklyChart');
    this.historyTrendChart = null;
    this.historyWeeklyChart = null;
    this.importedContactsTotal = 0;
    this.scheduleTargetType = document.getElementById('scheduleTargetType');
    this.scheduleTargetId = document.getElementById('scheduleTargetId');
    this.scheduleMessageText = document.getElementById('scheduleMessageText');
    this.scheduleDatetime = document.getElementById('scheduleDatetime');
    this.scheduleDelayMin = document.getElementById('scheduleDelayMin');
    this.scheduleDelayMax = document.getElementById('scheduleDelayMax');
    this.scheduledMessagesList = document.getElementById('scheduledMessagesList');
    this.scheduledCountHint = document.getElementById('scheduledCountHint');
    this.adminTab = document.getElementById('adminTab');
    this.adminContent = document.getElementById('adminContent');
    this.adminRefreshButton = document.getElementById('adminRefreshButton');
    this.selectedGroupIds = new Set();
    this.visibleFilteredGroups = [];
    this.selectedContactIds = new Set();
  }

  bindTabs(onTabChange) {
    return bindings.bindTabs.call(this, onTabChange);
  }

  bindFileRemovals(onRemove) {
    return bindings.bindFileRemovals.call(this, onRemove);
  }

  bindFileReorder(onMove) {
    return bindings.bindFileReorder.call(this, onMove);
  }

  bindGroupSearch(onSearch) {
    return bindings.bindGroupSearch.call(this, onSearch);
  }

  bindGroupExport(onExport) {
    return bindings.bindGroupExport.call(this, onExport);
  }

  bindContactSearch(onSearch) {
    return bindings.bindContactSearch.call(this, onSearch);
  }

  bindContactResults(onSelectContact) {
    return bindings.bindContactResults.call(this, onSelectContact);
  }

  bindSelectedContactRemoval(onRemoveContact) {
    return bindings.bindSelectedContactRemoval.call(this, onRemoveContact);
  }

  bindGroupChecklist(onToggleGroup) {
    return bindings.bindGroupChecklist.call(this, onToggleGroup);
  }

  bindStatsActions(onRefresh, onExport, onRangeChange, onCustomRangeApply) {
    return bindings.bindStatsActions.call(this, onRefresh, onExport, onRangeChange, onCustomRangeApply);
  }

  renderFiles(mode, files) {
    return renderers.renderFiles.call(this, mode, files);
  }

  renderGroups(groups, searchTerm = '') {
    return renderers.renderGroups.call(this, groups, searchTerm);
  }

  paintGroupSelection() {
    return renderers.paintGroupSelection.call(this);
  }

  renderGroupExportOptions(groups, selectedGroupId = '') {
    return renderers.renderGroupExportOptions.call(this, groups, selectedGroupId);
  }

  updateGroupMembersInfo(message, tone = '') {
    return renderers.updateGroupMembersInfo.call(this, message, tone);
  }

  renderContactResults(contacts, searchTerm = '', totalCount = null) {
    return renderers.renderContactResults.call(this, contacts, searchTerm, totalCount);
  }

  renderSelectedContacts(contacts, updateNumbersField = true) {
    return renderers.renderSelectedContacts.call(this, contacts, updateNumbersField);
  }

  renderScheduleTargetOptions(mode, contacts, groups, selectedTargetId = '') {
    return renderers.renderScheduleTargetOptions.call(this, mode, contacts, groups, selectedTargetId);
  }

  renderScheduledMessages(items) {
    return renderers.renderScheduledMessages.call(this, items);
  }

  setAdminVisible(isVisible) {
    return renderers.setAdminVisible.call(this, isVisible);
  }

  setAdminLoading(isLoading) {
    return renderers.setAdminLoading.call(this, isLoading);
  }

  renderAdminOverview(counters) {
    return renderers.renderAdminOverview.call(this, counters);
  }

  renderAdminLicenses(items) {
    return renderers.renderAdminLicenses.call(this, items);
  }

  renderAdminDevices(items) {
    return renderers.renderAdminDevices.call(this, items);
  }

  renderAdminEvents(items) {
    return renderers.renderAdminEvents.call(this, items);
  }

  renderAdminBackups(items) {
    return renderers.renderAdminBackups.call(this, items);
  }

  updateContactFilterInfo(filteredCount, totalCount, term) {
    return renderers.updateContactFilterInfo.call(this, filteredCount, totalCount, term);
  }

  updateFilterInfo(filteredCount, totalCount, term) {
    return renderers.updateFilterInfo.call(this, filteredCount, totalCount, term);
  }

  updateContactCounter(numbersRaw) {
    return renderers.updateContactCounter.call(this, numbersRaw);
  }

  updateGroupCounter(count) {
    return renderers.updateGroupCounter.call(this, count);
  }

  getSelectedGroupIds() {
    return renderers.getSelectedGroupIds.call(this);
  }

  getFileIcon(extension) {
    return renderers.getFileIcon.call(this, extension);
  }

  getExtension(fileName) {
    return renderers.getExtension.call(this, fileName);
  }

  setStatsLoading(isLoading) {
    return renderers.setStatsLoading.call(this, isLoading);
  }

  renderMessageStats(stats) {
    return renderers.renderMessageStats.call(this, stats);
  }

  renderMessageStatsHistory(stats, rangeDays) {
    return renderers.renderMessageStatsHistory.call(this, stats, rangeDays);
  }

  renderHistoryCharts(stats) {
    return renderers.renderHistoryCharts.call(this, stats);
  }

  setHistoryCustomRangeVisible(visible) {
    return renderers.setHistoryCustomRangeVisible.call(this, visible);
  }

  updateStatus(message, tone) {
    return feedback.updateStatus.call(this, message, tone);
  }

  showProgress(message) {
    return feedback.showProgress.call(this, message);
  }

  hideProgress() {
    return feedback.hideProgress.call(this);
  }

  updateSendProgress(progress) {
    return feedback.updateSendProgress.call(this, progress);
  }

  showToast(message, tone = 'success') {
    return feedback.showToast.call(this, message, tone);
  }

  showQrCanvas(canvas) {
    return feedback.showQrCanvas.call(this, canvas);
  }

  showSessionLoading(statusText, detailsText, percent, options) {
    return feedback.showSessionLoading.call(this, statusText, detailsText, percent, options);
  }

  updateSessionLoadingStatus(statusText, detailsText, percent, options) {
    return feedback.updateSessionLoadingStatus.call(this, statusText, detailsText, percent, options);
  }

  hideQr() {
    return feedback.hideQr.call(this);
  }

  showCustomConfirmModal(options) {
    return feedback.showCustomConfirmModal.call(this, options);
  }
}

module.exports = UiManager;