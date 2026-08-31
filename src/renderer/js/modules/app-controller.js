const IpcClient = require('./ipc-client');
const FormStorage = require('./form-storage');
const UiManager = require('./ui-manager');
const modeConfig = require('./app/mode-config');
const groupActions = require('./app/groups');
const sendingActions = require('./app/sending');
const groupImportActions = require('./app/group-import');
const { CampaignDispatcherController } = require('./campaign/campaign-dispatcher-controller');
const { ContactsController } = require('../../../features/contacts/presentation/contacts-controller');
const { GroupsController } = require('../../../features/groups/presentation/groups-controller');
const { SchedulingController } = require('../../../features/scheduling/presentation/scheduling-controller');
const { AnalyticsController } = require('../../../features/analytics/presentation/analytics-controller');
const { HistoryController } = require('../../../features/history/presentation/history-controller');
const { MessagingController } = require('../../../features/messaging/presentation/messaging-controller');
const { SessionController } = require('../../../features/session/presentation/session-controller');
const { NavigationController } = require('../../../features/navigation/presentation/navigation-controller');
const { ChatExportController } = require('../../../features/chat-export/presentation/chat-export-controller');
const formPersistence = require('./campaign/form-persistence');

class AppController {
  constructor() {
    this.ipcClient = new IpcClient();
    this.storage = new FormStorage();
    this.ui = new UiManager();
    this.contactsController = new ContactsController({
      stateRef: this,
      ui: this.ui,
      ipcClient: this.ipcClient
    });
    this.groupsController = new GroupsController({
      stateRef: this,
      ui: this.ui,
      ipcClient: this.ipcClient
    });
    this.schedulingController = new SchedulingController({
      stateRef: this,
      ui: this.ui,
      ipcClient: this.ipcClient
    });
    this.analyticsController = new AnalyticsController({
      stateRef: this,
      ui: this.ui,
      ipcClient: this.ipcClient
    });
    this.historyController = new HistoryController({
      stateRef: this,
      ui: this.ui,
      ipcClient: this.ipcClient
    });
    this.messagingController = new MessagingController({
      stateRef: this,
      ui: this.ui,
      ipcClient: this.ipcClient,
      modeConfig
    });
    this.sessionController = new SessionController({
      stateRef: this,
      ui: this.ui,
      ipcClient: this.ipcClient
    });
    this.navigationController = new NavigationController({
      stateRef: this,
      ui: this.ui
    });
    this.chatExportController = new ChatExportController({
      stateRef: this,
      ui: this.ui,
      ipcClient: this.ipcClient
    });

    this.modeConfig = modeConfig;
    this.isReady = false;
    this.groups = [];
    this.contacts = [];
    this.filteredContacts = [];
    this.selectedContacts = [];
    this.filesByMode = { contacts: [], groups: [] };
    this.groupSearchTerm = '';
    this.contactSearchTerm = '';
    this.exportGroupId = '';
    this.activeSendMode = null;
    this.campaignRiskByMode = {
      contacts: null,
      groups: null
    };
    this.lastInteractionById = {};
    this.lastInteractionByNumber = {};
    this.statsRefreshTimer = null;
    this.dailyStatusRefreshTimer = null;
    this.statsFilter = {
      preset: 'last-30',
      customFrom: '',
      customTo: ''
    };
    this.latestStats = null;
    this.sentTodayByMode = {
      contacts: new Set(),
      groups: new Set()
    };
    this.lastSentAtByMode = {
      contacts: Object.create(null),
      groups: Object.create(null)
    };
    this.scheduleDraft = {
      targetType: 'contacts',
      targetId: '',
      files: [],
      sendFilesFirst: true
    };
    this.messageComposer = {
      contacts: {
        activeIndex: 1,
        enabledIndices: [1],
        customVariables: [],
        randomTagsRaw: ''
      },
      groups: {
        activeIndex: 1,
        enabledIndices: [1],
        customVariables: [],
        randomTagsRaw: ''
      }
    };
    this.authState = {
      isValidated: true,
      role: 'user',
      features: {
        bulk_send: true,
        advanced_exports: true,
        extended_history: true,
        priority_support: true
      }
    };
    this.features = {
      bulk_send: true,
      advanced_exports: true,
      extended_history: true,
      priority_support: true
    };
    this.adminBackupsRaw = [];
    this.adminBackupsFilter = {
      query: '',
      status: 'all',
      from: '',
      to: ''
    };
    this.adminBackupsPaging = {
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1
    };
    this.chatHistoryState = {
      searchTerm: '',
      filteredTargets: [],
      selectedTargetId: '',
      selectedTargetType: 'contacts',
      items: []
    };
  }

