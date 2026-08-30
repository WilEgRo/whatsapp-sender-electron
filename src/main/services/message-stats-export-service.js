const ExcelJS = require('exceljs');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

class MessageStatsExportService {
  static sanitizeFileName(value) {
    return String(value || 'stats')
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 100);
  }

  static toSheetRows(items, labelKey) {
    return (Array.isArray(items) ? items : []).map((item) => ({
      [labelKey]: item[labelKey] || '',
      Unidades: Number(item.total_units || 0),
      Interacciones: Number(item.interactions || 0)
    }));
  }

  static buildFilterLabel(filter = {}) {
    const preset = String(filter.preset || 'last-30');
    if (preset === 'today') {
      return 'Hoy';
    }

    if (preset === 'last-7') {
      return 'Ultimos 7 dias';
    }

    if (preset === 'last-30') {
      return 'Ultimos 30 dias';
    }

    return `Personalizado (${filter.fromDay || '-'} a ${filter.toDay || '-'})`;
  }

  static styleHeaderRow(sheet, rowNumber = 1) {
    const row = sheet.getRow(rowNumber);
    row.font = { bold: true, color: { argb: 'FF1F3F75' } };
    row.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEFF5FF' }
    };
    row.alignment = { vertical: 'middle', horizontal: 'left' };
    row.border = {
      bottom: { style: 'thin', color: { argb: 'FFD5E2FA' } }
    };
  }

  static appendObjectRows(sheet, rows, columns) {
    sheet.columns = columns;
    if (Array.isArray(rows) && rows.length > 0) {
      sheet.addRows(rows);
    } else {
      sheet.addRow(Object.fromEntries(columns.map((column) => [column.key, '-'])));
    }
    MessageStatsExportService.styleHeaderRow(sheet, 1);
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  static async createLineChartBuffer({ title, labels, datasets }) {
    const width = 1200;
    const height = 420;
    const chartRenderer = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: 'white'
    });

    const configuration = {
      type: 'line',
      data: {
        labels,
        datasets
      },
      options: {
        responsive: false,
        plugins: {
          legend: { display: true, position: 'top' },
          title: {
            display: true,
            text: title,
            color: '#1A2E55',
            font: { size: 16, weight: 'bold' }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    };

    return chartRenderer.renderToBuffer(configuration, 'image/png');
  }

  static async buildWorkbook(data) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'WhatsApp Sender Pro';
    workbook.created = new Date();

    const summaryRows = [
      { Indicador: 'Filtro aplicado', Valor: MessageStatsExportService.buildFilterLabel(data.filter || {}) },
      { Indicador: 'Rango', Valor: `${(data.filter && data.filter.fromDay) || '-'} a ${(data.filter && data.filter.toDay) || '-'}` },
      { Indicador: 'Dia de referencia', Valor: data.referenceDay },
      { Indicador: 'Total hoy (unidades)', Valor: data.today.totalUnits },
      { Indicador: 'Porcentaje contactos', Valor: `${data.percentages.contacts}%` },
      { Indicador: 'Porcentaje grupos', Valor: `${data.percentages.groups}%` }
    ];

    const recordsRows = [
      {
        Record: 'Dia con mayor actividad',
        Periodo: data.records.topDay ? data.records.topDay.day : '-',
        Unidades: data.records.topDay ? Number(data.records.topDay.total_units || 0) : 0,
        Interacciones: data.records.topDay ? Number(data.records.topDay.interactions || 0) : 0
      },
      {
        Record: 'Semana con mayor actividad',
        Periodo: data.records.topWeek ? data.records.topWeek.week : '-',
        Unidades: data.records.topWeek ? Number(data.records.topWeek.total_units || 0) : 0,
        Interacciones: data.records.topWeek ? Number(data.records.topWeek.interactions || 0) : 0
      }
    ];

    const topDestRows = [
      {
        Tipo: 'Contacto',
        Destino: data.topDestinations.contact
          ? (data.topDestinations.contact.display_name || data.topDestinations.contact.destination_id)
          : '-',
        Unidades: data.topDestinations.contact ? Number(data.topDestinations.contact.total_units || 0) : 0,
        Interacciones: data.topDestinations.contact ? Number(data.topDestinations.contact.interactions || 0) : 0
      },
      {
        Tipo: 'Grupo',
        Destino: data.topDestinations.group
          ? (data.topDestinations.group.display_name || data.topDestinations.group.destination_id)
          : '-',
        Unidades: data.topDestinations.group ? Number(data.topDestinations.group.total_units || 0) : 0,
        Interacciones: data.topDestinations.group ? Number(data.topDestinations.group.interactions || 0) : 0
      }
    ];

    const rankingRows = (Array.isArray(data.exportTables && data.exportTables.topRanking) ? data.exportTables.topRanking : []).map((item, index) => ({
      Posicion: index + 1,
      Tipo: item.destination_type === 'groups' ? 'Grupo' : 'Contacto',
      Destino: item.destination_label || item.destination_id,
      Unidades: Number(item.total_units || 0),
      Interacciones: Number(item.interactions || 0)
    }));

    const sheetSummary = workbook.addWorksheet('Resumen');
    MessageStatsExportService.appendObjectRows(sheetSummary, summaryRows, [
      { header: 'Indicador', key: 'Indicador', width: 36 },
      { header: 'Valor', key: 'Valor', width: 50 }
    ]);

    const sheetDaily = workbook.addWorksheet('Resumen Diario');
    MessageStatsExportService.appendObjectRows(
      sheetDaily,
      MessageStatsExportService.toSheetRows(data.exportTables.daily, 'day'),
      [
        { header: 'Dia', key: 'day', width: 16 },
        { header: 'Unidades', key: 'Unidades', width: 12 },
        { header: 'Interacciones', key: 'Interacciones', width: 14 }
      ]
    );

    const sheetWeekly = workbook.addWorksheet('Resumen Semanal');
    MessageStatsExportService.appendObjectRows(
      sheetWeekly,
      MessageStatsExportService.toSheetRows(data.exportTables.weekly, 'week'),
      [
        { header: 'Semana', key: 'week', width: 16 },
        { header: 'Unidades', key: 'Unidades', width: 12 },
        { header: 'Interacciones', key: 'Interacciones', width: 14 }
      ]
    );

    const sheetMonthly = workbook.addWorksheet('Resumen Mensual');
    MessageStatsExportService.appendObjectRows(
      sheetMonthly,
      MessageStatsExportService.toSheetRows(data.exportTables.monthly, 'month'),
      [
        { header: 'Mes', key: 'month', width: 16 },
        { header: 'Unidades', key: 'Unidades', width: 12 },
        { header: 'Interacciones', key: 'Interacciones', width: 14 }
      ]
    );

    const sheetYearly = workbook.addWorksheet('Resumen Anual');
    MessageStatsExportService.appendObjectRows(
      sheetYearly,
      MessageStatsExportService.toSheetRows(data.exportTables.yearly, 'year'),
      [
        { header: 'Anio', key: 'year', width: 14 },
        { header: 'Unidades', key: 'Unidades', width: 12 },
        { header: 'Interacciones', key: 'Interacciones', width: 14 }
      ]
    );

    const sheetRecords = workbook.addWorksheet('Records');
    MessageStatsExportService.appendObjectRows(sheetRecords, recordsRows, [
      { header: 'Record', key: 'Record', width: 30 },
      { header: 'Periodo', key: 'Periodo', width: 18 },
      { header: 'Unidades', key: 'Unidades', width: 12 },
      { header: 'Interacciones', key: 'Interacciones', width: 14 }
    ]);

    const sheetTop = workbook.addWorksheet('Top Destinos');
    MessageStatsExportService.appendObjectRows(sheetTop, topDestRows, [
      { header: 'Tipo', key: 'Tipo', width: 14 },
      { header: 'Destino', key: 'Destino', width: 48 },
      { header: 'Unidades', key: 'Unidades', width: 12 },
      { header: 'Interacciones', key: 'Interacciones', width: 14 }
    ]);

    const sheetRanking = workbook.addWorksheet('Ranking Chats');
    MessageStatsExportService.appendObjectRows(sheetRanking, rankingRows, [
      { header: '#', key: 'Posicion', width: 8 },
      { header: 'Tipo', key: 'Tipo', width: 14 },
      { header: 'Destino', key: 'Destino', width: 48 },
      { header: 'Unidades', key: 'Unidades', width: 12 },
      { header: 'Interacciones', key: 'Interacciones', width: 14 }
    ]);

    const chartSheet = workbook.addWorksheet('Graficos');
    chartSheet.columns = [{ width: 2 }, { width: 68 }, { width: 68 }];
    chartSheet.getCell('B2').value = 'Tendencias del historial';
    chartSheet.getCell('B2').font = { bold: true, size: 14, color: { argb: 'FF1D3D71' } };

    const dailySeries = Array.isArray(data.charts && data.charts.daily) ? data.charts.daily : [];
    const weeklySeries = Array.isArray(data.charts && data.charts.weekly) ? data.charts.weekly : [];

    const dailyChartBuffer = await MessageStatsExportService.createLineChartBuffer({
      title: 'Tendencia diaria de unidades e interacciones',
      labels: dailySeries.map((item) => item.label),
      datasets: [
        {
          label: 'Unidades',
          data: dailySeries.map((item) => item.units),
          borderColor: '#2D6CDF',
          backgroundColor: 'rgba(45,108,223,0.18)',
          borderWidth: 3,
          tension: 0.35,
          fill: true,
          pointRadius: 2
        },
        {
          label: 'Interacciones',
          data: dailySeries.map((item) => item.interactions),
          borderColor: '#F08D49',
          backgroundColor: 'rgba(240,141,73,0.16)',
          borderWidth: 2,
          tension: 0.35,
          fill: false,
          pointRadius: 2
        }
      ]
    });

    const weeklyChartBuffer = await MessageStatsExportService.createLineChartBuffer({
      title: 'Tendencia semanal de unidades',
      labels: weeklySeries.map((item) => item.label),
      datasets: [
        {
          label: 'Unidades',
          data: weeklySeries.map((item) => item.units),
          borderColor: '#22A06B',
          backgroundColor: 'rgba(34,160,107,0.18)',
          borderWidth: 3,
          tension: 0.35,
          fill: true,
          pointRadius: 2
        }
      ]
    });

    const dailyImageId = workbook.addImage({ buffer: dailyChartBuffer, extension: 'png' });
    const weeklyImageId = workbook.addImage({ buffer: weeklyChartBuffer, extension: 'png' });

    chartSheet.addImage(dailyImageId, {
      tl: { col: 1, row: 3 },
      ext: { width: 780, height: 280 }
    });

    chartSheet.addImage(weeklyImageId, {
      tl: { col: 1, row: 20 },
      ext: { width: 780, height: 280 }
    });

    return workbook;
  }

  static async exportToExcel({ dialog, mainWindow, analyticsService, referenceDate, decorateStats, filter }) {
    const statsRaw = await analyticsService.getExportData(referenceDate, filter);
    const stats = typeof decorateStats === 'function' ? decorateStats(statsRaw) : statsRaw;
    const safeDate = MessageStatsExportService.sanitizeFileName(stats.referenceDay || new Date().toISOString().slice(0, 10));

    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar reporte de mensajeria',
      defaultPath: `reporte_mensajeria_${safeDate}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return {
        canceled: true
      };
    }

    const workbook = await MessageStatsExportService.buildWorkbook(stats);
    await workbook.xlsx.writeFile(saveResult.filePath);

    return {
      canceled: false,
      filePath: saveResult.filePath,
      referenceDay: stats.referenceDay
    };
  }
}

module.exports = MessageStatsExportService;
