/**
 * Campaign Dispatcher Controller
 * Coordinates Composer, Audience switching, Safety Inspector,
 * and execution lifecycle with TaskDock.
 */

const { CampaignAudience } = require('./campaign-audience');
const { inspectCampaignSafety, SAFETY_STATUS } = require('./campaign-safety');
const { optimizeCampaignConfig } = require('./campaign-optimizer');

class CampaignDispatcherController {
  constructor(appController) {
    this.app = appController;
    this.audience = new CampaignAudience();
    this.state = 'idle'; // 'idle' | 'ready' | 'running' | 'paused' | 'completed' | 'error' | 'cancelled'
    this.currentInspection = null;
  }

  init() {
    this.bindDomEvents();
    this.refreshInspection();
  }

  bindDomEvents() {
    // Audience source toggle pills
    const sourcePills = document.querySelectorAll('[data-audience-source]');
    sourcePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const source = pill.dataset.audienceSource;
        this.switchAudienceSource(source);
      });
    });

    // Message character counter
    const messageInput = document.getElementById('mensaje');
    if (messageInput) {
      messageInput.addEventListener('input', () => {
        this.updateMessageCharCount(messageInput.value);
        this.refreshInspection();
      });
    }

    // Delay and compliance inputs
    const delayMinInput = document.getElementById('delayMin');
    const delayMaxInput = document.getElementById('delayMax');
    const profileSelect = document.getElementById('riskProfileContacts');
    const complianceCheckbox = document.getElementById('complianceModeContacts');

    [delayMinInput, delayMaxInput, profileSelect, complianceCheckbox].forEach((el) => {
      if (el) {
        el.addEventListener('change', () => this.refreshInspection());
      }
    });

    // Optimize configuration button
    const optimizeBtn = document.getElementById('applySafeConfigContacts');
    if (optimizeBtn) {
      optimizeBtn.addEventListener('click', () => this.handleOptimizeConfig());
    }
  }

  switchAudienceSource(source) {
    this.audience.setSource(source);

    // Update active pill UI
    document.querySelectorAll('[data-audience-source]').forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.audienceSource === source);
    });

    // Toggle source sub-views
    const contactsView = document.getElementById('audienceContactsView');
    const groupsView = document.getElementById('audienceGroupsView');
    if (contactsView && groupsView) {
      contactsView.classList.toggle('hidden', source !== 'contacts');
      groupsView.classList.toggle('hidden', source !== 'groups');
    }

    // Sync active audience
    this.syncAudienceFromApp();
    this.refreshInspection();
  }

  syncAudienceFromApp() {
    if (this.app) {
      if (Array.isArray(this.app.selectedContacts)) {
        this.audience.setSelectedContacts(this.app.selectedContacts);
      }
      if (this.app.ui && typeof this.app.ui.getSelectedGroupIds === 'function') {
        this.audience.setSelectedGroupIds(this.app.ui.getSelectedGroupIds());
      }
    }
  }

  updateMessageCharCount(text = '') {
    const counterEl = document.getElementById('messageCharCount');
    if (counterEl) {
      const len = String(text || '').length;
      counterEl.textContent = `${len} caracter${len === 1 ? '' : 'es'}`;
    }
  }

  refreshInspection() {
    this.syncAudienceFromApp();

    const targetCount = this.audience.getActiveRecipientsCount();
    const mode = this.audience.getSource();

    const alreadySentCount = this.app && typeof this.app.getAlreadySentSelectedTargetsCount === 'function'
      ? this.app.getAlreadySentSelectedTargetsCount(mode)
      : 0;

    const delayMin = Number(document.getElementById('delayMin')?.value || 12);
    const delayMax = Number(document.getElementById('delayMax')?.value || 22);
    const unitDelayMin = Number(document.getElementById('unitDelayMin')?.value || 1);
    const unitDelayMax = Number(document.getElementById('unitDelayMax')?.value || 3);
    const profile = document.getElementById('riskProfileContacts')?.value || 'medium';
    const complianceMode = Boolean(document.getElementById('complianceModeContacts')?.checked ?? true);
    const hasFiles = Boolean(this.app?.filesByMode?.[mode]?.length > 0);

    const inspection = inspectCampaignSafety({
      targetCount,
      alreadySentCount,
      delayMin,
      delayMax,
      unitDelayMin,
      unitDelayMax,
      complianceMode,
      hasFiles,
      profile
    });

    this.currentInspection = inspection;
    this.renderInspection(inspection, targetCount);
    return inspection;
  }

  renderInspection(inspection, targetCount) {
    // Recipients & duration
    const recipientsEl = document.getElementById('inspectorRecipientsCount');
    if (recipientsEl) {
      recipientsEl.textContent = String(targetCount);
    }

    const durationEl = document.getElementById('inspectorEstimatedDuration');
    if (durationEl) {
      durationEl.textContent = inspection.estimatedDuration;
    }

    // Safety badge
    const statusEl = document.getElementById('inspectorSafetyStatus');
    if (statusEl) {
      statusEl.className = 'status-badge';
      if (inspection.status === SAFETY_STATUS.READY) {
        statusEl.classList.add('status-badge--success');
        statusEl.textContent = '● Listo para despacho';
      } else if (inspection.status === SAFETY_STATUS.WARNING) {
        statusEl.classList.add('status-badge--warning');
        statusEl.textContent = '● Advertencia de seguridad';
      } else {
        statusEl.classList.add('status-badge--danger');
        statusEl.textContent = targetCount === 0 ? '● Audiencia requerida' : '● Riesgo alto / Bloqueado';
      }
    }

    // Render individual checks
    this.renderCheck('checkAudience', inspection.checks.audience);
    this.renderCheck('checkVolume', inspection.checks.volume);
    this.renderCheck('checkDelay', inspection.checks.delay);
    this.renderCheck('checkDuplicates', inspection.checks.duplicates);
    this.renderCheck('checkCompliance', inspection.checks.compliance);

    // Render reasons & suggestion
    const reasonEl = document.getElementById('riskReasonContacts');
    if (reasonEl) {
      reasonEl.textContent = inspection.reasons.join(' ');
    }

    const suggestionEl = document.getElementById('safeSuggestionContacts');
    if (suggestionEl) {
      suggestionEl.textContent = inspection.suggestion;
    }

    const scoreEl = document.getElementById('riskScoreContacts');
    if (scoreEl) {
      scoreEl.textContent = `Puntaje de riesgo: ${inspection.score}/100`;
    }

    // Send buttons availability
    const sendBtn = document.getElementById('enviarMensajes');
    const forceBtn = document.getElementById('forzarEnvioMensajes');

    if (sendBtn) {
      const isSendable = inspection.status === SAFETY_STATUS.READY || inspection.status === SAFETY_STATUS.WARNING;
      sendBtn.disabled = !isSendable;
      sendBtn.title = isSendable
        ? 'Iniciar campaña de envíos'
        : (targetCount === 0 ? 'Selecciona al menos un destinatario' : 'Bloqueado por riesgo alto');
    }

    if (forceBtn) {
      forceBtn.classList.toggle('hidden', inspection.status !== SAFETY_STATUS.BLOCKED || targetCount === 0);
    }
  }

  renderCheck(elementId, checkResult) {
    const el = document.getElementById(elementId);
    if (!el || !checkResult) return;

    el.classList.remove('check-passed', 'check-failed');
    el.classList.add(checkResult.valid ? 'check-passed' : 'check-failed');

    const labelSpan = el.querySelector('.check-label');
    if (labelSpan) {
      labelSpan.textContent = checkResult.label;
    }
    const iconSpan = el.querySelector('.check-icon');
    if (iconSpan) {
      iconSpan.textContent = checkResult.valid ? '✓' : '✕';
    }
  }

  handleOptimizeConfig() {
    const delayMin = Number(document.getElementById('delayMin')?.value || 12);
    const delayMax = Number(document.getElementById('delayMax')?.value || 22);
    const unitDelayMin = Number(document.getElementById('unitDelayMin')?.value || 1);
    const unitDelayMax = Number(document.getElementById('unitDelayMax')?.value || 3);
    const profile = document.getElementById('riskProfileContacts')?.value || 'medium';
    const complianceMode = Boolean(document.getElementById('complianceModeContacts')?.checked ?? true);

    const optResult = optimizeCampaignConfig({
      delayMin,
      delayMax,
      unitDelayMin,
      unitDelayMax,
      profile,
      complianceMode
    });

    // Apply values to DOM
    const delayMinInput = document.getElementById('delayMin');
    if (delayMinInput) delayMinInput.value = String(optResult.optimizedValues.delayMin);

    const delayMaxInput = document.getElementById('delayMax');
    if (delayMaxInput) {
      // Re-populate options if select
      if (this.app && typeof this.app.updateDelayOptions === 'function') {
        this.app.updateDelayOptions('contacts');
      }
      delayMaxInput.value = String(optResult.optimizedValues.delayMax);
    }

    const unitDelayMinInput = document.getElementById('unitDelayMin');
    if (unitDelayMinInput) unitDelayMinInput.value = String(optResult.optimizedValues.unitDelayMin);

    const unitDelayMaxInput = document.getElementById('unitDelayMax');
    if (unitDelayMaxInput) unitDelayMaxInput.value = String(optResult.optimizedValues.unitDelayMax);

    const complianceCheckbox = document.getElementById('complianceModeContacts');
    if (complianceCheckbox) complianceCheckbox.checked = optResult.optimizedValues.complianceMode;

    if (this.app?.ui?.showToast) {
      this.app.ui.showToast(optResult.summary, 'success');
    }

    this.refreshInspection();
  }
}

module.exports = {
  CampaignDispatcherController
};
