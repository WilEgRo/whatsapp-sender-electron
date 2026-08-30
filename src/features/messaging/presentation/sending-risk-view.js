/**
 * WhatsApp Sender Electron - Messaging Feature
 * Presentation: Sending Risk View
 * 
 * Gestiona exclusivamente la manipulación visual del DOM asociada al riesgo,
 * badges, inspectores, modales de advertencia y controles de seguridad de envío.
 * Las reglas matemáticas de riesgo residen en Domain (risk-policy.js).
 */

function applyRiskVisual(config, level, text) {
  if (!config || !config.riskIndicatorId) return;
  const indicator = document.getElementById(config.riskIndicatorId);
  if (!indicator) return;

  indicator.textContent = text;
  indicator.classList.remove('risk-indicator--green', 'risk-indicator--yellow', 'risk-indicator--red');
  indicator.classList.add(`risk-indicator--${level}`);
}

function updateSendAvailability(config, level) {
  if (!config) return;
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

function setRiskPanelText(config, { reason, suggestion, score } = {}) {
  if (!config) return;
  const reasonElement = document.getElementById(config.riskReasonId);
  const suggestionElement = document.getElementById(config.riskSuggestionId);
  const scoreElement = document.getElementById(config.riskScoreId);

  if (reasonElement) reasonElement.textContent = reason || '';
  if (suggestionElement) suggestionElement.textContent = suggestion || '';
  if (scoreElement) scoreElement.textContent = `Puntaje de riesgo: ${score || 0}/100`;
}

function updateTargetCounter(config, preset, targetCount) {
  if (!config || !config.targetCounterId) return;
  const counterElement = document.getElementById(config.targetCounterId);
  if (!counterElement) return;

  const maxBatch = Number((preset && preset.maxBatch) || 0);

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

function updateGroupPreflightInspector({
  targetCount = 0,
  delayMin = 12,
  delayMax = 22,
  preset = {},
  complianceMode = true,
  result = { level: { level: 'green', text: 'VERDE' } },
  alreadySentCount = 0
} = {}) {
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

  const maxBatch = Number((preset && preset.maxBatch) || 35);
  const minDelayPreset = Number((preset && preset.delayMin) || 12);

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
      : (targetCount > maxBatch ? `Excede el límite seguro (${targetCount}/${maxBatch})` : 'Volumen dentro del límite seguro')
  );

  renderCheckItem(
    'checkDelayGroups',
    delayMin >= minDelayPreset && (delayMax - delayMin) >= 2,
    delayMin >= minDelayPreset ? 'Delay seguro y aleatorio' : 'Delay por debajo del umbral seguro'
  );

  renderCheckItem(
    'checkDuplicatesGroups',
    alreadySentCount === 0,
    alreadySentCount === 0 ? 'Sin reenvíos detectados hoy' : `${alreadySentCount} grupo(s) contactado(s) hoy`
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

function renderDelayOptions(config, minValue, currentMax) {
  if (!config) return;
  const maxSelect = document.getElementById(config.delayMaxId);
  if (!maxSelect) return;

  maxSelect.innerHTML = '';
  for (let option = minValue + 1; option <= 25; option += 1) {
    const node = document.createElement('option');
    node.value = String(option);
    node.textContent = String(option);
    maxSelect.appendChild(node);
  }

  maxSelect.value = currentMax > minValue ? String(currentMax) : String(minValue + 1);
}

function renderRiskPanel({
  config,
  result,
  preset,
  targetCount,
  isGroups = false,
  alreadySentCount = 0,
  delayMin = 2,
  delayMax = 8,
  complianceMode = true
}) {
  applyRiskVisual(config, result.level.level, result.level.text);
  updateSendAvailability(config, result.level.level);
  setRiskPanelText(config, result);
  updateTargetCounter(config, preset, targetCount);

  if (isGroups) {
    updateGroupPreflightInspector({
      targetCount,
      delayMin,
      delayMax,
      preset,
      complianceMode,
      result,
      alreadySentCount
    });
  }
}

function applySafeConfigurationInputs(config, preset, updateDelayOptionsFn) {
  const minSelect = document.getElementById(config.delayMinId);
  const maxSelect = document.getElementById(config.delayMaxId);
  const unitMinInput = document.getElementById(config.unitDelayMinId);
  const unitMaxInput = document.getElementById(config.unitDelayMaxId);
  const complianceCheckbox = document.getElementById(config.complianceModeId);

  if (!minSelect || !maxSelect) return;

  minSelect.value = String(Math.min(24, preset.delayMin));
  if (typeof updateDelayOptionsFn === 'function') {
    updateDelayOptionsFn();
  }

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
}

function bindRiskControlsView({
  config,
  onProfileChange,
  onComplianceChange,
  onApplySafeConfig,
  onForceSend,
  onClearSent
}) {
  const profileSelect = document.getElementById(config.riskProfileId);
  const applyButton = document.getElementById(config.applySafeConfigId);
  const complianceCheckbox = document.getElementById(config.complianceModeId);
  const forceButton = document.getElementById(config.forceSendButtonId);
  const clearSentButton = document.getElementById(config.clearSentTargetsId);

  if (profileSelect) profileSelect.addEventListener('change', onProfileChange);
  if (complianceCheckbox) complianceCheckbox.addEventListener('change', onComplianceChange);
  if (applyButton) applyButton.addEventListener('click', onApplySafeConfig);
  if (forceButton) forceButton.addEventListener('click', onForceSend);
  if (clearSentButton) clearSentButton.addEventListener('click', onClearSent);
}

async function showForceSendConfirmation(ui, { totalCount = 0, alreadySentCount = 0 } = {}) {
  if (!ui || typeof ui.showCustomConfirmModal !== 'function') return false;

  return await ui.showCustomConfirmModal({
    badgeTone: 'danger',
    badgeIcon: '🚨',
    badgeText: 'Riesgo Alto Detectado',
    title: '¿Forzar el envío de esta campaña?',
    subtitle: 'El análisis de riesgo determinó que la configuración actual está en NIVEL ROJO.',
    totalCount,
    alreadySentCount,
    newTodayCount: Math.max(0, totalCount - alreadySentCount),
    description: 'Forzar el envío con parámetros agresivos aumenta significativamente el riesgo de restricciones o suspensión de tu cuenta de WhatsApp por parte del sistema anti-spam.',
    recommendation: '💡 <strong>Sugerencia:</strong> Te recomendamos presionar <strong>"Cancelar y Corregir"</strong> y utilizar el botón <strong>"Aplicar configuración segura"</strong>.',
    cancelText: '🛑 Cancelar y Corregir',
    acceptText: '⚠️ Forzar Envío Bajo Mi Riesgo'
  });
}

async function showDailyResendConfirmation(ui, { totalCount = 0, alreadySentCount = 0, targetTypeName = 'destinatarios' } = {}) {
  if (!ui || typeof ui.showCustomConfirmModal !== 'function') return true;

  return await ui.showCustomConfirmModal({
    badgeTone: 'warning',
    badgeIcon: '⚠️',
    badgeText: 'Advertencia de Reenvío Diario',
    title: `¿Deseas reenviar mensajes a estos ${targetTypeName}?`,
    subtitle: 'Se detectaron destinatarios que ya recibieron mensajes en las últimas 24 horas.',
    totalCount,
    alreadySentCount,
    newTodayCount: Math.max(0, totalCount - alreadySentCount),
    description: `Has seleccionado ${totalCount} ${targetTypeName}, de los cuales ${alreadySentCount} ya fueron contactados hoy. El reenvío masivo el mismo día a los mismos números incrementa el riesgo de reportes o bloqueos en WhatsApp.`,
    recommendation: '💡 <strong>Sugerencia:</strong> Puedes presionar <strong>"Cancelar y Revisar"</strong> y luego dar clic en <strong>"Quitar usados hoy"</strong> para limpiar la lista antes de enviar.',
    cancelText: '🛑 Cancelar y Revisar',
    acceptText: '▶️ Continuar de Todos Modos'
  });
}

module.exports = {
  applyRiskVisual,
  updateSendAvailability,
  setRiskPanelText,
  updateTargetCounter,
  updateGroupPreflightInspector,
  renderDelayOptions,
  renderRiskPanel,
  applySafeConfigurationInputs,
  bindRiskControlsView,
  showForceSendConfirmation,
  showDailyResendConfirmation
};
