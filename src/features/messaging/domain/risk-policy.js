/**
 * WhatsApp Sender Electron - Messaging Feature
 * Domain: Risk Policy & Campaign Safety Rules
 * 
 * Reglas de negocio puras para evaluación de riesgo y límites de seguridad.
 * Módulo de dominio independiente sin dependencias externas ni de interfaz.
 */

const SAFE_PRESETS = Object.freeze({
  new: Object.freeze({
    maxBatch: 18,
    delayMin: 16,
    delayMax: 24,
    unitDelayMin: 2,
    unitDelayMax: 4,
    cooldownEvery: 5,
    cooldownMinSeconds: 60,
    cooldownMaxSeconds: 95,
    recommendation: 'Cuenta nueva: usa volumen bajo y pausas largas.'
  }),
  medium: Object.freeze({
    maxBatch: 35,
    delayMin: 12,
    delayMax: 22,
    unitDelayMin: 1,
    unitDelayMax: 3,
    cooldownEvery: 8,
    cooldownMinSeconds: 45,
    cooldownMaxSeconds: 75,
    recommendation: 'Cuenta media: volumen moderado con pausas constantes.'
  }),
  mature: Object.freeze({
    maxBatch: 60,
    delayMin: 10,
    delayMax: 20,
    unitDelayMin: 1,
    unitDelayMax: 2,
    cooldownEvery: 12,
    cooldownMinSeconds: 30,
    cooldownMaxSeconds: 55,
    recommendation: 'Cuenta madura: aun evita picos y conserva pausas.'
  })
});

const SAFETY_STATUS = Object.freeze({
  READY: 'READY',
  WARNING: 'WARNING',
  BLOCKED: 'BLOCKED'
});

