const express = require('express');
const createWhatsAppGroupImportRouter = require('./whatsapp-group-import.routes');

function createExpressServer({ scheduledMessageService, whatsappService }) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/whatsapp/groups', createWhatsAppGroupImportRouter({ whatsappService }));

  app.get('/api/health', (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      now: new Date().toISOString()
    });
  });

  app.get('/api/schedules', async (req, res) => {
    try {
      const status = String(req.query.status || 'pending');
      const items = await scheduledMessageService.listSchedules({ status });
      res.json({ success: true, items });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  app.post('/api/schedules', async (req, res) => {
    try {
      const created = await scheduledMessageService.createSchedule(req.body || {});
      res.status(201).json({ success: true, item: created });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message || String(error) });
    }
  });

  app.delete('/api/schedules/:id', async (req, res) => {
    try {
      const result = await scheduledMessageService.cancelSchedule(req.params.id);
      res.json({ success: true, result });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message || String(error) });
    }
  });

  app.post('/api/schedules/process-now', async (_req, res) => {
    try {
      await scheduledMessageService.processDueMessages();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message || String(error) });
    }
  });

  return app;
}

function startExpressServer({ scheduledMessageService, whatsappService, port = 3210 }) {
  const app = createExpressServer({ scheduledMessageService, whatsappService });
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`[HTTP] Scheduling API escuchando en http://127.0.0.1:${port}`);
  });

  return server;
}

module.exports = {
  startExpressServer
};
