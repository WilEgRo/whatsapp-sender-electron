const { Chart } = require('chart.js/auto');
const { normalizeDailyTimeline } = require('./timeline-utils');

function getExtension(fileName) {
  return (fileName.split('.').pop() || '').toLowerCase();
}

function getFileIcon(extension) {
  const iconMap = {
    pdf: 'DOC',
    doc: 'DOC',
    docx: 'DOC',
    txt: 'TXT',
    jpg: 'IMG',
    jpeg: 'IMG',
    png: 'IMG',
    gif: 'IMG',
    mp4: 'VID',
    avi: 'VID',
    mov: 'VID',
    mp3: 'AUD',
    wav: 'AUD'
  };

  return iconMap[extension] || 'FILE';
}

function formatLastSentTime(lastSentAt) {
  if (!lastSentAt) {
    return 'Sin hora registrada';
  }

  const parsed = new Date(lastSentAt);
  if (Number.isNaN(parsed.getTime())) {
    return 'Sin hora registrada';
  }

  return parsed.toLocaleTimeString('es-BO', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function buildTodayBadge(lastSentAt) {
  const label = `Enviado hoy a las ${formatLastSentTime(lastSentAt)}`;
  return `<span class="target-status-badge target-status-badge--today" title="${label}">Hoy</span>`;
}

function buildTodayStatusIndicator(sentToday, lastSentAt) {
  if (sentToday) {
    const label = `Enviado hoy a las ${formatLastSentTime(lastSentAt)}`;
    return `<span class="status-indicator status-indicator--sent-today" title="${label}"></span>`;
  }
  return `<span class="status-indicator status-indicator--not-sent" title="No enviado hoy"></span>`;
}

function renderFiles(mode, files) {
  const container = document.querySelector(`[data-files-container="${mode}"]`);
  if (!container) {
    return;
  }

  const toFileUri = (filePath) => {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    return encodeURI(`file:///${normalized}`);
  };

  const buildPreview = (file) => {
    const extension = getExtension(file.name);
    const uri = toFileUri(file.path);

    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
      return `<img class="file-chip__thumb" src="${uri}" alt="Preview ${file.name}">`;
    }

    if (['mp4', 'avi', 'mov', 'webm'].includes(extension)) {
      return `<video class="file-chip__thumb" src="${uri}" muted preload="metadata"></video>`;
    }

    return '';
  };

  if (files.length === 0) {
    container.innerHTML = '<p class="hint">No hay archivos seleccionados.</p>';
    return;
  }

  container.innerHTML = files
    .map((file, index) => {
      const extension = getExtension(file.name);
      const icon = getFileIcon(extension);

      return `
        <article class="file-chip">
          <div class="file-chip__meta">
            <span class="file-chip__icon">${icon}</span>
            ${buildPreview(file)}
            <div>
              <p class="file-chip__name">${file.name}</p>
              <p class="file-chip__path">${file.path}</p>
            </div>
          </div>
          <div class="file-chip__actions">
            <button class="file-chip__move" type="button" data-move-file="up" data-file-index="${index}" data-mode="${mode}" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="file-chip__move" type="button" data-move-file="down" data-file-index="${index}" data-mode="${mode}" ${index === files.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="file-chip__remove" type="button" data-remove-file="${index}" data-mode="${mode}">Quitar</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function updateGroupCounter(count) {
  this.totalGroupsElement.textContent = String(count);
}

function updateFilterInfo(filteredCount, totalCount, term) {
  if (!this.groupFilterInfo) {
    return;
  }

  if (!term) {
    this.groupFilterInfo.textContent = `Mostrando todos los grupos: ${totalCount}.`;
    return;
  }

  this.groupFilterInfo.textContent = `Filtro "${term}": ${filteredCount} de ${totalCount} grupos.`;
}

function renderGroups(groups, searchTerm = '') {
  if (!this.groupsChecklist) {
    return;
  }

  const safeGroups = Array.isArray(groups) ? groups : [];
  const normalizedTerm = String(searchTerm || '').trim().toLowerCase();
  const filteredGroups = normalizedTerm
    ? safeGroups.filter((group) => {
        if (!group) return false;
        const nameStr = String(group.name ?? group.title ?? group.formattedTitle ?? '');
        return nameStr.toLowerCase().includes(normalizedTerm);
      })
    : safeGroups;

  this.visibleFilteredGroups = filteredGroups;

  if (!filteredGroups.length) {
    this.groupsChecklist.innerHTML = `
      <p class="group-checklist__empty">${normalizedTerm ? 'Sin resultados para el filtro actual' : 'No se encontraron grupos'}</p>
    `;
    updateGroupCounter.call(this, safeGroups.length);
    updateFilterInfo.call(this, 0, safeGroups.length, normalizedTerm);
    return;
  }

  this.groupsChecklist.innerHTML = filteredGroups
    .map((group) => {
      const groupName = group ? (group.name ?? group.title ?? group.formattedTitle ?? 'Grupo sin nombre') : 'Grupo sin nombre';
      const groupId = (group && group.id) ? group.id : '';
      return `
      <button type="button" class="group-row" data-group-id="${groupId}">
        <span class="group-row__check">${this.selectedGroupIds.has(groupId) ? '✓' : ''}</span>
        <span class="group-row__name">${groupName}</span>
        <span class="group-row__sent-today">
          ${buildTodayStatusIndicator(group ? group.sentToday : false, group ? group.lastSentAt : null)}
          <span class="group-row__sent-today-label">${group && group.sentToday ? `Hoy ${formatLastSentTime(group.lastSentAt)}` : 'Sin enviar'}</span>
        </span>
      </button>
    `;
    })
    .join('');

  updateGroupCounter.call(this, safeGroups.length);
  updateFilterInfo.call(this, filteredGroups.length, safeGroups.length, normalizedTerm);
  paintGroupSelection.call(this);
}

function paintGroupSelection() {
  if (!this.groupsChecklist) {
    return;
  }

  this.groupsChecklist.querySelectorAll('[data-group-id]').forEach((row) => {
    const groupId = row.dataset.groupId;
    const selected = this.selectedGroupIds.has(groupId);
    row.classList.toggle('is-selected', selected);

    const check = row.querySelector('.group-row__check');
    if (check) {
      check.textContent = selected ? '✓' : '';
    }
  });
}

function renderGroupExportOptions(groups, selectedGroupId = '') {
  if (!this.groupExportSelect) {
    return;
  }

  const safeGroups = Array.isArray(groups) ? groups : [];
  const options = ['<option value="">Selecciona un grupo...</option>'];
  safeGroups.forEach((group) => {
    if (!group) return;
    const isSelected = Boolean(selectedGroupId && selectedGroupId === group.id);
    const groupName = group.name ?? group.title ?? group.formattedTitle ?? 'Grupo sin nombre';
    options.push(`<option value="${group.id || ''}" ${isSelected ? 'selected' : ''}>${groupName}</option>`);
  });

  this.groupExportSelect.innerHTML = options.join('');
}

function updateGroupMembersInfo(message, tone = '') {
  if (!this.groupMembersInfo) {
    return;
  }

  this.groupMembersInfo.textContent = message;
  this.groupMembersInfo.className = `hint ${tone}`.trim();
}

function updateContactCounter(numbersRaw) {
  const selectedCount = String(numbersRaw || '')
    .split(/[\n\r,;\t]+/)
    .map((item) => item.trim())
    .filter(Boolean).length;

  const importedTotal = Number.isFinite(Number(this.importedContactsTotal))
    ? Number(this.importedContactsTotal)
    : 0;

  if (importedTotal > 0 && this.totalContactsElement) {
    this.totalContactsElement.textContent = String(importedTotal);
    return;
  }

  if (this.totalContactsElement) {
    this.totalContactsElement.textContent = String(selectedCount);
  }
}

function updateContactFilterInfo(filteredCount, totalCount, term) {
  if (!this.contactFilterInfo || !this.contactResultsCount) {
    return;
  }

  this.contactResultsCount.textContent = `${filteredCount} resultados`;

  if (!term) {
    this.contactFilterInfo.textContent = 'Escribe para filtrar contactos en tiempo real.';
    return;
  }

  if (totalCount !== null && totalCount !== undefined) {
    this.contactFilterInfo.textContent = `Filtro "${term}": ${filteredCount} de ${totalCount}.`;
    return;
  }

  this.contactFilterInfo.textContent = `Filtro "${term}": ${filteredCount} resultados.`;
}

function renderContactResults(contacts, searchTerm = '', totalCount = null) {
  if (!this.contactResultsList) {
    return;
  }

  if (totalCount !== null && totalCount !== undefined) {
    const parsedTotal = Number(totalCount);
    this.importedContactsTotal = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : 0;
    this.totalContactsElement.textContent = String(this.importedContactsTotal);
  }

  const normalized = (searchTerm || '').trim();

  if (!contacts.length) {
    this.contactResultsList.innerHTML = '<p class="contact-results__empty">No hay contactos para mostrar.</p>';
    updateContactFilterInfo.call(this, 0, totalCount || 0, normalized);
    return;
  }

  this.contactResultsList.innerHTML = contacts
    .map((contact) => {
      const selected = this.selectedContactIds.has(contact.id);
      return `
        <button type="button" class="contact-row ${selected ? 'is-selected' : ''}" data-contact-id="${contact.id}">
          <span class="contact-row__name">${contact.name}</span>
          <span class="contact-row__number">${contact.number}</span>
          <span class="contact-row__today">
            ${buildTodayStatusIndicator(contact.sentToday, contact.lastSentAt)}
            <span class="contact-row__today-label">${contact.sentToday ? `Hoy ${formatLastSentTime(contact.lastSentAt)}` : 'Sin enviar'}</span>
          </span>
        </button>
      `;
    })
    .join('');

  updateContactFilterInfo.call(this, contacts.length, totalCount, normalized);
}

function renderSelectedContacts(contacts, updateNumbersField = true) {
  if (!this.selectedContactsChips || !this.numbersField) {
    return;
  }

  this.selectedContactIds = new Set(contacts.map((contact) => contact.id));

  if (!contacts.length) {
    this.selectedContactsChips.innerHTML = '<p class="contact-results__empty">Sin contactos seleccionados.</p>';
    this.selectedContactsCount.textContent = '0 seleccionados';
    if (updateNumbersField) {
      this.numbersField.value = '';
    }
    updateContactCounter.call(this, this.numbersField.value);
    return;
  }

  this.selectedContactsChips.innerHTML = contacts
    .map((contact) => {
      const status = typeof this.controller?.getDestinationStatus === 'function'
        ? this.controller.getDestinationStatus('contacts', contact.id || contact.number)
        : { sentToday: Boolean(contact.sentToday), lastSentAt: contact.lastSentAt || null };

      const isSentToday = Boolean(status.sentToday || contact.sentToday);
      const lastSentAt = status.lastSentAt || contact.lastSentAt || null;

      return `
        <article class="contact-chip">
          <div class="contact-chip__meta">
            <p class="contact-chip__name">${contact.name}</p>
            <p class="contact-chip__number">${contact.number}</p>
            <span class="target-status-tags">
              ${isSentToday ? buildTodayBadge(lastSentAt) : ''}
            </span>
          </div>
          <button type="button" class="contact-chip__remove" data-remove-contact-id="${contact.id}">x</button>
        </article>
      `;
    })
    .join('');

  this.selectedContactsCount.textContent = `${contacts.length} seleccionados`;
  if (updateNumbersField) {
    this.numbersField.value = contacts.map((contact) => contact.number).join(',');
  }
  updateContactCounter.call(this, this.numbersField.value);
}

function renderScheduleTargetOptions(mode, contacts, groups, selectedTargetId = '') {
  if (!this.scheduleTargetId) {
    return;
  }

  const source = mode === 'groups'
    ? (Array.isArray(groups) ? groups : []).map((item) => ({ id: item.id, label: item.name }))
    : (Array.isArray(contacts) ? contacts : []).map((item) => ({ id: item.id, label: `${item.name} (${item.number})` }));

  const options = ['<option value="">Selecciona...</option>'];
  source.forEach((item) => {
    const selected = selectedTargetId && selectedTargetId === item.id;
    options.push(`<option value="${item.id}" ${selected ? 'selected' : ''}>${item.label}</option>`);
  });

  this.scheduleTargetId.innerHTML = options.join('');
}

function renderScheduledMessages(items = []) {
  if (!this.scheduledMessagesList) {
    return;
  }

  const list = Array.isArray(items) ? items : [];

  if (this.scheduledCountHint) {
    this.scheduledCountHint.textContent = `${list.length} programados`;
  }

  if (list.length === 0) {
    this.scheduledMessagesList.innerHTML = '<p class="contact-results__empty">No hay mensajes programados pendientes.</p>';
    return;
  }

  this.scheduledMessagesList.innerHTML = list.map((item) => {
    const dateLabel = item.scheduledAtIso ? new Date(item.scheduledAtIso).toLocaleString('es-BO') : '-';
    const typeLabel = item.targetType === 'groups' ? 'Grupo' : 'Contacto';
    const filesCount = Array.isArray(item.files) ? item.files.length : 0;
    const messagePreview = String(item.messageText || '').trim().slice(0, 90);

    return `
      <article class="scheduled-item">
        <div class="scheduled-item__meta">
          <p class="scheduled-item__title">${typeLabel}: ${item.targetLabel || item.targetId}</p>
          <p class="scheduled-item__time">Programado: ${dateLabel}</p>
          <p class="scheduled-item__summary">${messagePreview || 'Sin texto'}${filesCount > 0 ? ` · ${filesCount} archivo(s)` : ''}</p>
        </div>
        <button class="file-chip__remove" type="button" data-cancel-schedule-id="${item.id}">Cancelar</button>
      </article>
    `;
  }).join('');
}

function setAdminVisible(isVisible) {
  if (!this.adminTab || !this.adminContent) {
    return;
  }

  const visible = Boolean(isVisible);
  this.adminTab.classList.toggle('hidden', !visible);
  this.adminContent.classList.toggle('hidden', !visible);

  if (!visible) {
    this.adminTab.classList.remove('active');
    this.adminContent.classList.remove('active');
  }
}

function setAdminLoading(isLoading) {
  if (!this.adminRefreshButton) {
    return;
  }

  const loading = Boolean(isLoading);
  this.adminRefreshButton.disabled = loading;
  this.adminRefreshButton.textContent = loading ? 'Actualizando...' : 'Actualizar admin';

  const hint = document.getElementById('adminStatusHint');
  if (!hint) {
    return;
  }

  if (loading) {
    hint.textContent = 'Cargando datos de administracion...';
  }
}

function renderAdminOverview(counters = {}) {
  const users = document.getElementById('adminCounterUsers');
  const activeLicenses = document.getElementById('adminCounterActiveLicenses');
  const activeDevices = document.getElementById('adminCounterActiveDevices');
  const events = document.getElementById('adminCounterEvents');
  const hint = document.getElementById('adminStatusHint');

  if (users) {
    users.textContent = String(Number(counters.users || 0));
  }

  if (activeLicenses) {
    activeLicenses.textContent = String(Number(counters.activeLicenses || 0));
  }

  if (activeDevices) {
    activeDevices.textContent = String(Number(counters.activeDevices || 0));
  }

  if (events) {
    events.textContent = String(Number(counters.licenseEvents || 0));
  }

  if (hint) {
    hint.textContent = `Ultima sincronizacion admin: ${new Date().toLocaleTimeString('es-BO')}`;
  }
}

function renderAdminLicenses(items = []) {
  const container = document.getElementById('adminLicensesList');
  if (!container) {
    return;
  }

  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) {
    container.innerHTML = '<p class="contact-results__empty">No hay licencias para mostrar.</p>';
    return;
  }

  container.innerHTML = rows.slice(0, 100).map((item) => {
    const statusClass = item.status === 'active' ? 'target-status-badge--today' : '';
    return `
      <article class="admin-item">
        <div class="admin-item__meta">
          <p class="admin-item__title">${item.userEmail || 'Sin email'} · ${item.key || '-'}</p>
          <p class="admin-item__summary">Plan: ${item.userPlan || '-'} · Estado: <span class="target-status-badge ${statusClass}">${item.status || 'unknown'}</span></p>
        </div>
        <button class="file-chip__remove" type="button" data-admin-revoke-key="${item.key}">Revocar</button>
      </article>
    `;
  }).join('');
}

function renderAdminDevices(items = []) {
  const container = document.getElementById('adminDevicesList');
  if (!container) {
    return;
  }

  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) {
    container.innerHTML = '<p class="contact-results__empty">No hay dispositivos registrados.</p>';
    return;
  }

  container.innerHTML = rows.slice(0, 100).map((item) => {
    const active = item.isActive !== false;
    return `
      <article class="admin-item">
        <div class="admin-item__meta">
          <p class="admin-item__title">${item.deviceName || item.deviceFingerprint || 'Dispositivo'}</p>
          <p class="admin-item__summary">Estado: <span class="target-status-badge ${active ? 'target-status-badge--today' : ''}">${active ? 'activo' : 'inactivo'}</span> · Ultimo uso: ${item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString('es-BO') : '-'}</p>
        </div>
        <button class="file-chip__remove" type="button" data-admin-deactivate-id="${item.id}" ${active ? '' : 'disabled'}>Desactivar</button>
      </article>
    `;
  }).join('');
}

function renderAdminEvents(items = []) {
  const container = document.getElementById('adminEventsList');
  if (!container) {
    return;
  }

  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) {
    container.innerHTML = '<p class="contact-results__empty">No hay eventos registrados.</p>';
    return;
  }

  container.innerHTML = rows.slice(0, 50).map((item) => {
    const timeLabel = item.at ? new Date(item.at).toLocaleString('es-BO') : '-';
    return `
      <article class="admin-item admin-item--event">
        <div class="admin-item__meta">
          <p class="admin-item__title">${item.type || 'evento'}</p>
          <p class="admin-item__summary">${timeLabel}</p>
        </div>
      </article>
    `;
  }).join('');
}

function renderAdminBackups(items = []) {
  const container = document.getElementById('adminBackupsList');
  if (!container) {
    return;
  }

  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) {
    container.innerHTML = '<p class="contact-results__empty">No hay respaldos disponibles.</p>';
    return;
  }

  container.innerHTML = rows.map((item) => {
    const status = String(item.status || 'completed');
    const statusClass = status === 'completed' ? 'target-status-badge--today' : '';
    const totalEntries = Number(item.totalEntries || 0);
    const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleString('es-BO') : '-';
    const completedAt = item.completedAt ? new Date(item.completedAt).toLocaleString('es-BO') : '-';

    return `
      <article class="admin-item">
        <div class="admin-item__meta">
          <p class="admin-item__title">${item.id || '-'}</p>
          <p class="admin-item__summary">Estado: <span class="target-status-badge ${statusClass}">${status}</span> · Registros: ${totalEntries}</p>
          <p class="admin-item__summary">Creado: ${createdAt} · Completado: ${completedAt}</p>
        </div>
        <button class="ghost-button ghost-button--tiny" type="button" data-admin-backup-download-id="${item.id}">Descargar JSON</button>
      </article>
    `;
  }).join('');
}

function getSelectedGroupIds() {
  return Array.from(this.selectedGroupIds);
}

function setStatsLoading(isLoading) {
  const refreshButton = document.getElementById('refreshStatsButton');
  const exportButton = document.getElementById('exportStatsExcelButton');

  if (refreshButton) {
    refreshButton.disabled = Boolean(isLoading);
    refreshButton.textContent = isLoading ? 'Actualizando...' : 'Actualizar';
  }

  if (exportButton) {
    exportButton.disabled = Boolean(isLoading);
  }
}

function renderMessageStats(stats) {
  const todayValue = document.getElementById('statsTodayUnits');
  const weekValue = document.getElementById('statsWeekUnits');
  const monthValue = document.getElementById('statsMonthUnits');
  const referenceDay = document.getElementById('statsReferenceDay');
  const pctContacts = document.getElementById('statsPctContacts');
  const pctGroups = document.getElementById('statsPctGroups');
  const topContact = document.getElementById('statsTopContact');
  const topGroup = document.getElementById('statsTopGroup');
  const topDay = document.getElementById('statsTopDayRecord');
  const topWeek = document.getElementById('statsTopWeekRecord');
  const updatedAt = document.getElementById('statsUpdatedAt');
  const hint = document.getElementById('statsHint');

  if (!stats || !todayValue || !weekValue || !monthValue) {
    return;
  }

  const weekCurrent = Array.isArray(stats.history && stats.history.weekly) && stats.history.weekly.length > 0
    ? Number(stats.history.weekly[0].total_units || 0)
    : 0;

  const monthCurrent = Array.isArray(stats.history && stats.history.monthly) && stats.history.monthly.length > 0
    ? Number(stats.history.monthly[0].total_units || 0)
    : 0;

  const topContactValue = stats.topDestinations && stats.topDestinations.contact
    ? `${stats.topDestinations.contact.display_name || stats.topDestinations.contact.destination_id} (${Number(stats.topDestinations.contact.total_units || 0)})`
    : '-';

  const topGroupValue = stats.topDestinations && stats.topDestinations.group
    ? `${stats.topDestinations.group.display_name || stats.topDestinations.group.destination_id} (${Number(stats.topDestinations.group.total_units || 0)})`
    : '-';

  const topDayValue = stats.records && stats.records.topDay
    ? `${stats.records.topDay.day} (${Number(stats.records.topDay.total_units || 0)})`
    : '-';

  const topWeekValue = stats.records && stats.records.topWeek
    ? `${stats.records.topWeek.week} (${Number(stats.records.topWeek.total_units || 0)})`
    : '-';

  todayValue.textContent = String(Number(stats.today && stats.today.totalUnits ? stats.today.totalUnits : 0));
  weekValue.textContent = String(weekCurrent);
  monthValue.textContent = String(monthCurrent);

  if (referenceDay) {
    referenceDay.textContent = `Fecha: ${stats.referenceDay || '--'}`;
  }

  if (pctContacts) {
    pctContacts.textContent = `${Number(stats.percentages && stats.percentages.contacts ? stats.percentages.contacts : 0)}%`;
  }

  if (pctGroups) {
    pctGroups.textContent = `Grupos: ${Number(stats.percentages && stats.percentages.groups ? stats.percentages.groups : 0)}%`;
  }

  if (topContact) {
    topContact.textContent = topContactValue;
  }

  if (topGroup) {
    topGroup.textContent = topGroupValue;
  }

  if (topDay) {
    topDay.textContent = topDayValue;
  }

  if (topWeek) {
    topWeek.textContent = topWeekValue;
  }

  if (updatedAt) {
    updatedAt.textContent = `Ultima actualizacion: ${new Date().toLocaleTimeString('es-BO')}`;
  }

  if (hint) {
    hint.textContent = 'Datos persistentes en SQLite, incluso despues de reiniciar la app.';
  }
}

function renderMessageStatsHistory(stats, rangeDays = 30) {
  const uniqueTotal = document.getElementById('statsUniqueTotal');
  const uniqueContacts = document.getElementById('statsUniqueContacts');
  const uniqueGroups = document.getElementById('statsUniqueGroups');
  const topContactDetail = document.getElementById('statsTopContactDetail');
  const topGroupDetail = document.getElementById('statsTopGroupDetail');

  const dailyBody = document.getElementById('statsDailyBody');
  const weeklyBody = document.getElementById('statsWeeklyBody');
  const monthlyBody = document.getElementById('statsMonthlyBody');

  if (!stats || !dailyBody || !weeklyBody || !monthlyBody) {
    return;
  }

  const unique = stats.uniqueChats || { total: 0, contacts: 0, groups: 0 };
  if (uniqueTotal) {
    uniqueTotal.textContent = String(Number(unique.total || 0));
  }

  if (uniqueContacts) {
    uniqueContacts.textContent = String(Number(unique.contacts || 0));
  }

  if (uniqueGroups) {
    uniqueGroups.textContent = String(Number(unique.groups || 0));
  }

  if (topContactDetail) {
    topContactDetail.textContent = stats.topDestinations && stats.topDestinations.contact
      ? `${stats.topDestinations.contact.display_name || stats.topDestinations.contact.destination_id} (${Number(stats.topDestinations.contact.total_units || 0)})`
      : '-';
  }

  if (topGroupDetail) {
    topGroupDetail.textContent = stats.topDestinations && stats.topDestinations.group
      ? `${stats.topDestinations.group.display_name || stats.topDestinations.group.destination_id} (${Number(stats.topDestinations.group.total_units || 0)})`
      : '-';
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const parseDay = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
      return null;
    }

    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const filter = stats.filter || null;
  let startDate = parseDay(filter && filter.fromDay);
  let endDate = parseDay(filter && filter.toDay);

  if (!startDate || !endDate) {
    const clampRangeDays = [7, 30, 90].includes(Number(rangeDays)) ? Number(rangeDays) : 30;
    endDate = new Date(today);
    startDate = new Date(today);
    startDate.setDate(today.getDate() - (clampRangeDays - 1));
  }

  const asDate = (isoDate) => {
    const parsed = new Date(`${isoDate}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const weekToDate = (weekKey) => {
    const match = /^([0-9]{4})-W([0-9]{2})$/.exec(String(weekKey || ''));
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const week = Number(match[2]);
    const firstDay = new Date(year, 0, 1);
    const dayOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const firstMonday = new Date(year, 0, 1 + (7 - dayOffset));
    firstMonday.setHours(0, 0, 0, 0);
    firstMonday.setDate(firstMonday.getDate() + ((week - 1) * 7));
    return firstMonday;
  };

  const monthToDate = (monthKey) => {
    const match = /^([0-9]{4})-([0-9]{2})$/.exec(String(monthKey || ''));
    if (!match) {
      return null;
    }

    const parsed = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  };

  const overlapsRange = (periodStart, periodEnd) => {
    if (!periodStart || !periodEnd) {
      return false;
    }

    return periodStart <= endDate && periodEnd >= startDate;
  };

  const dailyItems = (stats.history && Array.isArray(stats.history.daily) ? stats.history.daily : [])
    .filter((item) => {
      const rowDate = asDate(item.day);
      return rowDate && rowDate >= startDate && rowDate <= endDate;
    });

  const weeklyItems = (stats.history && Array.isArray(stats.history.weekly) ? stats.history.weekly : [])
    .filter((item) => {
      const weekStart = weekToDate(item.week);
      if (!weekStart) {
        return false;
      }

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      return overlapsRange(weekStart, weekEnd);
    });

  const monthlyItems = (stats.history && Array.isArray(stats.history.monthly) ? stats.history.monthly : [])
    .filter((item) => {
      const monthStart = monthToDate(item.month);
      if (!monthStart) {
        return false;
      }

      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      return overlapsRange(monthStart, monthEnd);
    });

  const buildRows = (items, labelKey) => {
    if (!Array.isArray(items) || items.length === 0) {
      return '<tr><td colspan="3">Sin datos en el rango seleccionado.</td></tr>';
    }

    return items.slice(0, 12).map((item) => `
      <tr>
        <td>${item[labelKey] || '-'}</td>
        <td>${Number(item.total_units || 0)}</td>
        <td>${Number(item.interactions || 0)}</td>
      </tr>
    `).join('');
  };

  dailyBody.innerHTML = buildRows(dailyItems, 'day');
  weeklyBody.innerHTML = buildRows(weeklyItems, 'week');
  monthlyBody.innerHTML = buildRows(monthlyItems, 'month');
}

function setHistoryCustomRangeVisible(visible) {
  if (!this.historyCustomRange) {
    return;
  }

  this.historyCustomRange.hidden = !visible;
}

function renderHistoryCharts(stats) {
  if (!stats) {
    return;
  }

  const rawDailyRows = Array.isArray(stats.history && stats.history.daily)
    ? stats.history.daily
    : [];

  const weeklyRows = Array.isArray(stats.history && stats.history.weekly)
    ? stats.history.weekly.slice().reverse()
    : [];

  const parseDay = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
      return null;
    }

    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const weekToDate = (weekKey) => {
    const match = /^([0-9]{4})-W([0-9]{2})$/.exec(String(weekKey || ''));
    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const week = Number(match[2]);
    const firstDay = new Date(year, 0, 1);
    const dayOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const firstMonday = new Date(year, 0, 1 + (7 - dayOffset));
    firstMonday.setHours(0, 0, 0, 0);
    firstMonday.setDate(firstMonday.getDate() + ((week - 1) * 7));
    return firstMonday;
  };

  const filter = stats.filter || null;
  const chartStartDate = parseDay(filter && filter.fromDay);
  const chartEndDate = parseDay(filter && filter.toDay);

  // Generate a strictly continuous, gap-free daily timeline with 0 values for inactive days
  const filteredDailyRows = normalizeDailyTimeline({
    dailyRows: rawDailyRows,
    fromDay: filter && filter.fromDay ? filter.fromDay : null,
    toDay: filter && filter.toDay ? filter.toDay : null
  });

  const filteredWeeklyRows = chartStartDate && chartEndDate
    ? weeklyRows.filter((item) => {
      const weekStart = weekToDate(item.week);
      if (!weekStart) {
        return false;
      }

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      return weekStart <= chartEndDate && weekEnd >= chartStartDate;
    })
    : weeklyRows;

  if (this.historyTrendChart) {
    this.historyTrendChart.destroy();
    this.historyTrendChart = null;
  }

  if (this.historyWeeklyChart) {
    this.historyWeeklyChart.destroy();
    this.historyWeeklyChart = null;
  }

  const darkGridColor = 'rgba(51, 65, 85, 0.4)';
  const darkTextColor = '#94a3b8';

  if (this.historyTrendChartEl) {
    this.historyTrendChart = new Chart(this.historyTrendChartEl, {
      type: 'line',
      data: {
        labels: filteredDailyRows.map((item) => item.day),
        datasets: [
          {
            label: 'Unidades (mensajes + adjuntos)',
            data: filteredDailyRows.map((item) => Number(item.total_units || 0)),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5
          },
          {
            label: 'Interacciones (envíos ejecutados)',
            data: filteredDailyRows.map((item) => Number(item.interactions || 0)),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: darkTextColor,
              font: { family: 'Inter', size: 11, weight: '500' }
            }
          },
          tooltip: {
            backgroundColor: '#162032',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: '#283548',
            borderWidth: 1
          }
        },
        scales: {
          x: {
            grid: { color: darkGridColor },
            ticks: {
              color: darkTextColor,
              font: { family: 'JetBrains Mono', size: 10 }
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: darkGridColor },
            ticks: {
              color: darkTextColor,
              precision: 0,
              font: { family: 'JetBrains Mono', size: 10 }
            }
          }
        }
      }
    });
  }

  if (this.historyWeeklyChartEl) {
    this.historyWeeklyChart = new Chart(this.historyWeeklyChartEl, {
      type: 'line',
      data: {
        labels: filteredWeeklyRows.map((item) => item.week),
        datasets: [
          {
            label: 'Unidades por semana (mensajes + adjuntos)',
            data: filteredWeeklyRows.map((item) => Number(item.total_units || 0)),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 5
          },
          {
            label: 'Interacciones por semana (envíos ejecutados)',
            data: filteredWeeklyRows.map((item) => Number(item.interactions || 0)),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.15)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: darkTextColor,
              font: { family: 'Inter', size: 11, weight: '500' }
            }
          },
          tooltip: {
            backgroundColor: '#162032',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: '#283548',
            borderWidth: 1
          }
        },
        scales: {
          x: {
            grid: { color: darkGridColor },
            ticks: {
              color: darkTextColor,
              font: { family: 'JetBrains Mono', size: 10 }
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: darkGridColor },
            ticks: {
              color: darkTextColor,
              precision: 0,
              font: { family: 'JetBrains Mono', size: 10 }
            }
          }
        }
      }
    });
  }
}

module.exports = {
  renderFiles,
  renderGroups,
  paintGroupSelection,
  renderGroupExportOptions,
  updateGroupMembersInfo,
  renderContactResults,
  renderSelectedContacts,
  renderScheduleTargetOptions,
  renderScheduledMessages,
  updateContactFilterInfo,
  updateFilterInfo,
  updateContactCounter,
  updateGroupCounter,
  getSelectedGroupIds,
  getFileIcon,
  getExtension,
  setStatsLoading,
  renderMessageStats,
  renderMessageStatsHistory,
  renderHistoryCharts,
  setHistoryCustomRangeVisible,
  setAdminVisible,
  setAdminLoading,
  renderAdminOverview,
  renderAdminLicenses,
  renderAdminDevices,
  renderAdminEvents,
  renderAdminBackups
};