function getRiskLevel(score) {
  if (score >= 70) {
    return { level: 'red', text: 'ROJO' };
  }

  if (score >= 40) {
    return { level: 'yellow', text: 'AMARILLO' };
  }

  return { level: 'green', text: 'VERDE' };
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '0 seg';
  }
  const secs = Math.round(totalSeconds);
  if (secs < 60) {
    return `${secs} seg`;
  }
  const mins = Math.round(secs / 60);
  if (mins < 60) {
    return `~${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `~${hours} h ${remainingMins} min` : `~${hours} h`;
}

function estimateCampaignDuration({ targetCount, delayMin, delayMax, profile, complianceMode = true }) {
  if (!targetCount || targetCount <= 0) {
    return '0 seg';
  }

  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;
  const dMin = Number.isFinite(delayMin) && delayMin > 0 ? delayMin : preset.delayMin;
  const dMax = Number.isFinite(delayMax) && delayMax > dMin ? delayMax : preset.delayMax;
  const avgDelay = (dMin + dMax) / 2;

  let totalSeconds = targetCount * avgDelay;

  if (complianceMode && preset.cooldownEvery > 0) {
    const cooldownCount = Math.floor(targetCount / preset.cooldownEvery);
    const avgCooldown = (preset.cooldownMinSeconds + preset.cooldownMaxSeconds) / 2;
    totalSeconds += cooldownCount * avgCooldown;
  }

  return formatDuration(totalSeconds);
}

function evaluateRisk({
  targetCount = 0,
  delayMin = 12,
  delayMax = 22,
  unitDelayMin = 1,
  unitDelayMax = 3,
  complianceMode = true,
  hasFiles = false,
  profile = 'medium',
  alreadySentCount = 0
} = {}) {
  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;

  let score = 8;
  const reasons = [];

  if (targetCount > preset.maxBatch) {
    score += 36;
    reasons.push(`Volumen alto para perfil ${profile}.`);
  } else if (targetCount > Math.floor(preset.maxBatch * 0.7)) {
    score += 18;
    reasons.push('Volumen medio-alto.');
  } else {
    reasons.push('Volumen controlado.');
  }

  if (delayMin < preset.delayMin) {
    score += 24;
    reasons.push('Delay minimo bajo.');
  }

  if (delayMax < preset.delayMax - 2) {
    score += 12;
    reasons.push('Delay maximo bajo para este perfil.');
  }

  if (delayMax - delayMin < 2) {
    score += 12;
    reasons.push('Rango de delay muy corto.');
  }

  if (unitDelayMin < preset.unitDelayMin) {
    score += 10;
    reasons.push('Delay entre unidades bajo.');
  }

  if (unitDelayMax < preset.unitDelayMax) {
    score += 6;
    reasons.push('Delay maximo entre unidades bajo para este perfil.');
  }

  if (unitDelayMax - unitDelayMin < 1) {
    score += 6;
    reasons.push('Rango de delay entre unidades muy corto.');
  }

  if (!complianceMode) {
    score += 20;
    reasons.push('Modo cumplimiento desactivado.');
  }

  if (hasFiles && targetCount > Math.floor(preset.maxBatch * 0.6)) {
    score += 8;
    reasons.push('Adjuntos con volumen considerable.');
  }

  if (alreadySentCount > 0) {
    score += Math.min(25, alreadySentCount * 3);
    reasons.push('Destinatarios ya contactados en las últimas 24h.');
  }

  const normalizedScore = Math.min(100, Math.max(0, score));
  const level = getRiskLevel(normalizedScore);

  return {
    score: normalizedScore,
    level,
    reasons,
    reason: reasons.join(' '),
    suggestion: `Configuracion sugerida (${profile}): max ${preset.maxBatch} por tanda, delay ${preset.delayMin}-${preset.delayMax}s, delay entre unidades ${preset.unitDelayMin}-${preset.unitDelayMax}s, pausa de seguridad cada ${preset.cooldownEvery} envios por ${preset.cooldownMinSeconds}-${preset.cooldownMaxSeconds}s.`
  };
}

function inspectCampaignSafety({
  targetCount = 0,
  alreadySentCount = 0,
  delayMin = 12,
  delayMax = 22,
  unitDelayMin = 1,
  unitDelayMax = 3,
  complianceMode = true,
  hasFiles = false,
  profile = 'medium'
} = {}) {
  const preset = SAFE_PRESETS[profile] || SAFE_PRESETS.medium;

  let score = 8;
  const reasons = [];

  // 1. Audience & Volume Check
  let volumeValid = false;
  let volumeMessage = '';
  if (targetCount === 0) {
    volumeValid = true;
    volumeMessage = 'Volumen dentro del límite seguro';
  } else if (targetCount > preset.maxBatch * 2) {
    score += 65;
    volumeValid = false;
    volumeMessage = `Volumen crítico (>200% límite seguro ${preset.maxBatch})`;
    reasons.push(`Volumen excede críticamente el perfil ${profile}.`);
  } else if (targetCount > preset.maxBatch) {
    score += 36;
    volumeValid = false;
    volumeMessage = `Excede el límite seguro (${targetCount}/${preset.maxBatch})`;
    reasons.push(`Volumen alto para perfil ${profile}.`);
  } else if (targetCount > Math.floor(preset.maxBatch * 0.7)) {
    score += 18;
    volumeValid = true;
    volumeMessage = `Volumen moderado-alto (${targetCount}/${preset.maxBatch})`;
    reasons.push('Volumen medio-alto.');
  } else {
    volumeValid = true;
    volumeMessage = `Volumen óptimo (${targetCount}/${preset.maxBatch})`;
    reasons.push('Volumen controlado.');
  }

  // 2. Delay Checks
  let delayValid = true;
  let delayMessage = 'Delay seguro y aleatorio';

  if (delayMin < preset.delayMin) {
    score += 24;
    delayValid = false;
    delayMessage = `Delay mínimo bajo (< ${preset.delayMin}s)`;
    reasons.push('Delay mínimo bajo.');
  }

  if (delayMax < preset.delayMax - 2) {
    score += 12;
    reasons.push('Delay máximo bajo para este perfil.');
  }

  if (delayMax - delayMin < 2) {
    score += 12;
    delayValid = false;
    delayMessage = 'Rango de delay muy corto (mínimo 2s)';
    reasons.push('Rango de delay muy corto.');
  }

  if (delayMax <= delayMin) {
    score += 40;
    delayValid = false;
    delayMessage = 'El delay máximo debe ser mayor al mínimo';
  }

  // 3. Unit Delay Checks
  if (unitDelayMin < preset.unitDelayMin) {
    score += 10;
    reasons.push('Delay entre unidades bajo.');
  }

  if (unitDelayMax < preset.unitDelayMax) {
    score += 6;
  }

  // 4. Compliance Mode Check
  const complianceValid = Boolean(complianceMode);
  if (!complianceMode) {
    score += 20;
    reasons.push('Modo cumplimiento desactivado.');
  }

  // 5. Files Check
  if (hasFiles && targetCount > Math.floor(preset.maxBatch * 0.6)) {
    score += 8;
    reasons.push('Adjuntos con volumen considerable.');
  }

  // 6. Duplicates / Re-send Check
  const duplicatesValid = alreadySentCount === 0;
  const duplicatesMessage = duplicatesValid
    ? 'Sin reenvíos detectados hoy'
    : `${alreadySentCount} destinatario(s) contactado(s) hoy`;
  if (alreadySentCount > 0) {
    score += Math.min(25, alreadySentCount * 3);
    reasons.push('Destinatarios ya contactados en las últimas 24h.');
  }

  const normalizedScore = Math.min(100, Math.max(0, score));

  // Determine Final Safety Status
  let status = SAFETY_STATUS.READY;
  if (targetCount === 0 || normalizedScore >= 70 || delayMax <= delayMin) {
    status = SAFETY_STATUS.BLOCKED;
  } else if (normalizedScore >= 40 || !complianceValid || !duplicatesValid || !delayValid || !volumeValid) {
    status = SAFETY_STATUS.WARNING;
  }

  const estimatedDuration = estimateCampaignDuration({
    targetCount,
    delayMin,
    delayMax,
    profile,
    complianceMode
  });

  return {
    status,
    score: normalizedScore,
    estimatedDuration,
    reasons: reasons.length > 0 ? reasons : ['Configuración dentro de parámetros seguros.'],
    suggestion: `Perfil ${profile}: recomendado max ${preset.maxBatch} por tanda, delay ${preset.delayMin}-${preset.delayMax}s, pausa cada ${preset.cooldownEvery} envíos.`,
    checks: {
      audience: {
        valid: targetCount > 0,
        label: targetCount > 0 ? `${targetCount} destinatario(s) seleccionado(s)` : 'Ningún destinatario seleccionado'
      },
      volume: {
        valid: volumeValid,
        label: volumeMessage
      },
      delay: {
        valid: delayValid,
        label: delayMessage
      },
      duplicates: {
        valid: duplicatesValid,
        label: duplicatesMessage
      },
      compliance: {
        valid: complianceValid,
        label: complianceValid ? 'Protección anti-bloqueo activa' : 'Protección anti-bloqueo inactiva'
      }
    }
  };
}

module.exports = {
  SAFE_PRESETS,
  SAFETY_STATUS,
  getRiskLevel,
  formatDuration,
  estimateCampaignDuration,
  evaluateRisk,
  inspectCampaignSafety
};
