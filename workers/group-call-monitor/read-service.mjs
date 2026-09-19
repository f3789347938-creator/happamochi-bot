import { parseGroupReadReceipt, formatReadReceipts } from './read-receipts.mjs';

const COMMANDS = new Map([['既読セット', 'start'], ['既読確認', 'list'], ['既読終了', 'stop']]);
const MAX_COMMAND_AGE = 15 * 60 * 1000;
const validUser = value => typeof value === 'string' && /^U[0-9a-f]{32}$/i.test(value);
const safeName = name => Array.from(String(name || '名前未取得').replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').trim()).slice(0, 40).join('') || '名前未取得';

export function parseReadCommand(event, eventId, { botId, now = Date.now(), cutoff = 0 } = {}) {
  const p = event?.payload;
  if (!validUser(botId) || event?.event !== 'chat' || event?.subEvent !== 'message' || event?.botId !== botId ||
      p?.type !== 'message' || p.sendId || p.bizId || !/^C[0-9a-f]{32}$/i.test(event.chatId || '') ||
      event.chatId !== p.source?.chatId || !validUser(p.source?.userId) || p.source.userId.toLowerCase() === botId.toLowerCase() ||
      !['text', 'textV2'].includes(p.message?.type) || typeof p.message.text !== 'string' ||
      typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(eventId) ||
      !Number.isSafeInteger(p.timestamp) || p.timestamp < Math.max(cutoff, now - MAX_COMMAND_AGE) ||
      p.timestamp > now + 5 * 60 * 1000) return null;
  const action = COMMANDS.get(p.message.text.trim());
  return action ? { chatId: event.chatId, userId: p.source.userId, eventId, action,
    checkpointAt: p.timestamp, eventAt: p.timestamp } : null;
}

/** Each group shares one check, replaced whenever a member sets it again. */
export class ReadReceiptService {
  constructor(store, client, config) { this.store = store; this.client = client; this.config = config; }

  async memberNames(chatId) {
    const names = new Map();
    let next;
    const seen = new Set();
    for (let page = 0; page < 10; page++) {
      const result = await this.client.members(chatId, { next, limit: 100 });
      if (!Array.isArray(result.list)) throw new Error('invalid_members_response');
      for (const member of result.list) if (validUser(member.userId)) names.set(member.userId, safeName(member.name));
      if (!result.next) return names;
      if (seen.has(result.next)) throw new Error('members_cursor_stalled');
      seen.add(result.next); next = result.next;
    }
    throw new Error('members_page_limit');
  }

  async receive(event, eventId, cutoff, now = Date.now()) {
    if (!event || !this.config.enabled || !/^C[0-9a-f]{32}$/i.test(event.chatId || '') ||
        (this.config.scope !== 'all' && !String(this.config.scope || '').split(',').map(x => x.trim()).includes(event.chatId))) return;
    const receipt = parseGroupReadReceipt(event, { botId: this.config.botId, chatId: event.chatId, now });
    if (receipt) {
      await this.store.recordReceipt(receipt.chatId, receipt.userId, receipt.watermark, receipt.eventAt, now);
      return;
    }
    const command = parseReadCommand(event, eventId, { botId: this.config.botId, now, cutoff });
    if (!command) return;
    const row = await this.store.claimCommand(command, now);
    if (!row) return;
    let text;
    try {
      if (row.applied === 0) {
        text = '新しい既読設定があるため、この操作では変更しませんでした。';
      } else {
        const names = await this.memberNames(command.chatId);
        const actorName = names.get(command.userId) || 'メンバー';
        if (command.action === 'start') {
          text = `${actorName}さんが既読をセットしました。\n「既読確認」で名前を表示できます。`;
        } else if (command.action === 'stop') {
          text = 'このグループの既読記録を停止しました。';
        } else {
          const session = await this.store.getSession(command.chatId, now);
          if (!session) text = 'このグループには既読がセットされていません。\n「既読セット」と送ってください。';
          else {
            const receipts = await this.store.listReceipts(command.chatId, now);
            // Only display members whose current group profile can be verified.
            const readers = receipts.filter(r => names.has(r.user_id)).map(r => ({
              userId: r.user_id, displayName: names.get(r.user_id), eventAt: r.event_at,
            }));
            const started = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(session.checkpoint_at));
            text = `このグループの既読確認\nセット：${started}\n\n${formatReadReceipts(readers)}`;
          }
        }
      }
    } catch {
      text = '既読確認の名前を取得できませんでした。少し待ってから「既読確認」と送ってください。';
    }
    if (!await this.store.markSending(row, text, Date.now())) return;
    try {
      await this.client.sendText(command.chatId, text, row.send_id);
      await this.store.finishCommand(row, 'sent', null, Date.now());
    } catch (error) {
      const rejected = error?.status >= 400 && error?.status < 500;
      await this.store.finishCommand(row, rejected ? 'failed' : 'uncertain', Number.isInteger(error?.status) ? `line_http_${error.status}` : 'send_error', Date.now());
      if ([401, 403, 429].includes(error?.status)) throw error;
    }
  }
}
