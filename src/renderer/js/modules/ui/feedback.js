function stopCountdownTimer() {
  if (this.countdownInterval) {
    clearInterval(this.countdownInterval);
    this.countdownInterval = null;
  }
  if (this.progressTimerBox) {
    this.progressTimerBox.classList.add('hidden');
  }
}

function startCountdownTimer(seconds, prefixMessage) {
  stopCountdownTimer.call(this);

  if (!this.progressTimerBox || !this.progressTimerText || !Number.isFinite(seconds) || seconds <= 0) {
    return;
  }

  let remaining = Math.ceil(seconds);
  this.progressTimerBox.classList.remove('hidden');
  this.progressTimerText.textContent = `${prefixMessage}: ${remaining}s...`;

  this.countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      if (this.progressTimerText) {
        this.progressTimerText.textContent = `${prefixMessage}: ${remaining}s...`;
      }
    } else {
      if (this.progressTimerText) {
        this.progressTimerText.textContent = 'Enviando siguiente mensaje...';
      }
      stopCountdownTimer.call(this);
    }
  }, 1000);
}

function updateStatus(message, tone) {
  this.statusText.textContent = message;
  this.statusDot.className = `status-dot ${tone}`;
}

function showProgress(message) {
  stopCountdownTimer.call(this);
  this.progressText.textContent = message;
  if (this.progressFill) {
    this.progressFill.style.width = '0%';
  }
  if (this.progressPercent) {
    this.progressPercent.textContent = '0%';
  }
  if (this.progressCounts) {
    this.progressCounts.textContent = 'Mensajes: 0 de 0 (0 exitosos, 0 fallidos)';
  }
  if (this.progressCurrent) {
    this.progressCurrent.textContent = 'Esperando inicio...';
  }
  if (this.progressDelay) {
    this.progressDelay.textContent = 'Delay activo: --';
  }
  if (this.progressSecurity) {
    this.progressSecurity.textContent = 'Pausa de seguridad: --';
  }
  if (this.progressSummary) {
    this.progressSummary.textContent = '';
  }
  if (this.cancelSendBtn) {
    this.cancelSendBtn.disabled = false;
    this.cancelSendBtn.innerHTML = '<span class="cancel-send-icon">🛑</span> <span>Cancelar Envío</span>';
  }
  if (this.taskDock && this.TASK_DOCK_STATES) {
    this.taskDock.setState(this.TASK_DOCK_STATES.RUNNING, {
      title: message || 'Campaña en ejecución',
      current: 'Iniciando despacho de mensajes...',
      percent: 0
    });
  }
  if (this.progressModal) {
    this.progressModal.classList.add('hidden');
  }
}

function hideProgress() {
  stopCountdownTimer.call(this);
  if (this.progressModal) {
    this.progressModal.classList.add('hidden');
  }
  if (this.taskDock && this.TASK_DOCK_STATES) {
    setTimeout(() => {
      const currentState = this.taskDock.getState();
      if (currentState === this.TASK_DOCK_STATES.COMPLETED || currentState === this.TASK_DOCK_STATES.ERROR) {
        this.taskDock.setState(this.TASK_DOCK_STATES.HIDDEN);
      }
    }, 4000);
  }
}

