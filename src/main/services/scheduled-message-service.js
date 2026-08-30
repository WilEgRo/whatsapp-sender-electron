const cron = require('node-cron');

class ScheduledMessageService {
  constructor({ repository, whatsappService }) {
    this.repository = repository;
    this.whatsappService = whatsappService;
    this.task = null;
    this.processing = false;
  }

  start() {
    if (this.task) {
      return;
    }

    this.task = cron.schedule('*/1 * * * *', async () => {
      await this.processDueMessages();
    }, {
      timezone: 'America/La_Paz'
    });
  }

  stop() {
    if (!this.task) {
      return;
    }

    this.task.stop();
    this.task.destroy();
    this.task = null;
  }

  toIsoFromDatetimeLocal(datetimeLocal) {
    const value = String(datetimeLocal || '').trim();
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  }

  async createSchedule(payload = {}) {
    const targetType = payload.targetType === 'groups' ? 'groups' : 'contacts';
    const targetId = String(payload.targetId || '').trim();
    const targetLabel = String(payload.targetLabel || '').trim();
    const messageText = String(payload.messageText || '').trim();
    const files = Array.isArray(payload.files) ? payload.files : [];
    const sendFilesFirst = payload.sendFilesFirst !== false;
    const delayMin = Number(payload.delayMin || 3);
    const delayMax = Number(payload.delayMax || 6);

    if (!targetId) {
      throw new Error('Debes seleccionar un destinatario');
    }

    if (!messageText && files.length === 0) {
      throw new Error('Debes ingresar mensaje o adjuntar archivos');
    }

    const scheduledAtIso = this.toIsoFromDatetimeLocal(payload.scheduledAt) || String(payload.scheduledAtIso || '').trim();
    if (!scheduledAtIso) {
      throw new Error('Fecha/hora programada invalida');
    }

    const createdAtIso = new Date().toISOString();
    const id = await this.repository.insertScheduledMessage({
      createdAtIso,
      scheduledAtIso,
      targetType,
      targetId,
      targetLabel,
      messageText,
      files,
      sendFilesFirst,
      delayMin,
      delayMax
    });

    return {
      id,
      createdAtIso,
      scheduledAtIso,
      targetType,
      targetId,
      targetLabel: targetLabel || targetId,
      messageText,
      files,
      sendFilesFirst,
      delayMin,
      delayMax,
      status: 'pending'
    };
  }

  listSchedules({ status = 'pending' } = {}) {
    return this.repository.getScheduledMessages({ status, limit: 500 });
  }

  async cancelSchedule(id) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new Error('Id invalido');
    }

    await this.repository.cancelScheduledMessage(numericId);
    return {
      id: numericId,
      status: 'canceled'
    };
  }

  async processDueMessages() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      const nowIso = new Date().toISOString();
      const due = await this.repository.getDueScheduledMessages(nowIso);

      for (const item of due) {
        try {
          await this.repository.markScheduledProcessing(item.id);
          await this.whatsappService.sendScheduledMessage(item);
          await this.repository.markScheduledSent(item.id, new Date().toISOString());
        } catch (error) {
          await this.repository.markScheduledFailed(item.id, error && error.message ? error.message : String(error));
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

module.exports = ScheduledMessageService;
