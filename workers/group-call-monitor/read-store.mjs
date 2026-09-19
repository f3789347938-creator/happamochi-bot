const DAY_MS = 24 * 60 * 60 * 1000;
const DEDUPE_MS = 7 * DAY_MS;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const ACTIONS = new Set(['start', 'stop', 'list']);
const FINISH_STATUSES = new Set(['sent', 'uncertain', 'failed']);

function id(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Invalid read-store identifier');
  }
  return value;
}

function time(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Invalid read-store timestamp');
  return value;
}

function clock(value) {
  time(value);
  if (value > Number.MAX_SAFE_INTEGER - DEDUPE_MS) throw new RangeError('Invalid read-store clock');
  return value;
}

function observedTime(value, now) {
  time(value);
  if (value - now > CLOCK_SKEW_MS) throw new RangeError('Read-store timestamp is in the future');
  return value;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function code(value) {
  if (value == null) return null;
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value) ? value : 'read_command_error';
}

/** The caller supplies verified actor IDs and normalized millisecond timestamps. */
export class ReadStore {
  constructor(db) { this.db = db; }

  async startSession(chatId, userId, checkpointAt, now = Date.now()) {
    id(chatId); id(userId); clock(now); observedTime(checkpointAt, now);
    return this.db.prepare(`INSERT INTO oa_read_sessions(chat_id,owner_user_id,checkpoint_at,started_at,expires_at)
      VALUES (?,?,?,?,?) ON CONFLICT(chat_id,owner_user_id) DO UPDATE SET
      checkpoint_at=excluded.checkpoint_at, started_at=excluded.started_at, expires_at=excluded.expires_at
      RETURNING *`).bind(chatId, userId, checkpointAt, now, now + DAY_MS).first();
  }

  async stopSession(chatId, userId) {
    id(chatId); id(userId);
    return changes(await this.db.prepare('DELETE FROM oa_read_sessions WHERE chat_id=? AND owner_user_id=?').bind(chatId, userId).run()) > 0;
  }

  async getSession(chatId, userId, now = Date.now()) {
    id(chatId); id(userId); clock(now);
    return this.db.prepare('SELECT * FROM oa_read_sessions WHERE chat_id=? AND owner_user_id=? AND expires_at>?')
      .bind(chatId, userId, now).first();
  }

  async recordReceipt(chatId, userId, watermark, eventAt, now = Date.now()) {
    id(chatId); id(userId); clock(now); observedTime(watermark, now); observedTime(eventAt, now);
    return Boolean(await this.db.prepare(`INSERT INTO oa_read_receipts(chat_id,user_id,watermark,event_at)
      SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM oa_read_sessions WHERE chat_id=? AND expires_at>?)
      ON CONFLICT(chat_id,user_id) DO UPDATE SET
      watermark=max(oa_read_receipts.watermark,excluded.watermark),
      event_at=max(oa_read_receipts.event_at,excluded.event_at)
      RETURNING user_id`).bind(chatId, userId, watermark, eventAt, chatId, now).first());
  }

  async listReceipts(chatId, ownerUserId, now = Date.now()) {
    id(chatId); id(ownerUserId); clock(now);
    const result = await this.db.prepare(`SELECT r.user_id,r.watermark,r.event_at FROM oa_read_receipts AS r
      JOIN oa_read_sessions AS s ON s.chat_id=r.chat_id
      WHERE s.chat_id=? AND s.owner_user_id=? AND s.expires_at>? AND r.watermark>=s.checkpoint_at
      ORDER BY r.watermark DESC,r.user_id`).bind(chatId, ownerUserId, now).all();
    return result.results;
  }

