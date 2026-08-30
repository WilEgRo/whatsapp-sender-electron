const path = require('path');
const fs = require('fs/promises');
const XLSX = require('xlsx');

class FileService {
  static async selectFiles(dialog, mainWindow) {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Imagenes', extensions: ['jpg', 'png', 'gif', 'jpeg'] },
        { name: 'Documentos', extensions: ['pdf', 'doc', 'docx', 'txt'] },
        { name: 'Videos', extensions: ['mp4', 'avi', 'mov'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });

    return result.filePaths.map((filePath) => ({
      path: filePath,
      name: path.basename(filePath)
    }));
  }

  static sanitizeFileName(name) {
    return String(name || 'grupo')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 90);
  }

  static buildCsv(rows) {
    const escapeCell = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
    const header = ['Nombre', 'Numero'].map(escapeCell).join(',');
    const lines = rows.map((row) => [row.name, row.number].map(escapeCell).join(','));
    return [header, ...lines].join('\n');
  }

  static async exportGroupMembers(dialog, mainWindow, { groupName, members, format }) {
    const safeBaseName = `${FileService.sanitizeFileName(groupName)}_miembros`;
    const extension = format === 'xlsx' ? 'xlsx' : 'csv';

    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar integrantes del grupo',
      defaultPath: `${safeBaseName}.${extension}`,
      filters: [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'CSV', extensions: ['csv'] }
      ]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return {
        canceled: true
      };
    }

    const rows = Array.isArray(members) ? members : [];

    if (extension === 'xlsx') {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(
        rows.map((member) => ({
          Nombre: member.name || '',
          Numero: member.number || ''
        }))
      );

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Miembros');
      XLSX.writeFile(workbook, saveResult.filePath);
    } else {
      const csv = FileService.buildCsv(rows);
      await fs.writeFile(saveResult.filePath, csv, 'utf8');
    }

    return {
      canceled: false,
      filePath: saveResult.filePath,
      total: rows.length,
      format: extension
    };
  }

  static async exportGroupImportResults(dialog, mainWindow, { groupName, participants }) {
    const safeBaseName = `${FileService.sanitizeFileName(groupName)}_resultados.xlsx`;
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar resultados de creacion de grupo',
      defaultPath: safeBaseName,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    const rows = (Array.isArray(participants) ? participants : [])
      .slice()
      .sort((first, second) => Number(first.originalIndex || 0) - Number(second.originalIndex || 0))
      .map((participant) => ({
      Nombre: participant.name || '',
      Numero: participant.number || '',
      Estado: participant.status === 'added' ? 'Agregado' : participant.status === 'invalid' ? 'Invalido' : participant.status === 'unknown' ? 'No confirmado' : participant.status === 'invitation_sent' ? 'Invitacion enviada' : participant.status === 'invitation_failed' ? 'Invitacion fallida' : 'Pendiente',
      Invitacion: participant.status === 'added' ? 'No necesaria' : (participant.invitation || 'No disponible'),
      'Detalle/Error': participant.detail || ''
      }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Resultados');
    XLSX.writeFile(workbook, saveResult.filePath);

    return { canceled: false, filePath: saveResult.filePath, total: rows.length };
  }

  static async importExcelContacts(dialog, mainWindow) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar contactos desde Excel / CSV',
      properties: ['openFile'],
      filters: [
        { name: 'Archivos de Excel y CSV', extensions: ['xlsx', 'xls', 'csv'] },
        { name: 'Todos los archivos', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true, contacts: [] };
    }

    const filePath = result.filePaths[0];

    try {
      const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        throw new Error('El archivo no contiene hojas validas.');
      }

      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!Array.isArray(rows) || rows.length === 0) {
        return { canceled: false, contacts: [], total: 0, filePath };
      }

      const normalizeHeader = (key) => String(key || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Identificar columnas
      const sampleRow = rows[0] || {};
      const keys = Object.keys(sampleRow);
      
      let numberKey = keys.find((k) => {
        const h = normalizeHeader(k);
        return h.includes('numero') || h.includes('phone') || h.includes('telefono') || h.includes('celular') || h.includes('whatsapp') || h.includes('mobile');
      });

      let nameKey = keys.find((k) => {
        const h = normalizeHeader(k);
        return h.includes('nombre') || h.includes('name') || h.includes('cliente') || h.includes('contacto');
      });

      // Si no se halló encabezado explícito para el número, buscar la primera columna que contenga números
      if (!numberKey) {
        numberKey = keys.find((k) => {
          const val = String(sampleRow[k] || '').replace(/[^0-9]/g, '');
          return val.length >= 7 && val.length <= 15;
        }) || keys[0];
      }

      const contacts = [];
      rows.forEach((row, index) => {
        const rawNum = String(row[numberKey] || '').replace(/[^0-9]/g, '');
        if (!rawNum || rawNum.length < 7 || rawNum.length > 15) {
          return;
        }

        const name = nameKey && row[nameKey] ? String(row[nameKey]).trim() : rawNum;

        // Construir contexto de variables adicionales del Excel
        const context = {};
        Object.keys(row).forEach((colKey) => {
          const normK = normalizeHeader(colKey).replace(/[^a-z0-9_]/g, '_');
          if (normK) {
            context[normK] = String(row[colKey] || '').trim();
          }
        });
        context.nombre = name;
        context.nombre_completo = name;
        context.numero = rawNum;

        contacts.push({
          id: `${rawNum}@c.us`,
          name: name || rawNum,
          number: rawNum,
          excelOrder: index + 1,
          context
        });
      });

      return {
        canceled: false,
        filePath,
        contacts,
        total: contacts.length
      };
    } catch (error) {
      console.error('[FileService] Error importando Excel:', error);
      throw error;
    }
  }
}

module.exports = FileService;
