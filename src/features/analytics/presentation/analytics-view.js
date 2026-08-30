/**
 * WhatsApp Sender Electron - Analytics Feature
 * Presentation: Analytics View
 * 
 * Gestiona exclusivamente la manipulación visual del DOM para métricas y estadísticas:
 * actualización de tarjetas KPI, tablas históricas y estado de carga.
 * No contiene reglas de negocio complejas ni llamadas directas a IPC.
 */

const {
  buildAnalyticsOverview
} = require('../application/build-analytics');

const {
  filterHistoryDatasets
} = require('../application/manage-analytics');

/**
 * Actualiza los elementos KPI principales en la pestaña de estadísticas.
 * @param {Object} stats
 */
function renderMessageStatsView(stats) {
  const todayValue = document.getElementById('statsTodayUnits');
  const weekValue = document.getElementById('statsWeekUnits');
  const monthValue = document.getElementById('statsMonthUnits');
  const referenceDay = document.getElementById('statsReferenceDay');
  const pctContacts = document.getElementById('statsPctContacts');
  const pctGroups = document.getElementById('statsPctGroups');
  const topContact = document.getElementById('statsTopContact');
  const topGroup = document.getElementById('statsTopGroup');
  const topDay = document.getElementById('statsTopDayRecord');
  const topWeek = document.getElementById('statsTopWeekRecord');
  const updatedAt = document.getElementById('statsUpdatedAt');
  const hint = document.getElementById('statsHint');

  if (!stats || !todayValue || !weekValue || !monthValue) {
    return;
  }

  const overview = buildAnalyticsOverview(stats);

  todayValue.textContent = String(overview.todayUnits);
  weekValue.textContent = String(overview.weekUnits);
  monthValue.textContent = String(overview.monthUnits);

  if (referenceDay) {
    referenceDay.textContent = `Fecha: ${overview.referenceDay}`;
  }

  if (pctContacts) {
    pctContacts.textContent = `${overview.percentages.contacts}%`;
  }

  if (pctGroups) {
    pctGroups.textContent = `Grupos: ${overview.percentages.groups}%`;
  }

  if (topContact) {
    topContact.textContent = overview.topContact;
  }

  if (topGroup) {
    topGroup.textContent = overview.topGroup;
  }

  if (topDay) {
    topDay.textContent = overview.topDayRecord;
  }

  if (topWeek) {
    topWeek.textContent = overview.topWeekRecord;
  }

  if (updatedAt) {
    updatedAt.textContent = `Ultima actualizacion: ${new Date().toLocaleTimeString('es-BO')}`;
  }

  if (hint) {
    hint.textContent = 'Datos persistentes en SQLite, incluso despues de reiniciar la app.';
  }
}

/**
 * Actualiza las tablas de historial (diario, semanal y mensual) y métricas de chats únicos.
 * @param {Object} stats
 * @param {number} [rangeDays=30]
 */
function renderMessageStatsHistoryView(stats, rangeDays = 30) {
  const uniqueTotal = document.getElementById('statsUniqueTotal');
  const uniqueContacts = document.getElementById('statsUniqueContacts');
  const uniqueGroups = document.getElementById('statsUniqueGroups');
  const topContactDetail = document.getElementById('statsTopContactDetail');
  const topGroupDetail = document.getElementById('statsTopGroupDetail');

  const dailyBody = document.getElementById('statsDailyBody');
  const weeklyBody = document.getElementById('statsWeeklyBody');
  const monthlyBody = document.getElementById('statsMonthlyBody');

  if (!stats || !dailyBody || !weeklyBody || !monthlyBody) {
    return;
  }

  const overview = buildAnalyticsOverview(stats);

  if (uniqueTotal) uniqueTotal.textContent = String(overview.uniqueChats.total);
  if (uniqueContacts) uniqueContacts.textContent = String(overview.uniqueChats.contacts);
  if (uniqueGroups) uniqueGroups.textContent = String(overview.uniqueChats.groups);
  if (topContactDetail) topContactDetail.textContent = overview.topContact;
  if (topGroupDetail) topGroupDetail.textContent = overview.topGroup;

  const filter = stats.filter || {};
  const filtered = filterHistoryDatasets(stats, {
    fromDay: filter.fromDay,
    toDay: filter.toDay,
    rangeDays
  });

  const buildRows = (items, labelKey) => {
    if (!Array.isArray(items) || items.length === 0) {
      return '<tr><td colspan="3">Sin datos en el rango seleccionado.</td></tr>';
    }

    return items.slice(0, 12).map((item) => `
      <tr>
        <td>${item[labelKey] || '-'}</td>
        <td>${Number(item.total_units || 0)}</td>
        <td>${Number(item.interactions || 0)}</td>
      </tr>
    `).join('');
  };

  dailyBody.innerHTML = buildRows(filtered.daily, 'day');
  weeklyBody.innerHTML = buildRows(filtered.weekly, 'week');
  monthlyBody.innerHTML = buildRows(filtered.monthly, 'month');
}

/**
 * Controla el estado visual de carga de las estadísticas.
 * @param {boolean} isLoading
 */
function setStatsLoadingView(isLoading) {
  const loadingIndicator = document.getElementById('statsLoading');
  const refreshButton = document.getElementById('refreshStatsButton');
  const exportButton = document.getElementById('exportStatsExcelButton');

  if (loadingIndicator) {
    loadingIndicator.classList.toggle('hidden', !isLoading);
  }

  if (refreshButton) {
    refreshButton.disabled = Boolean(isLoading);
    refreshButton.textContent = isLoading ? 'Actualizando...' : 'Actualizar';
  }

  if (exportButton) {
    exportButton.disabled = Boolean(isLoading);
  }
}

/**
 * Alterna la visibilidad del panel de rango personalizado de fechas.
 * @param {boolean} visible
 */
function setHistoryCustomRangeVisibleView(visible) {
  const customRange = document.getElementById('historyCustomRange');
  if (customRange) {
    customRange.hidden = !visible;
  }
}

module.exports = {
  renderMessageStatsView,
  renderMessageStatsHistoryView,
  setStatsLoadingView,
  setHistoryCustomRangeVisibleView
};