function updateSendProgress(progress) {
  if (!progress) {
    return;
  }

  const percent = Number.isFinite(progress.percent) ? progress.percent : 0;
  const total = Number.isFinite(progress.total) ? progress.total : 0;
  const processed = Number.isFinite(progress.processed) ? progress.processed : 0;
  const success = Number.isFinite(progress.success) ? progress.success : 0;
  const failed = Number.isFinite(progress.failed) ? progress.failed : 0;

  if (this.progressFill) {
    this.progressFill.style.width = `${percent}%`;
  }
  if (this.progressPercent) {
    this.progressPercent.textContent = `${percent}%`;
  }

  if (this.progressCounts) {
    if (total > 0) {
      if (progress.status === 'completed' || progress.status === 'cancelled') {
        this.progressCounts.textContent = `Mensajes: ${processed} de ${total} (${success} exitosos, ${failed} fallidos)`;
      } else {
        const currentNum = Math.min(processed + 1, total);
        this.progressCounts.textContent = `Mensajes: ${processed} de ${total} enviados (Enviando #${currentNum} | Exitosos: ${success}, Fallidos: ${failed})`;
      }
    } else {
      this.progressCounts.textContent = 'Preparando envíos...';
    }
  }

  if (this.progressDelay && Number.isFinite(progress.delayMinApplied) && Number.isFinite(progress.delayMaxApplied)) {
    if (Number.isFinite(progress.unitDelayMinApplied) && Number.isFinite(progress.unitDelayMaxApplied) && progress.unitDelayMaxApplied > 0) {
      this.progressDelay.textContent = `Delay entre envíos: ${progress.delayMinApplied}-${progress.delayMaxApplied}s | Entre bloques: ${progress.unitDelayMinApplied}-${progress.unitDelayMaxApplied}s`;
    } else {
      this.progressDelay.textContent = `Delay entre envíos: ${progress.delayMinApplied}-${progress.delayMaxApplied} segundos`;
    }
  }

  if (this.progressSecurity) {
    if (progress.complianceMode && Number.isFinite(progress.cooldownEvery) && Number.isFinite(progress.cooldownMinSeconds) && Number.isFinite(progress.cooldownMaxSeconds)) {
      this.progressSecurity.textContent = `Pausa de seguridad: cada ${progress.cooldownEvery} envíos, espera ${progress.cooldownMinSeconds}-${progress.cooldownMaxSeconds} segundos`;
    } else {
      this.progressSecurity.textContent = 'Pausa de seguridad: desactivada';
    }
  }

  if (this.progressCurrent) {
    if (progress.status === 'running' && progress.currentLabel) {
      stopCountdownTimer.call(this);
      const stateText = progress.currentResult === 'success' ? 'OK' : 'ERROR';
      this.progressCurrent.textContent = `Enviando a (${processed}/${total}): ${progress.currentLabel} (${stateText})`;
    } else if (progress.status === 'started') {
      stopCountdownTimer.call(this);
      this.progressCurrent.textContent = `Iniciando envío de ${total} destinatario(s)...`;
    } else if (progress.status === 'waiting' && Number.isFinite(progress.waitSeconds)) {
      this.progressCurrent.textContent = `Enviados ${processed} de ${total}. En pausa de delay entre envíos...`;
      startCountdownTimer.call(this, progress.waitSeconds, 'Esperando para enviar el siguiente mensaje');
    } else if (progress.status === 'unit-wait' && Number.isFinite(progress.waitSeconds)) {
      this.progressCurrent.textContent = `Enviando adjuntos/mensajes divididos a ${progress.currentLabel || 'contacto'}...`;
      startCountdownTimer.call(this, progress.waitSeconds, 'Esperando entre bloques del mensaje');
    } else if (progress.status === 'cooldown' && Number.isFinite(progress.waitSeconds)) {
      this.progressCurrent.textContent = `Pausa de seguridad anti-bloqueo activa (${processed} envíos realizados).`;
      startCountdownTimer.call(this, progress.waitSeconds, 'Pausa de seguridad anti-bloqueo');
    } else if (progress.status === 'cancelling') {
      stopCountdownTimer.call(this);
      this.progressCurrent.textContent = 'Cancelando envío... Deteniendo tareas pendientes.';
    } else if (progress.status === 'cancelled') {
      stopCountdownTimer.call(this);
      this.progressCurrent.textContent = 'Envío cancelado por el usuario.';
    }
  }

  if (this.cancelSendBtn && (progress.status === 'cancelling' || progress.status === 'cancelled')) {
    this.cancelSendBtn.disabled = true;
    this.cancelSendBtn.innerHTML = '<span class="cancel-send-icon">⏳</span> <span>Cancelando...</span>';
  }

  if (this.progressSummary) {
    if (progress.status === 'completed') {
      stopCountdownTimer.call(this);
      this.progressSummary.textContent = `Finalizado: ${progress.success}/${progress.total} enviados con éxito. Fallidos: ${progress.failed}.`;
      this.progressCurrent.textContent = 'Proceso completado con éxito';
    } else if (progress.status === 'cancelled') {
      stopCountdownTimer.call(this);
      this.progressSummary.textContent = `Envío cancelado: ${processed}/${total} enviados (${success} exitosos, ${failed} fallidos).`;
    }
  }

  if (this.taskDock && this.TASK_DOCK_STATES) {
    let dockState = this.TASK_DOCK_STATES.RUNNING;
    let timerText = '';

    if (progress.status === 'completed') {
      dockState = this.TASK_DOCK_STATES.COMPLETED;
    } else if (progress.status === 'cancelled' || progress.status === 'error') {
      dockState = this.TASK_DOCK_STATES.ERROR;
    } else if (progress.status === 'waiting' || progress.status === 'unit-wait' || progress.status === 'cooldown') {
      dockState = this.TASK_DOCK_STATES.PAUSED;
      if (Number.isFinite(progress.waitSeconds)) {
        timerText = `Pausa: ${progress.waitSeconds}s`;
      }
    }

    let currentText = 'Procesando envíos...';
    if (progress.currentLabel) {
      currentText = `Enviando a (${processed}/${total}): ${progress.currentLabel}`;
    } else if (total > 0) {
      currentText = `${processed} de ${total} procesados (${success} exitosos, ${failed} fallidos)`;
    }

    this.taskDock.setState(dockState, {
      title: 'Campaña en ejecución',
      current: currentText,
      percent: Math.round(percent),
      timer: timerText
    });
  }
}

