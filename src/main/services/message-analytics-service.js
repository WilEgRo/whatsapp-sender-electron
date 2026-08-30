const path = require('path');

const FILE_TYPE_BY_EXTENSION = {
  '.jpg': 'Imagen',
  '.jpeg': 'Imagen',
  '.png': 'Imagen',
  '.gif': 'Imagen',
  '.webp': 'Imagen',
  '.pdf': 'Documento',
  '.doc': 'Documento',
  '.docx': 'Documento',
  '.txt': 'Documento',
  '.csv': 'Documento',
  '.xlsx': 'Documento',
  '.xls': 'Documento',
  '.mp4': 'Video',
  '.avi': 'Video',
  '.mov': 'Video',
  '.mp3': 'Audio',
  '.wav': 'Audio',
  '.ogg': 'Audio'
};

class MessageAnalyticsService {
  constructor(repository) {
    this.repository = repository;
  }

  static toLocalDateParts(dateValue = new Date()) {
    const baseDate = new Date(dateValue);
    return {
      year: baseDate.getFullYear(),
      month: String(baseDate.getMonth() + 1).padStart(2, '0'),
      day: String(baseDate.getDate()).padStart(2, '0')
    };
  }

  static calculateUnits({ message, files }) {
    const hasText = Boolean(String(message || '').trim());
    const attachments = Array.isArray(files) ? files.length : 0;
    return (hasText ? 1 : 0) + attachments;
  }

  static buildContentType({ message, files }) {
    const types = new Set();

    if (String(message || '').trim()) {
      types.add('Texto');
    }

    (Array.isArray(files) ? files : []).forEach((filePath) => {
      const extension = path.extname(String(filePath || '')).toLowerCase();
      types.add(FILE_TYPE_BY_EXTENSION[extension] || 'Archivo');
    });

    if (types.size === 0) {
      types.add('Vacio');
    }

    return Array.from(types).join(', ');
  }

