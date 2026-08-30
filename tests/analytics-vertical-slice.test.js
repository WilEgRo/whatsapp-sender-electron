const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const analyticsRules = require('../src/features/analytics/domain/analytics-rules');
const {
  buildAnalyticsOverview,
  prepareTimelineChartData
} = require('../src/features/analytics/application/build-analytics');
const {
  resolveDateRange,
  filterHistoryDatasets
} = require('../src/features/analytics/application/manage-analytics');
const {
  AnalyticsIpcGateway
} = require('../src/features/analytics/infrastructure/analytics-ipc-gateway');
const {
  AnalyticsController
} = require('../src/features/analytics/presentation/analytics-controller');
const analyticsActions = require('../src/renderer/js/modules/app/analytics');

// ==========================================
// 1. DOMAIN: ANALYTICS-RULES
// ==========================================
test('Domain Analytics: parseDayString y formatDateString operan con precisión', () => {
  const d = analyticsRules.parseDayString('2026-08-30');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 7); // 0-indexed: agosto es 7
  assert.equal(d.getDate(), 30);

  assert.equal(analyticsRules.formatDateString(d), '2026-08-30');
  assert.equal(analyticsRules.parseDayString('invalido'), null);
});

test('Domain Analytics: normalizeDailyTimeline genera serie continua sin huecos y con ceros', () => {
  const raw = [
    { day: '2026-08-01', total_units: 5, interactions: 2 },
    { day: '2026-08-04', total_units: 10, interactions: 4 }
  ];

  const continuous = analyticsRules.normalizeDailyTimeline({
    dailyRows: raw,
    fromDay: '2026-08-01',
    toDay: '2026-08-04'
  });

  assert.equal(continuous.length, 4);
  assert.equal(continuous[0].day, '2026-08-01');
  assert.equal(continuous[0].total_units, 5);
  assert.equal(continuous[1].day, '2026-08-02');
  assert.equal(continuous[1].total_units, 0);
  assert.equal(continuous[2].day, '2026-08-03');
  assert.equal(continuous[2].total_units, 0);
  assert.equal(continuous[3].day, '2026-08-04');
  assert.equal(continuous[3].total_units, 10);
});

test('Domain Analytics: calculateDistributionPercentages calcula porcentajes y maneja totales en cero', () => {
  const normal = analyticsRules.calculateDistributionPercentages(75, 25);
  assert.equal(normal.contacts, 75);
  assert.equal(normal.groups, 25);

  const zero = analyticsRules.calculateDistributionPercentages(0, 0);
  assert.equal(zero.contacts, 0);
  assert.equal(zero.groups, 0);

  const rounding = analyticsRules.calculateDistributionPercentages(1, 2);
  assert.equal(rounding.contacts, 33);
  assert.equal(rounding.groups, 67);
});

test('Domain Analytics: weekKeyToDate y monthKeyToDate convierten claves periódicas', () => {
  const weekDate = analyticsRules.weekKeyToDate('2026-W34');
  assert.ok(weekDate instanceof Date);
  assert.equal(weekDate.getFullYear(), 2026);

  const monthDate = analyticsRules.monthKeyToDate('2026-08');
  assert.ok(monthDate instanceof Date);
  assert.equal(monthDate.getFullYear(), 2026);
  assert.equal(monthDate.getMonth(), 7);

  assert.equal(analyticsRules.weekKeyToDate('invalid'), null);
  assert.equal(analyticsRules.monthKeyToDate('invalid'), null);
});

test('Domain Analytics: isPeriodOverlapping evalúa superposición temporal', () => {
  const rangeStart = new Date('2026-08-01T00:00:00');
  const rangeEnd = new Date('2026-08-31T23:59:59');

  const insideStart = new Date('2026-08-10T00:00:00');
  const insideEnd = new Date('2026-08-15T23:59:59');
  assert.equal(analyticsRules.isPeriodOverlapping(insideStart, insideEnd, rangeStart, rangeEnd), true);

  const outsideStart = new Date('2026-09-01T00:00:00');
  const outsideEnd = new Date('2026-09-10T23:59:59');
  assert.equal(analyticsRules.isPeriodOverlapping(outsideStart, outsideEnd, rangeStart, rangeEnd), false);
});

