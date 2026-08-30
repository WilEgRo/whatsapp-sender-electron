/**
 * WhatsApp Sender Electron - Messaging Feature
 * Orchestrator: Sending Orchestrator (Slim Controller)
 * 
 * Orquestador delgado para el envío de mensajes y coordinación de pre-vuelo.
 * Delega en:
 * - Domain: risk-policy.js, campaign-validator.js
 * - Application: prepare-campaign.js
 * - Infrastructure: messaging-ipc-gateway.js
 * - Presentation: sending-risk-view.js
 */

const {
  SAFE_PRESETS,
  evaluateRisk
} = require('../../../../features/messaging/domain/risk-policy');

const {
  validateCampaign
} = require('../../../../features/messaging/domain/campaign-validator');

const {
  prepareCampaignPayload
} = require('../../../../features/messaging/application/prepare-campaign');

const {
  MessagingIpcGateway
} = require('../../../../features/messaging/infrastructure/messaging-ipc-gateway');

const {
  renderRiskPanel,
  renderDelayOptions,
  applySafeConfigurationInputs,
  bindRiskControlsView,
  showForceSendConfirmation,
  showDailyResendConfirmation
} = require('../../../../features/messaging/presentation/sending-risk-view');

function getComplianceMode(config) {
  const complianceCheckbox = document.getElementById(config.complianceModeId);
  return complianceCheckbox ? Boolean(complianceCheckbox.checked) : true;
}

function getProfile(config) {
  const profileSelect = document.getElementById(config.riskProfileId);
  return (profileSelect && profileSelect.value) || 'medium';
}

function getTargetCount(controller, mode) {
  if (mode === 'contacts') {
    return Array.isArray(controller.selectedContacts) ? controller.selectedContacts.length : 0;
  }
  if (mode === 'groups') {
    return controller.ui && typeof controller.ui.getSelectedGroupIds === 'function'
      ? controller.ui.getSelectedGroupIds().length
      : 0;
  }
  return 0;
}

async function selectFiles(controller, mode) {
  const config = controller.modeConfig[mode];
  const gateway = new MessagingIpcGateway(controller.ipcClient);

  try {
    const selected = await gateway.selectFiles();
    const normalized = Array.isArray(selected) ? selected.slice(0, config.maxFiles) : [];

    controller.filesByMode[mode] = normalized;
    controller.ui.renderFiles(mode, normalized);
    refreshRiskPanel(controller, mode);
  } catch (error) {
    console.error('Error seleccionando archivos:', error);
    controller.ui.showToast('No se pudieron seleccionar archivos', 'error');
  }
}

function refreshRiskPanel(controller, mode) {
  const config = controller.modeConfig[mode];
  if (!config || !config.riskIndicatorId) return;

  const delayMin = Number(document.getElementById(config.delayMinId)?.value || 2);
  const delayMax = Number(document.getElementById(config.delayMaxId)?.value || 8);
  const unitDelayMin = Number(document.getElementById(config.unitDelayMinId)?.value || 0);
  const unitDelayMax = Number(document.getElementById(config.unitDelayMaxId)?.value || 0);
  const complianceMode = getComplianceMode(config);
  const profile = getProfile(config);
  const targetCount = getTargetCount(controller, mode);
  const hasFiles = Boolean(controller.filesByMode[mode] && controller.filesByMode[mode].length > 0);
  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;

  const alreadySentCount = typeof controller.getAlreadySentSelectedTargetsCount === 'function'
    ? controller.getAlreadySentSelectedTargetsCount(mode)
    : 0;

  const result = evaluateRisk({
    targetCount,
    delayMin,
    delayMax,
    unitDelayMin,
    unitDelayMax,
    complianceMode,
    hasFiles,
    profile,
    alreadySentCount
  });

  renderRiskPanel({
    config,
    result,
    preset,
    targetCount,
    isGroups: mode === 'groups',
    alreadySentCount,
    delayMin,
    delayMax,
    complianceMode
  });

  controller.campaignRiskByMode[mode] = {
    level: result.level.level,
    text: result.level.text,
    score: result.score,
    profile,
    suggestion: result.suggestion,
    reason: result.reason
  };

  if (controller.campaignDispatcher && typeof controller.campaignDispatcher.refreshInspection === 'function') {
    controller.campaignDispatcher.refreshInspection();
  }
}

