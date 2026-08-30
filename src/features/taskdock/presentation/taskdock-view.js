/**
 * WhatsApp Sender Electron - TaskDock Feature
 * Presentation: TaskDock View
 * 
 * Gestiona la manipulación directa del DOM para el widget TaskDock
 * respetando el diseño y temas de la aplicación.
 */

const { getIconSvg } = require('../../../renderer/js/modules/ui/icons');
const {
  TASK_DOCK_STATES,
  resolveBadgeStyle,
  clampProgress
} = require('../domain/taskdock-rules');

/**
 * Cachea las referencias a los elementos internos del contenedor del TaskDock.
 * @param {HTMLElement} element
 * @returns {Object}
 */
function cacheDockElements(element) {
  if (!element) return {};

  return {
    element,
    titleEl: element.querySelector('[data-dock-title]'),
    statusBadgeEl: element.querySelector('[data-dock-status]'),
    currentLabelEl: element.querySelector('[data-dock-current]'),
    progressTrackEl: element.querySelector('[data-dock-track]'),
    progressFillEl: element.querySelector('[data-dock-fill]'),
    percentEl: element.querySelector('[data-dock-percent]'),
    timerBoxEl: element.querySelector('[data-dock-timer]'),
    timerTextEl: element.querySelector('[data-dock-timer-text]'),
    pauseBtn: element.querySelector('[data-dock-action="pause"]'),
    cancelBtn: element.querySelector('[data-dock-action="cancel"]'),
    closeBtn: element.querySelector('[data-dock-action="close"]')
  };
}

/**
 * Aplica el estado visual y los textos sobre los elementos del DOM cacheados.
 * @param {Object} cache
 * @param {string} state
 * @param {Object} [data={}]
 */
function applyDockVisuals(cache, state, data = {}) {
  const { element, titleEl, statusBadgeEl, currentLabelEl, timerBoxEl, timerTextEl, pauseBtn, cancelBtn, closeBtn } = cache;
  if (!element) return;

  element.setAttribute('data-state', state);

  if (state === TASK_DOCK_STATES.HIDDEN) {
    element.classList.add('hidden');
    return;
  }

  element.classList.remove('hidden');

  if (data.title && titleEl) {
    titleEl.textContent = data.title;
  }

  if (data.current !== undefined && currentLabelEl) {
    currentLabelEl.textContent = data.current;
  }

  if (data.percent !== undefined) {
    setDockProgress(cache, data.percent);
  }

  if (data.timer && timerTextEl && timerBoxEl) {
    timerTextEl.textContent = data.timer;
    timerBoxEl.classList.remove('hidden');
  } else if (data.timer === null && timerBoxEl) {
    timerBoxEl.classList.add('hidden');
  }

  if (statusBadgeEl) {
    statusBadgeEl.className = 'status-badge';
    ['status-badge--info', 'status-badge--warning', 'status-badge--success', 'status-badge--danger', 'status-badge--neutral'].forEach((cls) => {
      statusBadgeEl.classList.remove(cls);
    });

    switch (state) {
      case TASK_DOCK_STATES.RUNNING:
        statusBadgeEl.classList.add('status-badge--info');
        statusBadgeEl.textContent = 'En ejecución';
        break;
      case TASK_DOCK_STATES.PAUSED:
        statusBadgeEl.classList.add('status-badge--warning');
        statusBadgeEl.textContent = 'En pausa';
        break;
      case TASK_DOCK_STATES.COMPLETED:
        statusBadgeEl.classList.add('status-badge--success');
        statusBadgeEl.textContent = 'Completado';
        break;
      case TASK_DOCK_STATES.ERROR:
        statusBadgeEl.classList.add('status-badge--danger');
        statusBadgeEl.textContent = 'Error / Cancelado';
        break;
      case TASK_DOCK_STATES.IDLE:
      default:
        statusBadgeEl.classList.add('status-badge--neutral');
        statusBadgeEl.textContent = 'Inactivo';
        break;
    }
  }

  if (pauseBtn) {
    if (state === TASK_DOCK_STATES.RUNNING) {
      pauseBtn.innerHTML = `${getIconSvg('pause')} <span>Pausar</span>`;
      pauseBtn.classList.remove('hidden');
    } else if (state === TASK_DOCK_STATES.PAUSED) {
      pauseBtn.innerHTML = `${getIconSvg('play')} <span>Reanudar</span>`;
      pauseBtn.classList.remove('hidden');
    } else {
      pauseBtn.classList.add('hidden');
    }
  }

  const style = resolveBadgeStyle(state);
  if (cancelBtn) {
    if (style.showCancel) {
      cancelBtn.classList.remove('hidden');
    } else {
      cancelBtn.classList.add('hidden');
    }
  }

  if (closeBtn) {
    if (style.showClose) {
      closeBtn.classList.remove('hidden');
    } else {
      closeBtn.classList.add('hidden');
    }
  }

  if (timerBoxEl && !style.showTimer) {
    timerBoxEl.classList.add('hidden');
  }
}

/**
 * Actualiza visualmente la barra y etiqueta de progreso.
 * @param {Object} cache
 * @param {number} percent
 */
function setDockProgress(cache, percent) {
  const clamped = clampProgress(percent);
  if (cache.progressFillEl) {
    cache.progressFillEl.style.width = `${clamped}%`;
  }
  if (cache.percentEl) {
    cache.percentEl.textContent = `${clamped}%`;
  }
}

module.exports = {
  cacheDockElements,
  applyDockVisuals,
  setDockProgress
};
