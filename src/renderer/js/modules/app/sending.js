async function selectFiles(controller, mode) {
  const config = controller.modeConfig[mode];

  try {
    const selected = await controller.ipcClient.invoke('select-files');
    const normalized = Array.isArray(selected) ? selected.slice(0, config.maxFiles) : [];

    controller.filesByMode[mode] = normalized;
    controller.ui.renderFiles(mode, normalized);
    refreshRiskPanel(controller, mode);
  } catch (error) {
    console.error('Error seleccionando archivos:', error);
    controller.ui.showToast('No se pudieron seleccionar archivos', 'error');
  }
}

const SAFE_PRESETS = {
  new: {
    maxBatch: 18,
    delayMin: 16,
    delayMax: 24,
    unitDelayMin: 2,
    unitDelayMax: 4,
    cooldownEvery: 5,
    cooldownMinSeconds: 60,
    cooldownMaxSeconds: 95,
    recommendation: 'Cuenta nueva: usa volumen bajo y pausas largas.'
  },
  medium: {
    maxBatch: 35,
    delayMin: 12,
    delayMax: 22,
    unitDelayMin: 1,
    unitDelayMax: 3,
    cooldownEvery: 8,
    cooldownMinSeconds: 45,
    cooldownMaxSeconds: 75,
    recommendation: 'Cuenta media: volumen moderado con pausas constantes.'
  },
  mature: {
    maxBatch: 60,
    delayMin: 10,
    delayMax: 20,
    unitDelayMin: 1,
    unitDelayMax: 2,
    cooldownEvery: 12,
    cooldownMinSeconds: 30,
    cooldownMaxSeconds: 55,
    recommendation: 'Cuenta madura: aun evita picos y conserva pausas.'
  }
};

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
    return controller.selectedContacts.length;
  }

  if (mode === 'groups') {
    return controller.ui.getSelectedGroupIds().length;
  }

  return 0;
}

function applyRiskVisual(config, level, text) {
  const indicator = document.getElementById(config.riskIndicatorId);
  if (!indicator) {
    return;
  }

  indicator.textContent = text;
  indicator.classList.remove('risk-indicator--green', 'risk-indicator--yellow', 'risk-indicator--red');
  indicator.classList.add(`risk-indicator--${level}`);
}

function updateSendAvailability(config, level) {
  const sendButton = document.getElementById(config.sendButtonId);
  const forceButton = document.getElementById(config.forceSendButtonId);

  if (sendButton) {
    sendButton.disabled = level === 'red';
    sendButton.title = level === 'red' ? 'Bloqueado preventivamente por riesgo alto' : '';
  }

  if (forceButton) {
    forceButton.classList.toggle('hidden', level !== 'red');
  }
}

function getRiskLevel(score) {
  if (score >= 70) {
    return { level: 'red', text: 'ROJO' };
  }

  if (score >= 40) {
    return { level: 'yellow', text: 'AMARILLO' };
  }

  return { level: 'green', text: 'VERDE' };
}

function setRiskPanelText(config, { reason, suggestion, score }) {
  const reasonElement = document.getElementById(config.riskReasonId);
  const suggestionElement = document.getElementById(config.riskSuggestionId);
  const scoreElement = document.getElementById(config.riskScoreId);

  if (reasonElement) {
    reasonElement.textContent = reason;
  }

  if (suggestionElement) {
    suggestionElement.textContent = suggestion;
  }

  if (scoreElement) {
    scoreElement.textContent = `Puntaje de riesgo: ${score}/100`;
  }
}

function updateTargetCounter(controller, mode, profile, targetCount) {
  const config = controller.modeConfig[mode];
  const counterElement = document.getElementById(config.targetCounterId);
  if (!counterElement) {
    return;
  }

  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;
  const maxBatch = Number(preset.maxBatch || 0);

  counterElement.textContent = `${targetCount} seleccionados / recomendado ${maxBatch} por tanda`;
  counterElement.classList.remove('target-counter--ok', 'target-counter--warn', 'target-counter--over');

  if (targetCount > maxBatch) {
    counterElement.classList.add('target-counter--over');
    return;
  }

  if (targetCount >= Math.floor(maxBatch * 0.8)) {
    counterElement.classList.add('target-counter--warn');
    return;
  }

  counterElement.classList.add('target-counter--ok');
}

