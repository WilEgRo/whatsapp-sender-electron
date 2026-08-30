function normalizeNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function getInteractionTimestamp(controller, contact) {
  const byId = controller.lastInteractionById[contact.id] || 0;
  const byNumber = controller.lastInteractionByNumber[normalizeNumber(contact.number)] || 0;
  return Math.max(byId, byNumber);
}

function sortByInteraction(controller, contacts) {
  return (Array.isArray(contacts) ? contacts : []).slice().sort((a, b) => {
    const tA = getInteractionTimestamp(controller, a);
    const tB = getInteractionTimestamp(controller, b);

    if (tA !== tB) {
      return tB - tA;
    }

    const nameA = String(a?.name || '');
    const nameB = String(b?.name || '');
    return nameA.localeCompare(nameB, 'es');
  });
}

function applyContactFilter(controller) {
  const term = String(controller.contactSearchTerm || '').trim().toLowerCase();

  const orderedContacts = sortByInteraction(controller, controller.contacts);

  const decorateStatus = (contact) => {
    const status = typeof controller.getDestinationStatus === 'function'
      ? controller.getDestinationStatus('contacts', contact?.id)
      : { sentToday: false, lastSentAt: null };

    return {
      ...contact,
      sentToday: Boolean(status.sentToday),
      lastSentAt: status.lastSentAt || null
    };
  };

  controller.filteredContacts = term
    ? orderedContacts.filter((contact) => {
        if (!contact) return false;
        const nameStr = String(contact.name || '').toLowerCase();
        const numberStr = String(contact.number || '').toLowerCase();
        return nameStr.includes(term) || numberStr.includes(term);
      }).map(decorateStatus)
    : orderedContacts.slice(0, 200).map(decorateStatus);

  // Preservar el orden exacto de inserción/Excel sin reordenar por interacción
  controller.selectedContacts = (Array.isArray(controller.selectedContacts) ? controller.selectedContacts : []).map(decorateStatus);

  controller.ui.renderSelectedContacts(controller.selectedContacts);
  controller.ui.renderContactResults(controller.filteredContacts, controller.contactSearchTerm, (controller.contacts || []).length);
}

function selectContact(controller, contactId) {
  const alreadySelected = controller.selectedContacts.find((contact) => contact.id === contactId);
  if (alreadySelected) {
    removeSelectedContact(controller, contactId);
    return;
  }

  const contact = controller.contacts.find((item) => item.id === contactId);
  if (!contact) {
    return;
  }

  controller.selectedContacts.push(contact);
  controller.ui.renderSelectedContacts(controller.selectedContacts);
  controller.ui.renderContactResults(controller.filteredContacts, controller.contactSearchTerm);
  controller.saveFormData();
}

function removeSelectedContact(controller, contactId) {
  controller.selectedContacts = controller.selectedContacts.filter((contact) => contact.id !== contactId);
  controller.ui.renderSelectedContacts(controller.selectedContacts);
  controller.ui.renderContactResults(controller.filteredContacts, controller.contactSearchTerm);
  controller.saveFormData();
}

function clearSelectedContacts(controller) {
  controller.selectedContacts = [];
  controller.ui.renderSelectedContacts([]);
  controller.ui.renderContactResults(controller.filteredContacts, controller.contactSearchTerm);
  controller.saveFormData();
}

function syncManualNumbers(controller, textValue) {
  const rawTokens = String(textValue || '')
    .split(/[\n,\s]+/)
    .map((token) => normalizeNumber(token))
    .filter((num) => num.length >= 7 && num.length <= 15);

  const existingMap = new Map();
  (controller.contacts || []).forEach((c) => existingMap.set(c.number, c));
  (controller.selectedContacts || []).forEach((c) => {
    if (!existingMap.has(c.number)) {
      existingMap.set(c.number, c);
    }
  });

  const updatedSelected = [];
  const seen = new Set();

  rawTokens.forEach((num) => {
    if (!seen.has(num)) {
      seen.add(num);
      const existing = existingMap.get(num);
      if (existing) {
        updatedSelected.push(existing);
      } else {
        updatedSelected.push({
          id: `${num}@c.us`,
          name: num,
          number: num
        });
      }
    }
  });

  controller.selectedContacts = updatedSelected;
  // Pasar updateNumbersField = false para no mover el cursor mientras escribe
  controller.ui.renderSelectedContacts(controller.selectedContacts, false);
  controller.saveFormData();
}

