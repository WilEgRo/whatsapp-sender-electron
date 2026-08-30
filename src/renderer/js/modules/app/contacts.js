/**
 * WhatsApp Sender Electron - Contacts Module
 * Backwards-compatibility adapter delegating to Contacts Vertical Slice (v3.5.4)
 */

const {
  ContactsController
} = require('../../../../features/contacts/presentation/contacts-controller');

function getOrCreateContactsController(controller) {
  if (!controller.contactsController) {
    controller.contactsController = new ContactsController({
      stateRef: controller,
      ui: controller.ui,
      ipcClient: controller.ipcClient
    });
  }
  return controller.contactsController;
}

function applyContactFilter(controller) {
  return getOrCreateContactsController(controller).applyContactFilter();
}

function selectContact(controller, contactId) {
  return getOrCreateContactsController(controller).selectContact(contactId);
}

function removeSelectedContact(controller, contactId) {
  return getOrCreateContactsController(controller).removeSelectedContact(contactId);
}

function clearSelectedContacts(controller) {
  return getOrCreateContactsController(controller).clearSelectedContacts();
}

function syncManualNumbers(controller, textValue) {
  return getOrCreateContactsController(controller).syncManualNumbers(textValue);
}

function importExcelContacts(controller) {
  return getOrCreateContactsController(controller).importExcelContacts();
}

function loadContacts(controller) {
  return getOrCreateContactsController(controller).loadContacts();
}

function markContactsAsRecentlyMessaged(controller, targets) {
  return getOrCreateContactsController(controller).markContactsAsRecentlyMessaged(targets);
}

module.exports = {
  applyContactFilter,
  selectContact,
  removeSelectedContact,
  clearSelectedContacts,
  syncManualNumbers,
  importExcelContacts,
  loadContacts,
  markContactsAsRecentlyMessaged
};