  static toLocalDay(dateValue = new Date()) {
    const parts = MessageAnalyticsService.toLocalDateParts(dateValue);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  static shiftLocalDay(dayValue, deltaDays) {
    const safe = /^\d{4}-\d{2}-\d{2}$/.test(String(dayValue || ''))
      ? String(dayValue)
      : MessageAnalyticsService.toLocalDay(new Date());

    const date = new Date(`${safe}T12:00:00`);
    date.setDate(date.getDate() + Number(deltaDays || 0));
    return MessageAnalyticsService.toLocalDay(date);
  }

  static normalizeFilter(filter = {}, referenceDate = new Date()) {
    const today = MessageAnalyticsService.toLocalDay(referenceDate);
    const presetRaw = String(filter.preset || 'last-30').toLowerCase();
    const allowed = new Set(['today', 'last-7', 'last-30', 'custom']);
    const preset = allowed.has(presetRaw) ? presetRaw : 'last-30';

    if (preset === 'today') {
      return {
        preset,
        fromDay: today,
        toDay: today
      };
    }

    if (preset === 'last-7') {
      return {
        preset,
        fromDay: MessageAnalyticsService.shiftLocalDay(today, -6),
        toDay: today
      };
    }

    if (preset === 'last-30') {
      return {
        preset,
        fromDay: MessageAnalyticsService.shiftLocalDay(today, -29),
        toDay: today
      };
    }

    const customFrom = String(filter.customFrom || '').trim();
    const customTo = String(filter.customTo || '').trim();
    const validFrom = /^\d{4}-\d{2}-\d{2}$/.test(customFrom) ? customFrom : today;
    const validTo = /^\d{4}-\d{2}-\d{2}$/.test(customTo) ? customTo : validFrom;

    if (validFrom <= validTo) {
      return {
        preset,
        fromDay: validFrom,
        toDay: validTo
      };
    }

    return {
      preset,
      fromDay: validTo,
      toDay: validFrom
    };
  }

  static toPercent(part, total) {
    if (!total) {
      return 0;
    }

    return Number(((part / total) * 100).toFixed(2));
  }

  async logInteraction({ destinationType, destinationId, message, files, timestampIso = new Date().toISOString() }) {
    const unitsTotal = MessageAnalyticsService.calculateUnits({ message, files });
    if (unitsTotal <= 0) {
      return null;
    }

    const contentType = MessageAnalyticsService.buildContentType({ message, files });

    await this.repository.insertLog({
      timestampIso,
      destinationType,
      destinationId,
      unitsTotal,
      contentType
    });

    return {
      timestampIso,
      destinationType,
      destinationId,
      unitsTotal,
      contentType
    };
  }

  async getDashboard(referenceDate = new Date(), filter = {}) {
    const day = MessageAnalyticsService.toLocalDay(referenceDate);
    const normalizedFilter = MessageAnalyticsService.normalizeFilter(filter, referenceDate);

    const [
      todayTotal,
      dailyTotals,
      weeklyTotals,
      monthlyTotals,
      topDay,
      topWeek,
      topContact,
      topGroup,
      distribution,
      uniqueChats,
      topContactGlobal,
      topGroupGlobal,
      distributionGlobal
    ] = await Promise.all([
      this.repository.getTotalByDay(day),
      this.repository.getDailyTotalsByRange(normalizedFilter.fromDay, normalizedFilter.toDay, 180),
      this.repository.getWeeklyTotalsByRange(normalizedFilter.fromDay, normalizedFilter.toDay, 104),
      this.repository.getMonthlyTotalsByRange(normalizedFilter.fromDay, normalizedFilter.toDay, 36),
      this.repository.getTopDayRecordByRange(normalizedFilter.fromDay, normalizedFilter.toDay),
      this.repository.getTopWeekRecordByRange(normalizedFilter.fromDay, normalizedFilter.toDay),
      this.repository.getTopDestinationByTypeInRange('contacts', normalizedFilter.fromDay, normalizedFilter.toDay),
      this.repository.getTopDestinationByTypeInRange('groups', normalizedFilter.fromDay, normalizedFilter.toDay),
      this.repository.getDistributionTotalsByRange(normalizedFilter.fromDay, normalizedFilter.toDay),
      this.repository.getUniqueChatCountsByRange(normalizedFilter.fromDay, normalizedFilter.toDay),
      this.repository.getTopDestinationByType('contacts'),
      this.repository.getTopDestinationByType('groups'),
      this.repository.getDistributionTotals()
    ]);

    const topContactSafe = topContact || topContactGlobal || null;
    const topGroupSafe = topGroup || topGroupGlobal || null;

    // La distribucion principal se mantiene global para evitar sesgos por filtros cortos
    // que oculten contactos historicamente relevantes.
    const distributionForDashboard = {
      contacts: Number(distributionGlobal && distributionGlobal.contacts ? distributionGlobal.contacts : 0),
      groups: Number(distributionGlobal && distributionGlobal.groups ? distributionGlobal.groups : 0)
    };

    const totalUnits = distributionForDashboard.contacts + distributionForDashboard.groups;

    return {
      referenceDay: day,
      today: {
        totalUnits: todayTotal
      },
      history: {
        daily: dailyTotals,
        weekly: weeklyTotals,
        monthly: monthlyTotals
      },
      filter: normalizedFilter,
      records: {
        topDay: topDay || null,
        topWeek: topWeek || null
      },
      topDestinations: {
        contact: topContactSafe,
        group: topGroupSafe
      },
      percentages: {
        contacts: MessageAnalyticsService.toPercent(distributionForDashboard.contacts, totalUnits),
        groups: MessageAnalyticsService.toPercent(distributionForDashboard.groups, totalUnits)
      },
      distributionWindow: {
        contacts: Number(distribution && distribution.contacts ? distribution.contacts : 0),
        groups: Number(distribution && distribution.groups ? distribution.groups : 0)
      },
      uniqueChats
    };
  }

  async getExportData(referenceDate = new Date(), filter = {}) {
    const dashboard = await this.getDashboard(referenceDate, filter);
    const selectedFilter = dashboard.filter || MessageAnalyticsService.normalizeFilter(filter, referenceDate);

    const [daily, weekly, monthly, yearly, topRanking] = await Promise.all([
      this.repository.getDailyTotalsByRange(selectedFilter.fromDay, selectedFilter.toDay, 370),
      this.repository.getWeeklyTotalsByRange(selectedFilter.fromDay, selectedFilter.toDay, 120),
      this.repository.getMonthlyTotalsByRange(selectedFilter.fromDay, selectedFilter.toDay, 60),
      this.repository.getYearlyTotalsByRange(selectedFilter.fromDay, selectedFilter.toDay, 12),
      this.repository.getTopDestinationsRanking(selectedFilter.fromDay, selectedFilter.toDay, 25)
    ]);

    const chartSeries = {
      daily: daily.slice().reverse().map((item) => ({
        label: item.day,
        units: Number(item.total_units || 0),
        interactions: Number(item.interactions || 0)
      })),
      weekly: weekly.slice().reverse().map((item) => ({
        label: item.week,
        units: Number(item.total_units || 0),
        interactions: Number(item.interactions || 0)
      }))
    };

    return {
      ...dashboard,
      exportTables: {
        daily,
        weekly,
        monthly,
        yearly,
        topRanking
      },
      charts: chartSeries
    };
  }

  async getDestinationStatuses({ destinationType, destinationIds = [], referenceDate = new Date() } = {}) {
    const day = MessageAnalyticsService.toLocalDay(referenceDate);
    const rows = await this.repository.getDestinationStatusesByDay(destinationType, destinationIds, day);

    const byId = Object.create(null);
    rows.forEach((row) => {
      const id = String(row.destination_id || '');
      if (!id) {
        return;
      }

      byId[id] = {
        sentToday: true,
        interactions: Number(row.interactions || 0),
        lastSentAt: row.last_sent_at || null
      };
    });

    return {
      referenceDay: day,
      byId
    };
  }
}

module.exports = MessageAnalyticsService;
