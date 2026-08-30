/**
 * WhatsApp Sender Electron - Scheduling Feature
 * Presentation: Scheduling Controller
 * 
 * Controlador de presentación enfocado exclusivamente en la gestión de mensajes programados.
 * Conecta eventos de interfaz con casos de uso de aplicación, pasarela IPC y vistas.
 */

const {
  normalizeScheduleDraft
} = require('../domain/scheduling-rules');

const {
  prepareSchedulePayload
} = require('../application/schedule-campaign');

const {
  buildScheduleTargetOptions
} = require('../application/manage-schedules');

const {
  SchedulingIpcGateway
} = require('../infrastructure/scheduling-ipc-gateway');

class SchedulingController {
  /**
   * @param {Object} options
   * @param {Object} [options.ipcClient]
   * @param {Object} [options.ui]
   * @param {Object} [options.stateRef] - Referencia a AppController para retrocompatibilidad
   */
  constructor(options = {}) {
    this.gateway = new SchedulingIpcGateway(options.ipcClient);
    this.ui = options.ui || null;
    this.stateRef = options.stateRef || null;

    this._scheduleDraft = {
      targetType: 'contacts',
      targetId: '',
      files: [],
      sendFilesFirst: true
    };
  }

  get draft() {
    if (this.stateRef && this.stateRef.scheduleDraft) {
      return this.stateRef.scheduleDraft;
    }
    return this._scheduleDraft;
  }

  set draft(val) {
    const clean = normalizeScheduleDraft(val);
    this._scheduleDraft = clean;
    if (this.stateRef) {
      this.stateRef.scheduleDraft = clean;
    }
  }

  _getUi() {
    if (this.ui) return this.ui;
    if (this.stateRef && this.stateRef.ui) {
      this.ui = this.stateRef.ui;
      return this.ui;
    }
    return null;
  }

  /**
   * Actualiza el selector de destinatarios según el modo y catálogos proporcionados.
   * @param {string} mode - 'contacts' | 'groups'
   * @param {Array<Object>} [contacts=[]]
   * @param {Array<Object>} [groups=[]]
   * @param {string} [selectedTargetId='']
   */
  updateTargetOptions(mode, contacts = [], groups = [], selectedTargetId = '') {
    const ui = this._getUi();
    const safeMode = mode === 'groups' ? 'groups' : 'contacts';
    const targetId = selectedTargetId || this.draft.targetId;

    if (ui && typeof ui.renderScheduleTargetOptions === 'function') {
      ui.renderScheduleTargetOptions(safeMode, contacts, groups, targetId);
    }
  }

