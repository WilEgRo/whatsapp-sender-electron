const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ENDPOINT = 'http://127.0.0.1:3210/api/whatsapp/groups/import-excel';
const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const COUNTRY_CODES = new Set(['1', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '7', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '211', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228', '229', '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243', '244', '245', '246', '248', '249', '250', '251', '252', '253', '255', '256', '257', '258', '260', '261', '262', '263', '264', '265', '266', '267', '268', '269', '290', '291', '297', '298', '299', '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374', '375', '376', '377', '378', '379', '380', '381', '382', '383', '385', '386', '387', '389', '420', '421', '423', '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591', '592', '593', '594', '595', '596', '597', '598', '599', '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683', '685', '686', '687', '688', '689', '690', '691', '692', '850', '852', '853', '855', '856', '880', '886', '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974', '975', '976', '977', '992', '993', '994', '995', '996', '998']);
let activeExecution = false;

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function normalizeNumber(value) {
  const rawValue = String(value || '').trim();
  if (/[a-z@]/i.test(rawValue)) return '';
  const number = rawValue.replace(/[^0-9]/g, '');
  const countryCode = ['3', '2', '1'].map((length) => number.slice(0, length)).find((code) => COUNTRY_CODES.has(code));
  const hasReasonableLength = countryCode && number.length >= countryCode.length + 6 && number.length <= 15;
  const hasRequiredLengthForSeven = countryCode !== '7' || number.length === 11;
  return countryCode && hasReasonableLength && hasRequiredLengthForSeven && !/^0+$/.test(number) ? number : '';
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function readParticipants(filePath) {
  const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('El archivo no contiene hojas validas.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!rows.length) throw new Error('El archivo Excel no contiene participantes.');
  const keys = Object.keys(rows[0]);
  const numberKey = keys.find((key) => normalizeHeader(key) === 'numero');
  if (!numberKey) throw new Error('El Excel debe contener una columna llamada Numero.');
  const nameKey = keys.find((key) => normalizeHeader(key) === 'nombre');
  const seen = new Set();
  const participants = [];
  const errors = [];
  rows.forEach((row, index) => {
    if (!String(row[numberKey] || '').trim()) return;
    const number = normalizeNumber(row[numberKey]);
    if (!number) {
      errors.push({ fila: index + 2, error: 'Numero invalido' });
      participants.push({
        name: String(nameKey ? row[nameKey] || '' : '').trim(),
        number: String(row[numberKey] || '').trim(),
        originalIndex: index + 1,
        originalRow: index + 2,
        invalid: true
      });
      return;
    }
    if (seen.has(number)) {
      errors.push({ fila: index + 2, numero: number, error: 'Numero duplicado; se conserva la primera aparicion' });
      return;
    }
    seen.add(number);
    participants.push({
      name: String(nameKey ? row[nameKey] || '' : '').trim(),
      number,
      originalIndex: index + 1,
      originalRow: index + 2
    });
  });
  if (!participants.length) throw new Error('El Excel no contiene numeros validos en la columna Numero.');
  return { participants, errors };
}

function bind(controller) {
  const selectButton = document.getElementById('selectGroupImportFileButton');
  const analyzeButton = document.getElementById('analyzeGroupImportButton');
  const runButton = document.getElementById('runGroupImportButton');
  const exportButton = document.getElementById('exportGroupImportResultsButton');
  const groupNameInput = document.getElementById('groupImportName');
  const fileName = document.getElementById('groupImportFileName');
  const fileStatus = document.getElementById('groupImportFileStatus');
  const progress = document.getElementById('groupImportProgress');
  const results = document.getElementById('groupImportResults');
  const preview = document.getElementById('groupImportPreview');
  let selectedPath = '';
  let analyzed = false;
  let lastResult = null;

  const updateRunState = () => {
    runButton.disabled = activeExecution || !selectedPath || !analyzed || !groupNameInput.value.trim();
  };

  const renderPreview = (participants) => {
    preview.innerHTML = `<h3>Participantes detectados</h3><div class="group-import-preview-table"><div><strong>Nombre</strong><strong>Numero</strong></div>${participants.map((item) => `<div><span>${item.name || '-'}</span><span>${item.number}</span></div>`).join('')}</div><p class="hint">Total: ${participants.length} participante${participants.length === 1 ? '' : 's'}</p>`;
  };

  const renderResults = (result) => {
    lastResult = result;
    const pendingConfirmation = result.status === 'created_pending_confirmation';
    const inconclusive = Number(result.totalParticipants) > 0
      && Number(result.addedDirectly) === 0
      && Number(result.pendingInvitation) === 0
      && Number(result.invitationsSent) === 0;
    document.getElementById('groupImportResultStatus').textContent = result.status === 'reconciliation_error'
      ? 'Error de reconciliacion · revisa los resultados'
      : pendingConfirmation
      ? 'Grupo creado · confirmacion posterior pendiente'
      : inconclusive
        ? 'Resultado inconcluso / requiere diagnostico'
        : 'Proceso completado';
    const reconciliation = result.reconciliation || {};
    document.getElementById('groupImportResultMetrics').innerHTML = [
      ['Grupo', result.groupName || '-'], ['Originales', reconciliation.originalCount ?? result.totalParticipants], ['Confirmados durante creacion', result.creationAddConfirmed], ['Agregados', reconciliation.addedCount ?? result.addedDirectly],
      ['Pendientes', reconciliation.pendingCount ?? result.pendingInvitation], ['Invitaciones enviadas', reconciliation.invitationSentCount ?? result.invitationsSent], ['Invitaciones fallidas', reconciliation.invitationFailedCount ?? result.invitationsFailed], ['No confirmados', reconciliation.unknownCount || 0]
    ].map(([label, value]) => `<div><strong>${label === 'Grupo' ? String(value) : (Number(value) || 0)}</strong><span>${label}</span></div>`).join('');
    const rows = Array.isArray(result.participants) ? result.participants : [];
    const statusPresentation = {
      added: ['✓', 'Agregado directamente'],
      pending: ['⚠', 'Pendiente de incorporacion'],
      invitation_sent: ['✓', 'Invitacion enviada'],
      invitation_failed: ['✗', 'Fallo el envio de invitacion'],
      invalid: ['✗', 'Numero invalido'],
      unknown: ['⚠', 'Estado no confirmado']
    };
    const missingRows = rows.filter((item) => item.status !== 'added');
    document.getElementById('groupImportResultGroups').innerHTML = `<h3>Participantes</h3><div class="group-import-participant-list">${rows.map((item) => { const presentation = statusPresentation[item.status] || statusPresentation.unknown; return `<div><strong>${presentation[0]} ${item.name || 'Sin nombre'}</strong><span>${item.number}</span><small>${presentation[1]}${item.detail ? ` · ${item.detail}` : ''}</small></div>`; }).join('')}</div>${missingRows.length ? `<h3>Participantes no agregados (${missingRows.length})</h3><div class="group-import-participant-list">${missingRows.map((item) => { const presentation = statusPresentation[item.status] || statusPresentation.unknown; return `<div><strong>${presentation[0]} ${item.name || 'Sin nombre'}</strong><span>${item.number}</span><small>${presentation[1]} · ${item.detail || 'Sin evidencia suficiente'} · Invitacion: ${item.invitation || 'No procesada'}</small></div>`; }).join('')}</div>` : ''}`;
    if (result.inviteLink) {
      document.getElementById('groupImportResultGroups').insertAdjacentHTML('afterbegin', `<div class="group-import-invite"><strong>Enlace del grupo:</strong><a href="${result.inviteLink}" target="_blank">${result.inviteLink}</a><button id="copyGroupImportInviteButton" class="ghost-button ghost-button--tiny" type="button">Copiar enlace</button></div>`);
      document.getElementById('copyGroupImportInviteButton').addEventListener('click', async () => {
        await navigator.clipboard.writeText(result.inviteLink);
        controller.ui.showToast('Enlace copiado al portapapeles', 'success');
      });
    }
    const diagnosticPanel = document.getElementById('groupImportDiagnostics');
    const diagnostic = result.diagnostics;
    if (diagnostic) {
      const diagnosticRows = [
        ['createGroup()', JSON.stringify(diagnostic.createGroup)],
        ['Grupo despues de crear', JSON.stringify(diagnostic.groupAfterCreate)],
        ['getNumberId()', diagnostic.participants.map((item) => `${item.number}: ${JSON.stringify(item.getNumberId)}`).join('\n')],
        ['ID real', diagnostic.participants.map((item) => `${item.number}: ${item.getNumberId.serialized || '-'}`).join('\n')],
        ['isRegisteredUser()', diagnostic.participants.map((item) => `${item.number}: ${JSON.stringify(item.isRegisteredUser)}`).join('\n')],
        ['addParticipants()', diagnostic.participants.map((item) => `${item.number}: ${JSON.stringify(item.addParticipants)}`).join('\n')],
        ['Participantes despues de agregar', diagnostic.participants.map((item) => `${item.number}: ${JSON.stringify(item.participantsAfterAdd)}`).join('\n')],
        ['Participantes despues de refrescar', JSON.stringify(diagnostic.participantsAfterRefresh)],
        ['Comparacion', diagnostic.participants.map((item) => `${item.number}: ${item.comparison}`).join('\n')],
        ['Confirmacion', JSON.stringify(diagnostic.confirmation)],
        ['getInviteCode()', JSON.stringify(diagnostic.inviteCode)],
        ['Invitacion privada', diagnostic.participants.map((item) => `${item.number}: ${JSON.stringify(item.privateInvitation)}`).join('\n')]
      ];
      diagnosticPanel.innerHTML = `<h3>Diagnostico tecnico</h3><div class="group-import-diagnostic-table">${diagnosticRows.map(([label, value]) => `<div>${escapeHtml(label)}</div><div>${escapeHtml(value)}</div>`).join('')}</div>`;
    } else {
      diagnosticPanel.innerHTML = '';
    }
    results.classList.remove('hidden');
  };

  groupNameInput.addEventListener('input', updateRunState);
  selectButton.addEventListener('click', async () => {
    const selected = await controller.ipcClient.invoke('select-files');
    const candidate = Array.isArray(selected) ? selected.find((item) => SUPPORTED_EXTENSIONS.has(path.extname(item.path).toLowerCase())) : null;
    if (!candidate) return controller.ui.showToast('Selecciona un archivo Excel valido (.xlsx, .xls o .csv).', 'warning');
    selectedPath = candidate.path;
    analyzed = false;
    fileName.textContent = candidate.path;
    fileStatus.textContent = 'Archivo listo para analizar.';
    analyzeButton.disabled = false;
    progress.textContent = 'Archivo seleccionado. Revisa los participantes antes de crear el grupo.';
    updateRunState();
  });

  analyzeButton.addEventListener('click', () => {
    try {
      const parsed = readParticipants(selectedPath);
      analyzed = true;
      document.getElementById('groupImportParticipantsFound').textContent = parsed.participants.length;
      document.getElementById('groupImportValidRows').textContent = parsed.participants.length;
      document.getElementById('groupImportInvalidRows').textContent = parsed.errors.length;
      document.getElementById('groupImportAnalysisStatus').textContent = parsed.errors.length ? 'Revisar advertencias' : 'Archivo valido';
      progress.textContent = parsed.participants.length > 0
        ? 'Participantes validados. WhatsApp verificara su elegibilidad antes de crear el grupo.'
        : 'No es posible crear el grupo.';
      renderPreview(parsed.participants);
      updateRunState();
    } catch (error) {
      analyzed = false;
      updateRunState();
      fileStatus.textContent = 'No se pudo leer el archivo.';
      controller.ui.showToast(error.message || 'No se pudo analizar el archivo.', 'error');
    }
  });

  runButton.addEventListener('click', async () => {
    if (activeExecution || !selectedPath) return;
    const groupName = groupNameInput.value.trim();
    if (!groupName) return controller.ui.showToast('Escribe el nombre del grupo antes de continuar.', 'warning');
    activeExecution = true;
    runButton.disabled = true;
    runButton.textContent = 'Procesando...';
    selectButton.disabled = true;
    analyzeButton.disabled = true;
    results.classList.add('hidden');
    progress.textContent = 'Creando un unico grupo... Por favor espera mientras WhatsApp procesa la operacion.';
    try {
      const formData = new FormData();
      formData.append('groupName', groupName);
      formData.append('file', new Blob([fs.readFileSync(selectedPath)]), path.basename(selectedPath));
      const response = await fetch(ENDPOINT, { method: 'POST', body: formData });
      const payload = await response.json();
      console.debug('[GroupImport] Diagnostico de respuesta:', payload);
      if (!response.ok || !payload.success) throw new Error(payload.error || 'No se pudo completar el proceso.');
      renderResults(payload.result || {});
      if (payload.result && payload.result.status === 'created_without_participants') {
        progress.textContent = 'El grupo fue creado, pero ningun participante pudo ser agregado. La operacion no se considera completada correctamente.';
        controller.ui.showToast('Grupo creado sin participantes: revisa el resultado.', 'warning');
      } else if (payload.result && payload.result.status === 'created_pending_confirmation') {
        progress.textContent = 'Grupo creado. Hay participantes confirmados durante la creacion, pero la confirmacion posterior del grupo esta pendiente.';
        controller.ui.showToast('Grupo creado; confirmacion posterior pendiente.', 'warning');
      } else if (payload.result && payload.result.status === 'partial') {
        progress.textContent = 'Grupo creado con participantes pendientes e invitaciones procesadas.';
        controller.ui.showToast('Grupo creado parcialmente. Revisa los pendientes.', 'warning');
      } else if (payload.result && payload.result.status === 'completed') {
        progress.textContent = 'Grupo creado correctamente.';
        controller.ui.showToast('Grupo creado desde Excel', 'success');
      } else {
        progress.textContent = 'No se pudo completar la creacion del grupo.';
        controller.ui.showToast('La creacion del grupo no se completo.', 'warning');
      }
    } catch (error) {
      console.error('[GroupImport] Error:', error);
      progress.textContent = 'No se pudo completar el proceso.';
      controller.ui.showToast(error.name === 'TypeError' ? 'No se pudo conectar con el servidor de WhatsApp. Verifica que el servicio este iniciado.' : (error.message || 'No se pudo completar el proceso.'), 'error');
    } finally {
      activeExecution = false;
      runButton.textContent = 'Crear grupo';
      selectButton.disabled = false;
      analyzeButton.disabled = !selectedPath;
      updateRunState();
    }
  });

  exportButton.addEventListener('click', async () => {
    if (!lastResult) return;
    const response = await controller.ipcClient.invoke('export-group-import-results', {
      groupName: lastResult.groupName,
      participants: lastResult.participants
    });
    if (!response || !response.success) {
      controller.ui.showToast(response && response.error ? response.error : 'No se pudo guardar el Excel.', 'error');
      return;
    }
    if (!response.canceled) controller.ui.showToast('Excel de resultados guardado', 'success');
  });
}

module.exports = { bind, readParticipants };