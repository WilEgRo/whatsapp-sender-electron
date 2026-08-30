/**
 * WhatsApp Sender Electron - Analytics Feature
 * Application: Manage Analytics
 * 
 * Casos de uso para administración de filtros temporales,
 * resolución de rangos de consulta y filtrado de tablas históricas.
 * Sin dependencias directas del DOM, Electron ni IPC.
 */

const {
  parseDayString,
  formatDateString,
  weekKeyToDate,
  monthKeyToDate,
  isPeriodOverlapping
} = require('../domain/analytics-rules');

/**
 * Resuelve las fechas de inicio y fin para un preset dado o rango personalizado.
 * @param {string} preset - 'today' | 'last-7' | 'last-30' | 'last-90' | 'custom'
 * @param {Object} [options]
 * @param {string} [options.customFrom='']
 * @param {string} [options.customTo='']
 * @param {Date} [options.today=new Date()]
 * @returns {{ fromDay: string, toDay: string }}
 */
function resolveDateRange(preset, { customFrom = '', customTo = '', today = new Date() } = {}) {
  const refDate = new Date(today);
  refDate.setHours(0, 0, 0, 0);

  if (preset === 'custom') {
    const from = parseDayString(customFrom);
    const to = parseDayString(customTo);
    return {
      fromDay: from ? formatDateString(from) : formatDateString(refDate),
      toDay: to ? formatDateString(to) : formatDateString(refDate)
    };
  }

  if (preset === 'today') {
    const todayStr = formatDateString(refDate);
    return {
      fromDay: todayStr,
      toDay: todayStr
    };
  }

  let days = 30;
  if (preset === 'last-7') days = 7;
  else if (preset === 'last-90') days = 90;

  const startDate = new Date(refDate);
  startDate.setDate(refDate.getDate() - (days - 1));

  return {
    fromDay: formatDateString(startDate),
    toDay: formatDateString(refDate)
  };
}

/**
 * Filtra los datasets históricos (diario, semanal y mensual) en base a un rango de fechas.
 * @param {Object} stats
 * @param {Object} [options]
 * @param {string} [options.fromDay]
 * @param {string} [options.toDay]
 * @param {number} [options.rangeDays=30]
 * @returns {{ daily: Array<Object>, weekly: Array<Object>, monthly: Array<Object> }}
 */
function filterHistoryDatasets(stats, { fromDay = null, toDay = null, rangeDays = 30 } = {}) {
  if (!stats || !stats.history) {
    return { daily: [], weekly: [], monthly: [] };
  }

  let startDate = parseDayString(fromDay);
  let endDate = parseDayString(toDay);

  if (!startDate || !endDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const clampDays = [7, 30, 90].includes(Number(rangeDays)) ? Number(rangeDays) : 30;
    endDate = new Date(today);
    startDate = new Date(today);
    startDate.setDate(today.getDate() - (clampDays - 1));
  }

  const dailyItems = (Array.isArray(stats.history.daily) ? stats.history.daily : [])
    .filter((item) => {
      if (!item || !item.day) return false;
      const rowDate = parseDayString(item.day);
      return rowDate && rowDate >= startDate && rowDate <= endDate;
    });

  const weeklyItems = (Array.isArray(stats.history.weekly) ? stats.history.weekly : [])
    .filter((item) => {
      if (!item || !item.week) return false;
      const weekStart = weekKeyToDate(item.week);
      if (!weekStart) return false;

      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      return isPeriodOverlapping(weekStart, weekEnd, startDate, endDate);
    });

  const monthlyItems = (Array.isArray(stats.history.monthly) ? stats.history.monthly : [])
    .filter((item) => {
      if (!item || !item.month) return false;
      const monthStart = monthKeyToDate(item.month);
      if (!monthStart) return false;

      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      return isPeriodOverlapping(monthStart, monthEnd, startDate, endDate);
    });

  return {
    daily: dailyItems,
    weekly: weeklyItems,
    monthly: monthlyItems
  };
}

module.exports = {
  resolveDateRange,
  filterHistoryDatasets
};