  init() {
    this.sessionController.initStartupLoading();
    this.bindUiEvents();
    this.bindMessageComposerEvents();
    this.bindIpcEvents();
    this.loadSavedData();
    this.bindStatsEvents();
    this.bindAdminUiEvents();
    this.bindChatHistoryEvents();
    this.chatExportController.bindEvents();
    groupImportActions.bind(this);
    sendingActions.bindRiskControls(this, 'contacts');
    sendingActions.bindRiskControls(this, 'groups');
    this.updateDelayOptions('contacts');
    this.updateDelayOptions('groups');
    this.ui.renderFiles('contacts', []);
    this.ui.renderFiles('groups', []);
    this.ui.renderFiles('schedule', []);
    this.ui.renderContactResults([], '');
    this.ui.renderSelectedContacts([]);
    this.refreshChatHistoryTargetOptions();
    this.ui.renderScheduleTargetOptions('contacts', this.contacts, this.groups, '');
    this.bindSchedulingUiEvents();
    this.refreshMessageStats({ silent: true });
    this.refreshScheduledMessages({ silent: true });
    this.startStatsAutoRefresh();
    this.scheduleDailyStatusRefresh();
    this.ipcClient.send('renderer-ready');
    this.updateAdminVisibility();
    this.applyEntitlementsToUi();
    this.campaignDispatcher = new CampaignDispatcherController(this);
    this.campaignDispatcher.init();
  }

  hasFeature(_name) {
    return true;
  }

  activateTab(tab) {
    return this.navigationController.activateTab(tab);
  }

  applyEntitlementsToUi() {
    return this.navigationController.applyEntitlementsToUi();
  }

  bindSchedulingUiEvents() {
    return this.schedulingController.bindEvents();
  }

  async createScheduledMessage() {
    return this.schedulingController.createScheduledMessage();
  }

  async refreshScheduledMessages(options) {
    return this.schedulingController.refreshScheduledMessages(options);
  }

  async cancelScheduledMessage(id) {
    return this.schedulingController.cancelScheduledMessage(id);
  }

  bindStatsEvents() {
    return this.analyticsController.bindEvents();
  }

  startStatsAutoRefresh() {
    return this.analyticsController.startStatsAutoRefresh();
  }

  async refreshMessageStats(options) {
    return this.analyticsController.refreshMessageStats(options);
  }

  scheduleDailyStatusRefresh() {
    return this.historyController.scheduleDailyStatusRefresh();
  }

  getDestinationStatus(mode, destinationId) {
    return this.historyController.getDestinationStatus(mode, destinationId);
  }

  getAlreadySentSelectedTargetsCount(mode) {
    return this.historyController.getAlreadySentSelectedTargetsCount(mode);
  }

  async refreshDestinationStatuses(mode, options) {
    return this.historyController.refreshDestinationStatuses(mode, options);
  }

  async loadGroups() {
    this.ui.updateStatus('Cargando grupos...', 'connecting');
    return this.groupsController.loadGroups()
      .then(() => this.refreshDestinationStatuses('groups', { repaint: true }))
      .finally(() => {
        this.refreshChatHistoryTargetOptions();
        sendingActions.refreshRiskPanel(this, 'groups');
      });
  }

  async exportMessageStatsExcel() {
    return this.analyticsController.exportMessageStatsExcel();
  }

  bindUiEvents() {
    this.ui.bindTabs((tab) => {
      if (tab === 'statistics' && !this.hasFeature('extended_history')) {
        this.ui.showToast('Historial extendido disponible solo en plan Pro o superior.', 'warning');
        this.activateTab('contacts');
        return;
      }

      if (tab === 'chat-history') {
        this.refreshChatHistoryTargetOptions();
        return;
      }

      if (tab === 'chat-export') {
        if (this.chatExportController) {
          this.chatExportController.refreshAvailableTargets();
        }
        return;
      }

      if (tab === 'groups' && this.isReady) {
        this.loadGroups();
        return;
      }

      if (tab === 'admin' && this.hasAdminAccess()) {
        this.refreshAdminConsole({ silent: false });
      }
    });

    this.ui.bindFileRemovals((mode, index) => {
      if (mode === 'schedule') {
        this.scheduleDraft.files.splice(index, 1);
        this.ui.renderFiles('schedule', this.scheduleDraft.files);
        return;
      }

      this.filesByMode[mode].splice(index, 1);
      this.ui.renderFiles(mode, this.filesByMode[mode]);
      sendingActions.refreshRiskPanel(this, mode);
    });

    this.ui.bindFileReorder((mode, index, direction) => {
      const files = mode === 'schedule' ? this.scheduleDraft.files : this.filesByMode[mode];
      if (!Array.isArray(files) || files.length < 2) {
        return;
      }

      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= files.length) {
        return;
      }

      const [moved] = files.splice(index, 1);
      files.splice(nextIndex, 0, moved);
      this.ui.renderFiles(mode, files);

      if (mode !== 'schedule') {
        this.saveFormData();
      }
    });

