/**
 * WhatsApp Sender Electron - TaskDock Feature
 * Application: Manage TaskDock
 * 
 * Casos de uso para inicialización, actualización de progreso y transiciones
 * de estado del modelo de datos de la tarea en ejecución.
 * Sin dependencias del DOM.
 */

const {
  TASK_DOCK_STATES,
  isValidDockState,
  clampProgress
} = require('../domain/taskdock-rules');

/**
 * Crea un modelo inicial representativo de una tarea en segundo plano.
 * @param {string} [initialState='hidden']
 * @param {Object} [data={}]
 * @returns {{ state: string, title: string, current: string, percent: number, timer: string|null }}
 */
function createTaskDockModel(initialState = TASK_DOCK_STATES.HIDDEN, data = {}) {
  const safeState = isValidDockState(initialState) ? initialState : TASK_DOCK_STATES.HIDDEN;

  return {
    state: safeState,
    title: String(data.title || ''),
    current: String(data.current !== undefined ? data.current : ''),
    percent: clampProgress(data.percent || 0),
    timer: data.timer !== undefined ? data.timer : null
  };
}

/**
 * Actualiza el modelo ante una transición de estado y nuevos datos.
 * @param {Object} currentModel
 * @param {string} nextState
 * @param {Object} [data={}]
 * @returns {Object}
 */
function transitionTaskDockModel(currentModel, nextState, data = {}) {
  const safeState = isValidDockState(nextState) ? nextState : (currentModel && currentModel.state) || TASK_DOCK_STATES.HIDDEN;

  return {
    state: safeState,
    title: data.title !== undefined ? String(data.title) : (currentModel && currentModel.title) || '',
    current: data.current !== undefined ? String(data.current) : (currentModel && currentModel.current) || '',
    percent: data.percent !== undefined ? clampProgress(data.percent) : (currentModel && currentModel.percent) || 0,
    timer: data.timer !== undefined ? data.timer : (currentModel && currentModel.timer) || null
  };
}

module.exports = {
  createTaskDockModel,
  transitionTaskDockModel
};