function showToast(message, tone = 'success') {
  const toast = document.createElement('article');
  toast.className = `toast ${tone}`;

  toast.innerHTML = `
    <div class="toast__body">
      <p>${message}</p>
      <button class="toast__close" type="button" aria-label="Cerrar notificacion">x</button>
    </div>
  `;

  toast.querySelector('.toast__close').addEventListener('click', () => toast.remove());

  this.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast--out');
    setTimeout(() => toast.remove(), 280);
  }, 4600);
}

function showQrCanvas(canvas) {
  this.qrContainer.innerHTML = '';
  this.qrContainer.appendChild(canvas);

  if (this.qrContentArea) {
    this.qrContentArea.classList.remove('hidden');
  }
  if (this.sessionLoadingArea) {
    this.sessionLoadingArea.classList.add('hidden');
  }

  this.qrModal.classList.remove('hidden');
}

function showSessionLoading(statusText = 'Autenticando WhatsApp...', detailsText = 'Preparando la sesión...', percent = 20) {
  if (this.qrContentArea) {
    this.qrContentArea.classList.add('hidden');
  }
  if (this.sessionLoadingArea) {
    this.sessionLoadingArea.classList.remove('hidden');
  }

  if (this.sessionLoadingStatusText) {
    this.sessionLoadingStatusText.textContent = statusText;
  }
  if (this.sessionSyncCounter) {
    this.sessionSyncCounter.textContent = detailsText;
  }
  if (this.sessionProgressFill) {
    this.sessionProgressFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }
  if (this.sessionLoadingPercentText) {
    this.sessionLoadingPercentText.textContent = `${Math.round(percent)}%`;
  }

  this.qrModal.classList.remove('hidden');
}

function updateSessionLoadingStatus(statusText, detailsText, percent = null, options = {}) {
  if (this.qrContentArea) {
    this.qrContentArea.classList.add('hidden');
  }
  if (this.sessionLoadingArea) {
    this.sessionLoadingArea.classList.remove('hidden');
  }

  if (this.sessionLoadingStatusText && statusText) {
    this.sessionLoadingStatusText.textContent = statusText;
  }
  if (this.sessionSyncCounter && detailsText) {
    this.sessionSyncCounter.textContent = detailsText;
  }
  if (options.title && this.sessionLoadingTitle) {
    this.sessionLoadingTitle.textContent = options.title;
  }
  if (options.subtitle && this.sessionLoadingSubtitle) {
    this.sessionLoadingSubtitle.textContent = options.subtitle;
  }

  if (percent !== null && percent !== undefined) {
    const numPercent = Math.min(100, Math.max(0, Number(percent) || 0));
    if (this.sessionProgressFill) {
      this.sessionProgressFill.style.width = `${numPercent}%`;
    }
    if (this.sessionLoadingPercentText) {
      this.sessionLoadingPercentText.textContent = `${Math.round(numPercent)}%`;
    }
  }
}