  /**
   * Asocia los eventos de la interfaz correspondientes al módulo de programación.
   */
  bindEvents() {
    const ui = this._getUi();
    if (!ui) return;

    if (ui.scheduleTargetType) {
      ui.scheduleTargetType.addEventListener('change', () => {
        const nextMode = ui.scheduleTargetType.value === 'groups' ? 'groups' : 'contacts';
        this.draft.targetType = nextMode;
        this.draft.targetId = '';
        const contacts = (this.stateRef && this.stateRef.contacts) || [];
        const groups = (this.stateRef && this.stateRef.groups) || [];
        this.updateTargetOptions(nextMode, contacts, groups, '');
      });
    }

    if (ui.scheduleTargetId) {
      ui.scheduleTargetId.addEventListener('change', () => {
        this.draft.targetId = String(ui.scheduleTargetId.value || '').trim();
      });
    }

    const selectScheduleFilesButton = document.getElementById('selectFilesSchedule');
    if (selectScheduleFilesButton) {
      selectScheduleFilesButton.addEventListener('click', async () => {
        await this.selectScheduleFiles();
      });
    }

    const filesFirst = document.getElementById('sendFilesFirstSchedule');
    const textFirst = document.getElementById('sendTextFirstSchedule');

    if (filesFirst) {
      filesFirst.addEventListener('change', () => {
        this.draft.sendFilesFirst = Boolean(filesFirst.checked);
      });
    }

    if (textFirst) {
      textFirst.addEventListener('change', () => {
        this.draft.sendFilesFirst = !Boolean(textFirst.checked);
      });
    }

    const createButton = document.getElementById('createScheduleButton');
    if (createButton) {
      createButton.addEventListener('click', () => this.createScheduledMessage());
    }

    const refreshButton = document.getElementById('refreshScheduleButton');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => this.refreshScheduledMessages({ silent: false }));
    }

    if (ui.scheduledMessagesList) {
      ui.scheduledMessagesList.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-cancel-schedule-id]');
        if (!button) return;

        const scheduleId = Number(button.dataset.cancelScheduleId);
        if (!Number.isFinite(scheduleId)) return;

        await this.cancelScheduledMessage(scheduleId);
      });
    }
  }

  /**
   * Abre el diálogo de selección de archivos adjuntos para programación.
   */
  async selectScheduleFiles() {
    const ui = this._getUi();
    try {
      const selected = await this.gateway.selectFiles();
      this.draft.files = Array.isArray(selected) ? selected.slice(0, 3) : [];
      if (ui && typeof ui.renderFiles === 'function') {
        ui.renderFiles('schedule', this.draft.files);
      }
    } catch (error) {
      console.error('Error seleccionando archivos programados:', error);
      if (ui && typeof ui.showToast === 'function') {
        ui.showToast('No se pudieron seleccionar archivos para programacion', 'error');
      }
    }
  }

  /**
   * Crea un nuevo mensaje programado a partir de los datos ingresados en el formulario.
   */
  async createScheduledMessage() {
    const ui = this._getUi();

    if (this.stateRef && typeof this.stateRef.hasFeature === 'function' && !this.stateRef.hasFeature('bulk_send')) {
      if (ui) ui.showToast('Tu plan no incluye programacion de envios masivos.', 'warning');
      return;
    }

    const targetType = ui && ui.scheduleTargetType && ui.scheduleTargetType.value === 'groups' ? 'groups' : 'contacts';
    const targetId = ui && ui.scheduleTargetId ? String(ui.scheduleTargetId.value || '').trim() : '';
    const targetLabel = ui && ui.scheduleTargetId && ui.scheduleTargetId.selectedOptions && ui.scheduleTargetId.selectedOptions[0]
      ? ui.scheduleTargetId.selectedOptions[0].textContent
      : targetId;

    const messageText = ui && ui.scheduleMessageText ? String(ui.scheduleMessageText.value || '').trim() : '';
    const scheduledAt = ui && ui.scheduleDatetime ? String(ui.scheduleDatetime.value || '').trim() : '';
    const delayMin = ui && ui.scheduleDelayMin ? Number(ui.scheduleDelayMin.value || 3) : 3;
    const delayMax = ui && ui.scheduleDelayMax ? Number(ui.scheduleDelayMax.value || 6) : 6;

    const preparation = prepareSchedulePayload({
      targetType,
      targetId,
      targetLabel,
      messageText,
      files: this.draft.files,
      sendFilesFirst: this.draft.sendFilesFirst !== false,
      delayMin,
      delayMax,
      scheduledAt
    });

    if (!preparation.valid) {
      const firstError = preparation.errors[0];
      const message = firstError ? firstError.message : 'Parámetros de programación inválidos';
      if (ui) ui.showToast(message, 'warning');
      return;
    }

    try {
      const response = await this.gateway.createScheduledMessage(preparation.payload);

      if (!response || !response.success) {
        const errorMsg = (response && response.error) || 'error desconocido';
        if (ui) ui.showToast(`No se pudo programar: ${errorMsg}`, 'error');
        return;
      }

      if (ui) {
        ui.showToast('Mensaje programado correctamente', 'success');
        if (ui.scheduleMessageText) ui.scheduleMessageText.value = '';
        if (ui.scheduleDatetime) ui.scheduleDatetime.value = '';
      }

      this.draft.files = [];
      if (ui && typeof ui.renderFiles === 'function') {
        ui.renderFiles('schedule', []);
      }

      await this.refreshScheduledMessages({ silent: true });
    } catch (error) {
      console.error('Error creando mensaje programado:', error);
      if (ui) ui.showToast('Error inesperado al programar mensaje', 'error');
    }
  }

  /**
   * Recarga la lista de mensajes programados pendientes desde el proceso principal.
   * @param {Object} [options]
   * @param {boolean} [options.silent=true]
   */
  async refreshScheduledMessages({ silent = true } = {}) {
    const ui = this._getUi();
    try {
      const response = await this.gateway.getScheduledMessages({ status: 'pending' });

      if (!response || !response.success) {
        if (!silent && ui) {
          ui.showToast('No se pudo cargar la lista de programados', 'warning');
        }
        return;
      }

      if (ui && typeof ui.renderScheduledMessages === 'function') {
        ui.renderScheduledMessages(response.items || []);
      }
    } catch (error) {
      console.error('Error listando programados:', error);
      if (!silent && ui) {
        ui.showToast('Error inesperado al listar programados', 'error');
      }
    }
  }

  /**
   * Cancela una programación pendiente por su ID.
   * @param {number|string} id
   */
  async cancelScheduledMessage(id) {
    const ui = this._getUi();
    try {
      const response = await this.gateway.cancelScheduledMessage(id);

      if (!response || !response.success) {
        const errorMsg = (response && response.error) || 'error desconocido';
        if (ui) ui.showToast(`No se pudo cancelar: ${errorMsg}`, 'error');
        return;
      }

      if (ui) ui.showToast('Mensaje programado cancelado', 'success');
      await this.refreshScheduledMessages({ silent: true });
    } catch (error) {
      console.error('Error cancelando programado:', error);
      if (ui) ui.showToast('Error inesperado al cancelar', 'error');
    }
  }
}

module.exports = {
  SchedulingController
};
