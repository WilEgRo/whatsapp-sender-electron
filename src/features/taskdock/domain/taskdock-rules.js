/**
 * WhatsApp Sender Electron - TaskDock Feature
 * Domain: TaskDock Rules
 * 
 * Reglas de negocio puras, estados y restricciones de ciclo de vida del dock de tareas
 * sin dependencias de DOM, Electron ni IPC.
 */

const TASK_DOCK_STATES = Object.freeze({
  HIDDEN: 'hidden',
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error'
});

/**
 * Valida si un estado pertenece a la máquina de estados permitida del TaskDock.
 * @param {string} state
 * @returns {boolean}
 */
function isValidDockState(state) {
  return Object.values(TASK_DOCK_STATES).includes(state);
}

/**
 * Normaliza el valor de porcentaje entre 0 y 100 con redondeo seguro.
 * @param {number} percent
 * @returns {number}
 */
function clampProgress(percent) {
  const clamped = Math.min(100, Math.max(0, Number(percent) || 0));
  return Math.round(clamped);
}

/**
 * Devuelve la configuración visual estándar asociada a cada estado de ejecución.
 * @param {string} state
 * @returns {{ badgeClass: string, label: string, showPause: boolean, showCancel: boolean, showClose: boolean, showTimer: boolean }}
 */
function resolveBadgeStyle(state) {
  switch (state) {
    case TASK_DOCK_STATES.RUNNING:
      return {
        badgeClass: 'status-badge status-badge--info',
        label: 'En ejecución',
        showPause: true,
        showCancel: true,
        showClose: false,
        showTimer: true
      };

    case TASK_DOCK_STATES.PAUSED:
      return {
        badgeClass: 'status-badge status-badge--warning',
        label: 'En pausa',
        showPause: true,
        showCancel: true,
        showClose: false,
        showTimer: true
      };

    case TASK_DOCK_STATES.COMPLETED:
      return {
        badgeClass: 'status-badge status-badge--success',
        label: 'Completado',
        showPause: false,
        showCancel: false,
        showClose: true,
        showTimer: false
      };

    case TASK_DOCK_STATES.ERROR:
      return {
        badgeClass: 'status-badge status-badge--danger',
        label: 'Error / Cancelado',
        showPause: false,
        showCancel: false,
        showClose: true,
        showTimer: false
      };

    case TASK_DOCK_STATES.IDLE:
    default:
      return {
        badgeClass: 'status-badge status-badge--neutral',
        label: 'Inactivo',
        showPause: false,
        showCancel: false,
        showClose: false,
        showTimer: false
      };
  }
}

module.exports = {
  TASK_DOCK_STATES,
  isValidDockState,
  clampProgress,
  resolveBadgeStyle
};