function evaluateRisk({ targetCount, delayMin, delayMax, unitDelayMin, unitDelayMax, complianceMode, hasFiles, profile }) {
  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;

  let score = 8;
  const reasons = [];

  if (targetCount > preset.maxBatch) {
    score += 36;
    reasons.push(`Volumen alto para perfil ${profile}.`);
  } else if (targetCount > Math.floor(preset.maxBatch * 0.7)) {
    score += 18;
    reasons.push('Volumen medio-alto.');
  } else {
    reasons.push('Volumen controlado.');
  }

  if (delayMin < preset.delayMin) {
    score += 24;
    reasons.push('Delay minimo bajo.');
  }

  if (delayMax < preset.delayMax - 2) {
    score += 12;
    reasons.push('Delay maximo bajo para este perfil.');
  }

  if (delayMax - delayMin < 2) {
    score += 12;
    reasons.push('Rango de delay muy corto.');
  }

  if (unitDelayMin < preset.unitDelayMin) {
    score += 10;
    reasons.push('Delay entre unidades bajo.');
  }

  if (unitDelayMax < preset.unitDelayMax) {
    score += 6;
    reasons.push('Delay maximo entre unidades bajo para este perfil.');
  }

  if (unitDelayMax - unitDelayMin < 1) {
    score += 6;
    reasons.push('Rango de delay entre unidades muy corto.');
  }

  if (!complianceMode) {
    score += 20;
    reasons.push('Modo cumplimiento desactivado.');
  }

  if (hasFiles && targetCount > Math.floor(preset.maxBatch * 0.6)) {
    score += 8;
    reasons.push('Adjuntos con volumen considerable.');
  }

  const normalizedScore = Math.min(100, Math.max(0, score));
  const level = getRiskLevel(normalizedScore);

  return {
    score: normalizedScore,
    level,
    reason: reasons.join(' '),
    suggestion: `Configuracion sugerida (${profile}): max ${preset.maxBatch} por tanda, delay ${preset.delayMin}-${preset.delayMax}s, delay entre unidades ${preset.unitDelayMin}-${preset.unitDelayMax}s, pausa de seguridad cada ${preset.cooldownEvery} envios por ${preset.cooldownMinSeconds}-${preset.cooldownMaxSeconds}s.`
  };
}