test('Domain Analytics: normalizeStatsFilter sanea presets y fechas', () => {
  const valid = analyticsRules.normalizeStatsFilter({ preset: 'last-90' });
  assert.equal(valid.preset, 'last-90');

  const invalid = analyticsRules.normalizeStatsFilter({ preset: 'desconocido' });
  assert.equal(invalid.preset, 'last-30');
});

// ==========================================
// 2. APPLICATION: BUILD & MANAGE ANALYTICS
// ==========================================
test('Application Analytics: buildAnalyticsOverview genera resumen de indicadores', () => {
  const stats = {
    today: { totalUnits: 15 },
    history: {
      weekly: [{ total_units: 45 }],
      monthly: [{ total_units: 120 }]
    },
    percentages: { contacts: 60, groups: 40 },
    topDestinations: {
      contact: { display_name: 'Wilson', total_units: 20 },
      group: { display_name: 'Ventas', total_units: 25 }
    },
    records: {
      topDay: { day: '2026-08-20', total_units: 30 },
      topWeek: { week: '2026-W33', total_units: 60 }
    },
    uniqueChats: { total: 10, contacts: 7, groups: 3 }
  };

  const overview = buildAnalyticsOverview(stats);
  assert.equal(overview.todayUnits, 15);
  assert.equal(overview.weekUnits, 45);
  assert.equal(overview.monthUnits, 120);
  assert.equal(overview.percentages.contacts, 60);
  assert.equal(overview.percentages.groups, 40);
  assert.ok(overview.topContact.includes('Wilson'));
  assert.ok(overview.topGroup.includes('Ventas'));
  assert.ok(overview.topDayRecord.includes('2026-08-20'));
  assert.equal(overview.uniqueChats.total, 10);
});

test('Application Analytics: prepareTimelineChartData extrae series cronológicas', () => {
  const raw = [
    { day: '2026-08-10', total_units: 8, interactions: 4 },
    { day: '2026-08-11', total_units: 12, interactions: 6 }
  ];

  const chartData = prepareTimelineChartData(raw, {
    fromDay: '2026-08-10',
    toDay: '2026-08-11'
  });

  assert.deepEqual(chartData.labels, ['2026-08-10', '2026-08-11']);
  assert.deepEqual(chartData.totalUnits, [8, 12]);
  assert.deepEqual(chartData.interactions, [4, 6]);
});

test('Application Analytics: resolveDateRange resuelve presets correctamente', () => {
  const fixedToday = new Date('2026-08-30T12:00:00');

  const todayRange = resolveDateRange('today', { today: fixedToday });
  assert.equal(todayRange.fromDay, '2026-08-30');
  assert.equal(todayRange.toDay, '2026-08-30');

  const last7Range = resolveDateRange('last-7', { today: fixedToday });
  assert.equal(last7Range.toDay, '2026-08-30');
  assert.equal(last7Range.fromDay, '2026-08-24');

  const customRange = resolveDateRange('custom', {
    customFrom: '2026-08-01',
    customTo: '2026-08-15',
    today: fixedToday
  });
  assert.equal(customRange.fromDay, '2026-08-01');
  assert.equal(customRange.toDay, '2026-08-15');
});

test('Application Analytics: filterHistoryDatasets filtra filas diarias, semanales y mensuales', () => {
  const stats = {
    history: {
      daily: [
        { day: '2026-08-01', total_units: 10 },
        { day: '2026-08-20', total_units: 20 }
      ],
      weekly: [
        { week: '2026-W31', total_units: 15 }
      ],
      monthly: [
        { month: '2026-08', total_units: 30 },
        { month: '2026-05', total_units: 5 }
      ]
    }
  };

  const filtered = filterHistoryDatasets(stats, {
    fromDay: '2026-08-15',
    toDay: '2026-08-25'
  });

  assert.equal(filtered.daily.length, 1);
  assert.equal(filtered.daily[0].day, '2026-08-20');
  assert.equal(filtered.monthly.length, 1);
  assert.equal(filtered.monthly[0].month, '2026-08');
});

