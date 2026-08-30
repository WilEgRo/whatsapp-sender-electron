const express = require('express');
const multer = require('multer');
const path = require('path');
const { WhatsAppGroupImportService } = require('../services/whatsapp-group-import-service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
let groupCreationInProgress = false;

function groupCreationLock(uploadMiddleware) {
  return (req, res, next) => {
    if (groupCreationInProgress) {
      return res.status(409).json({
        success: false,
        error: 'GROUP_CREATION_IN_PROGRESS',
        message: 'Ya existe una creacion de grupo en curso. Espera a que termine antes de iniciar otra.'
      });
    }

    groupCreationInProgress = true;
    try {
      uploadMiddleware(req, res, (error) => {
        if (error) {
          groupCreationInProgress = false;
          return next(error);
        }
        return next();
      });
    } catch (error) {
      groupCreationInProgress = false;
      return next(error);
    }
  };
}

function createWhatsAppGroupImportRouter({ whatsappService }) {
  const router = express.Router();
  const service = new WhatsAppGroupImportService({ whatsappService });

  router.post('/import-excel', groupCreationLock(upload.single('file')), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'Debes adjuntar un archivo Excel en el campo file' });
      }
      if (!String(req.body && req.body.groupName || '').trim()) {
        return res.status(400).json({ success: false, error: 'Debes indicar el nombre del grupo en groupName' });
      }
      if (!SUPPORTED_EXTENSIONS.has(path.extname(req.file.originalname).toLowerCase())) {
        return res.status(400).json({ success: false, error: 'Formato no compatible. Usa xlsx, xls o csv' });
      }
      const result = await service.process(req.file.buffer, req.body.groupName);
      return res.json({ success: true, result });
    } catch (error) {
      console.error('[WhatsAppGroupImport] Error procesando Excel:', error);
      return res.status(400).json({ success: false, error: error.message || String(error) });
    } finally {
      groupCreationInProgress = false;
    }
  });

  return router;
}

module.exports = createWhatsAppGroupImportRouter;