function refreshRiskPanel(controller, mode) {
  const config = controller.modeConfig[mode];
  if (!config || !config.riskIndicatorId) {
    return;
  }

  const delayMin = Number(document.getElementById(config.delayMinId).value || 2);
  const delayMax = Number(document.getElementById(config.delayMaxId).value || 8);
  const unitDelayMin = Number(document.getElementById(config.unitDelayMinId).value || 0);
  const unitDelayMax = Number(document.getElementById(config.unitDelayMaxId).value || 0);
  const complianceMode = getComplianceMode(config);
  const profile = getProfile(config);
  const targetCount = getTargetCount(controller, mode);
  const hasFiles = controller.filesByMode[mode] && controller.filesByMode[mode].length > 0;

  const result = evaluateRisk({
    targetCount,
    delayMin,
    delayMax,
    unitDelayMin,
    unitDelayMax,
    complianceMode,
    hasFiles,
    profile
  });

  applyRiskVisual(config, result.level.level, result.level.text);
  updateSendAvailability(config, result.level.level);
  setRiskPanelText(config, result);
  updateTargetCounter(controller, mode, profile, targetCount);

  if (mode === 'groups') {
    updateGroupPreflightInspector(controller, {
      targetCount,
      delayMin,
      delayMax,
      profile,
      complianceMode,
      result
    });
  }

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

function updateGroupPreflightInspector(controller, { targetCount, delayMin, delayMax, profile, complianceMode, result }) {
  const countEl = document.getElementById('inspectorRecipientsCountGroups');
  if (countEl) {
    countEl.textContent = targetCount === 0 ? '0 grupos' : (targetCount === 1 ? '1 grupo' : `${targetCount} grupos`);
  }

  const durationEl = document.getElementById('inspectorEstimatedDurationGroups');
  if (durationEl) {
    if (targetCount === 0) {
      durationEl.textContent = '0 seg';
    } else {
      const avgDelay = (delayMin + delayMax) / 2;
      const totalSecs = Math.round(targetCount * avgDelay + (complianceMode ? Math.floor(targetCount / 10) * 15 : 0));
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      durationEl.textContent = mins > 0 ? (secs > 0 ? `${mins} min ${secs} s` : `${mins} min`) : `${secs} s`;
    }
  }

  const statusEl = document.getElementById('inspectorSafetyStatusGroups');
  if (statusEl) {
    statusEl.className = 'status-badge';
    if (targetCount === 0) {
      statusEl.classList.add('status-badge--danger');
      statusEl.textContent = '● Audiencia requerida';
    } else if (result.level.level === 'green') {
      statusEl.classList.add('status-badge--success');
      statusEl.textContent = '● Listo para despacho';
    } else if (result.level.level === 'yellow') {
      statusEl.classList.add('status-badge--warning');
      statusEl.textContent = '● Advertencia de seguridad';
    } else {
      statusEl.classList.add('status-badge--danger');
      statusEl.textContent = '● Riesgo alto / Bloqueado';
    }
  }

  const renderCheckItem = (id, valid, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('check-passed', 'check-failed');
    el.classList.add(valid ? 'check-passed' : 'check-failed');
    const labelSpan = el.querySelector('.check-label');
    if (labelSpan) labelSpan.textContent = label;
    const iconSpan = el.querySelector('.check-icon');
    if (iconSpan) iconSpan.textContent = valid ? '✓' : '✕';
  };

  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;
  const alreadySent = typeof controller.getAlreadySentSelectedTargetsCount === 'function'
    ? controller.getAlreadySentSelectedTargetsCount('groups')
    : 0;

  renderCheckItem(
    'checkAudienceGroups',
    targetCount > 0,
    targetCount > 0 ? `${targetCount} grupo(s) seleccionado(s)` : 'Ningún destinatario seleccionado'
  );

  renderCheckItem(
    'checkVolumeGroups',
    result.level.level !== 'red' || targetCount === 0,
    targetCount === 0
      ? 'Volumen dentro del límite seguro'
      : (targetCount > preset.maxBatch ? `Excede el límite seguro (${targetCount}/${preset.maxBatch})` : 'Volumen dentro del límite seguro')
  );

  renderCheckItem(
    'checkDelayGroups',
    delayMin >= preset.delayMin && (delayMax - delayMin) >= 2,
    delayMin >= preset.delayMin ? 'Delay seguro y aleatorio' : 'Delay por debajo del umbral seguro'
  );

  renderCheckItem(
    'checkDuplicatesGroups',
    alreadySent === 0,
    alreadySent === 0 ? 'Sin reenvíos detectados hoy' : `${alreadySent} grupo(s) contactado(s) hoy`
  );

  renderCheckItem(
    'checkComplianceGroups',
    complianceMode,
    complianceMode ? 'Protección anti-bloqueo activa' : 'Protección anti-bloqueo inactiva'
  );

  const sendBtn = document.getElementById('enviarGrupos');
  if (sendBtn) {
    const canSend = targetCount > 0 && result.level.level !== 'red';
    sendBtn.disabled = !canSend;
    sendBtn.title = canSend ? 'Enviar a grupos seleccionados' : (targetCount === 0 ? 'Selecciona al menos un grupo' : 'Bloqueado por riesgo alto');
  }
}

function applySafeConfiguration(controller, mode) {
  const config = controller.modeConfig[mode];
  const profile = getProfile(config);
  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;

  const minSelect = document.getElementById(config.delayMinId);
  const maxSelect = document.getElementById(config.delayMaxId);
  const unitMinInput = document.getElementById(config.unitDelayMinId);
  const unitMaxInput = document.getElementById(config.unitDelayMaxId);
  const complianceCheckbox = document.getElementById(config.complianceModeId);

  if (!minSelect || !maxSelect) {
    return;
  }

  minSelect.value = String(Math.min(24, preset.delayMin));
  updateDelayOptions(controller, mode);

  const safeMax = Math.min(25, Math.max(preset.delayMax, Number(minSelect.value) + 1));
  maxSelect.value = String(safeMax);

  if (unitMinInput) {
    unitMinInput.value = String(Math.min(30, Math.max(0, preset.unitDelayMin)));
  }

  if (unitMaxInput) {
    const unitMin = Number(unitMinInput ? unitMinInput.value : preset.unitDelayMin);
    unitMaxInput.value = String(Math.min(30, Math.max(unitMin, preset.unitDelayMax)));
  }

  if (complianceCheckbox) {
    complianceCheckbox.checked = true;
  }

  refreshRiskPanel(controller, mode);
  controller.saveFormData();
  controller.ui.showToast(`Configuracion segura aplicada para perfil ${profile}.`, 'success');
}

function bindRiskControls(controller, mode) {
  const config = controller.modeConfig[mode];
  const profileSelect = document.getElementById(config.riskProfileId);
  const applyButton = document.getElementById(config.applySafeConfigId);
  const complianceCheckbox = document.getElementById(config.complianceModeId);
  const forceButton = document.getElementById(config.forceSendButtonId);
  const clearSentButton = document.getElementById(config.clearSentTargetsId);

  if (profileSelect) {
    profileSelect.addEventListener('change', () => refreshRiskPanel(controller, mode));
  }

  if (complianceCheckbox) {
    complianceCheckbox.addEventListener('change', () => refreshRiskPanel(controller, mode));
  }

  if (applyButton) {
    applyButton.addEventListener('click', () => applySafeConfiguration(controller, mode));
  }

  if (forceButton) {
    forceButton.addEventListener('click', async () => {
      const totalCount = getTargetCount(controller, mode);
      const alreadySent = typeof controller.getAlreadySentSelectedTargetsCount === 'function'
        ? controller.getAlreadySentSelectedTargetsCount(mode)
        : 0;

      const confirmRes = await controller.ui.showCustomConfirmModal({
        badgeTone: 'danger',
        badgeIcon: '🚨',
        badgeText: 'Riesgo Alto Detectado',
        title: '¿Forzar el envío de esta campaña?',
        subtitle: 'El análisis de riesgo determinó que la configuración actual está en NIVEL ROJO.',
        totalCount,
        alreadySentCount: alreadySent,
        newTodayCount: Math.max(0, totalCount - alreadySent),
        description: 'Forzar el envío con parámetros agresivos aumenta significativamente el riesgo de restricciones o suspensión de tu cuenta de WhatsApp por parte del sistema anti-spam.',
        recommendation: '💡 <strong>Sugerencia:</strong> Te recomendamos presionar <strong>"Cancelar y Corregir"</strong> y utilizar el botón <strong>"Aplicar configuración segura"</strong>.',
        cancelText: '🛑 Cancelar y Corregir',
        acceptText: '⚠️ Forzar Envío Bajo Mi Riesgo'
      });

      if (!confirmRes) {
        return;
      }

      await sendBatch(controller, mode, { force: true });
    });
  }

  if (clearSentButton) {
    clearSentButton.addEventListener('click', () => {
      if (typeof controller.removeAlreadySentTargets !== 'function') {
        return;
      }

      const removed = controller.removeAlreadySentTargets(mode);
      if (removed > 0) {
        controller.ui.showToast(`Se quitaron ${removed} destinatarios ya usados hoy.`, 'success');
      } else {
        controller.ui.showToast('No hay destinatarios repetidos para quitar.', 'warning');
      }
    });
  }

  refreshRiskPanel(controller, mode);
}

function updateDelayOptions(controller, mode) {
  const config = controller.modeConfig[mode];
  const minSelect = document.getElementById(config.delayMinId);
  const maxSelect = document.getElementById(config.delayMaxId);

  const minValue = Number(minSelect.value);
  const currentMax = Number(maxSelect.value);

  maxSelect.innerHTML = '';
  for (let option = minValue + 1; option <= 25; option += 1) {
    const node = document.createElement('option');
    node.value = String(option);
    node.textContent = String(option);
    maxSelect.appendChild(node);
  }

  maxSelect.value = currentMax > minValue ? String(currentMax) : String(minValue + 1);
  refreshRiskPanel(controller, mode);
}

function buildPayload(controller, mode) {
  const config = controller.modeConfig[mode];
  const delayMin = Number(document.getElementById(config.delayMinId).value);
  const delayMax = Number(document.getElementById(config.delayMaxId).value);
  const unitDelayMin = Number(document.getElementById(config.unitDelayMinId).value);
  const unitDelayMax = Number(document.getElementById(config.unitDelayMaxId).value);
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
      messagePrimary: String(document.getElementById(config.messageFieldId).value || '').trim(),
      messageList: [String(document.getElementById(config.messageFieldId).value || '').trim()].filter(Boolean),
      customVariables: {},
      randomTags: []
    };

  const basePayload = {
    targetType: mode,
    message: messagePayload.messagePrimary,
    messageList: Array.isArray(messagePayload.messageList) ? messagePayload.messageList : [],
    customVariables: messagePayload.customVariables || {},
    randomTags: Array.isArray(messagePayload.randomTags) ? messagePayload.randomTags : [],
    files: controller.filesByMode[mode].map((file) => file.path),
    sendFilesFirst,
    sendOrderMode,
    delayMin,
    delayMax,
    unitDelayMin,
    unitDelayMax,
    complianceMode,
    riskProfile
  };

  if (mode === 'contacts') {
    basePayload.numbers = controller.selectedContacts.map((contact) => contact.number).join(',');
    basePayload.contactContexts = controller.selectedContacts.map((contact) => {
      const fullName = String(contact.name || '').trim();
      const parts = fullName.split(/\s+/).filter(Boolean);
      return {
        id: contact.id || `${contact.number}@c.us`,
        number: contact.number,
        numero: contact.number,
        full_name: fullName,
        nombre_completo: fullName,
        name: parts[0] || fullName || contact.number,
        nombre: parts[0] || fullName || contact.number,
        last_name: parts.length > 1 ? parts.slice(1).join(' ') : '',
        apellido: parts.length > 1 ? parts.slice(1).join(' ') : '',
        ...(contact.context || {})
      };
    });
  }

  if (mode === 'groups') {
    basePayload.groupIds = controller.ui.getSelectedGroupIds();
    basePayload.groupContexts = Array.isArray(messagePayload.groupContexts) ? messagePayload.groupContexts : [];
  }

  return basePayload;
}

