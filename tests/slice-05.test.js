const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexPath = path.resolve(__dirname, '../src/renderer/index.html');
const formsCssPath = path.resolve(__dirname, '../src/renderer/styles/forms.css');
const componentsCssPath = path.resolve(__dirname, '../src/renderer/styles/components.css');
const groupImportCssPath = path.resolve(__dirname, '../src/renderer/styles/group-import.css');
const { inspectCampaignSafety, SAFETY_STATUS } = require('../src/renderer/js/modules/campaign/campaign-safety');
const { normalizeDailyTimeline } = require('../src/renderer/js/modules/ui/timeline-utils');
const bindings = require('../src/renderer/js/modules/ui/bindings');

test('Slice 05: Unificación visual y contraste - cero fondos blancos en formularios y tarjetas', () => {
  const formsCss = fs.readFileSync(formsCssPath, 'utf8');
  const groupImportCss = fs.readFileSync(groupImportCssPath, 'utf8');

  // Verificar que forms.css no sobrescribe inputs con fondo blanco
  assert.ok(!formsCss.includes('background: #fff;'), 'forms.css no debe tener background: #fff;');
  assert.ok(!formsCss.includes('background: #ffffff;'), 'forms.css no debe tener background: #ffffff;');
  assert.ok(!formsCss.includes('background: #f8faff;'), 'forms.css no debe tener background: #f8faff;');
  assert.ok(formsCss.includes('var(--bg-input)'), 'forms.css debe utilizar token var(--bg-input)');
  assert.ok(formsCss.includes('var(--bg-surface)'), 'forms.css debe utilizar token var(--bg-surface)');

  // Sliders y rangos visibles
  assert.ok(formsCss.includes('input[type="range"]'), 'forms.css debe estilizar controles de rango/slider');
  assert.ok(formsCss.includes('::-webkit-slider-thumb'), 'forms.css debe estilizar thumb del slider');

  // group-import.css oscuro
  assert.ok(!groupImportCss.includes('background: #fff;'), 'group-import.css no debe tener background: #fff;');
  assert.ok(!groupImportCss.includes('background: #f8fafc;'), 'group-import.css no debe tener background: #f8fafc;');
});

test('Slice 05: Despachador de Campañas - completamente en español y exclusivo para contactos', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  // Título visible en español
  assert.ok(html.includes('<span>Despachador de Campañas</span>'), 'Sidebar debe mostrar "Despachador de Campañas"');
  assert.ok(html.includes('id="currentSectionTitle">Despachador de Campañas</h1>'), 'Topbar debe tener "Despachador de Campañas"');
  assert.ok(html.includes('<h2>Despachador de Campañas</h2>'), 'Contenido debe tener "Despachador de Campañas"');
  assert.ok(html.includes('<h3>Inspector de Seguridad</h3>'), 'Inspector debe titularse "Inspector de Seguridad"');

  // Exclusivo para contactos: sin selector de grupos en Despachador
  assert.ok(html.includes('id="audienceContactsView"'), 'Debe existir la vista de contactos');
  assert.ok(!html.includes('class="audience-source-selector"'), 'No debe existir selector de audiencia en el Despachador');
  assert.ok(!html.includes('data-audience-source="groups"'), 'No debe existir opción de grupos en el Despachador');

  // Indicación explícita de delay en ms y segundos
  assert.ok(html.includes('(segundos / ms)'), 'Debe indicar segundos / ms en el delay de mensajes');
});