    this.ui.bindGroupSearch((term) => {
      this.groupSearchTerm = term;
      console.log(`[Groups] Aplicando filtro: "${term || 'sin filtro'}"`);
      this.applyGroupFilter();
    });

    this.ui.bindGroupChecklist((togglePayload) => {
      console.log(`[Groups] Seleccionados: ${togglePayload.selectedIds.length}`);
      groupActions.syncExportSelectionWithGroup(this, togglePayload);
      sendingActions.refreshRiskPanel(this, 'groups');
    });

    this.ui.bindGroupExport(({ groupId, format }) => {
      this.exportGroupId = groupId;
      this.exportGroupMembers(groupId, format);
    });

    this.ui.bindContactSearch((term) => {
      this.contactSearchTerm = term;
      this.applyContactFilter();
    });

    const syncContactsBtn = document.getElementById('syncContactsButton');
    if (syncContactsBtn) {
      syncContactsBtn.addEventListener('click', () => {
        syncContactsBtn.disabled = true;
        const originalText = syncContactsBtn.textContent;
        syncContactsBtn.textContent = 'Sincronizando...';
        this.loadContacts().finally(() => {
          syncContactsBtn.disabled = false;
          syncContactsBtn.textContent = originalText;
        });
      });
    }

    const importExcelBtn = document.getElementById('importExcelContactsButton');
    if (importExcelBtn) {
      importExcelBtn.addEventListener('click', () => {
        this.importExcelContacts();
      });
    }

    const clearSelectedBtn = document.getElementById('clearSelectedContactsButton');
    if (clearSelectedBtn) {
      clearSelectedBtn.addEventListener('click', () => {
        this.clearSelectedContacts();
      });
    }

    this.ui.bindContactResults((contactId) => {
      this.selectContact(contactId);
      sendingActions.refreshRiskPanel(this, 'contacts');
    });

    this.ui.bindSelectedContactRemoval((contactId) => {
      this.removeSelectedContact(contactId);
      sendingActions.refreshRiskPanel(this, 'contacts');
    });

    const selectedContactsChips = document.getElementById('selectedContactsChips');
    if (selectedContactsChips) {
      selectedContactsChips.addEventListener('click', (event) => {
        const historyBtn = event.target.closest('[data-view-contact-history-id]');
        if (historyBtn) {
          const contactId = historyBtn.dataset.viewContactHistoryId;
          const contact = (this.contacts || []).find((c) => c.id === contactId)
            || (this.selectedContacts || []).find((c) => c.id === contactId)
            || { id: contactId, type: 'contacts' };
          this.openConversation(contact);
        }
      });
    }

    const groupsChecklist = document.getElementById('groupsChecklist');
    if (groupsChecklist) {
      groupsChecklist.addEventListener('click', (event) => {
        const historyBtn = event.target.closest('[data-view-group-history-id]');
        if (historyBtn) {
          event.stopPropagation();
          const groupId = historyBtn.dataset.viewGroupHistoryId;
          const group = (this.groups || []).find((g) => g.id === groupId)
            || { id: groupId, type: 'groups' };
          this.openConversation(group);
        }
      });
    }

