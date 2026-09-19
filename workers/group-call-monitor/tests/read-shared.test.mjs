import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ReadStore } from '../read-store.mjs';
import { ReadReceiptService } from '../read-service.mjs';

test('members share the latest group set; a different setter clears readers only in that group', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('../read-schema.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      let args = [];
      const execute = () => {
        const stmt = sqlite.prepare(sql);
        return stmt.columns().length ? { results: stmt.all(...args) } : { results: [], meta: { changes: Number(stmt.run(...args).changes) } };
      };
      return {
        bind(...values) { args = values; return this; },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return execute(); }, async run() { return execute(); }, execute,
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const botId = 'U' + '0'.repeat(32);
  const alice = 'U' + '1'.repeat(32), bob = 'U' + '2'.repeat(32), reader = 'U' + '3'.repeat(32);
  const group = 'C' + '1'.repeat(32), other = 'C' + '2'.repeat(32);
  const base = Date.now() - 10_000;
  const store = new ReadStore(db), replies = [];
  const api = {
    async members() { return { list: [{userId:alice,name:'アリス'},{userId:bob,name:'ボブ'},{userId:reader,name:'もち'}] }; },
    async sendText(chatId,text,sendId) { replies.push({chatId,text,sendId}); },
  };
  const service = new ReadReceiptService(store, api, {botId,scope:'all',enabled:true});
  const command = (chatId,userId,text,time) => ({event:'chat',subEvent:'message',botId,chatId,payload:{type:'message',timestamp:time,source:{chatId,userId},message:{type:'text',text}}});
  const receipt = (chatId,userId,time) => ({event:'chat',subEvent:'chatRead',botId,chatId,payload:{type:'chatRead',timestamp:time,source:{chatId,userId},read:{watermark:time}}});
  const receive = (e,id) => service.receive(e,id,base - 1,base + 5000);

  await receive(command(group,alice,'既読セット',base),'set-a');
  await receive(command(other,alice,'既読セット',base),'set-other');
  await receive(receipt(group,reader,base+100),'read-1');
  await receive(receipt(other,reader,base+100),'other-read');
  await receive(command(group,alice,'既読確認',base+200),'list-a');
  const aliceView = replies.at(-1).text;
  await receive(command(group,bob,'既読確認',base+300),'list-b');
  assert.equal(replies.at(-1).text,aliceView);
  assert.match(aliceView,/既読が確認できた人（1人）\n・もち/);

  await receive(command(group,bob,'既読セット',base+1000),'set-b');
  assert.equal((await store.getSession(group,base+5000)).set_by_user_id,bob);
  assert.equal((await store.listReceipts(group,base+5000)).length,0);
  assert.equal((await store.listReceipts(other,base+5000)).length,1);
  await receive(receipt(group,reader,base+100),'delayed-old-read');
  assert.equal((await store.listReceipts(group,base+5000)).length,0);
  await receive(command(group,alice,'既読確認',base+1200),'after-reset');
  assert.match(replies.at(-1).text,/既読が確認できた人（0人）/);

  await receive(receipt(group,reader,base+1500),'new-read');
  const count = replies.length;
  await receive(command(group,bob,'既読セット',base+1000),'set-b');
  assert.equal(replies.length,count);
  assert.equal((await store.listReceipts(group,base+5000)).length,1);
  await receive(command(group,alice,'既読確認',base+1600),'final-list');
  assert.match(replies.at(-1).text,/既読が確認できた人（1人）\n・もち/);
  for (const {text} of replies) assert.doesNotMatch(text,/既読開始|既読終了|24時間|イベント未受信の人/);
});
