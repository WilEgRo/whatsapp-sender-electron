/**
 * WhatsApp Sender Electron - Analytics Feature
 * Application: Build Analytics
 * 
 * Casos de uso para construir resúmenes estadísticos, formatear métricas
 * y preparar datasets para gráficos y reportes.
 * Sin dependencias directas del DOM, Electron ni IPC.
 */

const {
  normalizeDailyTimeline,
  calculateDistributionPercentages
} = require('../domain/analytics-rules');

/**
 * Procesa y estructura los indicadores principales de estadísticas (KPIs).
 * @param {Object} stats
 * @returns {Object}
 */
function buildAnalyticsOverview(stats = {}) {
  if (!stats || typeof stats !== 'object') {
    return {
      todayUnits: 0,
      weekUnits: 0,
      monthUnits: 0,
      referenceDay: '--',
      percentages: { contacts: 0, groups: 0 },
      topContact: '-',
      topGroup: '-',
      topDayRecord: '-',
      topWeekRecord: '-',
      uniqueChats: { total: 0, contacts: 0, groups: 0 }
    };
  }

  const todayUnits = Number(stats.today && stats.today.totalUnits ? stats.today.totalUnits : 0);

  const weekUnits = Array.isArray(stats.history && stats.history.weekly) && stats.history.weekly.length > 0
    ? Number(stats.history.weekly[0].total_units || 0)
    : 0;

  const monthUnits = Array.isArray(stats.history && stats.history.monthly) && stats.history.monthly.length > 0
    ? Number(stats.history.monthly[0].total_units || 0)
    : 0;

  const percentages = stats.percentages
    ? {
        contacts: Number(stats.percentages.contacts || 0),
        groups: Number(stats.percentages.groups || 0)
      }
    : calculateDistributionPercentages(
        stats.contactsUnits || 0,
        stats.groupsUnits || 0
      );

  const topContact = stats.topDestinations && stats.topDestinations.contact
    ? `${stats.topDestinations.contact.display_name || stats.topDestinations.contact.destination_id} (${Number(stats.topDestinations.contact.total_units || 0)})`
    : '-';

  const topGroup = stats.topDestinations && stats.topDestinations.group
    ? `${stats.topDestinations.group.display_name || stats.topDestinations.group.destination_id} (${Number(stats.topDestinations.group.total_units || 0)})`
    : '-';

  const topDayRecord = stats.records && stats.records.topDay
    ? `${stats.records.topDay.day} (${Number(stats.records.topDay.total_units || 0)})`
    : '-';

  const topWeekRecord = stats.records && stats.records.topWeek
    ? `${stats.records.topWeek.week} (${Number(stats.records.topWeek.total_units || 0)})`
    : '-';

  const uniqueChats = stats.uniqueChats || { total: 0, contacts: 0, groups: 0 };

  return {
    todayUnits,
    weekUnits,
    monthUnits,
    referenceDay: stats.referenceDay || '--',
    percentages,
    topContact,
    topGroup,
    topDayRecord,
    topWeekRecord,
    uniqueChats: {
      total: Number(uniqueChats.total || 0),
      contacts: Number(uniqueChats.contacts || 0),
      groups: Number(uniqueChats.groups || 0)
    }
  };
}

/**
 * Prepara las series cronológicas continuas de etiquetas y valores para gráficos temporales.
 * @param {Array<{ day: string, total_units?: number, interactions?: number }>} dailyRows
 * @param {Object} [rangeOptions]
 * @param {string} [rangeOptions.fromDay]
 * @param {string} [rangeOptions.toDay]
 * @returns {{ labels: Array<string>, totalUnits: Array<number>, interactions: Array<number> }}
 */
function prepareTimelineChartData(dailyRows = [], rangeOptions = {}) {
  const continuous = normalizeDailyTimeline({
    dailyRows,
    fromDay: rangeOptions.fromDay,
    toDay: rangeOptions.toDay
  });

  return {
    labels: continuous.map((row) => row.day),
    totalUnits: continuous.map((row) => row.total_units),
    interactions: continuous.map((row) => row.interactions)
  };
}

module.exports = {
  buildAnalyticsOverview,
  prepareTimelineChartData
};
