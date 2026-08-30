/**
 * WhatsApp Sender Pro — Task Dock Module (Slice 01)
 * Decoupled background task monitor infrastructure for operations.
 */

const { getIconSvg } = require('./icons');

const TASK_DOCK_STATES = {
  HIDDEN: 'hidden',
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error'
};

class TaskDock {
  constructor(dockElement) {
    this.element = dockElement || document.getElementById('taskDock');
    this.currentState = TASK_DOCK_STATES.HIDDEN;
    this.listeners = {
      pause: [],
      resume: [],
      cancel: [],
      close: []
    };

    this.cacheDomElements();
    this.bindInternalEvents();
  }

  cacheDomElements() {
    if (!this.element) return;

    this.titleEl = this.element.querySelector('[data-dock-title]');
    this.statusBadgeEl = this.element.querySelector('[data-dock-status]');
    this.currentLabelEl = this.element.querySelector('[data-dock-current]');
    this.progressTrackEl = this.element.querySelector('[data-dock-track]');
    this.progressFillEl = this.element.querySelector('[data-dock-fill]');
    this.percentEl = this.element.querySelector('[data-dock-percent]');
    this.timerBoxEl = this.element.querySelector('[data-dock-timer]');
    this.timerTextEl = this.element.querySelector('[data-dock-timer-text]');
    this.pauseBtn = this.element.querySelector('[data-dock-action="pause"]');
    this.cancelBtn = this.element.querySelector('[data-dock-action="cancel"]');
    this.closeBtn = this.element.querySelector('[data-dock-action="close"]');
  }

  bindInternalEvents() {
    if (!this.element) return;

    if (this.pauseBtn) {
      this.pauseBtn.addEventListener('click', () => {
        if (this.currentState === TASK_DOCK_STATES.RUNNING) {
          this.setState(TASK_DOCK_STATES.PAUSED);
          this.emit('pause');
        } else if (this.currentState === TASK_DOCK_STATES.PAUSED) {
          this.setState(TASK_DOCK_STATES.RUNNING);
          this.emit('resume');
        }
      });
    }

    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => {
        this.emit('cancel');
      });
    }

    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => {
        this.setState(TASK_DOCK_STATES.HIDDEN);
        this.emit('close');
      });
    }
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
    return this;
  }

  emit(event, payload) {
    if (this.listeners[event]) {
      this.listeners[event].forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[TaskDock] Error en listener de '${event}':`, err);
        }
      });
    }
  }

  /**
   * Updates state of the task dock
   * @param {string} state - One of TASK_DOCK_STATES
   * @param {Object} [data={}] - Optional metadata (title, current, percent, timer)
   */
  setState(state, data = {}) {
    this.currentState = state;
    if (!this.element) return;

    this.element.setAttribute('data-state', state);

    if (state === TASK_DOCK_STATES.HIDDEN) {
      this.element.classList.add('hidden');
      return;
    }

    this.element.classList.remove('hidden');

    // Update texts if provided
    if (data.title && this.titleEl) {
      this.titleEl.textContent = data.title;
    }

    if (data.current !== undefined && this.currentLabelEl) {
      this.currentLabelEl.textContent = data.current;
    }

    if (data.percent !== undefined) {
      this.setProgress(data.percent);
    }

    if (data.timer && this.timerTextEl && this.timerBoxEl) {
      this.timerTextEl.textContent = data.timer;
      this.timerBoxEl.classList.remove('hidden');
    } else if (data.timer === null && this.timerBoxEl) {
      this.timerBoxEl.classList.add('hidden');
    }

    // Apply state visuals
    if (this.statusBadgeEl) {
      this.statusBadgeEl.className = 'status-badge';
      switch (state) {
        case TASK_DOCK_STATES.RUNNING:
          this.statusBadgeEl.classList.add('status-badge--info');
          this.statusBadgeEl.textContent = 'En ejecución';
          if (this.pauseBtn) {
            this.pauseBtn.innerHTML = `${getIconSvg('pause')} <span>Pausar</span>`;
            this.pauseBtn.classList.remove('hidden');
          }
          if (this.cancelBtn) this.cancelBtn.classList.remove('hidden');
          if (this.closeBtn) this.closeBtn.classList.add('hidden');
          break;

        case TASK_DOCK_STATES.PAUSED:
          this.statusBadgeEl.classList.add('status-badge--warning');
          this.statusBadgeEl.textContent = 'En pausa';
          if (this.pauseBtn) {
            this.pauseBtn.innerHTML = `${getIconSvg('play')} <span>Reanudar</span>`;
            this.pauseBtn.classList.remove('hidden');
          }
          if (this.cancelBtn) this.cancelBtn.classList.remove('hidden');
          if (this.closeBtn) this.closeBtn.classList.add('hidden');
          break;

        case TASK_DOCK_STATES.COMPLETED:
          this.statusBadgeEl.classList.add('status-badge--success');
          this.statusBadgeEl.textContent = 'Completado';
          if (this.pauseBtn) this.pauseBtn.classList.add('hidden');
          if (this.cancelBtn) this.cancelBtn.classList.add('hidden');
          if (this.closeBtn) this.closeBtn.classList.remove('hidden');
          if (this.timerBoxEl) this.timerBoxEl.classList.add('hidden');
          break;

        case TASK_DOCK_STATES.ERROR:
          this.statusBadgeEl.classList.add('status-badge--danger');
          this.statusBadgeEl.textContent = 'Error / Cancelado';
          if (this.pauseBtn) this.pauseBtn.classList.add('hidden');
          if (this.cancelBtn) this.cancelBtn.classList.add('hidden');
          if (this.closeBtn) this.closeBtn.classList.remove('hidden');
          if (this.timerBoxEl) this.timerBoxEl.classList.add('hidden');
          break;

        case TASK_DOCK_STATES.IDLE:
        default:
          this.statusBadgeEl.classList.add('status-badge--neutral');
          this.statusBadgeEl.textContent = 'Inactivo';
          if (this.pauseBtn) this.pauseBtn.classList.add('hidden');
          if (this.cancelBtn) this.cancelBtn.classList.add('hidden');
          if (this.closeBtn) this.closeBtn.classList.add('hidden');
          break;
      }
    }
  }

  setProgress(percent) {
    const clamped = Math.min(100, Math.max(0, Number(percent) || 0));
    if (this.progressFillEl) {
      this.progressFillEl.style.width = `${clamped}%`;
    }
    if (this.percentEl) {
      this.percentEl.textContent = `${Math.round(clamped)}%`;
    }
  }

  getState() {
    return this.currentState;
  }
}

module.exports = {
  TaskDock,
  TASK_DOCK_STATES
};
