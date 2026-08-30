const test = require('node:test');
const assert = require('node:assert/strict');
const { optimizeCampaignConfig } = require('../src/renderer/js/modules/campaign/campaign-optimizer');

test('Optimizer: ajusta delays agresivos a los valores recomendados por perfil', () => {
  const result = optimizeCampaignConfig({
    profile: 'medium',
    delayMin: 2,
    delayMax: 5,
    unitDelayMin: 0,
    unitDelayMax: 0,
    complianceMode: false
  });

  assert.equal(result.optimizedValues.delayMin, 12, 'Perfil medium debe tener delayMin 12');
  assert.equal(result.optimizedValues.delayMax, 22, 'Perfil medium debe tener delayMax 22');
  assert.equal(result.optimizedValues.unitDelayMin, 1);
  assert.equal(result.optimizedValues.unitDelayMax, 3);
  assert.equal(result.optimizedValues.complianceMode, true, 'Debe reactivar modo cumplimiento');

  assert.ok(result.changes.length >= 3, 'Debe reportar los cambios realizados');
  assert.match(result.summary, /Delay ajustado/);
  assert.match(result.summary, /Modo cumplimiento/);
});

test('Optimizer: respeta el perfil de cuenta seleccionada (new, medium, mature)', () => {
  const resultNew = optimizeCampaignConfig({ profile: 'new', delayMin: 2, delayMax: 5 });
  assert.equal(resultNew.optimizedValues.delayMin, 16);
  assert.equal(resultNew.optimizedValues.delayMax, 24);

  const resultMature = optimizeCampaignConfig({ profile: 'mature', delayMin: 2, delayMax: 5 });
  assert.equal(resultMature.optimizedValues.delayMin, 10);
  assert.equal(resultMature.optimizedValues.delayMax, 20);
});

test('Optimizer: detecta cuando la configuración ya es segura y no inventa cambios', () => {
  const result = optimizeCampaignConfig({
    profile: 'medium',
    delayMin: 12,
    delayMax: 22,
    unitDelayMin: 1,
    unitDelayMax: 3,
    complianceMode: true
  });

  assert.equal(result.changes.length, 1);
  assert.match(result.changes[0], /ya se encuentra en los valores óptimos/i);
});
