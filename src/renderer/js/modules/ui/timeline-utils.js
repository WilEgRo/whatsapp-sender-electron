/**
 * Timeline utilities for continuous time-series metrics.
 * Ensures that all dates within a given range (fromDay -> toDay)
 * are present without gaps, formatted in chronological ascending order,
 * with inactive days populated as 0.
 */

function parseDayString(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(str || ''))) {
    return null;
  }
  const [year, month, day] = str.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Normalizes daily rows into a continuous, gap-free daily timeline.
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

  // Determine start date
  let start = parseDayString(fromDay);
  if (!start) {
    start = minFoundDate || new Date();
  }

  // Determine end date
  let end = parseDayString(toDay);
  if (!end) {
    end = maxFoundDate || new Date();
  }

  // Ensure start <= end
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const result = [];
  const current = new Date(start);

  // Generate continuous daily buckets
  while (current <= end) {
    const key = formatDateString(current);
    const existing = map.get(key);

    result.push({
      day: key,
      total_units: existing ? existing.total_units : 0,
      interactions: existing ? existing.interactions : 0
    });

    // Advance 1 day
    current.setDate(current.getDate() + 1);
  }

  return result;
}

module.exports = {
  normalizeDailyTimeline,
  parseDayString,
  formatDateString
};