function validatePayload(controller, mode, payload) {
  if (!controller.authState || !controller.authState.isValidated) {
    controller.ui.showToast('Tu licencia no esta validada. Inicia sesion para continuar.', 'error');
    return false;
  }

  if (typeof controller.hasFeature === 'function' && !controller.hasFeature('bulk_send')) {
    controller.ui.showToast('Tu plan no incluye envio masivo. Actualiza tu suscripcion para continuar.', 'warning');
    return false;
  }

  if (!controller.isReady) {
    controller.ui.showToast('WhatsApp no esta conectado todavia', 'error');
    return false;
  }

  if (mode === 'contacts' && !payload.numbers) {
    controller.ui.showToast('Ingresa al menos un numero', 'error');
    return false;
  }

  if (mode === 'contacts') {
    const invalid = controller.selectedContacts.filter((contact) => {
      const normalized = String(contact.number || '').replace(/[^0-9]/g, '');
      return normalized.length < 8 || normalized.length > 15;
    });

    if (invalid.length > 0) {
      controller.ui.showToast(`Hay ${invalid.length} numeros invalidos. Corrigelos antes de enviar.`, 'error');
      return false;
    }
  }

  if (mode === 'groups' && (!Array.isArray(payload.groupIds) || payload.groupIds.length === 0)) {
    controller.ui.showToast('Selecciona al menos un grupo', 'error');
    return false;
  }

  const hasAnyMessage = Array.isArray(payload.messageList)
    ? payload.messageList.some((item) => String(item || '').trim().length > 0)
    : Boolean(String(payload.message || '').trim());

  if (!hasAnyMessage && payload.files.length === 0) {
    controller.ui.showToast('Escribe un mensaje o agrega archivos', 'error');
    return false;
  }

  if (payload.delayMin > 24) {
    controller.ui.showToast('El delay minimo no puede superar 24 segundos', 'error');
    return false;
  }

  if (payload.delayMax > 25) {
    controller.ui.showToast('El delay maximo no puede superar 25 segundos', 'error');
    return false;
  }

  if (payload.delayMax <= payload.delayMin) {
    controller.ui.showToast('El delay maximo debe ser mayor al minimo', 'error');
    return false;
  }

  if (payload.unitDelayMin < 0 || payload.unitDelayMin > 30) {
    controller.ui.showToast('El delay minimo entre unidades debe estar entre 0 y 30 segundos', 'error');
    return false;
  }

  if (payload.unitDelayMax < 0 || payload.unitDelayMax > 30) {
    controller.ui.showToast('El delay maximo entre unidades debe estar entre 0 y 30 segundos', 'error');
    return false;
  }

  if (payload.unitDelayMax < payload.unitDelayMin) {
    controller.ui.showToast('El delay maximo entre unidades debe ser mayor o igual al minimo', 'error');
    return false;
  }

  return true;
}

