/**
 * WhatsApp Sender Electron - Contacts Feature
 * Presentation: Contacts Controller
 * 
 * Controlador de presentación enfocado exclusivamente en la gestión de contactos.
 * Conecta eventos de interfaz con casos de uso de aplicación, pasarela IPC y vistas.
 */

const {
  filterAndRankContacts,
  parseManualNumbersText,
  normalizeImportedContacts,
  recordRecentInteractions
} = require('../application/normalize-contacts');

const {
  toggleContactSelection,
  removeContactSelection,
  clearAllSelectedContacts
} = require('../application/select-contacts');

const {
  ContactsIpcGateway
} = require('../infrastructure/contacts-ipc-gateway');

class ContactsController {
  /**
   * @param {Object} options
   * @param {Object} [options.ipcClient]
   * @param {Object} [options.ui]
   * @param {Function} [options.getDestinationStatusFn]
   * @param {Function} [options.onSaveFormData]
   * @param {Object} [options.stateRef] - Referencia al estado compartido para retrocompatibilidad
   */
  constructor(options = {}) {
    this.gateway = new ContactsIpcGateway(options.ipcClient);
    this.ui = options.ui || null;
    this.getDestinationStatusFn = options.getDestinationStatusFn || null;
    this.onSaveFormData = options.onSaveFormData || null;
    this.stateRef = options.stateRef || null;

    this._contacts = [];
    this._filteredContacts = [];
    this._selectedContacts = [];
    this._searchTerm = '';
  }

  // Getters y setters sincronizados con stateRef si existe
  get contacts() {
    return this.stateRef && Array.isArray(this.stateRef.contacts) ? this.stateRef.contacts : this._contacts;
  }
  set contacts(val) {
    this._contacts = Array.isArray(val) ? val : [];
    if (this.stateRef) this.stateRef.contacts = this._contacts;
  }

  get filteredContacts() {
    return this.stateRef && Array.isArray(this.stateRef.filteredContacts) ? this.stateRef.filteredContacts : this._filteredContacts;
  }
  set filteredContacts(val) {
    this._filteredContacts = Array.isArray(val) ? val : [];
    if (this.stateRef) this.stateRef.filteredContacts = this._filteredContacts;
  }

  get selectedContacts() {
    return this.stateRef && Array.isArray(this.stateRef.selectedContacts) ? this.stateRef.selectedContacts : this._selectedContacts;
  }
  set selectedContacts(val) {
    this._selectedContacts = Array.isArray(val) ? val : [];
    if (this.stateRef) this.stateRef.selectedContacts = this._selectedContacts;
  }

  get searchTerm() {
    return this.stateRef && typeof this.stateRef.contactSearchTerm === 'string'
      ? this.stateRef.contactSearchTerm
      : this._searchTerm;
  }
  set searchTerm(val) {
    this._searchTerm = String(val || '');
    if (this.stateRef) this.stateRef.contactSearchTerm = this._searchTerm;
  }

  _getInteractionState() {
    return {
      lastInteractionById: (this.stateRef && this.stateRef.lastInteractionById) || {},
      lastInteractionByNumber: (this.stateRef && this.stateRef.lastInteractionByNumber) || {}
    };
  }

  _saveForm() {
    if (typeof this.onSaveFormData === 'function') {
      this.onSaveFormData();
    } else if (this.stateRef && typeof this.stateRef.saveFormData === 'function') {
      this.stateRef.saveFormData();
    }
  }

  _renderUi(updateNumbersField = true) {
    if (!this.ui && this.stateRef && this.stateRef.ui) {
      this.ui = this.stateRef.ui;
    }

    if (this.ui) {
      if (typeof this.ui.renderSelectedContacts === 'function') {
        this.ui.renderSelectedContacts(this.selectedContacts, updateNumbersField);
      }
      if (typeof this.ui.renderContactResults === 'function') {
        this.ui.renderContactResults(this.filteredContacts, this.searchTerm, this.contacts.length);
      }
    }
  }

  /**
   * Carga los contactos desde el cliente de WhatsApp a través del IPC Gateway.
   */
  async loadContacts() {
    try {
      console.log('[ContactsController] Solicitando contactos...');
      const response = await this.gateway.getContacts();

      if (!response || !response.success) {
        const errorMsg = (response && response.error) || 'Error desconocido';
        if (this.ui) this.ui.showToast(`Error cargando contactos: ${errorMsg}`, 'error');
        return;
      }

      this.contacts = Array.isArray(response.contacts) ? response.contacts : [];
      console.log(`[ContactsController] Contactos cargados: ${this.contacts.length}`);
      this.applyContactFilter();
    } catch (error) {
      console.error('Error en loadContacts:', error);
      if (this.ui) this.ui.showToast('No se pudieron cargar los contactos', 'error');
    }
  }

