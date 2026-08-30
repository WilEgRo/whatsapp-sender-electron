/**
 * WhatsApp Sender Electron - Groups Feature
 * Presentation: Groups Controller
 * 
 * Controlador de presentación enfocado exclusivamente en la gestión de grupos.
 * Conecta eventos de interfaz con casos de uso de aplicación, pasarela IPC y vistas.
 */

const {
  filterAndDecorateGroups,
  prepareGroupExportOptions
} = require('../application/normalize-groups');

const {
  syncExportSelectionState
} = require('../application/select-groups');

const {
  GroupsIpcGateway
} = require('../infrastructure/groups-ipc-gateway');

class GroupsController {
  /**
   * @param {Object} options
   * @param {Object} [options.ipcClient]
   * @param {Object} [options.ui]
   * @param {Function} [options.getDestinationStatusFn]
   * @param {Object} [options.stateRef] - Referencia al estado compartido para retrocompatibilidad
   */
  constructor(options = {}) {
    this.gateway = new GroupsIpcGateway(options.ipcClient);
    this.ui = options.ui || null;
    this.getDestinationStatusFn = options.getDestinationStatusFn || null;
    this.stateRef = options.stateRef || null;

    this._groups = [];
    this._filteredGroups = [];
    this._searchTerm = '';
    this._exportGroupId = '';
  }

  // Getters y setters sincronizados con stateRef si existe
  get groups() {
    return this.stateRef && Array.isArray(this.stateRef.groups) ? this.stateRef.groups : this._groups;
  }
  set groups(val) {
    this._groups = Array.isArray(val) ? val : [];
    if (this.stateRef) this.stateRef.groups = this._groups;
  }

  get filteredGroups() {
    return this._filteredGroups;
  }
  set filteredGroups(val) {
    this._filteredGroups = Array.isArray(val) ? val : [];
  }

  get searchTerm() {
    return this.stateRef && typeof this.stateRef.groupSearchTerm === 'string'
      ? this.stateRef.groupSearchTerm
      : this._searchTerm;
  }
  set searchTerm(val) {
    this._searchTerm = String(val || '');
    if (this.stateRef) this.stateRef.groupSearchTerm = this._searchTerm;
  }

  get exportGroupId() {
    return this.stateRef && typeof this.stateRef.exportGroupId === 'string'
      ? this.stateRef.exportGroupId
      : this._exportGroupId;
  }
  set exportGroupId(val) {
    this._exportGroupId = String(val || '');
    if (this.stateRef) this.stateRef.exportGroupId = this._exportGroupId;
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
   * Carga los grupos desde WhatsApp en el proceso principal.
   */
  async loadGroups() {
    const ui = this._getUi();
    try {
      console.log('[GroupsController] Solicitando grupos al proceso principal...');
      const response = await this.gateway.getGroups();

      if (!response || !response.success) {
        const errorMsg = (response && response.error) || 'Error desconocido';
        if (ui) ui.showToast(`Error cargando grupos: ${errorMsg}`, 'error');
        return;
      }

      this.groups = Array.isArray(response.groups) ? response.groups : [];
      console.log(`[GroupsController] Grupos cargados: ${this.groups.length}`);
      this.applyGroupFilter();

      if (ui && typeof ui.renderGroupExportOptions === 'function') {
        ui.renderGroupExportOptions(this.groups, this.exportGroupId);
      }
    } catch (error) {
      console.error('Error en loadGroups:', error);
      if (ui) ui.showToast('No se pudieron cargar los grupos', 'error');
    }
  }

  /**
   * Aplica el filtro de búsqueda y refresca la visualización de los grupos.
   */
  applyGroupFilter() {
    const ui = this._getUi();
    const statusFn = this.getDestinationStatusFn ||
      (this.stateRef && typeof this.stateRef.getDestinationStatus === 'function'
        ? (id) => this.stateRef.getDestinationStatus('groups', id)
        : null);

    this.filteredGroups = filterAndDecorateGroups({
      groups: this.groups,
      searchTerm: this.searchTerm,
      getDestinationStatusFn: statusFn
    });

    if (ui && typeof ui.renderGroups === 'function') {
      ui.renderGroups(this.filteredGroups, this.searchTerm);
    }
  }

  /**
   * Sincroniza la selección del grupo seleccionado para exportar integrantes.
   * @param {Object} togglePayload
   */
  syncExportSelection(togglePayload) {
    const ui = this._getUi();
    if (!togglePayload || !togglePayload.groupId) {
      return;
    }

    this.exportGroupId = syncExportSelectionState(this.exportGroupId, togglePayload);

    if (ui && typeof ui.renderGroupExportOptions === 'function') {
      ui.renderGroupExportOptions(this.groups, this.exportGroupId);
    }
  }

  /**
   * Exporta los integrantes del grupo indicado a Excel o CSV.
   * @param {string} groupId
   * @param {string} format
   */
  async exportGroupMembers(groupId, format) {
    const ui = this._getUi();
    const isReady = this.stateRef ? Boolean(this.stateRef.isReady) : true;

    if (!isReady) {
      if (ui) ui.showToast('WhatsApp no esta conectado todavia', 'error');
      return;
    }

    if (!groupId) {
      if (ui) {
        ui.updateGroupMembersInfo('Selecciona un grupo para exportar sus integrantes.', 'error');
        ui.showToast('Primero selecciona un grupo para exportar', 'warning');
      }
      return;
    }

    const exportFormat = format === 'xlsx' ? 'xlsx' : 'csv';
    if (ui) ui.updateGroupMembersInfo('Preparando exportacion de integrantes...', '');

    try {
      const response = await this.gateway.exportGroupMembers({
        groupId,
        format: exportFormat
      });

      if (!response || !response.success) {
        const errorMsg = (response && response.error) || 'Error desconocido';
        if (ui) {
          ui.updateGroupMembersInfo(`Error: ${errorMsg}`, 'error');
          ui.showToast(`No se pudo exportar: ${errorMsg}`, 'error');
        }
        return;
      }

      if (response.canceled) {
        if (ui) ui.updateGroupMembersInfo('Exportacion cancelada por el usuario.', '');
        return;
      }

      const total = response.result && Number.isFinite(response.result.total) ? response.result.total : 0;
      const groupName = response.result && response.result.groupName ? response.result.groupName : 'grupo';

      if (ui) {
        ui.updateGroupMembersInfo(`Exportado ${total} integrantes de ${groupName}.`, 'ok');
        ui.showToast(`Exportado en ${exportFormat.toUpperCase()}: ${total} integrantes.`, 'success');
      }
      console.log(`[GroupsController] Exportacion completada para ${groupName}`);
    } catch (error) {
      console.error('Error exportando integrantes de grupo:', error);
      if (ui) {
        ui.updateGroupMembersInfo('Error inesperado durante la exportacion.', 'error');
        ui.showToast('Error inesperado al exportar integrantes', 'error');
      }
    }
  }
}

module.exports = {
  GroupsController
};
