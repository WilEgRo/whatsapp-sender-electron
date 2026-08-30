/**
 * WhatsApp Sender Electron - Campaign Feature
 * Helper: Form Persistence Manager
 * 
 * Gestiona el guardado y recuperación de configuración de formularios,
 * preferencias de seguridad y composiciones de mensajes.
 */

function getSecurityPreferences(modeConfig = {}) {
  return Object.fromEntries(
    Object.entries(modeConfig).map(([mode, config]) => {
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

function applySecurityPreferences(modeConfig = {}, securityPreferences = {}, onUpdateDelay) {
  Object.entries(modeConfig).forEach(([mode, config]) => {
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

    if (typeof onUpdateDelay === 'function') {
      onUpdateDelay(mode);
    }

    if (delayMaxElement) {
      const savedDelayMax = Number(savedModePreferences.delayMax);
      if (Number.isFinite(savedDelayMax) && savedDelayMax >= 3 && savedDelayMax <= 25) {
        delayMaxElement.value = String(savedDelayMax);
      }
    }

    if (unitDelayMinElement) {
      const savedUnitDelayMin = Number(savedModePreferences.unitDelayMin);
      if (Number.isFinite(savedUnitDelayMin) && savedUnitDelayMin >= 0 && savedUnitDelayMin <= 10) {
        unitDelayMinElement.value = String(savedUnitDelayMin);
      }
    }

    if (unitDelayMaxElement) {
      const savedUnitDelayMax = Number(savedModePreferences.unitDelayMax);
      if (Number.isFinite(savedUnitDelayMax) && savedUnitDelayMax >= 1 && savedUnitDelayMax <= 15) {
        unitDelayMaxElement.value = String(savedUnitDelayMax);
      }
    }

    if (complianceElement && typeof savedModePreferences.complianceMode === 'boolean') {
      complianceElement.checked = savedModePreferences.complianceMode;
    }

    const savedSendOrderMode = savedModePreferences.sendOrderMode;
    if (savedSendOrderMode === 'message-split' && messageSplitElement) {
      messageSplitElement.checked = true;
    } else if (savedSendOrderMode === 'text-first' && textFirstElement) {
      textFirstElement.checked = true;
    } else if (filesFirstElement) {
      filesFirstElement.checked = true;
    } else if (typeof savedModePreferences.sendFilesFirst === 'boolean') {
      if (savedModePreferences.sendFilesFirst) {
        if (filesFirstElement) filesFirstElement.checked = true;
      } else {
        if (textFirstElement) textFirstElement.checked = true;
      }
    }
  });
}

function saveFormData(storage, controller) {
  if (!storage || typeof storage.save !== 'function') return;

  const contactsMessages = controller.getMessageElements('contacts').map((element) => String(element.value || ''));
  const groupsMessages = controller.getMessageElements('groups').map((element) => String(element.value || ''));

  storage.save({
    mensaje: contactsMessages[0] || '',
    mensajeGrupo: groupsMessages[0] || '',
    messagesByMode: {
      contacts: contactsMessages,
      groups: groupsMessages
    },
    messageComposer: controller.messageComposer,
    securityPreferences: getSecurityPreferences(controller.modeConfig),
    lastInteractionById: controller.lastInteractionById,
    lastInteractionByNumber: controller.lastInteractionByNumber,
    statsFilter: controller.statsFilter
  });
}

function loadSavedData(storage, controller) {
  if (!storage || typeof storage.load !== 'function') return;

  const data = storage.load();

  const contactsMessages = data.messagesByMode && Array.isArray(data.messagesByMode.contacts)
    ? data.messagesByMode.contacts
    : [data.mensaje || '', '', ''];
  const groupsMessages = data.messagesByMode && Array.isArray(data.messagesByMode.groups)
    ? data.messagesByMode.groups
    : [data.mensajeGrupo || '', '', ''];

  controller.getMessageElements('contacts').forEach((element, idx) => {
    element.value = String(contactsMessages[idx] || '');
  });

  controller.getMessageElements('groups').forEach((element, idx) => {
    element.value = String(groupsMessages[idx] || '');
  });

  if (data.messageComposer && typeof data.messageComposer === 'object') {
    const contactsComposer = data.messageComposer.contacts && typeof data.messageComposer.contacts === 'object'
      ? data.messageComposer.contacts
      : {};
    const groupsComposer = data.messageComposer.groups && typeof data.messageComposer.groups === 'object'
      ? data.messageComposer.groups
      : {};

    controller.messageComposer.contacts.activeIndex = [1, 2, 3].includes(Number(contactsComposer.activeIndex))
      ? Number(contactsComposer.activeIndex)
      : 1;
    controller.messageComposer.groups.activeIndex = [1, 2, 3].includes(Number(groupsComposer.activeIndex))
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

    controller.messageComposer.contacts.enabledIndices = normalizeEnabledIndices(contactsComposer.enabledIndices);
    controller.messageComposer.groups.enabledIndices = normalizeEnabledIndices(groupsComposer.enabledIndices);

    controller.messageComposer.contacts.customVariables = Array.isArray(contactsComposer.customVariables)
      ? contactsComposer.customVariables
      : [];
    controller.messageComposer.groups.customVariables = Array.isArray(groupsComposer.customVariables)
      ? groupsComposer.customVariables
      : [];

    controller.messageComposer.contacts.randomTagsRaw = String(contactsComposer.randomTagsRaw || '');
    controller.messageComposer.groups.randomTagsRaw = String(groupsComposer.randomTagsRaw || '');
  }

  const randomTagsContacts = document.getElementById('randomTagsContacts');
  if (randomTagsContacts) {
    randomTagsContacts.value = controller.messageComposer.contacts.randomTagsRaw;
  }

  const randomTagsGroups = document.getElementById('randomTagsGroups');
  if (randomTagsGroups) {
    randomTagsGroups.value = controller.messageComposer.groups.randomTagsRaw;
  }

  controller.renderCustomVariables('contacts');
  controller.renderCustomVariables('groups');
  controller.setActiveMessageTab('contacts', controller.messageComposer.contacts.activeIndex);
  controller.setActiveMessageTab('groups', controller.messageComposer.groups.activeIndex);

  controller.lastInteractionById = data.lastInteractionById && typeof data.lastInteractionById === 'object'
    ? data.lastInteractionById
    : {};

  controller.lastInteractionByNumber = data.lastInteractionByNumber && typeof data.lastInteractionByNumber === 'object'
    ? data.lastInteractionByNumber
    : {};

  if (data.statsFilter && typeof data.statsFilter === 'object') {
    const rawPreset = String(data.statsFilter.preset || 'last-30');
    const allowedPresets = new Set(['today', 'last-7', 'last-30', 'custom']);
    const normalizedPreset = allowedPresets.has(rawPreset) ? rawPreset : 'last-30';
    const safeCustomFrom = String(data.statsFilter.customFrom || '');
    const safeCustomTo = String(data.statsFilter.customTo || '');

    const useCustom = normalizedPreset === 'custom' && safeCustomFrom && safeCustomTo;

    controller.statsFilter = {
      preset: useCustom ? 'custom' : (normalizedPreset === 'custom' ? 'last-30' : normalizedPreset),
      customFrom: useCustom ? safeCustomFrom : '',
      customTo: useCustom ? safeCustomTo : ''
    };
  }

  applySecurityPreferences(controller.modeConfig, data.securityPreferences, (mode) => {
    controller.updateDelayOptions(mode);
  });

  if (controller.ui) {
    controller.ui.setHistoryCustomRangeVisible(controller.statsFilter.preset === 'custom');

    if (controller.ui.historyStartDate && controller.statsFilter.customFrom) {
      controller.ui.historyStartDate.value = controller.statsFilter.customFrom;
    }

    if (controller.ui.historyEndDate && controller.statsFilter.customTo) {
      controller.ui.historyEndDate.value = controller.statsFilter.customTo;
    }
  }

  const rangeSelect = document.getElementById('historyRangeDays');
  if (rangeSelect) {
    rangeSelect.value = controller.statsFilter.preset;
  }

  controller.applyEntitlementsToUi();
}

module.exports = {
  getSecurityPreferences,
  applySecurityPreferences,
  saveFormData,
  loadSavedData
};