// ==========================================
// 3. INFRASTRUCTURE: ANALYTICS-IPC-GATEWAY
// ==========================================
test('Infrastructure Analytics IPC Gateway: invoca get-message-stats y export-message-stats', async () => {
  const calls = [];
  const mockIpcClient = {
    invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'get-message-stats') {
        return { success: true, stats: { today: { totalUnits: 10 } } };
      }
      if (channel === 'export-message-stats') {
        return { success: true, filePath: '/tmp/stats.xlsx' };
      }
      return null;
    }
  };

  const gateway = new AnalyticsIpcGateway(mockIpcClient);

  const statsRes = await gateway.getMessageStats({ filter: { preset: 'last-7' } });
  assert.equal(statsRes.success, true);
  assert.equal(calls[0].channel, 'get-message-stats');

  const exportRes = await gateway.exportMessageStats({ filter: { preset: 'last-7' } });
  assert.equal(exportRes.success, true);
  assert.equal(calls[1].channel, 'export-message-stats');
});

// ==========================================
// 4. PRESENTATION: ANALYTICS-CONTROLLER
// ==========================================
test('Presentation AnalyticsController: gestiona filtros y sincroniza con stateRef', async () => {
  const stateRef = {
    statsFilter: { preset: 'last-30', customFrom: '', customTo: '' },
    latestStats: null,
    ui: {
      setStatsLoading: () => {},
      renderMessageStats: () => {},
      renderMessageStatsHistory: () => {},
      renderHistoryCharts: () => {},
      showToast: () => {}
    }
  };

  const mockIpc = {
    invoke: async (channel) => {
      if (channel === 'get-message-stats') {
        return { success: true, stats: { today: { totalUnits: 22 } } };
      }
      return null;
    }
  };

  const controller = new AnalyticsController({
    stateRef,
    ipcClient: mockIpc
  });

  assert.equal(controller.filter.preset, 'last-30');
  controller.filter.preset = 'last-7';
  assert.equal(stateRef.statsFilter.preset, 'last-7', 'stateRef debe mantenerse sincronizado');

  await controller.refreshMessageStats({ silent: true });
  assert.ok(stateRef.latestStats);
  assert.equal(stateRef.latestStats.today.totalUnits, 22);
});

// ==========================================
// 5. REGRESIÓN ARQUITECTÓNICA
// ==========================================
test('Arquitectura Analytics: analytics-rules.js NO contiene referencias a DOM, Electron ni IPC', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/features/analytics/domain/analytics-rules.js'),
    'utf8'
  );

  assert.ok(!code.includes('document.'), 'No debe referenciar document');
  assert.ok(!code.includes('window.'), 'No debe referenciar window');
  assert.ok(!code.includes("require('electron')"), 'No debe importar electron');
  assert.ok(!code.includes('ipcRenderer'), 'No debe referenciar ipcRenderer');
  assert.ok(!code.includes('AppController'), 'No debe referenciar controladores externos');
});

test('Arquitectura Analytics: build-analytics.js y manage-analytics.js son independientes del DOM', () => {
  const codeBuild = fs.readFileSync(
    path.resolve(__dirname, '../src/features/analytics/application/build-analytics.js'),
    'utf8'
  );
  const codeManage = fs.readFileSync(
    path.resolve(__dirname, '../src/features/analytics/application/manage-analytics.js'),
    'utf8'
  );

  assert.ok(!codeBuild.includes('document.'), 'build-analytics no debe referenciar document');
  assert.ok(!codeBuild.includes('window.'), 'build-analytics no debe referenciar window');
  assert.ok(!codeManage.includes('document.'), 'manage-analytics no debe referenciar document');
  assert.ok(!codeManage.includes('window.'), 'manage-analytics no debe referenciar window');
});

test('Arquitectura Analytics: analytics.js actúa como fachada delgada (< 100 líneas)', () => {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../src/renderer/js/modules/app/analytics.js'),
    'utf8'
  );

  const lines = code.split('\n').length;
  assert.ok(lines < 100, `analytics.js debe tener menos de 100 líneas, tiene ${lines}`);
  assert.ok(code.includes('AnalyticsController'), 'analytics.js debe delegar a AnalyticsController');
});

test('Compatibilidad Analytics: analytics.js y AppController exponen contratos requeridos', () => {
  assert.equal(typeof analyticsActions.bindStatsEvents, 'function');
  assert.equal(typeof analyticsActions.startStatsAutoRefresh, 'function');
  assert.equal(typeof analyticsActions.stopStatsAutoRefresh, 'function');
  assert.equal(typeof analyticsActions.refreshMessageStats, 'function');
  assert.equal(typeof analyticsActions.exportMessageStatsExcel, 'function');
});
