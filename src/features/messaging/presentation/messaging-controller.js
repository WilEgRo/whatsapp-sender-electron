/**
 * WhatsApp Sender Electron - Messaging Feature
 * Presentation: Messaging Controller
 * 
 * Coordinador de presentación para composición de mensajes, gestión de adjuntos,
 * previsualización de riesgo y despacho de campañas.
 */

const {
  MessagingIpcGateway
} = require('../infrastructure/messaging-ipc-gateway');

const {
  getMessageElements,
  applyActiveMessageTab,
  applyMessageSplitOptionVisibility,
  insertTokenInTextarea,
  renderCustomVariablesList
} = require('./message-composer-view');

const {
  renderRiskPanel,
  renderDelayOptions,
  applySafeConfigurationInputs,
  bindRiskControlsView,
  showForceSendConfirmation,
  showDailyResendConfirmation
} = require('./sending-risk-view');

const {
  evaluateRisk
} = require('../domain/risk-policy');

const {
  validateCampaign
} = require('../domain/campaign-validator');

const {
  prepareCampaignPayload,
  buildContactContexts
} = require('../application/prepare-campaign');

class MessagingController {
  /**
   * @param {Object} options
   * @param {Object} [options.stateRef] - Referencia a AppController para compatibilidad
   * @param {Object} [options.ui]
   * @param {Object} [options.ipcClient]
   * @param {Object} [options.modeConfig]
   */
  constructor(options = {}) {
    this.stateRef = options.stateRef || null;
    this.ui = options.ui || null;
    this.ipcClient = options.ipcClient || null;
    this.modeConfig = options.modeConfig || (this.stateRef && this.stateRef.modeConfig) || {};
    this.gateway = new MessagingIpcGateway(this.ipcClient);

    this._filesByMode = {
      contacts: [],
      groups: []
    };

    this._messageComposer = {
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
  }

  get filesByMode() {
    if (this.stateRef && this.stateRef.filesByMode) {
      return this.stateRef.filesByMode;
    }
    return this._filesByMode;
  }

  set filesByMode(val) {
    this._filesByMode = val || { contacts: [], groups: [] };
    if (this.stateRef) {
      this.stateRef.filesByMode = this._filesByMode;
    }
  }

  get messageComposer() {
    if (this.stateRef && this.stateRef.messageComposer) {
      return this.stateRef.messageComposer;
    }
    return this._messageComposer;
  }

  _getUi() {
    if (this.ui) return this.ui;
    if (this.stateRef && this.stateRef.ui) {
      this.ui = this.stateRef.ui;
      return this.ui;
    }
    return null;
  }

  _notifySave() {
    if (this.stateRef && typeof this.stateRef.saveFormData === 'function') {
      this.stateRef.saveFormData();
    }
  }

  getMessageElements(mode) {
    return getMessageElements(mode);
  }

  getMessageComposerState(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    return this.messageComposer[safeMode];
  }

  setActiveMessageTab(mode, index) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const safeIndex = [1, 2, 3].includes(Number(index)) ? Number(index) : 1;
    const composer = this.getMessageComposerState(safeMode);
    const enabled = Array.isArray(composer.enabledIndices) ? composer.enabledIndices : [1];
    const nextIndex = enabled.includes(safeIndex) ? safeIndex : (enabled[0] || 1);
    composer.enabledIndices = enabled;
    composer.activeIndex = nextIndex;

    applyActiveMessageTab(safeMode, composer);
    this.updateMessageSplitOptionVisibility(safeMode);
  }

  updateMessageSplitOptionVisibility(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const config = this.modeConfig[safeMode];
    const canUseSplit = Array.isArray(composer.enabledIndices) && composer.enabledIndices.length > 1;

    applyMessageSplitOptionVisibility(safeMode, config, canUseSplit);
  }

  addMessageTab(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const enabled = new Set(Array.isArray(composer.enabledIndices) ? composer.enabledIndices : [1]);
    const next = [1, 2, 3].find((idx) => !enabled.has(idx));
    if (!next) return;

    enabled.add(next);
    composer.enabledIndices = Array.from(enabled).sort((a, b) => a - b);

    this.setActiveMessageTab(safeMode, next);
    this._notifySave();
  }

  closeMessageTab(mode, index) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const safeIndex = Number(index);
    if (![2, 3].includes(safeIndex)) return;

    const composer = this.getMessageComposerState(safeMode);
    const enabled = new Set(Array.isArray(composer.enabledIndices) ? composer.enabledIndices : [1]);
    if (!enabled.has(safeIndex)) return;

    enabled.delete(safeIndex);
    composer.enabledIndices = Array.from(enabled).sort((a, b) => a - b);

    if (!composer.enabledIndices.includes(composer.activeIndex)) {
      composer.activeIndex = composer.enabledIndices[composer.enabledIndices.length - 1] || 1;
    }

