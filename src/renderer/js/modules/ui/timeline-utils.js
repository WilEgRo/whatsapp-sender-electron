/**
 * WhatsApp Sender Electron - Timeline Utilities
 * Backwards-compatibility adapter delegating to Analytics Domain Rules (v3.5.7)
 */

const {
  normalizeDailyTimeline,
  parseDayString,
  formatDateString
} = require('../../../../features/analytics/domain/analytics-rules');

module.exports = {
  normalizeDailyTimeline,
  parseDayString,
  formatDateString
};
