/**
 * WhatsApp Sender Electron - TaskDock Feature
 * Presentation: TaskDock Controller
 * 
 * Controlador de presentación para el widget TaskDock.
 * Preserva compatibilidad completa con UiManager y Feedback.
 */

const {
  TASK_DOCK_STATES
} = require('../domain/taskdock-rules');

const {
  cacheDockElements,
  applyDockVisuals,
  setDockProgress
} = require('./taskdock-view');

class TaskDock {
  /**
   * @param {HTMLElement} [dockElement]
   */
  constructor(dockElement) {
    this.element = dockElement || (typeof document !== 'undefined' ? document.getElementById('taskDock') : null);
    this.currentState = TASK_DOCK_STATES.HIDDEN;
    this.listeners = {
      pause: [],
      resume: [],
      cancel: [],
      close: []
    };

    this.cache = cacheDockElements(this.element);
    this.bindInternalEvents();
  }

  bindInternalEvents() {
    if (!this.element) return;

    if (this.cache.pauseBtn) {
      this.cache.pauseBtn.addEventListener('click', () => {
        if (this.currentState === TASK_DOCK_STATES.RUNNING) {
          this.setState(TASK_DOCK_STATES.PAUSED);
          this.emit('pause');
        } else if (this.currentState === TASK_DOCK_STATES.PAUSED) {
          this.setState(TASK_DOCK_STATES.RUNNING);
          this.emit('resume');
        }
      });
    }

    if (this.cache.cancelBtn) {
      this.cache.cancelBtn.addEventListener('click', () => {
        this.emit('cancel');
      });
    }

    if (this.cache.closeBtn) {
      this.cache.closeBtn.addEventListener('click', () => {
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

  setState(state, data = {}) {
    this.currentState = state;
    if (!this.element) return;

    applyDockVisuals(this.cache, state, data);
  }

  setProgress(percent) {
    setDockProgress(this.cache, percent);
  }

  getState() {
    return this.currentState;
  }
}

module.exports = {
  TaskDock,
  TASK_DOCK_STATES
};