  /**
   * Aplica el filtro de búsqueda y ordenamiento de contactos.
   */
  applyContactFilter() {
    const statusFn = this.getDestinationStatusFn ||
      (this.stateRef && typeof this.stateRef.getDestinationStatus === 'function'
        ? (id) => this.stateRef.getDestinationStatus('contacts', id)
        : null);

    this.filteredContacts = filterAndRankContacts({
      contacts: this.contacts,
      searchTerm: this.searchTerm,
      interactionState: this._getInteractionState(),
      getDestinationStatusFn: statusFn,
      limit: 200
    });

    if (statusFn && Array.isArray(this.selectedContacts)) {
      this.selectedContacts = this.selectedContacts.map((contact) => {
        const status = statusFn(contact && (contact.id || contact.number));
        return {
          ...contact,
          sentToday: Boolean(status && status.sentToday),
          lastSentAt: (status && status.lastSentAt) || null
        };
      });
    }

    this._renderUi(true);
  }

  /**
   * Alterna la selección de un contacto específico.
   * @param {string} contactId
   */
  selectContact(contactId) {
    const result = toggleContactSelection(this.selectedContacts, this.contacts, contactId);
    this.selectedContacts = result.selected;
    this._renderUi(true);
    this._saveForm();
  }

  /**
   * Elimina un contacto de la lista de seleccionados.
   * @param {string} contactId
   */
  removeSelectedContact(contactId) {
    this.selectedContacts = removeContactSelection(this.selectedContacts, contactId);
    this._renderUi(true);
    this._saveForm();
  }

  /**
   * Limpia toda la selección de contactos.
   */
  clearSelectedContacts() {
    this.selectedContacts = clearAllSelectedContacts();
    this._renderUi(true);
    this._saveForm();
  }

  /**
   * Sincroniza los números ingresados manualmente en el textarea.
   * @param {string} textValue
   */
  syncManualNumbers(textValue) {
    this.selectedContacts = parseManualNumbersText(textValue, {
      existingContacts: this.contacts,
      currentSelected: this.selectedContacts
    });

    this._renderUi(false);
    this._saveForm();
  }

  /**
   * Importa contactos desde un archivo Excel a través del IPC Gateway.
   */
  async importExcelContacts() {
    try {
      console.log('[ContactsController] Solicitando importación de Excel...');
      const response = await this.gateway.importExcelContacts();

      if (!response || response.canceled) {
        return;
      }

      if (!response.success) {
        if (this.ui) this.ui.showToast(`Error importando Excel: ${response.error}`, 'error');
        return;
      }

      const imported = Array.isArray(response.contacts) ? response.contacts : [];
      if (imported.length === 0) {
        if (this.ui) this.ui.showToast('No se encontraron números válidos en el archivo Excel', 'warning');
        return;
      }

      this.selectedContacts = normalizeImportedContacts(imported);
      this.applyContactFilter();
      this._saveForm();

      if (this.ui) {
        this.ui.showToast(`Importados ${imported.length} contactos desde Excel en el orden exacto del archivo.`, 'success');
      }
    } catch (error) {
      console.error('[ContactsController] Error importando Excel:', error);
      if (this.ui) this.ui.showToast('No se pudo procesar el archivo Excel', 'error');
    }
  }

  /**
   * Marca contactos como contactados recientemente tras un envío.
   * @param {Array<string>} targets
   */
  markContactsAsRecentlyMessaged(targets = []) {
    if (!Array.isArray(targets) || targets.length === 0) {
      return;
    }

    const lastInteractionById = (this.stateRef && this.stateRef.lastInteractionById) || {};
    const lastInteractionByNumber = (this.stateRef && this.stateRef.lastInteractionByNumber) || {};
    const sentTodaySet = (this.stateRef && this.stateRef.sentTodayByMode && this.stateRef.sentTodayByMode.contacts) || new Set();
    const lastSentAtMap = (this.stateRef && this.stateRef.lastSentAtByMode && this.stateRef.lastSentAtByMode.contacts) || {};

    recordRecentInteractions({
      targets,
      contacts: this.contacts,
      lastInteractionById,
      lastInteractionByNumber,
      sentTodaySet,
      lastSentAtMap
    });

    if (this.ui && typeof this.ui.renderSelectedContacts === 'function') {
      this.ui.renderSelectedContacts(this.selectedContacts);
    }

    this._saveForm();
    this.applyContactFilter();
  }
}

module.exports = {
  ContactsController
};
