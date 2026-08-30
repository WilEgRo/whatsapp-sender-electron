const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.resolve(__dirname, '../src/renderer/index.html');
const handlersPath = path.resolve(__dirname, '../src/main/ipc/handlers.js');

test('Compatibilidad: Preservación de IDs críticos de sesión y feedback', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  const criticalIds = [
    // WhatsApp session & topbar
    'statusDot',
    'statusText',
    'totalContacts',
    'totalGroups',
    'logoutButton',

    // Modals
    'qrModal',
    'qrContainer',
    'qrContentArea',
    'sessionLoadingArea',
    'sessionLoadingTitle',
    'sessionLoadingSubtitle',
    'sessionLoadingStatusText',
    'sessionSyncCounter',
    'sessionProgressFill',
    'sessionLoadingPercentText',

    // Progress Modal & controls
    'progressModal',
    'progressText',
    'progressCounts',
    'progressDelay',
    'progressSecurity',
    'progressFill',
    'progressPercent',
    'progressCurrent',
    'progressTimerBox',
    'progressTimerText',
    'progressSummary',
    'cancelSendBtn',

    // Custom confirm modal
    'customConfirmModal',
    'confirmModalTitle',
    'confirmStatTotal',
    'confirmStatAlreadySent',
    'confirmStatNewToday',
    'confirmModalCancelBtn',
    'confirmModalAcceptBtn',

    // Toast container
    'toastContainer'
  ];

  criticalIds.forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `El ID crítico '${id}' debe estar presente en index.html`);
  });
});

test('Compatibilidad: Preservación de IDs de formularios operativos y estadísticas', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  const formIds = [
    // Contacts mode
    'contactSearchInput',
    'contactResultsList',
    'selectedContactsCount',
    'selectedContactsChips',
    'numeros',
    'mensaje',
    'selectFiles',
    'delayMin',
    'delayMax',
    'unitDelayMin',
    'unitDelayMax',
    'complianceModeContacts',
    'riskProfileContacts',
    'riskIndicatorContacts',
    'enviarMensajes',
    'forzarEnvioMensajes',

    // Groups mode
    'groupSearchInput',
    'gruposChecklist',
    'groupExportSelect',
    'mensajeGrupo',
    'selectFilesGrupo',
    'delayMinGrupo',
    'delayMaxGrupo',
    'complianceModeGroups',
    'riskProfileGroups',
    'riskIndicatorGroups',
    'enviarGrupos',
    'forzarEnvioGrupos',

    // Group import mode
    'groupImportName',
    'selectGroupImportFileButton',
    'analyzeGroupImportButton',
    'runGroupImportButton',
    'groupImportFileName',
    'groupImportParticipantsFound',
    'groupImportValidRows',
    'groupImportInvalidRows',
    'groupImportResults',
    'exportGroupImportResultsButton',

    // Scheduler mode
    'scheduleTargetType',
    'scheduleTargetId',
    'scheduleMessageText',
    'scheduleDatetime',
    'createScheduleButton',
    'scheduledMessagesList',

    // Statistics / Analytics dashboard
    'refreshStatsButton',
    'exportStatsExcelButton',
    'statsTodayUnits',
    'statsReferenceDay',
    'statsWeekUnits',
    'statsMonthUnits',
    'statsPctContacts',
    'statsPctGroups',
    'statsTopContact',
    'statsTopGroup',
    'statsTopDayRecord',
    'statsTopWeekRecord',
    'statsUpdatedAt',
    'historyTrendChart',
    'historyWeeklyChart'
  ];

  formIds.forEach((id) => {
    assert.ok(html.includes(`id="${id}"`), `El ID operativo '${id}' debe estar presente en index.html`);
  });
});

test('Compatibilidad: Canales IPC del Main Process no han sido alterados', () => {
  const code = fs.readFileSync(handlersPath, 'utf8');

  const expectedIpcChannels = [
    'send-batch-message',
    'cancel-send',
    'send-message',
    'send-group-message',
    'get-groups',
    'get-contacts',
    'get-group-members',
    'export-group-members',
    'export-group-import-results',
    'select-files',
    'import-excel-contacts',
    'get-message-stats',
    'export-message-stats',
    'get-destination-statuses',
    'get-message-log-history',
    'get-chat-history-preview',
    'create-scheduled-message',
    'get-scheduled-messages',
    'cancel-scheduled-message',
    'process-scheduled-messages-now',
    'get-device-fingerprint',
    'renderer-ready'
  ];

  expectedIpcChannels.forEach((channel) => {
    assert.ok(code.includes(`'${channel}'`), `El canal IPC '${channel}' debe estar registrado`);
  });
});
