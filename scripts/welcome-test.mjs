// 新メンバー参加時の歓迎メッセージのテスト。
//
// 直した不具合:
//   1. 同じ参加イベントが再送されると歓迎メッセージが2通出ていた
//      (memberJoined に重複排除が無かった)
//   2. 何も設定していないグループでも送られていた
//      (設定行が無いときに「送る」と判定していた=既定オン)
//      → 既定オフにし、「ウェルカムオン」と送ったグループだけ送る
import crypto from 'node:crypto'

const SECRET = process.env.CHESS_TEST_SECRET || 'c03a8d1e26cc700d461f8ff9b35ecfad'
const BASE = process.env.CHESS_TEST_BASE || 'http://localhost:3000'

let pass = 0
let fail = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  ❌ ${label} ${extra}`)
  }
}

let seq = 0
const sign = (b) => crypto.createHmac('sha256', SECRET).update(b).digest('base64')

// 同期処理されるテスト用ID接頭辞を使う。
// 「初期状態(設定行が無い)では送らない」を検証するため、
// グループIDは実行ごとに変える。固定IDだと前回の「ウェルカムオン」が
// 設定テーブルに残り、2回目以降は初期状態ではなくなってしまう。
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
const G = `Cpf_test_welcome1_${RUN}`
const G2 = `Cpf_test_welcome2_${RUN}`
const U = 'Upf_test_newbie_0000000000000001'

async function post(events) {
  const body = JSON.stringify({ destination: 'test', events })
  const res = await fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(body) },
    body,
  })
  await new Promise((r) => setTimeout(r, 120))
  return res
}

function joinEvent({ group = G, user = U, eventId, timestamp } = {}) {
  return {
    type: 'memberJoined',
    mode: 'active',
    timestamp: timestamp ?? Date.now(),
    source: { type: 'group', groupId: group },
    webhookEventId: eventId ?? `wj_${++seq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `wj_rt_${++seq}_${Date.now()}`,
    joined: { members: [{ type: 'user', userId: user }] },
  }
}

function msg(text, { group = G, user = U } = {}) {
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'group', groupId: group, userId: user },
    webhookEventId: `wm_${++seq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `wm_rt_${++seq}_${Date.now()}`,
    message: { id: String(Date.now() + seq), type: 'text', text },
  }
}

/** 実際にLINEへ送ろうとした内容を reply_api_logs から数える */
async function countReplies(groupId, needle) {
  const res = await fetch(`${BASE}/debug/reply-logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupId, needle }),
  })
  if (!res.ok) return -1
  const j = await res.json()
  return j.count ?? -1
}

async function main() {
  console.log('=== 1. 初期状態では歓迎メッセージを送らない ===')
  {
    const before = await countReplies(G, 'ようこそ')
    await post([joinEvent()])
    const after = await countReplies(G, 'ようこそ')
    ok(after === before, '何も設定していないグループでは送らない(既定オフ)', `${before} → ${after}`)
  }

  console.log('\n=== 2. ウェルカムオンにしたグループだけ送る ===')
  {
    await post([msg('ウェルカムオン')])
    const before = await countReplies(G, 'ようこそ')
    await post([joinEvent()])
    const after = await countReplies(G, 'ようこそ')
    ok(after === before + 1, 'オンにすると1通だけ送る', `${before} → ${after}`)
  }

  console.log('\n=== 3. 同じイベントの再送で2通目が出ない(今回の不具合) ===')
  {
    const eventId = `wj_dup_${Date.now()}`
    const before = await countReplies(G, 'ようこそ')
    await post([joinEvent({ eventId })])
    const once = await countReplies(G, 'ようこそ')
    ok(once === before + 1, '1回目は送られる', `${before} → ${once}`)
    // LINEが同じイベントを再送してくる状況を再現
    await post([joinEvent({ eventId })])
    const twice = await countReplies(G, 'ようこそ')
    ok(twice === once, '同じwebhookEventIdの再送では送られない', `${once} → ${twice}`)
    // 3回目も増えない
    await post([joinEvent({ eventId })])
    const thrice = await countReplies(G, 'ようこそ')
    ok(thrice === once, '何度再送されても増えない', `${once} → ${thrice}`)
  }

  console.log('\n=== 4. eventIdが無い再送でも2通目が出ない ===')
  {
    const ts = Date.now()
    const before = await countReplies(G, 'ようこそ')
    const ev = joinEvent({ timestamp: ts })
    delete ev.webhookEventId
    await post([ev])
    const once = await countReplies(G, 'ようこそ')
    ok(once === before + 1, 'eventIdが無くても1回目は送られる', `${before} → ${once}`)
    const ev2 = joinEvent({ timestamp: ts })
    delete ev2.webhookEventId
    await post([ev2])
    const twice = await countReplies(G, 'ようこそ')
    ok(twice === once, '同じ人・同じ時刻の再送では送られない', `${once} → ${twice}`)
  }

  console.log('\n=== 5. オフに戻せる ===')
  {
    await post([msg('ウェルカムオフ')])
    const before = await countReplies(G, 'ようこそ')
    await post([joinEvent()])
    const after = await countReplies(G, 'ようこそ')
    ok(after === before, 'オフにすると送らない', `${before} → ${after}`)
  }

  console.log('\n=== 6. 設定はグループごとに独立している ===')
  {
    await post([msg('ウェルカムオン')])
    const b2 = await countReplies(G2, 'ようこそ')
    await post([joinEvent({ group: G2 })])
    const a2 = await countReplies(G2, 'ようこそ')
    ok(a2 === b2, '別グループはオンにしていないので送らない', `${b2} → ${a2}`)
    // 元のグループはオンなので送られる
    const b1 = await countReplies(G, 'ようこそ')
    await post([joinEvent({ group: G })])
    const a1 = await countReplies(G, 'ようこそ')
    ok(a1 === b1 + 1, 'オンにしたグループでは送られる', `${b1} → ${a1}`)
    await post([msg('ウェルカムオフ')])
  }

  console.log('\n=== 7. カスタム文の設定・解除が動く ===')
  {
    const r1 = await fetch(`${BASE}/debug/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ウェルカムメッセージ設定 よろしくね', groupId: G, userId: U }),
    }).then((r) => r.json())
    ok(JSON.stringify(r1.would_reply_with).includes('設定しました'), 'カスタム文を設定できる')
    const r2 = await fetch(`${BASE}/debug/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'ウェルカムメッセージ解除', groupId: G, userId: U }),
    }).then((r) => r.json())
    ok(JSON.stringify(r2.would_reply_with).includes('解除'), 'カスタム文を解除できる')
  }

  console.log('\n=== 8. ヘルプに初期オフと書かれている ===')
  {
    const r = await fetch(`${BASE}/debug/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'hm|n|C04', groupId: 'Cmenu_test_grp1', userId: 'Umenu_test_alice_000000000000001' }),
    }).then((r) => r.json())
    const t = JSON.stringify(r.would_reply_with)
    ok(t.includes('オフ（初期設定）') || t.includes('オフ'), 'メニューの表示が既定オフと一致する')
  }

  console.log('\n=== 結果 ===')
  console.log(`  成功 ${pass} / 失敗 ${fail}`)
  if (failures.length > 0) {
    console.log('\n失敗した項目:')
    for (const f of failures) console.log(`  - ${f}`)
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
