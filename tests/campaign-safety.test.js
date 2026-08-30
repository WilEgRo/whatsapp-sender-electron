const test = require('node:test');
const assert = require('node:assert/strict');
const {
  inspectCampaignSafety,
  estimateCampaignDuration,
  formatDuration,
  SAFETY_STATUS,
  SAFE_PRESETS
} = require('../src/renderer/js/modules/campaign/campaign-safety');

test('Safety: formatDuration formatea segundos a texto humano legible', () => {
  assert.equal(formatDuration(0), '0 seg');
  assert.equal(formatDuration(-10), '0 seg');
  assert.equal(formatDuration(45), '45 seg');
  assert.equal(formatDuration(120), '~2 min');
  assert.equal(formatDuration(3600), '~1 h');
  assert.equal(formatDuration(4500), '~1 h 15 min');
});

test('Safety: estimateCampaignDuration calcula el tiempo total incluyendo cooldowns', () => {
  // 10 destinatarios con delay 10-20s (promedio 15s) en perfil mature
  const est = estimateCampaignDuration({
    targetCount: 10,
    delayMin: 10,
    delayMax: 20,
    profile: 'mature',
    complianceMode: true
  });
  // 10 * 15s = 150s = 2.5 min (~3 min)
  assert.match(est, /min/);
});

test('Safety: estado BLOCKED cuando no hay destinatarios seleccionados', () => {
  const inspection = inspectCampaignSafety({
    targetCount: 0,
    delayMin: 12,
    delayMax: 22,
    profile: 'medium'
  });

  assert.equal(inspection.status, SAFETY_STATUS.BLOCKED);
  assert.equal(inspection.checks.audience.valid, false);
});

test('Safety: estado READY cuando la configuración cumple todos los parámetros seguros', () => {
  const inspection = inspectCampaignSafety({
    targetCount: 15, // Por debajo de 35 (maxBatch de medium)
    delayMin: 12,
    delayMax: 22,
    unitDelayMin: 1,
    unitDelayMax: 3,
    complianceMode: true,
    alreadySentCount: 0,
    hasFiles: false,
    profile: 'medium'
  });

  assert.equal(inspection.status, SAFETY_STATUS.READY);
  assert.ok(inspection.score < 40, `Score (${inspection.score}) debe ser menor a 40 para READY`);
  assert.equal(inspection.checks.audience.valid, true);
  assert.equal(inspection.checks.volume.valid, true);
  assert.equal(inspection.checks.delay.valid, true);
  assert.equal(inspection.checks.duplicates.valid, true);
  assert.equal(inspection.checks.compliance.valid, true);
});

test('Safety: estado WARNING cuando hay reenvíos en las últimas 24h o delays en el límite', () => {
  const inspection = inspectCampaignSafety({
    targetCount: 20,
    alreadySentCount: 5, // Reenvíos detectados
    delayMin: 12,
    delayMax: 22,
    complianceMode: true,
    profile: 'medium'
  });

  assert.equal(inspection.status, SAFETY_STATUS.WARNING);
  assert.equal(inspection.checks.duplicates.valid, false);
  assert.match(inspection.checks.duplicates.label, /5 destinatario\(s\) contactado\(s\) hoy/);
});

test('Safety: estado BLOCKED cuando el volumen supera el límite del perfil o delay es inválido', () => {
  // Exceso de volumen para perfil new (max 18)
  const inspectionOverVolume = inspectCampaignSafety({
    targetCount: 60,
    delayMin: 16,
    delayMax: 24,
    profile: 'new'
  });

  assert.equal(inspectionOverVolume.checks.volume.valid, false);
  assert.equal(inspectionOverVolume.status, SAFETY_STATUS.BLOCKED);

  // Delay max menor o igual a min
  const inspectionInvalidDelay = inspectCampaignSafety({
    targetCount: 10,
    delayMin: 15,
    delayMax: 10,
    profile: 'medium'
  });

  assert.equal(inspectionInvalidDelay.checks.delay.valid, false);
  assert.equal(inspectionInvalidDelay.status, SAFETY_STATUS.BLOCKED);
});

test('Safety: refleja las reglas y presets reales del motor de cumplimiento', () => {
  assert.equal(SAFE_PRESETS.new.maxBatch, 18);
  assert.equal(SAFE_PRESETS.medium.maxBatch, 35);
  assert.equal(SAFE_PRESETS.mature.maxBatch, 60);

  assert.equal(SAFE_PRESETS.new.delayMin, 16);
  assert.equal(SAFE_PRESETS.medium.delayMin, 12);
  assert.equal(SAFE_PRESETS.mature.delayMin, 10);
});