function applySafeConfiguration(controller, mode) {
  const config = controller.modeConfig[mode];
  const profile = getProfile(config);
  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;

  applySafeConfigurationInputs(config, preset, () => updateDelayOptions(controller, mode));
  refreshRiskPanel(controller, mode);
  controller.saveFormData();
  controller.ui.showToast(`Configuracion segura aplicada para perfil ${profile}.`, 'success');
}

function bindRiskControls(controller, mode) {
  const config = controller.modeConfig[mode];

  bindRiskControlsView({
    config,
    onProfileChange: () => refreshRiskPanel(controller, mode),
    onComplianceChange: () => refreshRiskPanel(controller, mode),
    onApplySafeConfig: () => applySafeConfiguration(controller, mode),
    onForceSend: async () => {
      const totalCount = getTargetCount(controller, mode);
      const alreadySent = typeof controller.getAlreadySentSelectedTargetsCount === 'function'
        ? controller.getAlreadySentSelectedTargetsCount(mode)
        : 0;

      const confirmed = await showForceSendConfirmation(controller.ui, { totalCount, alreadySentCount: alreadySent });
      if (confirmed) {
        await sendBatch(controller, mode, { force: true });
      }
    },
    onClearSent: () => {
      if (typeof controller.removeAlreadySentTargets !== 'function') return;
      const removed = controller.removeAlreadySentTargets(mode);
      if (removed > 0) {
        controller.ui.showToast(`Se quitaron ${removed} destinatarios ya usados hoy.`, 'success');
      } else {
        controller.ui.showToast('No hay destinatarios repetidos para quitar.', 'warning');
      }
    }
  });

  refreshRiskPanel(controller, mode);
}

function updateDelayOptions(controller, mode) {
  const config = controller.modeConfig[mode];
  const minSelect = document.getElementById(config.delayMinId);
  const maxSelect = document.getElementById(config.delayMaxId);
  if (!minSelect || !maxSelect) return;

  renderDelayOptions(config, Number(minSelect.value), Number(maxSelect.value));
  refreshRiskPanel(controller, mode);
}

function buildPayload(controller, mode) {
  const config = controller.modeConfig[mode];
  const delayMin = Number(document.getElementById(config.delayMinId)?.value || 2);
  const delayMax = Number(document.getElementById(config.delayMaxId)?.value || 8);
  const unitDelayMin = Number(document.getElementById(config.unitDelayMinId)?.value || 0);
  const unitDelayMax = Number(document.getElementById(config.unitDelayMaxId)?.value || 0);
  const complianceMode = getComplianceMode(config);
  const riskProfile = getProfile(config);

  const filesFirstInput = document.getElementById(config.sendFilesFirstId);
  const textFirstInput = document.getElementById(config.sendTextFirstId);
  const messageSplitInput = document.getElementById(config.sendMessageSplitId);

  let sendOrderMode = 'files-first';
  if (messageSplitInput && messageSplitInput.checked) {
    sendOrderMode = 'message-split';
  } else if (textFirstInput && textFirstInput.checked) {
    sendOrderMode = 'text-first';
  }
  const sendFilesFirst = filesFirstInput ? Boolean(filesFirstInput.checked) : true;

  const messagePayload = typeof controller.getMessagePayload === 'function'
    ? controller.getMessagePayload(mode)
    : {
      messagePrimary: String(document.getElementById(config.messageFieldId)?.value || '').trim(),
      messageList: [String(document.getElementById(config.messageFieldId)?.value || '').trim()].filter(Boolean),
      customVariables: {},
      randomTags: []
    };

  return prepareCampaignPayload({
    mode,
    delayMin,
    delayMax,
    unitDelayMin,
    unitDelayMax,
    complianceMode,
    riskProfile,
    sendFilesFirst,
    sendOrderMode,
    messagePayload,
    files: controller.filesByMode[mode] || [],
    selectedContacts: controller.selectedContacts || [],
    selectedGroupIds: controller.ui ? controller.ui.getSelectedGroupIds() : []
  });
}

