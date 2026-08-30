/**
 * Campaign Audience Module
 * Manages unified recipient audience (contacts and groups),
 * deduplication, and count summaries for Campaign Dispatcher.
 */

function normalizeNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

class CampaignAudience {
  constructor() {
    this.activeSource = 'contacts'; // 'contacts' | 'groups'
    this.selectedContacts = [];
    this.selectedGroupIds = new Set();
    this.groupsCatalog = [];
  }

  setSource(source) {
    if (source === 'contacts' || source === 'groups') {
      this.activeSource = source;
    }
  }

  getSource() {
    return this.activeSource;
  }

  // --- Contacts Management ---
  setSelectedContacts(contacts) {
    if (!Array.isArray(contacts)) {
      this.selectedContacts = [];
      return;
    }
    // Deduplicate by number
    const seen = new Set();
    this.selectedContacts = contacts.filter((c) => {
      const num = normalizeNumber(c?.number);
      if (!num || seen.has(num)) {
        return false;
      }
      seen.add(num);
      return true;
    });
  }

  addContact(contact) {
    if (!contact || !contact.number) return false;
    const num = normalizeNumber(contact.number);
    if (!num) return false;

    const exists = this.selectedContacts.some((c) => normalizeNumber(c.number) === num);
    if (!exists) {
      this.selectedContacts.push(contact);
      return true;
    }
    return false;
  }

  removeContact(contactIdOrNumber) {
    const target = String(contactIdOrNumber);
    const prevLen = this.selectedContacts.length;
    this.selectedContacts = this.selectedContacts.filter(
      (c) => c.id !== target && normalizeNumber(c.number) !== normalizeNumber(target)
    );
    return this.selectedContacts.length < prevLen;
  }

  clearContacts() {
    this.selectedContacts = [];
  }

  // --- Groups Management ---
  setGroupsCatalog(groups) {
    this.groupsCatalog = Array.isArray(groups) ? groups : [];
  }

  setSelectedGroupIds(groupIds) {
    this.selectedGroupIds = new Set(Array.isArray(groupIds) ? groupIds.filter(Boolean) : []);
  }

  toggleGroup(groupId) {
    if (!groupId) return;
    if (this.selectedGroupIds.has(groupId)) {
      this.selectedGroupIds.delete(groupId);
    } else {
      this.selectedGroupIds.add(groupId);
    }
  }

  clearGroups() {
    this.selectedGroupIds.clear();
  }

  // --- Aggregated Queries ---
  getContactsCount() {
    return this.selectedContacts.length;
  }

  getGroupsCount() {
    return this.selectedGroupIds.size;
  }

  getActiveRecipientsCount() {
    return this.activeSource === 'groups'
      ? this.getGroupsCount()
      : this.getContactsCount();
  }

  getTotalRecipientsCount() {
    return this.getContactsCount() + this.getGroupsCount();
  }

  isValid() {
    return this.getActiveRecipientsCount() > 0;
  }

  getRecipientsSummary() {
    return {
      source: this.activeSource,
      contactsCount: this.getContactsCount(),
      groupsCount: this.getGroupsCount(),
      activeCount: this.getActiveRecipientsCount(),
      totalCount: this.getTotalRecipientsCount(),
      isValid: this.isValid()
    };
  }

  clearAll() {
    this.clearContacts();
    this.clearGroups();
  }
}

module.exports = {
  CampaignAudience,
  normalizeNumber
};
