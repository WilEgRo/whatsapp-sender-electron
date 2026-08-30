const QRCode = require('qrcode');
const { shell } = require('electron');
const IpcClient = require('./ipc-client');
const FormStorage = require('./form-storage');
const UiManager = require('./ui-manager');
const modeConfig = require('./app/mode-config');
const contactActions = require('./app/contacts');
const groupActions = require('./app/groups');
const sendingActions = require('./app/sending');
const groupImportActions = require('./app/group-import');
const { CampaignDispatcherController } = require('./campaign/campaign-dispatcher-controller');
const { ContactsController } = require('../../../features/contacts/presentation/contacts-controller');
const { GroupsController } = require('../../../features/groups/presentation/groups-controller');

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
    this.bindUiEvents();
    this.bindMessageComposerEvents();
    this.bindIpcEvents();
    this.loadSavedData();
    this.bindStatsEvents();
    this.bindAdminUiEvents();
    this.bindChatHistoryEvents();
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
    const target = String(tab || '').trim();
    if (!target) {
      return;
    }

    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === target);
    });

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === target);
    });
  }

  applyEntitlementsToUi() {
    const historyTab = document.getElementById('estadisticasTab');
    const historyPanel = document.getElementById('estadisticasContent');
    if (historyTab) {
      historyTab.classList.remove('hidden');
    }
    if (historyPanel) {
      historyPanel.classList.remove('hidden');
    }

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

  bindSchedulingUiEvents() {
    if (this.ui.scheduleTargetType) {
      this.ui.scheduleTargetType.addEventListener('change', () => {
        this.scheduleDraft.targetType = this.ui.scheduleTargetType.value === 'groups' ? 'groups' : 'contacts';
        this.scheduleDraft.targetId = '';
        this.ui.renderScheduleTargetOptions(this.scheduleDraft.targetType, this.contacts, this.groups, '');
      });
    }

    if (this.ui.scheduleTargetId) {
      this.ui.scheduleTargetId.addEventListener('change', () => {
        this.scheduleDraft.targetId = String(this.ui.scheduleTargetId.value || '');
      });
    }

    const selectScheduleFilesButton = document.getElementById('selectFilesSchedule');
    if (selectScheduleFilesButton) {
      selectScheduleFilesButton.addEventListener('click', async () => {
        try {
          const selected = await this.ipcClient.invoke('select-files');
          this.scheduleDraft.files = Array.isArray(selected) ? selected.slice(0, 3) : [];
          this.ui.renderFiles('schedule', this.scheduleDraft.files);
        } catch (error) {
          console.error('Error seleccionando archivos programados:', error);
          this.ui.showToast('No se pudieron seleccionar archivos para programacion', 'error');
        }
      });
    }

    const filesFirst = document.getElementById('sendFilesFirstSchedule');
    const textFirst = document.getElementById('sendTextFirstSchedule');

    if (filesFirst) {
      filesFirst.addEventListener('change', () => {
        this.scheduleDraft.sendFilesFirst = Boolean(filesFirst.checked);
      });
    }

    if (textFirst) {
      textFirst.addEventListener('change', () => {
        this.scheduleDraft.sendFilesFirst = !Boolean(textFirst.checked);
      });
    }

    const createButton = document.getElementById('createScheduleButton');
    if (createButton) {
      createButton.addEventListener('click', () => this.createScheduledMessage());
    }

    const refreshButton = document.getElementById('refreshScheduleButton');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => this.refreshScheduledMessages({ silent: false }));
    }

    if (this.ui.scheduledMessagesList) {
      this.ui.scheduledMessagesList.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-cancel-schedule-id]');
        if (!button) {
          return;
        }

        const scheduleId = Number(button.dataset.cancelScheduleId);
        if (!Number.isFinite(scheduleId)) {
          return;
        }

        await this.cancelScheduledMessage(scheduleId);
      });
    }
  }

  async createScheduledMessage() {
    if (!this.hasFeature('bulk_send')) {
      this.ui.showToast('Tu plan no incluye programacion de envios masivos.', 'warning');
      return;
    }

    const targetType = this.ui.scheduleTargetType && this.ui.scheduleTargetType.value === 'groups' ? 'groups' : 'contacts';
    const targetId = this.ui.scheduleTargetId ? String(this.ui.scheduleTargetId.value || '').trim() : '';
    const targetLabel = this.ui.scheduleTargetId && this.ui.scheduleTargetId.selectedOptions && this.ui.scheduleTargetId.selectedOptions[0]
      ? this.ui.scheduleTargetId.selectedOptions[0].textContent
      : targetId;
    const messageText = this.ui.scheduleMessageText ? String(this.ui.scheduleMessageText.value || '').trim() : '';
    const scheduledAt = this.ui.scheduleDatetime ? String(this.ui.scheduleDatetime.value || '').trim() : '';
    const delayMin = this.ui.scheduleDelayMin ? Number(this.ui.scheduleDelayMin.value || 3) : 3;
    const delayMax = this.ui.scheduleDelayMax ? Number(this.ui.scheduleDelayMax.value || 6) : 6;

    if (!targetId) {
      this.ui.showToast('Selecciona un destinatario para programar', 'warning');
      return;
    }

    if (!scheduledAt) {
      this.ui.showToast('Selecciona fecha y hora para programar', 'warning');
      return;
    }

    try {
      const response = await this.ipcClient.invoke('create-scheduled-message', {
        targetType,
        targetId,
        targetLabel,
        messageText,
        files: this.scheduleDraft.files.map((item) => item.path),
        sendFilesFirst: this.scheduleDraft.sendFilesFirst !== false,
        delayMin,
        delayMax,
        scheduledAt
      });

      if (!response || !response.success) {
        this.ui.showToast(`No se pudo programar: ${response && response.error ? response.error : 'error desconocido'}`, 'error');
        return;
      }

      this.ui.showToast('Mensaje programado correctamente', 'success');
      if (this.ui.scheduleMessageText) {
        this.ui.scheduleMessageText.value = '';
      }
      if (this.ui.scheduleDatetime) {
        this.ui.scheduleDatetime.value = '';
      }
      this.scheduleDraft.files = [];
      this.ui.renderFiles('schedule', []);
      this.refreshScheduledMessages({ silent: true });
    } catch (error) {
      console.error('Error creando mensaje programado:', error);
      this.ui.showToast('Error inesperado al programar mensaje', 'error');
    }
  }

  async refreshScheduledMessages({ silent = true } = {}) {
    try {
      const response = await this.ipcClient.invoke('get-scheduled-messages', { status: 'pending' });
      if (!response || !response.success) {
        if (!silent) {
          this.ui.showToast('No se pudo cargar la lista de programados', 'warning');
        }
        return;
      }

      this.ui.renderScheduledMessages(response.items || []);
    } catch (error) {
      console.error('Error listando programados:', error);
      if (!silent) {
        this.ui.showToast('Error inesperado al listar programados', 'error');
      }
    }
  }

  async cancelScheduledMessage(id) {
    try {
      const response = await this.ipcClient.invoke('cancel-scheduled-message', { id });
      if (!response || !response.success) {
        this.ui.showToast(`No se pudo cancelar: ${response && response.error ? response.error : 'error desconocido'}`, 'error');
        return;
      }

      this.ui.showToast('Mensaje programado cancelado', 'success');
      this.refreshScheduledMessages({ silent: true });
    } catch (error) {
      console.error('Error cancelando programado:', error);
      this.ui.showToast('Error inesperado al cancelar', 'error');
    }
  }

  bindStatsEvents() {
    this.ui.bindStatsActions(
      () => this.refreshMessageStats({ silent: false }),
      () => this.exportMessageStatsExcel(),
      (rangePreset) => {
        this.statsFilter.preset = String(rangePreset || 'last-30');
        this.ui.setHistoryCustomRangeVisible(this.statsFilter.preset === 'custom');
        this.saveFormData();
        if (this.statsFilter.preset !== 'custom') {
          this.refreshMessageStats({ silent: false });
        }
      },
      ({ customFrom, customTo }) => {
        this.statsFilter.customFrom = String(customFrom || '');
        this.statsFilter.customTo = String(customTo || '');
        this.saveFormData();
        this.refreshMessageStats({ silent: false });
      }
    );
  }

  startStatsAutoRefresh() {
    if (this.statsRefreshTimer) {
      clearInterval(this.statsRefreshTimer);
    }

    this.statsRefreshTimer = setInterval(() => {
      this.refreshMessageStats({ silent: true });
    }, 30000);
  }

  async refreshMessageStats({ silent = true } = {}) {
    this.ui.setStatsLoading(true);

    try {
      const response = await this.ipcClient.invoke('get-message-stats', {
        filter: this.statsFilter
      });

      if (!response || !response.success || !response.stats) {
        if (!silent) {
          this.ui.showToast('No se pudieron cargar las estadisticas', 'warning');
        }
        return;
      }

      this.latestStats = response.stats;
      this.ui.renderMessageStats(response.stats);
      this.ui.renderMessageStatsHistory(response.stats);
      this.ui.renderHistoryCharts(response.stats);
    } catch (error) {
      console.error('Error cargando estadisticas:', error);
      if (!silent) {
        this.ui.showToast('Error cargando estadisticas', 'error');
      }
    } finally {
      this.ui.setStatsLoading(false);
    }
  }

  scheduleDailyStatusRefresh() {
    if (this.dailyStatusRefreshTimer) {
      clearTimeout(this.dailyStatusRefreshTimer);
      this.dailyStatusRefreshTimer = null;
    }

    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 4, 0);
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime());

    this.dailyStatusRefreshTimer = setTimeout(async () => {
      try {
        await Promise.all([
          this.refreshDestinationStatuses('contacts', { repaint: true }),
          this.refreshDestinationStatuses('groups', { repaint: true }),
          this.refreshMessageStats({ silent: true })
        ]);
      } catch (error) {
        console.error('Error actualizando estado diario a medianoche:', error);
      } finally {
        this.scheduleDailyStatusRefresh();
      }
    }, delay);
  }

  getDestinationStatus(mode, destinationId) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const safeId = String(destinationId || '').trim();

    if (!safeId) {
      return {
        sentToday: false,
        lastSentAt: null
      };
    }

    const modeSet = this.sentTodayByMode[safeMode];
    const modeLastSent = this.lastSentAtByMode[safeMode];

    if (modeSet.has(safeId)) {
      return {
        sentToday: true,
        lastSentAt: modeLastSent[safeId] || null
      };
    }

    if (safeMode === 'contacts') {
      const numDigits = safeId.replace(/[^0-9]/g, '');
      if (numDigits) {
        const altId = `${numDigits}@c.us`;
        if (modeSet.has(altId)) {
          return {
            sentToday: true,
            lastSentAt: modeLastSent[altId] || null
          };
        }
        if (modeSet.has(numDigits)) {
          return {
            sentToday: true,
            lastSentAt: modeLastSent[numDigits] || null
          };
        }
      }
    }

    return {
      sentToday: false,
      lastSentAt: null
    };
  }

  getAlreadySentSelectedTargetsCount(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';

    if (safeMode === 'contacts') {
      if (!Array.isArray(this.selectedContacts)) {
        return 0;
      }
      return this.selectedContacts.filter((contact) => {
        const id = contact.id || contact.number;
        const status = this.getDestinationStatus('contacts', id);
        return Boolean(status && status.sentToday);
      }).length;
    }

    if (safeMode === 'groups') {
      const selectedGroupIds = this.ui ? this.ui.getSelectedGroupIds() : [];
      if (!Array.isArray(selectedGroupIds)) {
        return 0;
      }
      return selectedGroupIds.filter((groupId) => {
        const status = this.getDestinationStatus('groups', groupId);
        return Boolean(status && status.sentToday);
      }).length;
    }

    return 0;
  }

  async refreshDestinationStatuses(mode, { repaint = true } = {}) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    let destinationIds = [];

    if (safeMode === 'contacts') {
      const idsFromContacts = (this.contacts || []).map((contact) => contact.id);
      const idsFromSelected = (this.selectedContacts || []).map((contact) => contact.id || contact.number);
      const uniqueSet = new Set([...idsFromContacts, ...idsFromSelected].filter(Boolean));
      destinationIds = Array.from(uniqueSet);
    } else {
      destinationIds = (this.groups || []).map((group) => group.id);
    }

    if (!Array.isArray(destinationIds) || destinationIds.length === 0) {
      return;
    }

    try {
      const response = await this.ipcClient.invoke('get-destination-statuses', {
        destinationType: safeMode,
        destinationIds
      });

      if (!response || !response.success || !response.result || !response.result.byId) {
        return;
      }

      const byId = response.result.byId;
      const todaySet = new Set();
      const lastSentMap = Object.create(null);

      Object.keys(byId).forEach((id) => {
        const item = byId[id] || {};
        if (item.sentToday) {
          todaySet.add(id);
        }

        if (item.lastSentAt) {
          lastSentMap[id] = item.lastSentAt;
        }
      });

      this.sentTodayByMode[safeMode] = todaySet;
      this.lastSentAtByMode[safeMode] = lastSentMap;

      if (!repaint) {
        return;
      }

      if (safeMode === 'contacts') {
        this.applyContactFilter();
      } else {
        this.applyGroupFilter();
      }
    } catch (error) {
      console.error(`Error cargando estado de destinatarios (${safeMode}):`, error);
    }
  }

  async exportMessageStatsExcel() {
    if (!this.hasFeature('advanced_exports')) {
      this.ui.showToast('La exportacion avanzada requiere plan Pro o superior.', 'warning');
      return;
    }

    this.ui.setStatsLoading(true);

    try {
      const response = await this.ipcClient.invoke('export-message-stats', {
        filter: this.statsFilter
      });

      if (!response || !response.success) {
        this.ui.showToast(`No se pudo exportar reporte: ${response && response.error ? response.error : 'error desconocido'}`, 'error');
        return;
      }

      if (response.canceled) {
        this.ui.showToast('Exportacion cancelada', 'warning');
        return;
      }

      this.ui.showToast('Reporte de estadisticas exportado en Excel', 'success');
    } catch (error) {
      console.error('Error exportando estadisticas:', error);
      this.ui.showToast('Error inesperado al exportar estadisticas', 'error');
    } finally {
      this.ui.setStatsLoading(false);
    }
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
    if (mode === 'contacts') {
      return ['mensaje', 'mensajeContacts2', 'mensajeContacts3']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    }

    return ['mensajeGrupo', 'mensajeGrupo2', 'mensajeGrupo3']
      .map((id) => document.getElementById(id))
      .filter(Boolean);
  }

  getMessageComposerState(mode) {
    return this.messageComposer[mode === 'groups' ? 'groups' : 'contacts'];
  }

  setActiveMessageTab(mode, index) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const safeIndex = [1, 2, 3].includes(Number(index)) ? Number(index) : 1;
    const composer = this.getMessageComposerState(safeMode);
    const enabled = Array.isArray(composer.enabledIndices) ? composer.enabledIndices : [1];
    const nextIndex = enabled.includes(safeIndex) ? safeIndex : (enabled[0] || 1);
    composer.enabledIndices = enabled;
    composer.activeIndex = nextIndex;

    document.querySelectorAll(`[data-message-tab="${safeMode}"]`).forEach((button) => {
      const idx = Number(button.dataset.messageIndex);
      const isEnabled = composer.enabledIndices.includes(idx);
      button.classList.toggle('hidden', !isEnabled);
      button.classList.toggle('is-active', idx === composer.activeIndex);
    });

    document.querySelectorAll(`[data-message-pane="${safeMode}"]`).forEach((textarea) => {
      const idx = Number(textarea.dataset.messageIndex);
      const visible = composer.enabledIndices.includes(idx) && idx === composer.activeIndex;
      textarea.classList.toggle('hidden', !visible);
    });

    const addButton = document.querySelector(`[data-add-message-tab="${safeMode}"]`);
    if (addButton) {
      addButton.disabled = composer.enabledIndices.length >= 3;
    }

    this.updateMessageSplitOptionVisibility(safeMode);
  }

  updateMessageSplitOptionVisibility(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const config = this.modeConfig[safeMode];
    const splitOption = document.getElementById(config.sendMessageSplitOptionId);
    const splitRadio = document.getElementById(config.sendMessageSplitId);
    const filesFirstRadio = document.getElementById(config.sendFilesFirstId);

    if (!splitOption || !splitRadio) {
      return;
    }

    const canUseSplit = Array.isArray(composer.enabledIndices) && composer.enabledIndices.length > 1;
    splitOption.classList.toggle('hidden', !canUseSplit);

    if (!canUseSplit && splitRadio.checked && filesFirstRadio) {
      filesFirstRadio.checked = true;
    }
  }

  addMessageTab(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const enabled = new Set(Array.isArray(composer.enabledIndices) ? composer.enabledIndices : [1]);
    const next = [1, 2, 3].find((idx) => !enabled.has(idx));
    if (!next) {
      return;
    }

    enabled.add(next);
    composer.enabledIndices = Array.from(enabled).sort((a, b) => a - b);

    this.setActiveMessageTab(safeMode, next);
    this.saveFormData();
  }

  closeMessageTab(mode, index) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const safeIndex = Number(index);
    if (![2, 3].includes(safeIndex)) {
      return;
    }

    const composer = this.getMessageComposerState(safeMode);
    const enabled = new Set(Array.isArray(composer.enabledIndices) ? composer.enabledIndices : [1]);
    if (!enabled.has(safeIndex)) {
      return;
    }

    enabled.delete(safeIndex);
    composer.enabledIndices = Array.from(enabled).sort((a, b) => a - b);

    if (!composer.enabledIndices.includes(composer.activeIndex)) {
      composer.activeIndex = composer.enabledIndices[composer.enabledIndices.length - 1] || 1;
    }

    this.setActiveMessageTab(safeMode, composer.activeIndex);
    this.saveFormData();
  }

  insertTokenAtCursor(mode, token) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const activeTextarea = document.querySelector(
      `[data-message-pane="${safeMode}"][data-message-index="${composer.activeIndex}"]`
    );

    if (!activeTextarea) {
      return;
    }

    const start = Number.isInteger(activeTextarea.selectionStart) ? activeTextarea.selectionStart : activeTextarea.value.length;
    const end = Number.isInteger(activeTextarea.selectionEnd) ? activeTextarea.selectionEnd : activeTextarea.value.length;
    const currentValue = String(activeTextarea.value || '');
    activeTextarea.value = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`;
    const nextPos = start + token.length;
    activeTextarea.setSelectionRange(nextPos, nextPos);
    activeTextarea.focus();
    this.saveFormData();
  }

  renderCustomVariables(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const listElement = document.getElementById(safeMode === 'groups' ? 'customVarsListGroups' : 'customVarsListContacts');
    if (!listElement) {
      return;
    }

    const variables = Array.isArray(composer.customVariables) ? composer.customVariables : [];
    if (variables.length === 0) {
      listElement.innerHTML = '';
      return;
    }

    listElement.innerHTML = variables.map((item, idx) => {
      const name = String(item.name || '').trim();
      const value = String(item.value || '').trim();
      return `
        <span class="custom-var-chip">
          {{${name}}} = ${value}
          <button type="button" data-remove-custom-var="${safeMode}" data-custom-var-index="${idx}">x</button>
        </span>
      `;
    }).join('');
  }

  addCustomVariable(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const nameInput = document.getElementById(safeMode === 'groups' ? 'customVarNameGroups' : 'customVarNameContacts');
    const valueInput = document.getElementById(safeMode === 'groups' ? 'customVarValueGroups' : 'customVarValueContacts');
    if (!nameInput || !valueInput) {
      return;
    }

    const rawName = String(nameInput.value || '').trim().toLowerCase();
    const rawValue = String(valueInput.value || '').trim();
    const normalizedName = rawName.replace(/[^a-z0-9_]/g, '_');

    if (!normalizedName || !rawValue) {
      this.ui.showToast('Debes ingresar nombre y valor para crear la variable.', 'warning');
      return;
    }

    const variables = Array.isArray(composer.customVariables) ? composer.customVariables : [];
    const existingIndex = variables.findIndex((item) => item.name === normalizedName);
    if (existingIndex >= 0) {
      variables[existingIndex].value = rawValue;
    } else {
      variables.push({ name: normalizedName, value: rawValue });
    }

    composer.customVariables = variables;
    nameInput.value = '';
    valueInput.value = '';
    this.renderCustomVariables(safeMode);
    this.insertTokenAtCursor(safeMode, `{{${normalizedName}}}`);
    this.saveFormData();
  }

  removeCustomVariable(mode, index) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const variables = Array.isArray(composer.customVariables) ? composer.customVariables : [];
    const safeIndex = Number(index);
    if (!Number.isInteger(safeIndex) || safeIndex < 0 || safeIndex >= variables.length) {
      return;
    }

    variables.splice(safeIndex, 1);
    composer.customVariables = variables;
    this.renderCustomVariables(safeMode);
    this.saveFormData();
  }

  bindMessageComposerEvents() {
    document.querySelectorAll('[data-message-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = String(button.dataset.messageTab || '').trim();
        const index = Number(button.dataset.messageIndex || 1);
        this.setActiveMessageTab(mode, index);
      });
    });

    document.querySelectorAll('[data-add-message-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = String(button.dataset.addMessageTab || '').trim();
        this.addMessageTab(mode);
      });
    });

    document.querySelectorAll('[data-close-message-tab]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const mode = String(button.dataset.closeMessageTab || '').trim();
        const index = Number(button.dataset.messageIndex || 1);
        this.closeMessageTab(mode, index);
      });
    });

    document.querySelectorAll('[data-insert-variable]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = String(button.dataset.insertVariable || '').trim();
        const token = String(button.dataset.variableToken || '').trim();
        if (!token) {
          return;
        }

        this.insertTokenAtCursor(mode, token);
      });
    });

    const addContactsButton = document.getElementById('addCustomVarContacts');
    if (addContactsButton) {
      addContactsButton.addEventListener('click', () => this.addCustomVariable('contacts'));
    }

    const addGroupsButton = document.getElementById('addCustomVarGroups');
    if (addGroupsButton) {
      addGroupsButton.addEventListener('click', () => this.addCustomVariable('groups'));
    }

    const customVarsContacts = document.getElementById('customVarsListContacts');
    if (customVarsContacts) {
      customVarsContacts.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-custom-var]');
        if (!button) {
          return;
        }

        this.removeCustomVariable(button.dataset.removeCustomVar, button.dataset.customVarIndex);
      });
    }

    const customVarsGroups = document.getElementById('customVarsListGroups');
    if (customVarsGroups) {
      customVarsGroups.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-custom-var]');
        if (!button) {
          return;
        }

        this.removeCustomVariable(button.dataset.removeCustomVar, button.dataset.customVarIndex);
      });
    }

    const randomTagsContacts = document.getElementById('randomTagsContacts');
    if (randomTagsContacts) {
      randomTagsContacts.addEventListener('input', () => {
        this.messageComposer.contacts.randomTagsRaw = String(randomTagsContacts.value || '');
        this.saveFormData();
      });
    }

    const randomTagsGroups = document.getElementById('randomTagsGroups');
    if (randomTagsGroups) {
      randomTagsGroups.addEventListener('input', () => {
        this.messageComposer.groups.randomTagsRaw = String(randomTagsGroups.value || '');
        this.saveFormData();
      });
    }

    this.setActiveMessageTab('contacts', 1);
    this.setActiveMessageTab('groups', 1);
  }

  getMessagePayload(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const enabledIndices = Array.isArray(composer.enabledIndices) && composer.enabledIndices.length > 0
      ? composer.enabledIndices.slice().sort((a, b) => a - b)
      : [1];
    const messageByIndex = new Map(
      this.getMessageElements(safeMode).map((el) => [Number(el.dataset.messageIndex || 1), String(el.value || '').trim()])
    );
    const messageList = enabledIndices
      .map((index) => String(messageByIndex.get(index) || '').trim())
      .filter(Boolean);

    const customVariables = {};
    (Array.isArray(composer.customVariables) ? composer.customVariables : []).forEach((item) => {
      const key = String(item && item.name ? item.name : '').trim();
      if (!key) {
        return;
      }

      customVariables[key] = String(item.value || '');
    });

    const randomTags = String(composer.randomTagsRaw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (safeMode === 'contacts') {
      const contactContexts = this.selectedContacts.map((contact) => {
        const fullName = String(contact.name || '').trim();
        const parts = fullName.split(/\s+/).filter(Boolean);
        return {
          id: contact.id,
          number: contact.number,
          numero: contact.number,
          full_name: fullName,
          nombre_completo: fullName,
          name: parts[0] || fullName,
          nombre: parts[0] || fullName,
          last_name: parts.length > 1 ? parts.slice(1).join(' ') : '',
          apellido: parts.length > 1 ? parts.slice(1).join(' ') : '',
          ...(contact.context || {})
        };
      });

      return {
        messageList,
        messagePrimary: messageList[0] || '',
        customVariables,
        randomTags,
        contactContexts
      };
    }

    const groupContexts = (this.groups || []).map((group) => ({
      id: group.id,
      group: group.name,
      grupo: group.name
    }));

    return {
      messageList,
      messagePrimary: messageList[0] || '',
      customVariables,
      randomTags,
      groupContexts
    };
  }

  bindIpcEvents() {
    this.ipcClient.on('server-ready', () => {
      this.ui.updateStatus('Conectando a WhatsApp Web...', 'connecting');
    });

    this.ipcClient.on('whatsapp-qr', async (_event, qrCodeValue) => {
      try {
        const qrCanvas = await QRCode.toCanvas(qrCodeValue, {
          width: 240,
          margin: 2,
          color: { dark: '#0d1b16', light: '#f6fff9' }
        });

        this.ui.showQrCanvas(qrCanvas);
      } catch (error) {
        console.error('Error renderizando QR:', error);
        this.ui.showToast('No se pudo renderizar el codigo QR', 'error');
      }
    });

    this.ipcClient.on('whatsapp-authenticated', () => {
      console.log('[WhatsApp] Sesión autenticada. Mostrando pantalla de carga...');
      this.ui.showSessionLoading(
        'WhatsApp autenticado correctamente',
        'Iniciando sesión en WhatsApp y preparando la aplicación...',
        25
      );
      this.ui.showToast('¡Código QR escaneado correctamente!', 'success');
    });

    this.ipcClient.on('whatsapp-loading-screen', (_event, payload) => {
      const percent = payload && payload.percent ? Number(payload.percent) : 0;
      const message = payload && payload.message ? payload.message : 'Descargando datos de WhatsApp...';
      this.ui.updateSessionLoadingStatus(
        `Cargando sesión de WhatsApp (${Math.round(percent)}%)...`,
        `${message}. Por favor NO CIERRE el programa.`,
        percent,
        { subtitle: 'WhatsApp autenticado correctamente. Cargando sesión...' }
      );
    });

    this.ipcClient.on('whatsapp-ready', () => {
      this.isReady = true;
      this.ui.updateStatus('WhatsApp conectado', 'ready');
      this.ui.updateSessionLoadingStatus(
        'WhatsApp autenticado y listo',
        'Sincronizando chats, grupos y contactos...',
        95,
        { subtitle: 'WhatsApp autenticado correctamente' }
      );
      console.log('[Groups] WhatsApp listo. Iniciando sincronizacion de grupos...');
      this.loadGroups();
    });

    this.ipcClient.on('whatsapp-disconnected', (_event, reason) => {
      this.isReady = false;
      this.ui.hideQr();
      this.ui.updateStatus('WhatsApp desconectado', 'error');
      this.ui.showToast(`Sesion desconectada: ${reason || 'sin detalle'}`, 'warning');
    });

    this.ipcClient.on('groups-loaded', (_event, groups) => {
      this.groups = groups;
      console.log(`[Groups] Sincronizacion completada. Grupos cargados: ${groups.length}`);
      this.applyGroupFilter();
      this.ui.renderGroupExportOptions(this.groups, this.exportGroupId);
      this.refreshDestinationStatuses('groups', { repaint: true });
      this.ui.renderScheduleTargetOptions(this.scheduleDraft.targetType, this.contacts, this.groups, this.scheduleDraft.targetId);
    });

    this.ipcClient.on('groups-sync-status', (_event, payload) => {
      if (!payload || !payload.state) {
        return;
      }

      if (payload.state === 'loading') {
        console.log('[Groups] Sincronizando grupos desde WhatsApp...');
        this.ui.updateStatus('Sincronizando grupos...', 'connecting');
        this.ui.updateSessionLoadingStatus(
          'Sincronizando chats y grupos de WhatsApp...',
          'Buscando y organizando grupos en segundo plano...',
          98
        );
        return;
      }

      if (payload.state === 'completed') {
        console.log(`[Groups] Sincronizacion de grupos finalizada: ${payload.total} grupos.`);
        if (this.isReady) {
          this.ui.updateStatus('WhatsApp conectado', 'ready');
        }
        this.ui.updateSessionLoadingStatus(
          '¡Sincronización completada al 100%!',
          `Se sincronizaron ${payload.total || 0} grupos correctamente. Abriendo aplicación...`,
          100,
          { title: '¡WhatsApp Conectado y Sincronizado!' }
        );
        setTimeout(() => {
          this.ui.hideQr();
        }, 1200);
        return;
      }

      if (payload.state === 'failed') {
        console.error(`[Groups] Error al sincronizar grupos: ${payload.error || 'sin detalle'}`);
        this.ui.showToast('No se pudieron sincronizar grupos en este intento', 'warning');
        setTimeout(() => {
          this.ui.hideQr();
        }, 1500);
      }
    });

    if (this.ui && this.ui.cancelSendBtn) {
      this.ui.cancelSendBtn.addEventListener('click', async () => {
        if (this.ui.cancelSendBtn.disabled) {
          return;
        }

        this.ui.cancelSendBtn.disabled = true;
        this.ui.cancelSendBtn.innerHTML = '<span class="cancel-send-icon">⏳</span> <span>Cancelando...</span>';
        this.ui.updateSendProgress({ status: 'cancelling' });

        try {
          await this.ipcClient.invoke('cancel-send');
        } catch (error) {
          console.error('[AppController] Error enviando señal de cancelación:', error);
        }
      });
    }

    if (this.ui && this.ui.taskDock) {
      this.ui.taskDock.on('cancel', async () => {
        this.ui.updateSendProgress({ status: 'cancelling' });
        try {
          await this.ipcClient.invoke('cancel-send');
        } catch (error) {
          console.error('[AppController] Error cancelando desde TaskDock:', error);
        }
      });
    }

    this.ipcClient.on('send-progress', (_event, progress) => {
      if (!progress || !this.activeSendMode || progress.targetType !== this.activeSendMode) {
        return;
      }

      this.ui.updateSendProgress(progress);
      if (progress.status === 'completed' || progress.status === 'cancelled') {
        setTimeout(() => this.ui.hideProgress(), 2400);
      }
    });
  }

  loadGroups() {
    return this.groupsController.loadGroups()
      .then(() => this.refreshDestinationStatuses('groups', { repaint: true }))
      .finally(() => {
        this.refreshChatHistoryTargetOptions();
        sendingActions.refreshRiskPanel(this, 'groups');
      });
  }

  loadContacts() {
    return this.contactsController.loadContacts()
      .then(() => this.refreshDestinationStatuses('contacts', { repaint: true }))
      .finally(() => {
        this.refreshChatHistoryTargetOptions();
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
    const contactTargets = (Array.isArray(this.contacts) ? this.contacts : []).map((contact) => ({
      id: contact.id,
      type: 'contacts',
      label: `${contact.name} (${contact.number})`,
      searchText: `${contact.name} ${contact.number}`.toLowerCase()
    }));

    const groupTargets = (Array.isArray(this.groups) ? this.groups : []).map((group) => ({
      id: group.id,
      type: 'groups',
      label: `[Grupo] ${group.name}`,
      searchText: String(group.name || '').toLowerCase()
    }));

    return [...contactTargets, ...groupTargets].sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }

  refreshChatHistoryTargetOptions() {
    const select = document.getElementById('chatHistoryTargetSelect');
    const statusHint = document.getElementById('chatHistoryStatusHint');
    if (!select) {
      return;
    }

    const term = String(this.chatHistoryState.searchTerm || '').trim().toLowerCase();
    const allTargets = this.getChatHistoryTargets();
    const filtered = term
      ? allTargets.filter((item) => item.searchText.includes(term))
      : allTargets;

    this.chatHistoryState.filteredTargets = filtered;

    if (filtered.length === 0) {
      select.innerHTML = '';
      this.chatHistoryState.selectedTargetId = '';
      if (statusHint) {
        statusHint.textContent = 'No se encontraron chats para ese filtro.';
      }
      return;
    }

    const previous = String(this.chatHistoryState.selectedTargetId || '').trim();
    const nextSelected = filtered.find((item) => item.id === previous) || filtered[0];

    select.innerHTML = filtered
      .map((item) => `<option value="${this.escapeHtml(item.id)}">${this.escapeHtml(item.label)}</option>`)
      .join('');

    select.value = nextSelected.id;
    this.chatHistoryState.selectedTargetId = nextSelected.id;
    this.chatHistoryState.selectedTargetType = nextSelected.type;

    if (statusHint) {
      statusHint.textContent = `${filtered.length} chat(s) disponible(s).`;
    }
  }

  renderChatHistoryConversation(items, chatLabel) {
    const container = document.getElementById('chatHistoryConversation');
    const countHint = document.getElementById('chatHistoryResultCount');
    if (!container) {
      return;
    }

    const safeItems = Array.isArray(items) ? items : [];
    if (countHint) {
      countHint.textContent = `${safeItems.length} mensajes de texto`;
    }

    if (safeItems.length === 0) {
      container.innerHTML = '<p class="chat-history-empty">No se encontraron mensajes de texto en este chat.</p>';
      return;
    }

    container.innerHTML = safeItems
      .map((item) => {
        const timestamp = item && item.timestampIso ? new Date(item.timestampIso) : null;
        const timeLabel = timestamp && !Number.isNaN(timestamp.getTime())
          ? timestamp.toLocaleString('es-BO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
          : '--:--';
        const isOutgoing = Boolean(item && item.fromMe);
        const senderLabel = isOutgoing ? 'Yo' : String(item && item.sender ? item.sender : chatLabel || 'Contacto');

        return `
          <article class="chat-message ${isOutgoing ? 'chat-message--outgoing' : 'chat-message--incoming'}">
            <div class="chat-message__meta">
              <span>${this.escapeHtml(senderLabel)}</span>
              <span>${this.escapeHtml(timeLabel)}</span>
            </div>
            <p class="chat-message__text">${this.escapeHtml(item && item.text ? item.text : '')}</p>
          </article>
        `;
      })
      .join('');
  }

  async loadChatHistoryPreview() {
    const select = document.getElementById('chatHistoryTargetSelect');
    const statusHint = document.getElementById('chatHistoryStatusHint');
    if (!select || !select.value) {
      this.ui.showToast('Selecciona un chat para ver la conversacion.', 'warning');
      return;
    }

    const chatId = String(select.value || '').trim();
    const selected = (this.chatHistoryState.filteredTargets || []).find((item) => item.id === chatId) || null;
    this.chatHistoryState.selectedTargetId = chatId;
    this.chatHistoryState.selectedTargetType = selected ? selected.type : 'contacts';

    if (statusHint) {
      statusHint.textContent = 'Cargando conversacion...';
    }

    try {
      const response = await this.ipcClient.invoke('get-chat-history-preview', {
        chatId,
        limit: 220
      });

      if (!response || !response.success || !response.result) {
        throw new Error(response && response.error ? response.error : 'No se pudo recuperar el historial');
      }

      const result = response.result;
      const items = Array.isArray(result.items) ? result.items : [];
      this.chatHistoryState.items = items;
      this.renderChatHistoryConversation(items, result.chatName || (selected && selected.label) || 'Chat');

      if (statusHint) {
        statusHint.textContent = `Conversacion cargada: ${items.length} mensaje(s) de texto.`;
      }
    } catch (error) {
      console.error('Error cargando historial de chat:', error);
      this.chatHistoryState.items = [];
      this.renderChatHistoryConversation([], selected && selected.label ? selected.label : 'Chat');
      if (statusHint) {
        statusHint.textContent = `Error: ${error.message || 'no se pudo cargar el historial'}`;
      }
      this.ui.showToast('No se pudo cargar el historial de chat.', 'error');
    }
  }

  bindChatHistoryEvents() {
    const searchInput = document.getElementById('chatHistoryContactSearch');
    const select = document.getElementById('chatHistoryTargetSelect');
    const loadButton = document.getElementById('chatHistoryLoadButton');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.chatHistoryState.searchTerm = String(searchInput.value || '');
        this.refreshChatHistoryTargetOptions();
      });
    }

    if (select) {
      select.addEventListener('change', () => {
        this.chatHistoryState.selectedTargetId = String(select.value || '');
      });

      select.addEventListener('dblclick', () => {
        this.loadChatHistoryPreview();
      });
    }

    if (loadButton) {
      loadButton.addEventListener('click', () => {
        this.loadChatHistoryPreview();
      });
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
    return sendingActions.selectFiles(this, mode);
  }

  updateDelayOptions(mode) {
    return sendingActions.updateDelayOptions(this, mode);
  }

  sendBatch(mode, options) {
    return sendingActions.sendBatch(this, mode, options);
  }

  exportGroupMembers(groupId, format) {
    return this.groupsController.exportGroupMembers(groupId, format);
  }

  saveFormData() {
    const contactsMessages = this.getMessageElements('contacts').map((element) => String(element.value || ''));
    const groupsMessages = this.getMessageElements('groups').map((element) => String(element.value || ''));

    this.storage.save({
      mensaje: contactsMessages[0] || '',
      mensajeGrupo: groupsMessages[0] || '',
      messagesByMode: {
        contacts: contactsMessages,
        groups: groupsMessages
      },
      messageComposer: this.messageComposer,
      securityPreferences: this.getSecurityPreferences(),
      lastInteractionById: this.lastInteractionById,
      lastInteractionByNumber: this.lastInteractionByNumber,
      statsFilter: this.statsFilter
    });
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
    return Object.fromEntries(
      Object.entries(this.modeConfig).map(([mode, config]) => {
        const delayMinElement = document.getElementById(config.delayMinId);
        const delayMaxElement = document.getElementById(config.delayMaxId);
        const unitDelayMinElement = document.getElementById(config.unitDelayMinId);
        const unitDelayMaxElement = document.getElementById(config.unitDelayMaxId);
        const complianceElement = document.getElementById(config.complianceModeId);
        const profileElement = document.getElementById(config.riskProfileId);
        const filesFirstElement = document.getElementById(config.sendFilesFirstId);
        const textFirstElement = document.getElementById(config.sendTextFirstId);
        const messageSplitElement = document.getElementById(config.sendMessageSplitId);

        let sendOrderMode = 'files-first';
        if (messageSplitElement && messageSplitElement.checked) {
          sendOrderMode = 'message-split';
        } else if (textFirstElement && textFirstElement.checked) {
          sendOrderMode = 'text-first';
        }

        return [mode, {
          delayMin: delayMinElement ? delayMinElement.value : '',
          delayMax: delayMaxElement ? delayMaxElement.value : '',
          unitDelayMin: unitDelayMinElement ? unitDelayMinElement.value : '',
          unitDelayMax: unitDelayMaxElement ? unitDelayMaxElement.value : '',
          complianceMode: complianceElement ? Boolean(complianceElement.checked) : true,
          riskProfile: profileElement ? profileElement.value : 'medium',
          sendFilesFirst: filesFirstElement ? Boolean(filesFirstElement.checked) : true,
          sendOrderMode
        }];
      })
    );
  }

  applySecurityPreferences(securityPreferences = {}) {
    Object.entries(this.modeConfig).forEach(([mode, config]) => {
      const savedModePreferences = securityPreferences[mode] || {};
      const delayMinElement = document.getElementById(config.delayMinId);
      const delayMaxElement = document.getElementById(config.delayMaxId);
      const unitDelayMinElement = document.getElementById(config.unitDelayMinId);
      const unitDelayMaxElement = document.getElementById(config.unitDelayMaxId);
      const complianceElement = document.getElementById(config.complianceModeId);
      const profileElement = document.getElementById(config.riskProfileId);
      const filesFirstElement = document.getElementById(config.sendFilesFirstId);
      const textFirstElement = document.getElementById(config.sendTextFirstId);
      const messageSplitElement = document.getElementById(config.sendMessageSplitId);

      if (profileElement && typeof savedModePreferences.riskProfile === 'string') {
        profileElement.value = savedModePreferences.riskProfile;
      }

      if (delayMinElement) {
        const savedDelayMin = Number(savedModePreferences.delayMin);
        if (Number.isFinite(savedDelayMin) && savedDelayMin >= 2 && savedDelayMin <= 24) {
          delayMinElement.value = String(savedDelayMin);
        }
      }

      this.updateDelayOptions(mode);

      if (delayMaxElement) {
        const currentMin = Number(delayMinElement ? delayMinElement.value : 2);
        const savedDelayMax = Number(savedModePreferences.delayMax);
        const normalizedDelayMax = Number.isFinite(savedDelayMax) && savedDelayMax > currentMin
          ? Math.min(25, savedDelayMax)
          : Math.min(25, currentMin + 1);

        delayMaxElement.value = String(normalizedDelayMax);
      }

      if (unitDelayMinElement) {
        const savedUnitDelayMin = Number(savedModePreferences.unitDelayMin);
        if (Number.isFinite(savedUnitDelayMin) && savedUnitDelayMin >= 0 && savedUnitDelayMin <= 30) {
          unitDelayMinElement.value = String(savedUnitDelayMin);
        }
      }

      if (unitDelayMaxElement) {
        const currentUnitMin = Number(unitDelayMinElement ? unitDelayMinElement.value : 0);
        const savedUnitDelayMax = Number(savedModePreferences.unitDelayMax);
        const normalizedUnitDelayMax = Number.isFinite(savedUnitDelayMax) && savedUnitDelayMax >= currentUnitMin
          ? Math.min(30, savedUnitDelayMax)
          : Math.min(30, Math.max(currentUnitMin + 2, 3));

        unitDelayMaxElement.value = String(normalizedUnitDelayMax);
      }

      if (complianceElement) {
        complianceElement.checked = typeof savedModePreferences.complianceMode === 'boolean'
          ? savedModePreferences.complianceMode
          : true;
      }

      if (filesFirstElement && textFirstElement) {
        const safeMode = mode === 'groups' ? 'groups' : 'contacts';
        const composer = this.getMessageComposerState(safeMode);
        const hasManyMessages = Array.isArray(composer.enabledIndices) && composer.enabledIndices.length > 1;
        const savedOrderMode = String(savedModePreferences.sendOrderMode || '').trim();

        if (savedOrderMode === 'message-split' && messageSplitElement && hasManyMessages) {
          messageSplitElement.checked = true;
          filesFirstElement.checked = false;
          textFirstElement.checked = false;
        } else if (savedOrderMode === 'text-first') {
          textFirstElement.checked = true;
          filesFirstElement.checked = false;
          if (messageSplitElement) {
            messageSplitElement.checked = false;
          }
        } else {
          const filesFirst = typeof savedModePreferences.sendFilesFirst === 'boolean'
            ? savedModePreferences.sendFilesFirst
            : true;

          filesFirstElement.checked = filesFirst;
          textFirstElement.checked = !filesFirst;
          if (messageSplitElement) {
            messageSplitElement.checked = false;
          }
        }
      }

      this.updateMessageSplitOptionVisibility(mode);
    });
  }

  loadSavedData() {
    const data = this.storage.load();

    const contactsMessages = data.messagesByMode && Array.isArray(data.messagesByMode.contacts)
      ? data.messagesByMode.contacts
      : [data.mensaje || '', '', ''];
    const groupsMessages = data.messagesByMode && Array.isArray(data.messagesByMode.groups)
      ? data.messagesByMode.groups
      : [data.mensajeGrupo || '', '', ''];

    this.getMessageElements('contacts').forEach((element, idx) => {
      element.value = String(contactsMessages[idx] || '');
    });

    this.getMessageElements('groups').forEach((element, idx) => {
      element.value = String(groupsMessages[idx] || '');
    });

    if (data.messageComposer && typeof data.messageComposer === 'object') {
      const contactsComposer = data.messageComposer.contacts && typeof data.messageComposer.contacts === 'object'
        ? data.messageComposer.contacts
        : {};
      const groupsComposer = data.messageComposer.groups && typeof data.messageComposer.groups === 'object'
        ? data.messageComposer.groups
        : {};

      this.messageComposer.contacts.activeIndex = [1, 2, 3].includes(Number(contactsComposer.activeIndex))
        ? Number(contactsComposer.activeIndex)
        : 1;
      this.messageComposer.groups.activeIndex = [1, 2, 3].includes(Number(groupsComposer.activeIndex))
        ? Number(groupsComposer.activeIndex)
        : 1;

      const normalizeEnabledIndices = (value) => {
        const normalized = Array.isArray(value)
          ? value.map((item) => Number(item)).filter((item) => [1, 2, 3].includes(item))
          : [];

        if (!normalized.includes(1)) {
          normalized.push(1);
        }

        return Array.from(new Set(normalized)).sort((a, b) => a - b);
      };

      this.messageComposer.contacts.enabledIndices = normalizeEnabledIndices(contactsComposer.enabledIndices);
      this.messageComposer.groups.enabledIndices = normalizeEnabledIndices(groupsComposer.enabledIndices);

      this.messageComposer.contacts.customVariables = Array.isArray(contactsComposer.customVariables)
        ? contactsComposer.customVariables
        : [];
      this.messageComposer.groups.customVariables = Array.isArray(groupsComposer.customVariables)
        ? groupsComposer.customVariables
        : [];

      this.messageComposer.contacts.randomTagsRaw = String(contactsComposer.randomTagsRaw || '');
      this.messageComposer.groups.randomTagsRaw = String(groupsComposer.randomTagsRaw || '');
    }

    const randomTagsContacts = document.getElementById('randomTagsContacts');
    if (randomTagsContacts) {
      randomTagsContacts.value = this.messageComposer.contacts.randomTagsRaw;
    }

    const randomTagsGroups = document.getElementById('randomTagsGroups');
    if (randomTagsGroups) {
      randomTagsGroups.value = this.messageComposer.groups.randomTagsRaw;
    }

    this.renderCustomVariables('contacts');
    this.renderCustomVariables('groups');
    this.setActiveMessageTab('contacts', this.messageComposer.contacts.activeIndex);
    this.setActiveMessageTab('groups', this.messageComposer.groups.activeIndex);

    this.lastInteractionById = data.lastInteractionById && typeof data.lastInteractionById === 'object'
      ? data.lastInteractionById
      : {};

    this.lastInteractionByNumber = data.lastInteractionByNumber && typeof data.lastInteractionByNumber === 'object'
      ? data.lastInteractionByNumber
      : {};

    if (data.statsFilter && typeof data.statsFilter === 'object') {
      const rawPreset = String(data.statsFilter.preset || 'last-30');
      const allowedPresets = new Set(['today', 'last-7', 'last-30', 'custom']);
      const normalizedPreset = allowedPresets.has(rawPreset) ? rawPreset : 'last-30';
      const safeCustomFrom = String(data.statsFilter.customFrom || '');
      const safeCustomTo = String(data.statsFilter.customTo || '');

      const useCustom = normalizedPreset === 'custom' && safeCustomFrom && safeCustomTo;

      this.statsFilter = {
        preset: useCustom ? 'custom' : (normalizedPreset === 'custom' ? 'last-30' : normalizedPreset),
        customFrom: useCustom ? safeCustomFrom : '',
        customTo: useCustom ? safeCustomTo : ''
      };
    }

    this.applySecurityPreferences(data.securityPreferences);
    this.ui.setHistoryCustomRangeVisible(this.statsFilter.preset === 'custom');

    if (this.ui.historyStartDate && this.statsFilter.customFrom) {
      this.ui.historyStartDate.value = this.statsFilter.customFrom;
    }

    if (this.ui.historyEndDate && this.statsFilter.customTo) {
      this.ui.historyEndDate.value = this.statsFilter.customTo;
    }

    const rangeSelect = document.getElementById('historyRangeDays');
    if (rangeSelect) {
      rangeSelect.value = this.statsFilter.preset;
    }

    this.applyEntitlementsToUi();
  }
}

module.exports = AppController;