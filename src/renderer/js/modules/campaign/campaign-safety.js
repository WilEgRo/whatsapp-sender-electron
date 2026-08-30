/**
 * Campaign Safety Inspector Module
 * Re-exports from Domain Risk Policy to preserve backwards compatibility
 * while eliminating duplicate definitions and constants.
 */

const riskPolicy = require('../../../../features/messaging/domain/risk-policy');

module.exports = {
  inspectCampaignSafety: riskPolicy.inspectCampaignSafety,
  estimateCampaignDuration: riskPolicy.estimateCampaignDuration,
  formatDuration: riskPolicy.formatDuration,
  SAFE_PRESETS: riskPolicy.SAFE_PRESETS,
  SAFETY_STATUS: riskPolicy.SAFETY_STATUS,
  getRiskLevel: riskPolicy.getRiskLevel,
  evaluateRisk: riskPolicy.evaluateRisk
};