  /** Claim and apply start/stop atomically; replay never resets or stops a later session. */
  async claimCommand({ chatId, eventId, userId, action, checkpointAt, eventAt = checkpointAt ?? Date.now() }, now = Date.now()) {
    id(chatId); id(eventId); id(userId); clock(now); observedTime(eventAt, now);
    if (!ACTIONS.has(action)) throw new TypeError('Invalid read command action');
    if (action === 'start') observedTime(checkpointAt ?? eventAt, now);
    // Keep this boundary aligned with cleanup so a purged old event cannot execute again.
    if (eventAt <= now - DEDUPE_MS) return null;
    const sendId = crypto.randomUUID();
    const statements = [this.db.prepare(`INSERT OR IGNORE INTO oa_read_commands
      (chat_id,event_id,owner_user_id,action,event_at,send_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'processing',?,?)`).bind(chatId, eventId, userId, action, eventAt, sendId, now, now)];
    if (action === 'start') {
      statements.push(this.db.prepare(`INSERT INTO oa_read_sessions(chat_id,owner_user_id,checkpoint_at,started_at,expires_at)
        SELECT ?,?,?,?,? WHERE EXISTS
        (SELECT 1 FROM oa_read_commands WHERE chat_id=? AND event_id=? AND send_id=?)
        ON CONFLICT(chat_id,owner_user_id) DO UPDATE SET checkpoint_at=excluded.checkpoint_at,
        started_at=excluded.started_at,expires_at=excluded.expires_at`)
        .bind(chatId, userId, checkpointAt ?? eventAt, now, now + DAY_MS, chatId, eventId, sendId));
    } else if (action === 'stop') {
      statements.push(this.db.prepare(`DELETE FROM oa_read_sessions WHERE chat_id=? AND owner_user_id=? AND EXISTS
        (SELECT 1 FROM oa_read_commands WHERE chat_id=? AND event_id=? AND send_id=?)`)
        .bind(chatId, userId, chatId, eventId, sendId));
    }
    statements.push(this.db.prepare('SELECT * FROM oa_read_commands WHERE chat_id=? AND event_id=? AND send_id=?')
      .bind(chatId, eventId, sendId));
    const results = await this.db.batch(statements);
    return results.at(-1).results[0] ?? null;
  }

  async markSending(row, text, now = Date.now()) {
    id(row.chat_id); id(row.event_id); id(row.send_id); clock(now);
    if (typeof text !== 'string' || !text.length || text.length > 5000) throw new TypeError('Invalid read command reply');
    return Boolean(await this.db.prepare(`UPDATE oa_read_commands SET status='sending',message_text=?,updated_at=?,
      last_attempt_at=?,attempts=attempts+1 WHERE chat_id=? AND event_id=? AND send_id=? AND status='processing'
      RETURNING event_id`).bind(text, now, now, row.chat_id, row.event_id, row.send_id).first());
  }

  async finishCommand(row, status, errorCode = null, now = Date.now()) {
    id(row.chat_id); id(row.event_id); id(row.send_id); clock(now);
    if (!FINISH_STATUSES.has(status)) throw new TypeError('Invalid read command status');
    return Boolean(await this.db.prepare(`UPDATE oa_read_commands SET status=?,error_code=?,updated_at=?,sent_at=?
      WHERE chat_id=? AND event_id=? AND send_id=? AND status<>'sent' RETURNING event_id`)
      .bind(status, status === 'sent' ? null : code(errorCode), now, status === 'sent' ? now : null,
        row.chat_id, row.event_id, row.send_id).first());
  }

  async acknowledge(chatId, sendId, timestamp = Date.now()) {
    id(chatId); id(sendId); time(timestamp);
    return Boolean(await this.db.prepare(`UPDATE oa_read_commands SET status='sent',error_code=NULL,sent_at=?,updated_at=max(updated_at,?)
      WHERE chat_id=? AND send_id=? AND status IN ('sending','uncertain','failed') RETURNING event_id`)
      .bind(timestamp, timestamp, chatId, sendId).first());
  }

  async quarantineInterrupted(now = Date.now(), staleMs = 120_000) {
    clock(now);
    if (!Number.isSafeInteger(staleMs) || staleMs < 0) throw new RangeError('Invalid read command stale interval');
    return changes(await this.db.prepare(`UPDATE oa_read_commands SET status='uncertain',error_code='interrupted_command',updated_at=?
      WHERE status IN ('processing','sending') AND updated_at<?`).bind(now, now - staleMs).run());
  }

  async cleanup(now = Date.now()) {
    clock(now);
    // A receipt survives while ANY active owner still needs its watermark.
    const results = await this.db.batch([
      this.db.prepare('DELETE FROM oa_read_sessions WHERE expires_at<=?').bind(now),
      this.db.prepare(`DELETE FROM oa_read_receipts WHERE NOT EXISTS (SELECT 1 FROM oa_read_sessions AS s
        WHERE s.chat_id=oa_read_receipts.chat_id AND s.expires_at>? AND s.checkpoint_at<=oa_read_receipts.watermark)`).bind(now),
      this.db.prepare('DELETE FROM oa_read_commands WHERE created_at<=?').bind(now - DEDUPE_MS),
    ]);
    return { sessionsDeleted: changes(results[0]), receiptsDeleted: changes(results[1]), commandsDeleted: changes(results[2]) };
  }
}