    Object.entries(this.modeConfig).forEach(([mode, config]) => {
      document.getElementById(config.sendButtonId).addEventListener('click', () => this.sendBatch(mode));
      document.getElementById(config.selectFilesButtonId).addEventListener('click', () => this.selectFiles(mode));
      document.getElementById(config.delayMinId).addEventListener('change', () => {
        this.updateDelayOptions(mode);
        this.saveFormData();
      });
      document.getElementById(config.delayMaxId).addEventListener('change', () => {
        this.updateDelayOptions(mode);
        this.saveFormData();
      });

      const unitDelayMinElement = document.getElementById(config.unitDelayMinId);
      if (unitDelayMinElement) {
        unitDelayMinElement.addEventListener('input', () => this.saveFormData());
      }

      const unitDelayMaxElement = document.getElementById(config.unitDelayMaxId);
      if (unitDelayMaxElement) {
        unitDelayMaxElement.addEventListener('input', () => this.saveFormData());
      }

      this.getMessageElements(mode).forEach((element) => {
        element.addEventListener('input', () => this.saveFormData());
      });

      const complianceCheckbox = document.getElementById(config.complianceModeId);
      if (complianceCheckbox) {
        complianceCheckbox.addEventListener('change', () => this.saveFormData());
      }

      const riskProfileSelect = document.getElementById(config.riskProfileId);
      if (riskProfileSelect) {
        riskProfileSelect.addEventListener('change', () => this.saveFormData());
      }

      const filesFirstRadio = document.getElementById(config.sendFilesFirstId);
      const textFirstRadio = document.getElementById(config.sendTextFirstId);
      const messageSplitRadio = document.getElementById(config.sendMessageSplitId);

      if (filesFirstRadio) {
        filesFirstRadio.addEventListener('change', () => this.saveFormData());
      }

      if (textFirstRadio) {
        textFirstRadio.addEventListener('change', () => this.saveFormData());
      }

      if (messageSplitRadio) {
        messageSplitRadio.addEventListener('change', () => this.saveFormData());
      }
    });

    const numerosEl = document.getElementById('numeros');
    if (numerosEl) {
      numerosEl.addEventListener('input', (event) => {
        this.syncManualNumbers(event.target.value);
        this.saveFormData();
      });
    }

