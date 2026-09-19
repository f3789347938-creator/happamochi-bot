export class MonitorStore {
  constructor(db) { this.db = db; }
  async state(now = Date.now()) {
    await this.db.prepare('INSERT OR IGNORE INTO oa_call_monitor_state(id, initialized_at) VALUES (1, ?)').bind(now).run();
    return this.db.prepare('SELECT * FROM oa_call_monitor_state WHERE id = 1').first();
  }
  async acquire(owner, now) {
    await this.state(now);
    return Boolean(await this.db.prepare(`UPDATE oa_call_monitor_state SET lease_owner = ?, lease_until = ?, last_run_at = ?
      WHERE id = 1 AND lease_until < ? RETURNING id`).bind(owner, now + 110000, now, now).first());
  }
  async activateScope(scope, enabled, now) {
    const key = `${enabled ? 'send' : 'observe'}:${scope}`;
    const changed = await this.db.prepare("UPDATE oa_call_monitor_state SET scope_key = ?, scope_activated_at = ?, discovery_next = '' WHERE id = 1 AND scope_key <> ? RETURNING id").bind(key, now, key).first();
    if (changed) await this.db.prepare("UPDATE oa_call_notifications SET status = 'observed', error_code = 'before_scope_activation' WHERE status = 'pending' AND ended_at < ?").bind(now).run();
  }
  async renew(owner, now) {
    const row = await this.db.prepare('UPDATE oa_call_monitor_state SET lease_until = ? WHERE id = 1 AND lease_owner = ? RETURNING id')
      .bind(now + 110000, owner).first();
    if (!row) throw new Error('lease_lost');
  }
  async release(owner, error = null) {
    await this.db.prepare('UPDATE oa_call_monitor_state SET lease_until = 0, lease_owner = NULL, last_error = ?, last_success_at = CASE WHEN ? IS NULL THEN ? ELSE last_success_at END WHERE id = 1 AND lease_owner = ?')
      .bind(error, error, Date.now(), owner).run();
  }
  async cursor(value, eventAt) {
    await this.db.prepare('UPDATE oa_call_monitor_state SET cursor = ?, last_event_at = ? WHERE id = 1').bind(value, eventAt).run();
  }
  async observedCall(call, text, enabled) {
    await this.db.prepare(`INSERT OR IGNORE INTO oa_call_notifications
      (chat_id,message_id,ended_at,duration_ms,detected_at,message_text,send_id,status)
      VALUES (?,?,?,?,?,?,?,?)`).bind(call.chatId, call.messageId, call.endedAt, call.durationMs, Date.now(), text,
        crypto.randomUUID(), enabled ? 'pending' : 'observed').run();
  }
  async pending() {
    return (await this.db.prepare("SELECT * FROM oa_call_notifications WHERE status = 'pending' ORDER BY ended_at LIMIT 20").all()).results;
  }
  async claim(row, now) {
    return Boolean(await this.db.prepare("UPDATE oa_call_notifications SET status = 'sending', attempts = attempts + 1, last_attempt_at = ? WHERE chat_id = ? AND message_id = ? AND status = 'pending' RETURNING message_id")
      .bind(now, row.chat_id, row.message_id).first());
  }
  async finish(row, status, code = null) {
    await this.db.prepare('UPDATE oa_call_notifications SET status = ?, error_code = ?, sent_at = ? WHERE chat_id = ? AND message_id = ?')
      .bind(status, code, status === 'sent' ? Date.now() : null, row.chat_id, row.message_id).run();
  }
  async acknowledge(chatId, sendId, timestamp) {
    if (typeof sendId !== 'string' || sendId.length > 256) return;
    await this.db.prepare("UPDATE oa_call_notifications SET status = 'sent', error_code = NULL, sent_at = ? WHERE chat_id = ? AND send_id = ? AND status IN ('sending','uncertain','failed')")
      .bind(Number.isSafeInteger(timestamp) ? timestamp : Date.now(), chatId, sendId).run();
  }
  async quarantineInterrupted(now) {
    await this.db.prepare("UPDATE oa_call_notifications SET status = 'uncertain', error_code = 'interrupted_send' WHERE status = 'sending' AND last_attempt_at < ?").bind(now - 120000).run();
  }
  async chatCursor(chatId, fallback) {
    const row = await this.db.prepare('SELECT checked_through FROM oa_call_chat_cursors WHERE chat_id = ?').bind(chatId).first();
    return row ? row.checked_through : fallback;
  }
  async checkedChat(chatId, timestamp) {
    await this.db.prepare(`INSERT INTO oa_call_chat_cursors(chat_id,checked_through,needs_scan,last_scan_at) VALUES (?,?,0,?)
      ON CONFLICT(chat_id) DO UPDATE SET checked_through = max(checked_through,excluded.checked_through),
      needs_scan = 0, history_backward = '', scan_cutoff = 0, scan_through = 0, last_scan_at = excluded.last_scan_at`).bind(chatId, timestamp, Date.now()).run();
  }
  async discoveryCursor(next) {
    await this.db.prepare('UPDATE oa_call_monitor_state SET discovery_next = ? WHERE id = 1').bind(next || '').run();
  }
  async queueChat(chatId) {
    await this.db.prepare('INSERT INTO oa_call_chat_cursors(chat_id) VALUES (?) ON CONFLICT(chat_id) DO UPDATE SET needs_scan = 1').bind(chatId).run();
  }
  async unresolvedChats(now) {
    return (await this.db.prepare(`SELECT chat_id, min(last_attempt_at) AS since FROM oa_call_notifications
      WHERE status IN ('sending','uncertain') AND last_attempt_at >= ? GROUP BY chat_id`).bind(now - 24 * 60 * 60 * 1000).all()).results;
  }
  async queuedChats() {
    return (await this.db.prepare('SELECT * FROM oa_call_chat_cursors WHERE needs_scan = 1 ORDER BY last_scan_at, chat_id LIMIT 35').all()).results;
  }
  async historyProgress(chatId, backward, cutoff, through) {
    await this.db.prepare('UPDATE oa_call_chat_cursors SET history_backward = ?, scan_cutoff = ?, scan_through = ?, last_scan_at = ? WHERE chat_id = ?')
      .bind(backward, cutoff, through, Date.now(), chatId).run();
  }
  async status() {
    const state = await this.state();
    const counts = (await this.db.prepare('SELECT status, COUNT(*) AS count FROM oa_call_notifications GROUP BY status').all()).results;
    const recent = (await this.db.prepare('SELECT chat_id,message_id,ended_at,duration_ms,status,error_code FROM oa_call_notifications ORDER BY detected_at DESC LIMIT 10').all()).results;
    return { state, counts, recent };
  }
}
