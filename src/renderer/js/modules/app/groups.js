function applyGroupFilter(controller) {
  const groupsWithStatus = (Array.isArray(controller.groups) ? controller.groups : []).map((group) => {
    const status = typeof controller.getDestinationStatus === 'function'
      ? controller.getDestinationStatus('groups', group.id)
      : { sentToday: false, lastSentAt: null };

    return {
      ...group,
      sentToday: Boolean(status.sentToday),
      lastSentAt: status.lastSentAt || null
    };
  });

  controller.ui.renderGroups(groupsWithStatus, controller.groupSearchTerm);
}

function syncExportSelectionWithGroup(controller, togglePayload) {
  if (!togglePayload || !togglePayload.groupId) {
    return;
  }

  if (togglePayload.isSelected) {
    controller.exportGroupId = togglePayload.groupId;
  } else if (controller.exportGroupId === togglePayload.groupId) {
    const fallback = Array.isArray(togglePayload.selectedIds) ? togglePayload.selectedIds[0] : '';
    controller.exportGroupId = fallback || '';
  }

  controller.ui.renderGroupExportOptions(controller.groups, controller.exportGroupId);
}

async function loadGroups(controller) {
  try {
    console.log('[Groups] Solicitando grupos al proceso principal...');
    const response = await controller.ipcClient.invoke('get-groups');
    if (!response.success) {
      controller.ui.showToast(`Error cargando grupos: ${response.error}`, 'error');
      return;
    }

    controller.groups = response.groups;
    applyGroupFilter(controller);
    controller.ui.renderGroupExportOptions(controller.groups, controller.exportGroupId);
  } catch (error) {
    console.error('Error en get-groups:', error);
    controller.ui.showToast('No se pudieron cargar los grupos', 'error');
  }
}

async function exportGroupMembers(controller, groupId, format) {
  if (!controller.isReady) {
    controller.ui.showToast('WhatsApp no esta conectado todavia', 'error');
    return;
  }

  if (!groupId) {
    controller.ui.updateGroupMembersInfo('Selecciona un grupo para exportar sus integrantes.', 'error');
    controller.ui.showToast('Primero selecciona un grupo para exportar', 'warning');
    return;
  }

  const exportFormat = format === 'xlsx' ? 'xlsx' : 'csv';
  controller.ui.updateGroupMembersInfo('Preparando exportacion de integrantes...', '');

  try {
    const response = await controller.ipcClient.invoke('export-group-members', {
      groupId,
      format: exportFormat
    });

    if (!response.success) {
      controller.ui.updateGroupMembersInfo(`Error: ${response.error}`, 'error');
      controller.ui.showToast(`No se pudo exportar: ${response.error}`, 'error');
      return;
    }

    if (response.canceled) {
      controller.ui.updateGroupMembersInfo('Exportacion cancelada por el usuario.', '');
      return;
    }

    const fileName = response.result && response.result.filePath ? response.result.filePath : 'archivo';
    const total = response.result && Number.isFinite(response.result.total) ? response.result.total : 0;
    const groupName = response.result && response.result.groupName ? response.result.groupName : 'grupo';

    controller.ui.updateGroupMembersInfo(`Exportado ${total} integrantes de ${groupName}.`, 'ok');
    controller.ui.showToast(`Exportado en ${exportFormat.toUpperCase()}: ${total} integrantes.`, 'success');
    console.log(`[Groups] Exportacion completada: ${fileName}`);
  } catch (error) {
    console.error('Error exportando integrantes de grupo:', error);
    controller.ui.updateGroupMembersInfo('Error inesperado durante la exportacion.', 'error');
    controller.ui.showToast('Error inesperado al exportar integrantes', 'error');
  }
}

module.exports = {
  applyGroupFilter,
  syncExportSelectionWithGroup,
  loadGroups,
  exportGroupMembers
};
