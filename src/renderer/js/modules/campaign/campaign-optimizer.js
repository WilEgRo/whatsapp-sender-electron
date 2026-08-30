/**
 * Campaign Optimizer Module
 * Computes and applies safe parameters according to the active profile
 * and compliance engine recommendations, reporting clear changelog text.
 */

const { SAFE_PRESETS } = require('./campaign-safety');

function optimizeCampaignConfig(currentConfig = {}) {
  const profile = currentConfig.profile || 'medium';
  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;

  const changes = [];

  const safeDelayMin = preset.delayMin;
  const safeDelayMax = preset.delayMax;
  const safeUnitDelayMin = preset.unitDelayMin;
  const safeUnitDelayMax = preset.unitDelayMax;
  const safeComplianceMode = true;

  if (Number(currentConfig.delayMin) !== safeDelayMin || Number(currentConfig.delayMax) !== safeDelayMax) {
    changes.push(`Delay ajustado a ${safeDelayMin}-${safeDelayMax} segundos`);
  }

  if (Number(currentConfig.unitDelayMin) !== safeUnitDelayMin || Number(currentConfig.unitDelayMax) !== safeUnitDelayMax) {
    changes.push(`Delay entre unidades ajustado a ${safeUnitDelayMin}-${safeUnitDelayMax} segundos`);
  }

  if (!currentConfig.complianceMode) {
    changes.push('Modo cumplimiento y pausas de seguridad reactivadas');
  }

  if (changes.length === 0) {
    changes.push('La configuración ya se encuentra en los valores óptimos recomendados');
  }

  return {
    profile,
    optimizedValues: {
      delayMin: safeDelayMin,
      delayMax: safeDelayMax,
      unitDelayMin: safeUnitDelayMin,
      unitDelayMax: safeUnitDelayMax,
      complianceMode: safeComplianceMode
    },
    changes,
    summary: changes.join('. ') + '.'
  };
}

module.exports = {
  optimizeCampaignConfig
};