function validatePayload(controller, mode, payload) {
  const validation = validateCampaign({
    mode,
    payload,
    authState: controller.authState,
    hasBulkSendFeature: typeof controller.hasFeature === 'function' ? controller.hasFeature('bulk_send') : true,
    isWhatsAppReady: Boolean(controller.isReady),
    selectedContacts: controller.selectedContacts || []
  });

  if (!validation.valid && validation.errors.length > 0) {
    const firstError = validation.errors[0];
    const toastTone = firstError.code === 'FEATURE_NOT_INCLUDED' ? 'warning' : 'error';
    controller.ui.showToast(firstError.message, toastTone);
    return false;
  }

  return true;
}

async function sendBatch(controller, mode, options = {}) {
  const config = controller.modeConfig[mode];
  const payload = buildPayload(controller, mode);
  const currentRisk = controller.campaignRiskByMode[mode] || null;

  if (!validatePayload(controller, mode, payload)) return;

  if (currentRisk && currentRisk.level === 'red' && !options.force) {
    controller.ui.showToast('Envio bloqueado preventivamente por riesgo alto. Usa "Forzar envio" si decides continuar.', 'warning');
    return;
  }

  if (typeof controller.getAlreadySentSelectedTargetsCount === 'function') {
    const alreadySentCount = controller.getAlreadySentSelectedTargetsCount(mode);
    if (alreadySentCount > 0) {
      const totalCount = getTargetCount(controller, mode);
      const targetTypeName = mode === 'groups' ? 'grupos' : 'contactos';

      const confirmed = await showDailyResendConfirmation(controller.ui, {
        totalCount,
        alreadySentCount,
        targetTypeName
      });

      if (!confirmed) return;
    }
  }

  controller.activeSendMode = mode;
  controller.ui.showProgress(config.progressLabel);
  const gateway = new MessagingIpcGateway(controller.ipcClient);

  try {
    const response = await gateway.sendBatchMessage(payload);

    if (!response || !response.success) {
      controller.ui.hideProgress();
      controller.ui.showToast(`Error de envio: ${(response && response.error) || 'error desconocido'}`, 'error');
      controller.activeSendMode = null;
      return;
    }

    const results = Array.isArray(response.result) ? response.result : [];
    const success = results.filter((item) => item.status === 'success').length;
    const successfulTargets = results
      .filter((item) => item.status === 'success')
      .map((item) => (mode === 'groups' ? item.groupId : (item.number || item.label)))
      .filter(Boolean);

    if (successfulTargets.length > 0 && typeof controller.markTargetsAsRecentlyMessaged === 'function') {
      controller.markTargetsAsRecentlyMessaged(mode, successfulTargets);
    }

    if (response.cancelled) {
      controller.ui.showToast(`Envío cancelado por el usuario. Mensajes enviados antes de la cancelación: ${success}.`, 'warning');
    } else {
      const total = results.length;
      const failed = total - success;
      controller.ui.showToast(`${success}/${total} ${config.successLabel}. Fallidos: ${failed}.`, failed > 0 ? 'warning' : 'success');
    }

    refreshRiskPanel(controller, mode);
    if (typeof controller.refreshDestinationStatuses === 'function') {
      controller.refreshDestinationStatuses(mode, { repaint: true });
    }
    if (typeof controller.refreshMessageStats === 'function') {
      controller.refreshMessageStats({ silent: true });
    }
  } catch (error) {
    controller.ui.hideProgress();
    console.error('Error enviando lote:', error);
    controller.ui.showToast('Error inesperado durante el envio', 'error');
  } finally {
    setTimeout(() => {
      controller.activeSendMode = null;
    }, 2400);
  }
}

module.exports = {
  selectFiles,
  updateDelayOptions,
  sendBatch,
  bindRiskControls,
  refreshRiskPanel,
  // Exportaciones de compatibilidad
  SAFE_PRESETS,
  evaluateRisk,
  buildPayload,
  validatePayload
};