    this.setActiveMessageTab(safeMode, composer.activeIndex);
    this._notifySave();
  }

  insertTokenAtCursor(mode, token) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const activeTextarea = document.querySelector(
      `[data-message-pane="${safeMode}"][data-message-index="${composer.activeIndex}"]`
    );

    if (!activeTextarea) return;

    insertTokenInTextarea(activeTextarea, token);
    this._notifySave();
  }

  renderCustomVariables(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const listElement = document.getElementById(
      safeMode === 'groups' ? 'customVarsListGroups' : 'customVarsListContacts'
    );
    renderCustomVariablesList(listElement, safeMode, composer.customVariables);
  }

  addCustomVariable(mode) {
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const composer = this.getMessageComposerState(safeMode);
    const nameInput = document.getElementById(safeMode === 'groups' ? 'customVarNameGroups' : 'customVarNameContacts');
    const valueInput = document.getElementById(safeMode === 'groups' ? 'customVarValueGroups' : 'customVarValueContacts');
    const ui = this._getUi();

    if (!nameInput || !valueInput) return;

    const rawName = String(nameInput.value || '').trim().toLowerCase();
    const rawValue = String(valueInput.value || '').trim();
    const normalizedName = rawName.replace(/[^a-z0-9_]/g, '_');

    if (!normalizedName || !rawValue) {
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('Debes ingresar nombre y valor para crear la variable.', 'warning');
      }
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
    this._notifySave();
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
    this._notifySave();
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
        if (!token) return;
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
        if (button) {
          this.removeCustomVariable(button.dataset.removeCustomVar, button.dataset.customVarIndex);
        }
      });
    }

    const customVarsGroups = document.getElementById('customVarsListGroups');
    if (customVarsGroups) {
      customVarsGroups.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-custom-var]');
        if (button) {
          this.removeCustomVariable(button.dataset.removeCustomVar, button.dataset.customVarIndex);
        }
      });
    }

    const randomTagsContacts = document.getElementById('randomTagsContacts');
    if (randomTagsContacts) {
      randomTagsContacts.addEventListener('input', () => {
        this.messageComposer.contacts.randomTagsRaw = String(randomTagsContacts.value || '');
        this._notifySave();
      });
    }

    const randomTagsGroups = document.getElementById('randomTagsGroups');
    if (randomTagsGroups) {
      randomTagsGroups.addEventListener('input', () => {
        this.messageComposer.groups.randomTagsRaw = String(randomTagsGroups.value || '');
        this._notifySave();
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
      if (key) {
        customVariables[key] = String(item.value || '');
      }
    });

    const randomTags = String(composer.randomTagsRaw || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (safeMode === 'contacts') {
      const selectedContacts = (this.stateRef && this.stateRef.selectedContacts) || [];
      const contactContexts = buildContactContexts(selectedContacts);

      return {
        messageList,
        messagePrimary: messageList[0] || '',
        customVariables,
        randomTags,
        contactContexts
      };
    }

    const groups = (this.stateRef && this.stateRef.groups) || [];
    const groupContexts = groups.map((group) => ({
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

  getTargetCount(mode) {
    if (mode === 'contacts') {
      return (this.stateRef && Array.isArray(this.stateRef.selectedContacts))
        ? this.stateRef.selectedContacts.length
        : 0;
    }
    if (mode === 'groups') {
      const ui = this._getUi();
      return (ui && typeof ui.getSelectedGroupIds === 'function')
        ? ui.getSelectedGroupIds().length
        : 0;
    }
    return 0;
  }

  refreshRiskPanel(mode) {
    const sendingActions = require('../../../renderer/js/modules/app/sending');
    return sendingActions.refreshRiskPanel(this.stateRef || this, mode);
  }

  updateDelayOptions(mode) {
    const sendingActions = require('../../../renderer/js/modules/app/sending');
    return sendingActions.updateDelayOptions(this.stateRef || this, mode);
  }

  async selectFiles(mode) {
    const ui = this._getUi();
    try {
      const result = await this.gateway.selectFiles();
      const rawFiles = Array.isArray(result)
        ? result
        : (result && Array.isArray(result.files) ? result.files : []);
      if (!rawFiles || rawFiles.length === 0) return;

      const config = (this.modeConfig && this.modeConfig[mode]) || {};
      const maxFiles = Number.isFinite(config.maxFiles) ? config.maxFiles : 5;

      const currentFiles = Array.isArray(this.filesByMode[mode]) ? this.filesByMode[mode] : [];
      const newFiles = rawFiles.filter(
        (f) => f && f.path && !currentFiles.some((cf) => cf.path === f.path)
      );

      const merged = [...currentFiles, ...newFiles].slice(0, maxFiles);

      this.filesByMode[mode] = merged;
      if (this.stateRef && this.stateRef.filesByMode) {
        this.stateRef.filesByMode[mode] = merged;
      }

      if (ui && typeof ui.renderFiles === 'function') {
        ui.renderFiles(mode, merged);
      }

      this.refreshRiskPanel(mode);
      this._notifySave();
    } catch (error) {
      console.error(`[Messaging] Error seleccionando archivos (${mode}):`, error);
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('No se pudieron seleccionar los archivos.', 'error');
      }
    }
  }

  async sendBatch(mode, options = {}) {
    const sendingActions = require('../../../renderer/js/modules/app/sending');
    return sendingActions.sendBatch(this.stateRef || this, mode, options);
  }
}

module.exports = {
  MessagingController
};