    const selectFilteredGroupsButton = document.getElementById('selectFilteredGroups');
    if (selectFilteredGroupsButton) {
      selectFilteredGroupsButton.addEventListener('click', () => {
        const filteredGroups = Array.isArray(this.ui.visibleFilteredGroups) ? this.ui.visibleFilteredGroups : [];
        if (filteredGroups.length === 0) {
          this.ui.showToast('No hay grupos filtrados para seleccionar.', 'warning');
          return;
        }

        filteredGroups.forEach((group) => {
          if (group && group.id) {
            this.ui.selectedGroupIds.add(group.id);
          }
        });

        this.ui.paintGroupSelection();
        sendingActions.refreshRiskPanel(this, 'groups');
        this.ui.showToast(`Se seleccionaron ${filteredGroups.length} grupos del filtro actual.`, 'success');
      });
    }
  }

  getMessageElements(mode) {
    return this.messagingController.getMessageElements(mode);
  }

  getMessageComposerState(mode) {
    return this.messagingController.getMessageComposerState(mode);
  }

  setActiveMessageTab(mode, index) {
    return this.messagingController.setActiveMessageTab(mode, index);
  }

  updateMessageSplitOptionVisibility(mode) {
    return this.messagingController.updateMessageSplitOptionVisibility(mode);
  }

  addMessageTab(mode) {
    return this.messagingController.addMessageTab(mode);
  }

  closeMessageTab(mode, index) {
    return this.messagingController.closeMessageTab(mode, index);
  }

  insertTokenAtCursor(mode, token) {
    return this.messagingController.insertTokenAtCursor(mode, token);
  }

  renderCustomVariables(mode) {
    return this.messagingController.renderCustomVariables(mode);
  }

  addCustomVariable(mode) {
    return this.messagingController.addCustomVariable(mode);
  }

  removeCustomVariable(mode, index) {
    return this.messagingController.removeCustomVariable(mode, index);
  }

  bindMessageComposerEvents() {
    return this.messagingController.bindMessageComposerEvents();
  }

  getMessagePayload(mode) {
    return this.messagingController.getMessagePayload(mode);
  }

  bindIpcEvents() {
    return this.sessionController.bindIpcEvents();
  }

  loadGroups() {
    return this.groupsController.loadGroups()
      .then(() => this.refreshDestinationStatuses('groups', { repaint: true }))
      .finally(() => {
        this.refreshChatHistoryTargetOptions();
        if (this.chatExportController) {
          this.chatExportController.refreshAvailableTargets();
        }
        sendingActions.refreshRiskPanel(this, 'groups');
      });
  }

  loadContacts() {
    return this.contactsController.loadContacts()
      .then(() => this.refreshDestinationStatuses('contacts', { repaint: true }))
      .finally(() => {
        this.refreshChatHistoryTargetOptions();
        if (this.chatExportController) {
          this.chatExportController.refreshAvailableTargets();
        }
        sendingActions.refreshRiskPanel(this, 'contacts');
        this.ui.renderScheduleTargetOptions(this.scheduleDraft.targetType, this.contacts, this.groups, this.scheduleDraft.targetId);
      });
  }

  applyGroupFilter() {
    return this.groupsController.applyGroupFilter();
  }

  applyContactFilter() {
    return this.contactsController.applyContactFilter();
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  getChatHistoryTargets() {
    return this.historyController.getChatHistoryTargets();
  }

  refreshChatHistoryTargetOptions() {
    return this.historyController.refreshChatHistoryTargetOptions();
  }

  renderChatHistoryConversation(items, chatLabel) {
    return this.historyController.renderChatHistoryConversation(items, chatLabel);
  }

  async loadChatHistoryPreview() {
    return this.historyController.loadChatHistoryPreview();
  }

  bindChatHistoryEvents() {
    return this.historyController.bindEvents();
  }

  openConversation(target) {
    return this.historyController.openConversation(target);
  }

  exportConversation(format) {
    return this.historyController.exportConversation(format);
  }

  exportChat(format) {
    if (this.chatExportController) {
      return this.chatExportController.exportChat(format);
    }
  }

  selectContact(contactId) {
    return this.contactsController.selectContact(contactId);
  }

  removeSelectedContact(contactId) {
    return this.contactsController.removeSelectedContact(contactId);
  }

  clearSelectedContacts() {
    return this.contactsController.clearSelectedContacts();
  }

  syncManualNumbers(textValue) {
    return this.contactsController.syncManualNumbers(textValue);
  }

  importExcelContacts() {
    return this.contactsController.importExcelContacts();
  }

  markContactsAsRecentlyMessaged(targets) {
    const result = this.contactsController.markContactsAsRecentlyMessaged(targets);
    sendingActions.refreshRiskPanel(this, 'contacts');
    return result;
  }

  markTargetsAsRecentlyMessaged(mode, targets) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';

    if (safeMode === 'contacts') {
      this.markContactsAsRecentlyMessaged(targets);
      return;
    }

    const ids = Array.isArray(targets)
      ? targets.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    if (ids.length === 0) {
      return;
    }

    const nowIso = new Date().toISOString();
    ids.forEach((id) => {
      this.sentTodayByMode.groups.add(id);
      this.lastSentAtByMode.groups[id] = nowIso;
    });

    this.applyGroupFilter();
    sendingActions.refreshRiskPanel(this, 'groups');
  }

  removeAlreadySentTargets(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';

    if (safeMode === 'contacts') {
      const previous = this.selectedContacts.length;
      this.selectedContacts = this.selectedContacts.filter((contact) => {
        const status = this.getDestinationStatus('contacts', contact.id);
        return !status.sentToday;
      });

      const removed = previous - this.selectedContacts.length;
      if (removed > 0) {
        this.ui.renderSelectedContacts(this.selectedContacts);
        this.ui.renderContactResults(this.filteredContacts, this.contactSearchTerm, this.contacts.length);
        this.saveFormData();
      }

      sendingActions.refreshRiskPanel(this, 'contacts');
      return removed;
    }

    const selectedGroupIds = this.ui.getSelectedGroupIds();
    const keepIds = selectedGroupIds.filter((groupId) => {
      const status = this.getDestinationStatus('groups', groupId);
      return !status.sentToday;
    });

    const removed = selectedGroupIds.length - keepIds.length;
    if (removed > 0) {
      this.ui.selectedGroupIds = new Set(keepIds);
      this.ui.paintGroupSelection();
    }

    sendingActions.refreshRiskPanel(this, 'groups');
    return removed;
  }

  selectFiles(mode) {
    return this.messagingController.selectFiles(mode);
  }

  updateDelayOptions(mode) {
    return this.messagingController.updateDelayOptions(mode);
  }

  sendBatch(mode, options) {
    return this.messagingController.sendBatch(mode, options);
  }

  exportGroupMembers(groupId, format) {
    return this.groupsController.exportGroupMembers(groupId, format);
  }

  saveFormData() {
    return formPersistence.saveFormData(this.storage, this);
  }

  hasAdminAccess() {
    return false;
  }

  updateAdminVisibility() {
    this.ui.setAdminVisible(false);
  }

  bindAdminUiEvents() {
    // Admin console is inactive in standalone desktop mode
  }

  getSecurityPreferences() {
    return formPersistence.getSecurityPreferences(this.modeConfig);
  }

  applySecurityPreferences(securityPreferences = {}) {
    return formPersistence.applySecurityPreferences(this.modeConfig, securityPreferences, (mode) => {
      this.updateDelayOptions(mode);
    });
  }

  loadSavedData() {
    return formPersistence.loadSavedData(this.storage, this);
  }
}

module.exports = AppController;