function hideQr() {
  this.qrModal.classList.add('hidden');
  if (this.qrContentArea) {
    this.qrContentArea.classList.remove('hidden');
  }
  if (this.sessionLoadingArea) {
    this.sessionLoadingArea.classList.add('hidden');
  }
}

function showCustomConfirmModal(options = {}) {
  const modal = document.getElementById('customConfirmModal');
  const badge = document.getElementById('confirmModalBadge');
  const badgeIcon = document.getElementById('confirmModalIcon');
  const badgeText = document.getElementById('confirmModalBadgeText');
  const title = document.getElementById('confirmModalTitle');
  const subtitle = document.getElementById('confirmModalSubtitle');
  const statTotal = document.getElementById('confirmStatTotal');
  const statAlreadySent = document.getElementById('confirmStatAlreadySent');
  const statNewToday = document.getElementById('confirmStatNewToday');
  const description = document.getElementById('confirmModalDescription');
  const adviceBox = document.getElementById('confirmModalAdviceBox');
  const recommendation = document.getElementById('confirmModalRecommendation');
  const cancelBtn = document.getElementById('confirmModalCancelBtn');
  const acceptBtn = document.getElementById('confirmModalAcceptBtn');

  if (!modal || !cancelBtn || !acceptBtn) {
    return Promise.resolve(window.confirm(options.title || '¿Continuar?'));
  }

  const tone = options.badgeTone || 'warning';
  if (badge) {
    badge.className = `confirm-modal-badge confirm-modal-badge--${tone}`;
  }

  if (badgeIcon) badgeIcon.textContent = options.badgeIcon || (tone === 'danger' ? '🚨' : '⚠️');
  if (badgeText) badgeText.textContent = options.badgeText || 'Advertencia';
  if (title) title.textContent = options.title || '¿Confirmar Acción?';
  if (subtitle) subtitle.textContent = options.subtitle || '';

  if (statTotal) statTotal.textContent = String(options.totalCount ?? 0);
  if (statAlreadySent) statAlreadySent.textContent = String(options.alreadySentCount ?? 0);
  if (statNewToday) statNewToday.textContent = String(options.newTodayCount ?? 0);

  if (description) description.textContent = options.description || '';

  if (adviceBox && recommendation) {
    if (options.recommendation) {
      adviceBox.classList.remove('hidden');
      recommendation.innerHTML = options.recommendation;
    } else {
      adviceBox.classList.add('hidden');
    }
  }

  if (cancelBtn) {
    cancelBtn.innerHTML = `<span>${options.cancelText || '🛑 Cancelar'}</span>`;
  }
  if (acceptBtn) {
    acceptBtn.className = tone === 'danger' ? 'confirm-btn confirm-btn--accept' : 'confirm-btn confirm-btn--accept-warning';
    acceptBtn.innerHTML = `<span>${options.acceptText || '▶️ Continuar de Todos Modos'}</span>`;
  }

  modal.classList.remove('hidden');

  return new Promise((resolve) => {
    const handleAccept = () => {
      cleanup();
      modal.classList.add('hidden');
      resolve(true);
    };

    const handleCancel = () => {
      cleanup();
      modal.classList.add('hidden');
      resolve(false);
    };

    const cleanup = () => {
      acceptBtn.removeEventListener('click', handleAccept);
      cancelBtn.removeEventListener('click', handleCancel);
    };

    acceptBtn.addEventListener('click', handleAccept);
    cancelBtn.addEventListener('click', handleCancel);
  });
}

module.exports = {
  updateStatus,
  showProgress,
  hideProgress,
  updateSendProgress,
  showToast,
  showQrCanvas,
  showSessionLoading,
  updateSessionLoadingStatus,
  hideQr,
  showCustomConfirmModal
};
