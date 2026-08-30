/**
 * WhatsApp Sender Electron - Analytics Feature
 * Domain: Analytics Rules
 * 
 * Reglas de negocio y utilidades estadísticas puras:
 * cálculo de porcentajes, normalización de líneas de tiempo continuas,
 * transformaciones de fechas y filtros temporales sin dependencias de UI ni IPC.
 */

/**
 * Parsea una cadena de fecha YYYY-MM-DD a un objeto Date local a las 00:00:00.
 * @param {string} str
 * @returns {Date|null}
 */
function parseDayString(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str || ''))) {
    return null;
  }
  const [year, month, day] = str.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/**
 * Formatea un objeto Date a cadena YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Normaliza las filas diarias asegurando una secuencia continua sin huecos,
 * rellenando con ceros los días sin interacción en orden cronológico ascendente.
 * @param {Object} options
 * @param {Array<{ day: string, total_units?: number, interactions?: number }>} options.dailyRows
 * @param {string} [options.fromDay]
 * @param {string} [options.toDay]
 * @returns {Array<{ day: string, total_units: number, interactions: number }>}
 */
function normalizeDailyTimeline({ dailyRows = [], fromDay = null, toDay = null } = {}) {
  const rows = Array.isArray(dailyRows) ? dailyRows : [];
  const map = new Map();

  let minFoundDate = null;
  let maxFoundDate = null;

  for (const row of rows) {
    if (!row || !row.day) continue;
    const d = parseDayString(row.day);
    if (!d) continue;

    const key = formatDateString(d);
    map.set(key, {
      total_units: Number(row.total_units || 0),
      interactions: Number(row.interactions || 0)
    });

    if (!minFoundDate || d < minFoundDate) minFoundDate = d;
    if (!maxFoundDate || d > maxFoundDate) maxFoundDate = d;
  }

  let start = parseDayString(fromDay);
  if (!start) {
    start = minFoundDate || new Date();
  }

  let end = parseDayString(toDay);
  if (!end) {
    end = maxFoundDate || new Date();
  }

  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const result = [];
  const current = new Date(start);

  while (current <= end) {
    const key = formatDateString(current);
    const existing = map.get(key);

    result.push({
      day: key,
      total_units: existing ? existing.total_units : 0,
      interactions: existing ? existing.interactions : 0
    });

    current.setDate(current.getDate() + 1);
  }

  return result;
}

/**
 * Calcula porcentajes de distribución entre contactos y grupos.
 * @param {number} contactsUnits
 * @param {number} groupsUnits
 * @returns {{ contacts: number, groups: number }}
 */
function calculateDistributionPercentages(contactsUnits = 0, groupsUnits = 0) {
  const c = Math.max(0, Number(contactsUnits) || 0);
  const g = Math.max(0, Number(groupsUnits) || 0);
  const total = c + g;

  if (total === 0) {
    return { contacts: 0, groups: 0 };
  }

  const pctContacts = Math.round((c / total) * 100);
  const pctGroups = 100 - pctContacts;

  return {
    contacts: pctContacts,
    groups: pctGroups
  };
}

/**
 * Convierte una clave de semana (e.g. '2026-W34') a la fecha del primer día (Lunes).
 * @param {string} weekKey
 * @returns {Date|null}
 */
function weekKeyToDate(weekKey) {
  const match = /^([0-9]{4})-W([0-9]{2})$/.exec(String(weekKey || ''));
  if (!match) return null;

  const year = Number(match[1]);
  const week = Number(match[2]);
  const firstDay = new Date(year, 0, 1);
  const dayOffset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const firstMonday = new Date(year, 0, 1 + (7 - dayOffset));
  firstMonday.setHours(0, 0, 0, 0);
  firstMonday.setDate(firstMonday.getDate() + ((week - 1) * 7));
  return firstMonday;
}

/**
 * Convierte una clave de mes (e.g. '2026-08') a la fecha del primer día del mes.
 * @param {string} monthKey
 * @returns {Date|null}
 */
function monthKeyToDate(monthKey) {
  const match = /^([0-9]{4})-([0-9]{2})$/.exec(String(monthKey || ''));
  if (!match) return null;

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

/**
 * Determina si un intervalo temporal se superpone con un rango de fechas de consulta.
 * @param {Date} periodStart
 * @param {Date} periodEnd
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {boolean}
 */
function isPeriodOverlapping(periodStart, periodEnd, rangeStart, rangeEnd) {
  if (!periodStart || !periodEnd || !rangeStart || !rangeEnd) {
    return false;
  }
  return periodStart <= rangeEnd && periodEnd >= rangeStart;
}

/**
 * Sanea y valida la configuración de filtros de estadísticas.
 * @param {Object} filter
 * @returns {{ preset: string, customFrom: string, customTo: string }}
 */
function normalizeStatsFilter(filter = {}) {
  const preset = String((filter && filter.preset) || 'last-30').trim();
  const customFrom = String((filter && filter.customFrom) || '').trim();
  const customTo = String((filter && filter.customTo) || '').trim();

  return {
    preset: ['today', 'last-7', 'last-30', 'last-90', 'all', 'custom'].includes(preset) ? preset : 'last-30',
    customFrom,
    customTo
  };
}

module.exports = {
  parseDayString,
  formatDateString,
  normalizeDailyTimeline,
  calculateDistributionPercentages,
  weekKeyToDate,
  monthKeyToDate,
  isPeriodOverlapping,
  normalizeStatsFilter
};
