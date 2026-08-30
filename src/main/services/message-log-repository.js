const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { app } = require('electron');

function resolveDbPath() {
  try {
    const userDataPath = app && typeof app.getPath === 'function' ? app.getPath('userData') : null;
    if (userDataPath) {
      return path.join(userDataPath, 'message-logs.sqlite');
    }
  } catch (_error) {
    // cuando la ruta de la aplicación Electron aún no esté disponible.
  }

  return path.join(process.cwd(), 'data', 'message-logs.sqlite');
}

function normalizeDayValue(day) {
  if (!day) {
    return null;
  }

  const match = /^\d{4}-\d{2}-\d{2}$/.exec(String(day).trim());
  return match ? match[0] : null;
}

function buildDateRangeParams(fromDay, toDay) {
  const from = normalizeDayValue(fromDay);
  const to = normalizeDayValue(toDay);

  if (from && to) {
    return {
      whereClause: "WHERE DATE(timestamp_iso, 'localtime') BETWEEN ? AND ?",
      params: [from, to]
    };
  }

  if (from) {
    return {
      whereClause: "WHERE DATE(timestamp_iso, 'localtime') >= ?",
      params: [from]
    };
  }

  if (to) {
    return {
      whereClause: "WHERE DATE(timestamp_iso, 'localtime') <= ?",
      params: [to]
    };
  }

  return {
    whereClause: '',
    params: []
  };
}

class MessageLogRepository {
  constructor(dbPath = resolveDbPath()) {
    this.dbPath = dbPath;
    this.database = null;
  }