test('Slice 05: Operaciones de Grupos - módulo estructurado con Inspector de Pre-vuelo propio', () => {
  const html = fs.readFileSync(indexPath, 'utf8');

  // Sección de grupos
  assert.ok(html.includes('id="gruposContent"'), 'Debe existir sección #gruposContent');
  assert.ok(html.includes('<h2>Operaciones de Grupos</h2>'), 'Debe titularse "Operaciones de Grupos"');

  // Buscador de grupos con placeholder claro
  assert.ok(html.includes('id="groupSearchInput"'), 'Debe existir #groupSearchInput');
  assert.ok(html.includes('placeholder="🔍 Escribe el nombre del grupo..."'), 'Buscador de grupos debe tener placeholder descriptivo');
  assert.ok(html.includes('id="gruposChecklist"'), 'Debe existir #gruposChecklist');

  // Inspector de pre-vuelo para grupos
  assert.ok(html.includes('id="inspectorRecipientsCountGroups"'), 'Debe existir contador de destinatarios para grupos');
  assert.ok(html.includes('id="inspectorEstimatedDurationGroups"'), 'Debe existir duración estimada para grupos');
  assert.ok(html.includes('id="inspectorSafetyStatusGroups"'), 'Debe existir estado de seguridad para grupos');

  // Verificaciones automáticas de grupos
  assert.ok(html.includes('id="checkAudienceGroups"'), 'Debe existir #checkAudienceGroups');
  assert.ok(html.includes('id="checkVolumeGroups"'), 'Debe existir #checkVolumeGroups');
  assert.ok(html.includes('id="checkDelayGroups"'), 'Debe existir #checkDelayGroups');
  assert.ok(html.includes('id="checkDuplicatesGroups"'), 'Debe existir #checkDuplicatesGroups');
  assert.ok(html.includes('id="checkComplianceGroups"'), 'Debe existir #checkComplianceGroups');

  // Acciones de pre-vuelo de grupos
  assert.ok(html.includes('id="applySafeConfigGroups"'), 'Debe existir botón para optimizar configuración de grupos');
  assert.ok(html.includes('id="enviarGrupos"'), 'Debe existir botón para enviar a grupos');
  assert.ok(html.includes('id="forzarEnvioGrupos"'), 'Debe existir botón para forzar envío a grupos');
});

test('Slice 05: No redundancia en el inspector - un solo estado vacío cuando targetCount === 0', () => {
  const inspection = inspectCampaignSafety({
    targetCount: 0,
    delayMin: 12,
    delayMax: 22,
    profile: 'medium'
  });

  // Estado global bloqueado por falta de audiencia
  assert.equal(inspection.status, SAFETY_STATUS.BLOCKED);

  // Audience es la única comprobación que reporta que no hay destinatarios
  assert.equal(inspection.checks.audience.valid, false);
  assert.equal(inspection.checks.audience.label, 'Ningún destinatario seleccionado');

  // Volume NO repite el mensaje de "Sin destinatarios"
  assert.notEqual(inspection.checks.volume.label, 'Sin destinatarios seleccionados');
  assert.notEqual(inspection.checks.volume.label, 'Ningún destinatario seleccionado');
  assert.ok(inspection.checks.volume.label.includes('límite seguro'));
});

test('Slice 05: Métricas continuas - genera todos los días intermedios con 0 y orden ascendente', () => {
  // Datos reales con hueco: 07, 08 y 11 (faltan 09 y 10)
  const rawData = [
    { day: '2026-08-07', total_units: 10, interactions: 5 },
    { day: '2026-08-08', total_units: 25, interactions: 12 },
    { day: '2026-08-11', total_units: 18, interactions: 9 }
  ];

  const continuous = normalizeDailyTimeline({
    dailyRows: rawData,
    fromDay: '2026-08-07',
    toDay: '2026-08-11'
  });

  // Debe tener exactamente 5 días consecutivos
  assert.equal(continuous.length, 5, 'Debe contener los 5 días continuos del rango');

  // Orden estrictamente cronológico ascendente
  const days = continuous.map((row) => row.day);
  assert.deepEqual(days, [
    '2026-08-07',
    '2026-08-08',
    '2026-08-09',
    '2026-08-10',
    '2026-08-11'
  ], 'Las fechas deben estar completas y en orden cronológico ascendente');

  // Valores de los días con actividad
  assert.equal(continuous[0].total_units, 10);
  assert.equal(continuous[1].total_units, 25);
  assert.equal(continuous[4].total_units, 18);

  // Los días sin actividad (09 y 10) deben tener explícitamente 0
  assert.equal(continuous[2].day, '2026-08-09');
  assert.equal(continuous[2].total_units, 0);
  assert.equal(continuous[2].interactions, 0);

  assert.equal(continuous[3].day, '2026-08-10');
  assert.equal(continuous[3].total_units, 0);
  assert.equal(continuous[3].interactions, 0);
});
