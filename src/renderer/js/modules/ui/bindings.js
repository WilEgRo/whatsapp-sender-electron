const SECTION_METADATA = {
  contacts: { title: 'Despachador de Campañas', desc: 'Composición y despacho seguro de campañas para contactos' },
  groups: { title: 'Operaciones de Grupos', desc: 'Envío, gestión e inspección de seguridad en grupos de WhatsApp' },
  'group-import': { title: 'Crear Grupo desde Excel', desc: 'Importación de participantes y reconciliación de identidades' },
  'chat-export': { title: 'Exportar Chat', desc: 'Exportación de conversaciones completas de WhatsApp en formatos legibles o respaldo técnico' },
  scheduling: { title: 'Programación', desc: 'Envíos desatendidos y cola de mensajes automatizados' },
  statistics: { title: 'Historial & Métricas', desc: 'Análisis de volumen, entregabilidad y registros persistentes' },
  admin: { title: 'Consola Admin', desc: 'Métricas de dispositivos y auditoría del sistema' }
};

function updateSectionContext(tab) {
  const meta = SECTION_METADATA[tab];
  if (!meta) return;
  const titleEl = document.getElementById('currentSectionTitle');
  const descEl = document.getElementById('currentSectionDesc');
  if (titleEl) titleEl.textContent = meta.title;
  if (descEl) descEl.textContent = meta.desc;
}

function bindTabs(onTabChange) {
  const tabs = Array.from(document.querySelectorAll('[data-tab]'));

  tabs.forEach((tabButton) => {
    tabButton.addEventListener('click', () => {
      const tab = tabButton.dataset.tab;
      tabs.forEach((button) => button.classList.remove('active'));
      tabButton.classList.add('active');

      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === tab);
      });

      updateSectionContext(tab);
      onTabChange(tab);
    });
  });
}

function bindFileRemovals(onRemove) {
  document.querySelectorAll('[data-files-container]').forEach((container) => {
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-file]');
      if (!button) {
        return;
      }

      const index = Number(button.dataset.removeFile);
      const mode = button.dataset.mode;
      onRemove(mode, index);
    });
  });
}

function bindFileReorder(onMove) {
  document.querySelectorAll('[data-files-container]').forEach((container) => {
    container.addEventListener('click', (event) => {
      const button = event.target.closest('[data-move-file]');
      if (!button) {
        return;
      }

      const index = Number(button.dataset.fileIndex);
      const mode = button.dataset.mode;
      const direction = button.dataset.moveFile;

      if (!Number.isFinite(index) || !mode || !direction) {
        return;
      }

      onMove(mode, index, direction);
    });
  });
}

function bindGroupSearch(onSearch) {
  if (!this.groupSearchInput) {
    return;
  }

  this.groupSearchInput.addEventListener('input', (event) => {
    onSearch(event.target.value || '');
  });
}

function bindGroupExport(onExport) {
  const excelButton = document.getElementById('exportGroupExcel');
  const csvButton = document.getElementById('exportGroupCsv');

  const triggerExport = (format) => {
    if (typeof onExport !== 'function') {
      return;
    }

    const groupId = this.groupExportSelect ? this.groupExportSelect.value : '';
    onExport({ groupId, format });
  };

  if (excelButton) {
    excelButton.addEventListener('click', () => triggerExport('xlsx'));
  }

  if (csvButton) {
    csvButton.addEventListener('click', () => triggerExport('csv'));
  }
}

function bindContactSearch(onSearch) {
  if (!this.contactSearchInput) {
    return;
  }

  this.contactSearchInput.addEventListener('input', (event) => {
    onSearch(event.target.value || '');
  });
}

function bindContactResults(onSelectContact) {
  if (!this.contactResultsList) {
    return;
  }

  this.contactResultsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-contact-id]');
    if (!button) {
      return;
    }

    const contactId = button.dataset.contactId;
    if (!contactId) {
      return;
    }

    if (typeof onSelectContact === 'function') {
      onSelectContact(contactId);
    }
  });
}

function bindSelectedContactRemoval(onRemoveContact) {
  if (!this.selectedContactsChips) {
    return;
  }

  this.selectedContactsChips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-contact-id]');
    if (!button) {
      return;
    }

    const contactId = button.dataset.removeContactId;
    if (!contactId) {
      return;
    }

    if (typeof onRemoveContact === 'function') {
      onRemoveContact(contactId);
    }
  });
}

function bindGroupChecklist(onToggleGroup) {
  if (!this.groupsChecklist) {
    return;
  }

  this.groupsChecklist.addEventListener('click', (event) => {
    const row = event.target.closest('[data-group-id]');
    if (!row) {
      return;
    }

    const groupId = row.dataset.groupId;
    if (!groupId) {
      return;
    }

    let isSelected = false;
    if (this.selectedGroupIds.has(groupId)) {
      this.selectedGroupIds.delete(groupId);
    } else {
      this.selectedGroupIds.add(groupId);
      isSelected = true;
    }

    const selectedIds = Array.from(this.selectedGroupIds);

    if (typeof onToggleGroup === 'function') {
      onToggleGroup({ selectedIds, groupId, isSelected });
    }

    this.paintGroupSelection();
  });
}

function bindStatsActions(onRefresh, onExport, onRangeChange, onCustomRangeApply) {
  const refreshButton = document.getElementById('refreshStatsButton');
  const exportButton = document.getElementById('exportStatsExcelButton');
  const rangeSelect = document.getElementById('historyRangeDays');
  const applyCustomButton = document.getElementById('applyHistoryRange');

  if (refreshButton) {
    refreshButton.addEventListener('click', () => {
      if (typeof onRefresh === 'function') {
        onRefresh();
      }
    });
  }

  if (exportButton) {
    exportButton.addEventListener('click', () => {
      if (typeof onExport === 'function') {
        onExport();
      }
    });
  }

  if (rangeSelect) {
    rangeSelect.addEventListener('change', () => {
      const rangePreset = String(rangeSelect.value || 'last-30');
      if (typeof onRangeChange === 'function') {
        onRangeChange(rangePreset);
      }
    });
  }

  if (applyCustomButton) {
    applyCustomButton.addEventListener('click', () => {
      const fromInput = document.getElementById('historyStartDate');
      const toInput = document.getElementById('historyEndDate');

      if (typeof onCustomRangeApply === 'function') {
        onCustomRangeApply({
          customFrom: fromInput ? fromInput.value : '',
          customTo: toInput ? toInput.value : ''
        });
      }
    });
  }
}

module.exports = {
  bindTabs,
  bindFileRemovals,
  bindFileReorder,
  bindGroupSearch,
  bindGroupExport,
  bindContactSearch,
  bindContactResults,
  bindSelectedContactRemoval,
  bindGroupChecklist,
  bindStatsActions
};
