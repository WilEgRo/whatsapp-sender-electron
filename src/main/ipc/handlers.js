const FileService = require('../services/file-service');
const os = require('os');
const crypto = require('crypto');

function formatSuccess(result) {
  return { success: true, result };
}

function formatError(error) {
  return { success: false, error: error.message || String(error) };
}

function registerIpcHandlers({ ipcMain, dialog, getMainWindow, getWhatsAppService, getScheduledMessageService }) {
  ipcMain.handle('send-batch-message', async (_event, payload) => {
    const whatsappService = getWhatsAppService();
    const mainWindow = getMainWindow();

    const onProgress = (progress) => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('send-progress', progress);
      }
    };

    try {
      const senderByType = {
        contacts: () => whatsappService.sendToContacts(payload, onProgress),
        groups: () => whatsappService.sendToGroups(payload, onProgress)
      };

      const sender = senderByType[payload.targetType];
      if (!sender) {
        throw new Error('Tipo de envio no soportado');
      }

      const outcome = await sender();
      if (outcome && outcome.cancelled) {
        return { success: true, result: outcome.results || [], cancelled: true };
      }

      const resultList = Array.isArray(outcome) ? outcome : (outcome && outcome.results ? outcome.results : []);
      return formatSuccess(resultList);
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('cancel-send', async () => {
    const whatsappService = getWhatsAppService();
    if (whatsappService && typeof whatsappService.requestCancelSend === 'function') {
      whatsappService.requestCancelSend();
    }
    return formatSuccess({ cancelled: true });
  });

  ipcMain.handle('send-message', async (_event, payload) => {
    const whatsappService = getWhatsAppService();

    try {
      const result = await whatsappService.sendToContacts(payload);
      return formatSuccess(result);
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('send-group-message', async (_event, payload) => {
    const whatsappService = getWhatsAppService();

    try {
      const result = await whatsappService.sendToGroups(payload);
      return formatSuccess(result);
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-groups', async () => {
    const whatsappService = getWhatsAppService();

    try {
      const groups = await whatsappService.getGroups();
      return { success: true, groups };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-contacts', async () => {
    const whatsappService = getWhatsAppService();

    try {
      const contacts = await whatsappService.getContacts();
      return { success: true, contacts };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-group-members', async (_event, payload) => {
    const whatsappService = getWhatsAppService();

    try {
      const group = await whatsappService.getGroupMembers(payload && payload.groupId);
      return { success: true, group };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('export-group-members', async (_event, payload) => {
    const whatsappService = getWhatsAppService();
    const mainWindow = getMainWindow();

    try {
      const group = await whatsappService.getGroupMembers(payload && payload.groupId);
      const result = await FileService.exportGroupMembers(dialog, mainWindow, {
        groupName: group.groupName,
        members: group.members,
        format: payload && payload.format
      });

      return {
        success: true,
        canceled: result.canceled,
        result: {
          ...result,
          groupName: group.groupName
        }
      };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('export-group-import-results', async (_event, payload) => {
    const mainWindow = getMainWindow();
    try {
      const result = await FileService.exportGroupImportResults(dialog, mainWindow, {
        groupName: payload && payload.groupName,
        participants: payload && payload.participants
      });
      return { success: true, ...result };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('select-files', async () => {
    const mainWindow = getMainWindow();
    return FileService.selectFiles(dialog, mainWindow);
  });

  ipcMain.handle('import-excel-contacts', async () => {
    const mainWindow = getMainWindow();
    try {
      const result = await FileService.importExcelContacts(dialog, mainWindow);
      return { success: true, ...result };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-message-stats', async (_event, payload) => {
    const whatsappService = getWhatsAppService();

    try {
      const stats = await whatsappService.getMessageStatistics({
        referenceDate: payload && payload.referenceDate,
        filter: payload && payload.filter
      });
      return { success: true, stats };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('export-message-stats', async (_event, payload) => {
    const whatsappService = getWhatsAppService();
    const mainWindow = getMainWindow();

    try {
      const result = await whatsappService.exportMessageStatistics({
        dialog,
        mainWindow,
        referenceDate: payload && payload.referenceDate,
        filter: payload && payload.filter
      });

      return {
        success: true,
        canceled: result.canceled,
        result
      };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-destination-statuses', async (_event, payload) => {
    const whatsappService = getWhatsAppService();

    try {
      const result = await whatsappService.getDestinationStatuses({
        destinationType: payload && payload.destinationType,
        destinationIds: payload && payload.destinationIds,
        referenceDate: payload && payload.referenceDate
      });

      return { success: true, result };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-message-log-history', async (_event, payload) => {
    const whatsappService = getWhatsAppService();

    try {
      const items = await whatsappService.getMessageLogsForBackup({
        limit: payload && payload.limit ? payload.limit : 200000
      });

      return { success: true, items };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-chat-history-preview', async (_event, payload) => {
    const whatsappService = getWhatsAppService();
    const targetChatId = (payload && payload.chatId) || 'desconocido';

    try {
      const result = await whatsappService.getChatHistoryPreview({
        chatId: payload && payload.chatId,
        limit: payload && payload.limit
      });

      return formatSuccess(result);
    } catch (error) {
      const errorMsg = error && error.message ? error.message : String(error);
      return {
        success: false,
        error: `[get-chat-history-preview] No se pudo recuperar el historial para '${targetChatId}': ${errorMsg}`
      };
    }
  });

  ipcMain.handle('download-chat-media', async (_event, payload) => {
    const whatsappService = getWhatsAppService();
    try {
      const result = await whatsappService.downloadMessageMedia({
        chatId: payload && payload.chatId,
        messageId: payload && payload.messageId
      });
      return result;
    } catch (error) {
      return {
        success: false,
        messageId: payload && payload.messageId,
        error: error && error.message ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('cleanup-export-media', async (_event, payload) => {
    const whatsappService = getWhatsAppService();
    try {
      const result = await whatsappService.cleanupTempMedia({
        filePaths: payload && payload.filePaths
      });
      return result;
    } catch (error) {
      return {
        success: false,
        removedCount: 0,
        error: error && error.message ? error.message : String(error)
      };
    }
  });

  ipcMain.handle('create-scheduled-message', async (_event, payload) => {
    const scheduledService = getScheduledMessageService();

    try {
      const item = await scheduledService.createSchedule(payload || {});
      return { success: true, item };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-scheduled-messages', async (_event, payload) => {
    const scheduledService = getScheduledMessageService();

    try {
      const items = await scheduledService.listSchedules({
        status: payload && payload.status ? payload.status : 'pending'
      });
      return { success: true, items };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('cancel-scheduled-message', async (_event, payload) => {
    const scheduledService = getScheduledMessageService();

    try {
      const result = await scheduledService.cancelSchedule(payload && payload.id);
      return { success: true, result };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('process-scheduled-messages-now', async () => {
    const scheduledService = getScheduledMessageService();

    try {
      await scheduledService.processDueMessages();
      return { success: true };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-device-fingerprint', async () => {
    try {
      const source = [
        os.hostname(),
        os.platform(),
        os.arch(),
        String(os.totalmem())
      ].join('|');

      const hash = crypto.createHash('sha256').update(source).digest('hex');
      return { success: true, fingerprint: hash };
    } catch (error) {
      return formatError(error);
    }
  });

  ipcMain.handle('get-whatsapp-session-state', async () => {
    const whatsappService = getWhatsAppService();
    if (!whatsappService) {
      return {
        success: true,
        state: {
          status: 'disconnected',
          isAuthenticated: false,
          isReady: false,
          isSyncingGroups: false,
          loadingPercent: 0,
          loadingMessage: '',
          qrCode: null,
          groupsCount: 0,
          groups: []
        }
      };
    }

    return {
      success: true,
      state: whatsappService.getSessionStatus()
    };
  });

  ipcMain.on('renderer-ready', async () => {
    const mainWindow = getMainWindow();
    const whatsappService = getWhatsAppService();

    if (!mainWindow || !whatsappService) {
      return;
    }

    const sessionSnapshot = whatsappService.getSessionStatus();
    mainWindow.webContents.send('whatsapp-session-snapshot', sessionSnapshot);

    if (sessionSnapshot.isReady) {
      mainWindow.webContents.send('whatsapp-ready');
      if (Array.isArray(sessionSnapshot.groups) && sessionSnapshot.groups.length > 0) {
        mainWindow.webContents.send('groups-loaded', sessionSnapshot.groups);
      }
      if (!sessionSnapshot.isSyncingGroups) {
        mainWindow.webContents.send('groups-sync-status', {
          state: 'completed',
          total: sessionSnapshot.groupsCount
        });
      }
      return;
    }

    if (sessionSnapshot.status === 'qr' && sessionSnapshot.qrCode) {
      mainWindow.webContents.send('whatsapp-qr', sessionSnapshot.qrCode);
      return;
    }

    if (sessionSnapshot.status === 'loading') {
      mainWindow.webContents.send('whatsapp-loading-screen', {
        percent: sessionSnapshot.loadingPercent,
        message: sessionSnapshot.loadingMessage
      });
      return;
    }

    if (sessionSnapshot.isAuthenticated) {
      mainWindow.webContents.send('whatsapp-authenticated');
      return;
    }

    if (sessionSnapshot.status === 'starting') {
      mainWindow.webContents.send('server-ready');
      return;
    }

    if (sessionSnapshot.status === 'disconnected') {
      mainWindow.webContents.send('whatsapp-disconnected', 'Cliente no conectado');
    }
  });
}

module.exports = {
  registerIpcHandlers
};