async function sendBatch(controller, mode, options = {}) {
  const config = controller.modeConfig[mode];
  const payload = buildPayload(controller, mode);
  const currentRisk = controller.campaignRiskByMode[mode] || null;

  if (!validatePayload(controller, mode, payload)) {
    return;
  }

  if (currentRisk && currentRisk.level === 'red' && !options.force) {
    controller.ui.showToast('Envio bloqueado preventivamente por riesgo alto. Usa "Forzar envio" si decides continuar.', 'warning');
    return;
  }

  if (typeof controller.getAlreadySentSelectedTargetsCount === 'function') {
    const alreadySentCount = controller.getAlreadySentSelectedTargetsCount(mode);
    if (alreadySentCount > 0) {
      const totalCount = getTargetCount(controller, mode);
      const newTodayCount = Math.max(0, totalCount - alreadySentCount);
      const targetTypeName = mode === 'groups' ? 'grupos' : 'contactos';

      const confirmRes = await controller.ui.showCustomConfirmModal({
        badgeTone: 'warning',
        badgeIcon: '⚠️',
        badgeText: 'Advertencia de Reenvío Diario',
        title: `¿Deseas reenviar mensajes a estos ${targetTypeName}?`,
        subtitle: `Se detectaron destinatarios que ya recibieron mensajes en las últimas 24 horas.`,
        totalCount,
        alreadySentCount,
        newTodayCount,
        description: `Has seleccionado ${totalCount} ${targetTypeName}, de los cuales ${alreadySentCount} ya fueron contactados hoy. El reenvío masivo el mismo día a los mismos números incrementa el riesgo de reportes o bloqueos en WhatsApp.`,
        recommendation: `💡 <strong>Sugerencia:</strong> Puedes presionar <strong>"Cancelar y Revisar"</strong> y luego dar clic en <strong>"Quitar usados hoy"</strong> para limpiar la lista antes de enviar.`,
        cancelText: '🛑 Cancelar y Revisar',
        acceptText: '▶️ Continuar de Todos Modos'
      });

      if (!confirmRes) {
        return;
      }
    }
  }

  controller.activeSendMode = mode;
  controller.ui.showProgress(config.progressLabel);

  try {
    const response = await controller.ipcClient.invoke('send-batch-message', payload);

    if (!response.success) {
      controller.ui.hideProgress();
      controller.ui.showToast(`Error de envio: ${response.error}`, 'error');
      controller.activeSendMode = null;
      return;
    }

    if (response.cancelled) {
      const results = Array.isArray(response.result) ? response.result : [];
      const total = results.length;
      const success = results.filter((item) => item.status === 'success').length;

      if (mode === 'contacts') {
        const successfulTargets = results
          .filter((item) => item.status === 'success')
          .map((item) => item.number || item.label)
          .filter(Boolean);

        if (successfulTargets.length > 0 && typeof controller.markTargetsAsRecentlyMessaged === 'function') {
          controller.markTargetsAsRecentlyMessaged('contacts', successfulTargets);
        }
      }

      if (mode === 'groups') {
        const successfulTargets = results
          .filter((item) => item.status === 'success')
          .map((item) => item.groupId)
          .filter(Boolean);

        if (successfulTargets.length > 0 && typeof controller.markTargetsAsRecentlyMessaged === 'function') {
          controller.markTargetsAsRecentlyMessaged('groups', successfulTargets);
        }
      }

      controller.ui.showToast(`Envío cancelado por el usuario. Mensajes enviados antes de la cancelación: ${success}.`, 'warning');
      refreshRiskPanel(controller, mode);

      if (typeof controller.refreshDestinationStatuses === 'function') {
        controller.refreshDestinationStatuses(mode, { repaint: true });
      }

      if (typeof controller.refreshMessageStats === 'function') {
        controller.refreshMessageStats({ silent: true });
      }
      return;
    }

    const total = response.result.length;
    const success = response.result.filter((item) => item.status === 'success').length;
    const failed = total - success;

    if (mode === 'contacts') {
      const successfulTargets = response.result
        .filter((item) => item.status === 'success')
        .map((item) => item.number || item.label)
        .filter(Boolean);

      if (successfulTargets.length > 0 && typeof controller.markTargetsAsRecentlyMessaged === 'function') {
        controller.markTargetsAsRecentlyMessaged('contacts', successfulTargets);
      }
    }

    if (mode === 'groups') {
      const successfulTargets = response.result
        .filter((item) => item.status === 'success')
        .map((item) => item.groupId)
        .filter(Boolean);

      if (successfulTargets.length > 0 && typeof controller.markTargetsAsRecentlyMessaged === 'function') {
        controller.markTargetsAsRecentlyMessaged('groups', successfulTargets);
      }
    }

    controller.ui.showToast(`${success}/${total} ${config.successLabel}. Fallidos: ${failed}.`, failed > 0 ? 'warning' : 'success');
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
  refreshRiskPanel
};