  async initialize() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    await new Promise((resolve, reject) => {
      this.database = new sqlite3.Database(this.dbPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await this.run(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp_iso TEXT NOT NULL,
        destination_type TEXT NOT NULL,
        destination_id TEXT NOT NULL,
        units_total INTEGER NOT NULL,
        content_type TEXT NOT NULL
      )
    `);

    await this.run('CREATE INDEX IF NOT EXISTS idx_message_logs_timestamp ON message_logs(timestamp_iso)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_message_logs_destination_type ON message_logs(destination_type)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_message_logs_destination_id ON message_logs(destination_id)');

    await this.run(`
      CREATE TABLE IF NOT EXISTS scheduled_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at_iso TEXT NOT NULL,
        scheduled_at_iso TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        target_label TEXT,
        message_text TEXT,
        files_json TEXT NOT NULL,
        send_files_first INTEGER NOT NULL DEFAULT 1,
        delay_min INTEGER NOT NULL DEFAULT 3,
        delay_max INTEGER NOT NULL DEFAULT 6,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        sent_at_iso TEXT
      )
    `);

    await this.run('CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status ON scheduled_messages(status)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due ON scheduled_messages(status, scheduled_at_iso)');
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.database.run(sql, params, function onRun(error) {
        if (error) {
          reject(error);
          return;
        }

        resolve(this);
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.database.get(sql, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(row || null);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.database.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(Array.isArray(rows) ? rows : []);
      });
    });
  }

  async insertLog({ timestampIso, destinationType, destinationId, unitsTotal, contentType }) {
    await this.run(
      `
        INSERT INTO message_logs (
          timestamp_iso,
          destination_type,
          destination_id,
          units_total,
          content_type
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [timestampIso, destinationType, destinationId, unitsTotal, contentType]
    );
  }

  async getTotalByDay(day) {
    const row = await this.get(
      `
        SELECT COALESCE(SUM(units_total), 0) AS total_units
        FROM message_logs
        WHERE DATE(timestamp_iso, 'localtime') = ?
      `,
      [day]
    );

    return Number(row && row.total_units ? row.total_units : 0);
  }

  getDailyTotals(limit = 60) {
    return this.getDailyTotalsByRange(null, null, limit);
  }

  getDailyTotalsByRange(fromDay, toDay, limit = 180) {
    const range = buildDateRangeParams(fromDay, toDay);
    return this.all(
      `
        SELECT
          DATE(timestamp_iso, 'localtime') AS day,
          SUM(units_total) AS total_units,
          COUNT(*) AS interactions
        FROM message_logs
        ${range.whereClause}
        GROUP BY day
        ORDER BY day DESC
        LIMIT ?
      `,
      [...range.params, limit]
    );
  }

  getWeeklyTotals(limit = 26) {
    return this.getWeeklyTotalsByRange(null, null, limit);
  }

  getWeeklyTotalsByRange(fromDay, toDay, limit = 104) {
    const range = buildDateRangeParams(fromDay, toDay);
    return this.all(
      `
        SELECT
          STRFTIME('%Y-W%W', timestamp_iso, 'localtime') AS week,
          SUM(units_total) AS total_units,
          COUNT(*) AS interactions
        FROM message_logs
        ${range.whereClause}
        GROUP BY week
        ORDER BY week DESC
        LIMIT ?
      `,
      [...range.params, limit]
    );
  }

  getMonthlyTotals(limit = 12) {
    return this.getMonthlyTotalsByRange(null, null, limit);
  }

  getMonthlyTotalsByRange(fromDay, toDay, limit = 36) {
    const range = buildDateRangeParams(fromDay, toDay);
    return this.all(
      `
        SELECT
          STRFTIME('%Y-%m', timestamp_iso, 'localtime') AS month,
          SUM(units_total) AS total_units,
          COUNT(*) AS interactions
        FROM message_logs
        ${range.whereClause}
        GROUP BY month
        ORDER BY month DESC
        LIMIT ?
      `,
      [...range.params, limit]
    );
  }

  getYearlyTotalsByRange(fromDay, toDay, limit = 10) {
    const range = buildDateRangeParams(fromDay, toDay);
    return this.all(
      `
        SELECT
          STRFTIME('%Y', timestamp_iso, 'localtime') AS year,
          SUM(units_total) AS total_units,
          COUNT(*) AS interactions
        FROM message_logs
        ${range.whereClause}
        GROUP BY year
        ORDER BY year DESC
        LIMIT ?
      `,
      [...range.params, limit]
    );
  }

  getTopDayRecord() {
    return this.getTopDayRecordByRange(null, null);
  }

  getTopDayRecordByRange(fromDay, toDay) {
    const range = buildDateRangeParams(fromDay, toDay);
    return this.get(
      `
        SELECT
          DATE(timestamp_iso, 'localtime') AS day,
          SUM(units_total) AS total_units,
          COUNT(*) AS interactions
        FROM message_logs
        ${range.whereClause}
        GROUP BY day
        ORDER BY total_units DESC, day DESC
        LIMIT 1
      `,
      range.params
    );
  }

  getTopWeekRecord() {
    return this.getTopWeekRecordByRange(null, null);
  }

  getTopWeekRecordByRange(fromDay, toDay) {
    const range = buildDateRangeParams(fromDay, toDay);
    return this.get(
      `
        SELECT
          STRFTIME('%Y-W%W', timestamp_iso, 'localtime') AS week,
          SUM(units_total) AS total_units,
          COUNT(*) AS interactions
        FROM message_logs
        ${range.whereClause}
        GROUP BY week
        ORDER BY total_units DESC, week DESC
        LIMIT 1
      `,
      range.params
    );
  }

  getTopDestinationByType(destinationType) {
    return this.getTopDestinationByTypeInRange(destinationType, null, null);
  }

  getTopDestinationByTypeInRange(destinationType, fromDay, toDay) {
    const range = buildDateRangeParams(fromDay, toDay);
    return this.get(
      `
        SELECT
          destination_id,
          SUM(units_total) AS total_units,
          COUNT(*) AS interactions
        FROM message_logs
        WHERE destination_type = ?
          ${range.whereClause ? `AND ${range.whereClause.replace(/^WHERE\s+/i, '')}` : ''}
        GROUP BY destination_id
        ORDER BY total_units DESC, interactions DESC
        LIMIT 1
      `,
      [destinationType, ...range.params]
    );
  }

  async getDistributionTotals() {
    return this.getDistributionTotalsByRange(null, null);
  }

  async getDistributionTotalsByRange(fromDay, toDay) {
    const range = buildDateRangeParams(fromDay, toDay);
    const rows = await this.all(
      `
        SELECT
          destination_type,
          SUM(units_total) AS total_units
        FROM message_logs
        ${range.whereClause}
        GROUP BY destination_type
      `,
      range.params
    );

    return rows.reduce(
      (accumulator, row) => {
        const key = row.destination_type === 'groups' ? 'groups' : 'contacts';
        accumulator[key] = Number(row.total_units || 0);
        return accumulator;
      },
      { contacts: 0, groups: 0 }
    );
  }

  async getUniqueChatCounts() {
    return this.getUniqueChatCountsByRange(null, null);
  }

  async getUniqueChatCountsByRange(fromDay, toDay) {
    const range = buildDateRangeParams(fromDay, toDay);
    const rows = await this.all(
      `
        SELECT
          destination_type,
          COUNT(DISTINCT destination_id) AS total_chats
        FROM message_logs
        ${range.whereClause}
        GROUP BY destination_type
      `,
      range.params
    );

    const counts = rows.reduce(
      (accumulator, row) => {
        const key = row.destination_type === 'groups' ? 'groups' : 'contacts';
        accumulator[key] = Number(row.total_chats || 0);
        return accumulator;
      },
      { contacts: 0, groups: 0 }
    );

    return {
      contacts: counts.contacts,
      groups: counts.groups,
      total: counts.contacts + counts.groups
    };
  }

  getTopDestinationsRanking(fromDay, toDay, limit = 20) {
    const range = buildDateRangeParams(fromDay, toDay);
    return this.all(
      `
        SELECT
          destination_type,
          destination_id,
          SUM(units_total) AS total_units,
          COUNT(*) AS interactions
        FROM message_logs
        ${range.whereClause}
        GROUP BY destination_type, destination_id
        ORDER BY interactions DESC, total_units DESC
        LIMIT ?
      `,
      [...range.params, limit]
    );
  }

  getAllMessageLogs(limit = 200000) {
    return this.all(
      `
        SELECT
          id,
          timestamp_iso,
          destination_type,
          destination_id,
          units_total,
          content_type
        FROM message_logs
        ORDER BY timestamp_iso ASC, id ASC
        LIMIT ?
      `,
      [Number(limit) || 200000]
    );
  }

  async getDestinationStatusesByDay(destinationType, destinationIds = [], day) {
    if (!Array.isArray(destinationIds) || destinationIds.length === 0) {
      return [];
    }

    const normalizedType = destinationType === 'groups' ? 'groups' : 'contacts';
    const cleanIds = destinationIds
      .map((id) => String(id || '').trim())
      .filter(Boolean);

    if (cleanIds.length === 0) {
      return [];
    }

    const placeholders = cleanIds.map(() => '?').join(',');

    return this.all(
      `
        SELECT
          destination_id,
          MAX(timestamp_iso) AS last_sent_at,
          COUNT(*) AS interactions
        FROM message_logs
        WHERE destination_type = ?
          AND DATE(timestamp_iso, 'localtime') = ?
          AND destination_id IN (${placeholders})
        GROUP BY destination_id
      `,
      [normalizedType, day, ...cleanIds]
    );
  }

  async insertScheduledMessage({
    createdAtIso,
    scheduledAtIso,
    targetType,
    targetId,
    targetLabel,
    messageText,
    files = [],
    sendFilesFirst = true,
    delayMin = 3,
    delayMax = 6
  }) {
    const result = await this.run(
      `
        INSERT INTO scheduled_messages (
          created_at_iso,
          scheduled_at_iso,
          target_type,
          target_id,
          target_label,
          message_text,
          files_json,
          send_files_first,
          delay_min,
          delay_max,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `,
      [
        createdAtIso,
        scheduledAtIso,
        targetType,
        targetId,
        targetLabel || '',
        messageText || '',
        JSON.stringify(Array.isArray(files) ? files : []),
        sendFilesFirst ? 1 : 0,
        Number(delayMin) || 3,
        Number(delayMax) || 6
      ]
    );

    return Number(result.lastID || 0);
  }

  async getScheduledMessages({ status = 'pending', limit = 200 } = {}) {
    const params = [];
    const where = [];

    if (status && status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await this.all(
      `
        SELECT
          id,
          created_at_iso,
          scheduled_at_iso,
          target_type,
          target_id,
          target_label,
          message_text,
          files_json,
          send_files_first,
          delay_min,
          delay_max,
          status,
          last_error,
          sent_at_iso
        FROM scheduled_messages
        ${whereClause}
        ORDER BY scheduled_at_iso ASC, id ASC
        LIMIT ?
      `,
      [...params, Number(limit) || 200]
    );

    return rows.map((row) => ({
      id: Number(row.id),
      createdAtIso: row.created_at_iso,
      scheduledAtIso: row.scheduled_at_iso,
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: row.target_label || row.target_id,
      messageText: row.message_text || '',
      files: (() => {
        try {
          const parsed = JSON.parse(row.files_json || '[]');
          return Array.isArray(parsed) ? parsed : [];
        } catch (_error) {
          return [];
        }
      })(),
      sendFilesFirst: Number(row.send_files_first || 0) === 1,
      delayMin: Number(row.delay_min || 3),
      delayMax: Number(row.delay_max || 6),
      status: row.status,
      lastError: row.last_error || null,
      sentAtIso: row.sent_at_iso || null
    }));
  }

  getDueScheduledMessages(nowIso) {
    return this.getScheduledMessagesByStatusAndDue('pending', nowIso, 100);
  }

  async getScheduledMessagesByStatusAndDue(status, nowIso, limit = 100) {
    const rows = await this.all(
      `
        SELECT
          id,
          created_at_iso,
          scheduled_at_iso,
          target_type,
          target_id,
          target_label,
          message_text,
          files_json,
          send_files_first,
          delay_min,
          delay_max,
          status,
          last_error,
          sent_at_iso
        FROM scheduled_messages
        WHERE status = ?
          AND scheduled_at_iso <= ?
        ORDER BY scheduled_at_iso ASC, id ASC
        LIMIT ?
      `,
      [status, nowIso, Number(limit) || 100]
    );

    return rows.map((row) => ({
      id: Number(row.id),
      createdAtIso: row.created_at_iso,
      scheduledAtIso: row.scheduled_at_iso,
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: row.target_label || row.target_id,
      messageText: row.message_text || '',
      files: (() => {
        try {
          const parsed = JSON.parse(row.files_json || '[]');
          return Array.isArray(parsed) ? parsed : [];
        } catch (_error) {
          return [];
        }
      })(),
      sendFilesFirst: Number(row.send_files_first || 0) === 1,
      delayMin: Number(row.delay_min || 3),
      delayMax: Number(row.delay_max || 6),
      status: row.status,
      lastError: row.last_error || null,
      sentAtIso: row.sent_at_iso || null
    }));
  }

  markScheduledProcessing(id) {
    return this.run(
      `
        UPDATE scheduled_messages
        SET status = 'processing',
            last_error = NULL
        WHERE id = ?
          AND status = 'pending'
      `,
      [id]
    );
  }

  markScheduledSent(id, sentAtIso) {
    return this.run(
      `
        UPDATE scheduled_messages
        SET status = 'sent',
            sent_at_iso = ?,
            last_error = NULL
        WHERE id = ?
      `,
      [sentAtIso, id]
    );
  }

  markScheduledFailed(id, errorMessage) {
    return this.run(
      `
        UPDATE scheduled_messages
        SET status = 'failed',
            last_error = ?
        WHERE id = ?
      `,
      [String(errorMessage || 'Error desconocido').slice(0, 500), id]
    );
  }

  cancelScheduledMessage(id) {
    return this.run(
      `
        UPDATE scheduled_messages
        SET status = 'canceled'
        WHERE id = ?
          AND status IN ('pending', 'failed')
      `,
      [id]
    );
  }
}

module.exports = MessageLogRepository;