async function importExcelContacts(controller) {
  try {
    console.log('[Contacts] Solicitando importación de Excel...');
    const response = await controller.ipcClient.invoke('import-excel-contacts');

    if (!response || response.canceled) {
      return;
    }

    if (!response.success) {
      controller.ui.showToast(`Error importando Excel: ${response.error}`, 'error');
      return;
    }

    const imported = Array.isArray(response.contacts) ? response.contacts : [];
    if (imported.length === 0) {
      controller.ui.showToast('No se encontraron números válidos en el archivo Excel', 'warning');
      return;
    }

    // Insertar en orden EXACTO del Excel, eliminando duplicados consecutivos si los hay
    const newSelected = [];
    const seen = new Set();

    imported.forEach((item) => {
      if (!seen.has(item.number)) {
        seen.add(item.number);
        newSelected.push(item);
      }
    });

    controller.selectedContacts = newSelected;
    applyContactFilter(controller);
    controller.saveFormData();

    controller.ui.showToast(`Importados ${imported.length} contactos desde Excel en el orden exacto del archivo.`, 'success');
  } catch (error) {
    console.error('[Contacts] Error importando Excel:', error);
    controller.ui.showToast('No se pudo procesar el archivo Excel', 'error');
  }
}

async function loadContacts(controller) {
  try {
    console.log('[Contacts] Solicitando contactos al proceso principal...');
    const response = await controller.ipcClient.invoke('get-contacts');
    if (!response.success) {
      controller.ui.showToast(`Error cargando contactos: ${response.error}`, 'error');
      return;
    }

    controller.contacts = Array.isArray(response.contacts) ? response.contacts : [];
    console.log(`[Contacts] Contactos cargados: ${controller.contacts.length}`);
    applyContactFilter(controller);
  } catch (error) {
    console.error('Error en get-contacts:', error);
    controller.ui.showToast('No se pudieron cargar los contactos', 'error');
  }
}

function markContactsAsRecentlyMessaged(controller, targets = []) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return;
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const normalizedSet = new Set(
    targets.map((target) => normalizeNumber(String(target).replace('@c.us', ''))).filter(Boolean)
  );
  const targetIdSet = new Set(
    targets.map((target) => String(target || '').trim()).filter(Boolean)
  );

  targets.forEach((target) => {
    const safeTarget = String(target || '').trim();
    if (!safeTarget) return;
    const numDigits = normalizeNumber(safeTarget);

    controller.sentTodayByMode.contacts.add(safeTarget);
    controller.lastSentAtByMode.contacts[safeTarget] = nowIso;

    if (numDigits) {
      controller.sentTodayByMode.contacts.add(numDigits);
      controller.sentTodayByMode.contacts.add(`${numDigits}@c.us`);
      controller.lastSentAtByMode.contacts[numDigits] = nowIso;
      controller.lastSentAtByMode.contacts[`${numDigits}@c.us`] = nowIso;
    }
  });

  (controller.contacts || []).forEach((contact) => {
    const contactNumber = normalizeNumber(contact.number);
    const contactIdNumber = normalizeNumber(String(contact.id || '').replace('@c.us', ''));

    if (targetIdSet.has(contact.id) || normalizedSet.has(contactNumber) || normalizedSet.has(contactIdNumber)) {
      controller.lastInteractionById[contact.id] = now;
      controller.lastInteractionByNumber[contactNumber] = now;
      controller.sentTodayByMode.contacts.add(contact.id);
      controller.lastSentAtByMode.contacts[contact.id] = nowIso;
    }
  });

  if (typeof controller.ui?.renderSelectedContacts === 'function') {
    controller.ui.renderSelectedContacts(controller.selectedContacts);
  }

  controller.saveFormData();
  applyContactFilter(controller);
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
