// 「りぷかく」(リプライ確認)の自動テスト。
//
// 実際のWebhookイベント(署名付き)をローカルサーバーへ送り、
// 自分の発言への返信が記録され、引用付きで返ることを検証する。
import crypto from 'node:crypto'

const SECRET = process.env.CHESS_TEST_SECRET || 'c03a8d1e26cc700d461f8ff9b35ecfad'
const BASE = process.env.CHESS_TEST_BASE || 'http://localhost:3000'

let pass = 0
let fail = 0
const failures = []

function ok(cond, label, extra = '') {
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
const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64')

async function post(events) {
  const body = JSON.stringify({ destination: 'test', events })
  const res = await fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(body) },
    body,
  })
  // この環境ではD1への書き込み完了まで1秒近くかかる(実測)。
  await new Promise((r) => setTimeout(r, 1200))
  return res
}

const G = 'Crp_test_grp1'
const G2 = 'Crp_test_grp2'
const AI = 'Urp_test_airi'   // 発言してリプライされる人(愛璃役)
const RY = 'Urp_test_ryu'    // りゅうちゃむ役
const YU = 'Urp_test_yuu'    // 天空海役
const BY = 'Urp_test_byou'   // 病弱役

/**
 * 発言を送る。返り値は message.id(これを quotedMessageId に使う)。
 */
async function say(text, { user = AI, group = G } = {}) {
  const id = String(Date.now() + ++seq)
  await post([
    {
      type: 'message',
      mode: 'active',
      timestamp: Date.now(),
      source: group ? { type: 'group', groupId: group, userId: user } : { type: 'user', userId: user },
      webhookEventId: `rp_ev_${++seq}_${Date.now()}`,
      deliveryContext: { isRedelivery: false },
      replyToken: `rp_rt_${++seq}_${Date.now()}`,
      message: { id, type: 'text', text, quoteToken: `qt_${id}` },
    },
  ])
  return id
}

/** 指定メッセージへのリプライを送る */
async function replyTo(quotedMessageId, text, { user = RY, group = G } = {}) {
  const id = String(Date.now() + ++seq)
  await post([
    {
      type: 'message',
      mode: 'active',
      timestamp: Date.now(),
      source: group ? { type: 'group', groupId: group, userId: user } : { type: 'user', userId: user },
      webhookEventId: `rp_ev_${++seq}_${Date.now()}`,
      deliveryContext: { isRedelivery: false },
      replyToken: `rp_rt_${++seq}_${Date.now()}`,
      message: { id, type: 'text', text, quoteToken: `qt_${id}`, quotedMessageId },
    },
  ])
  return id
}

const simulate = async (text, { user = AI, group = G } = {}) => {
  const res = await fetch(`${BASE}/debug/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, userId: user, groupId: group }),
  })
  return res.json()
}

const dbg = (payload) =>
  fetch(`${BASE}/debug/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json())

/** 「りぷかく」の返信から、引用メッセージだけを取り出す */
function quotesOf(msgs) {
  return (msgs ?? []).filter((m) => typeof m?.quoteToken === 'string' && m.quoteToken.length > 0)
}

async function main() {
  await dbg({ op: 'reset', prefix: 'Urp_test_' })

  // =====================================================================
  console.log('\n=== 1. リプライの記録 ===')
  const base = await say('ドSになってるよん…Ｏ‿Ｏ', { user: AI })
  await replyTo(base, 'ドSになってるよん…Ｏ‿Ｏ', { user: RY })
  let rows = (await dbg({ op: 'list', target: AI, group: G })).rows
  ok(rows.length === 1, '自分の発言への返信が1件記録される', `${rows.length}件`)
  ok(rows[0]?.sender_id === RY, 'リプライした人が記録される', `${rows[0]?.sender_id}`)
  ok(!!rows[0]?.quote_token, '引用トークンが保存される')

  // リプライでない発言は記録されない
  await say('ふつうの発言', { user: RY })
  rows = (await dbg({ op: 'list', target: AI, group: G })).rows
  ok(rows.length === 1, 'リプライでない発言は記録されない', `${rows.length}件`)

  // =====================================================================
  console.log('\n=== 2. 除外すべきケース ===')
  // 自分の発言に自分で返信した分は出さない
  const own = await say('自分の発言', { user: AI })
  await replyTo(own, '自分で自分に返信', { user: AI })
  rows = (await dbg({ op: 'list', target: AI, group: G })).rows
  ok(rows.length === 1, '自分で自分に返信した分は記録しない', `${rows.length}件`)

  // 記録に無いメッセージへの返信(記録開始前の発言など)は誰宛か不明 → 飛ばす
  await replyTo('unknown_message_id_9999', '知らない発言への返信', { user: RY })
  const cnt = (await dbg({ op: 'count', prefix: 'Urp_test_' })).count
  ok(cnt === 1, '記録に無い発言への返信は記録しない', `合計${cnt}件`)

  // =====================================================================
  console.log('\n=== 3. 「りぷかく」の応答(見本と同じ形) ===')
  // 見本と同じ4件をそろえる(1件目は既にあるので3件追加)
  const m2 = await say('なんや蚊に刺されたんか の元', { user: AI })
  await replyTo(m2, 'なんや蚊に刺されたんか', { user: RY })
  const m3 = await say('勝手に殺すな の元', { user: AI })
  await replyTo(m3, '@愛璃 勝手に殺すな(  \'-\' )', { user: YU })
  const m4 = await say('だれ？ の元', { user: AI })
  await replyTo(m4, 'だれ？', { user: BY })

  let r = await simulate('りぷかく', { user: AI, group: G })
  let msgs = r.would_reply_with
  ok(msgs?.[0]?.text?.includes('直近でリプライされたメッセージ最大4件'), '1通目が見本と同じ案内文', `${msgs?.[0]?.text}`)
  const q = quotesOf(msgs)
  ok(q.length === 4, '引用が4件返る', `${q.length}件`)
  ok(q.every((m) => m.type === 'text'), '引用はすべてテキストメッセージ')
  ok(q.every((m) => m.text === '.'), '引用メッセージの本文は「.」(見本と同じ)')
  ok(msgs.length <= 5, 'LINEの1リプライ5通制限を超えない', `${msgs.length}通`)

  // 5件目を足しても4件までに収まる
  const m5 = await say('5件目の元', { user: AI })
  await replyTo(m5, '5件目のリプライ', { user: BY })
  r = await simulate('りぷかく', { user: AI, group: G })
  ok(quotesOf(r.would_reply_with).length === 4, '5件以上あっても引用は4件まで', `${quotesOf(r.would_reply_with).length}件`)

  const newest = (await dbg({ op: 'list', target: AI, group: G, limit: 4 })).rows
  ok(
    newest.some((x) => x.message_text?.includes('5件目のリプライ')),
    '直近4件には最新のリプライが含まれる'
  )
  ok(
    !newest.some((x) => x.message_text?.includes('ドSになってるよん')),
    '4件を超えた古いリプライは表示対象から外れる'
  )

  // =====================================================================
  console.log('\n=== 4. 対象者ごと・グループごとの分離 ===')
  // リプライされていない人には出ない
  r = await simulate('りぷかく', { user: 'Urp_test_nobody', group: G })
  ok(
    r.would_reply_with?.[0]?.text?.includes('まだリプライされてない'),
    'リプライされていない人には「まだない」と返る',
    `${r.would_reply_with?.[0]?.text}`
  )

  // 他人宛のリプライは自分に出ない
  const ryMsg = await say('りゅうちゃむの発言', { user: RY })
  await replyTo(ryMsg, 'りゅうちゃむへの返信', { user: BY })
  const ryRows = (await dbg({ op: 'list', target: RY, group: G })).rows
  ok(ryRows.length === 1, '別の人へのリプライはその人に記録される', `${ryRows.length}件`)
  ok(
    ryRows.every((x) => x.message_text?.includes('りゅうちゃむへの返信')),
    '他人宛のリプライが自分の結果に混ざらない'
  )
  const aiRows = (await dbg({ op: 'list', target: AI, group: G })).rows
  ok(
    !aiRows.some((x) => x.message_text?.includes('りゅうちゃむへの返信')),
    '自分の結果に他人宛のリプライが入らない'
  )

  // 別グループのリプライは混ざらない
  const g2msg = await say('別グループの発言', { user: AI, group: G2 })
  await replyTo(g2msg, '別グループの返信', { user: RY, group: G2 })
  const g2rows = (await dbg({ op: 'list', target: AI, group: G2 })).rows
  ok(g2rows.length === 1, '別グループのリプライは別に記録される', `${g2rows.length}件`)
  ok(
    g2rows.every((x) => x.message_text?.includes('別グループの返信')),
    '別グループの結果に元グループのものが混ざらない'
  )

  // =====================================================================
  console.log('\n=== 5. 「めんかく」と混ざらない ===')
  // りぷかくの結果がめんかくに出ない/その逆も
  const mk = await simulate('めんかく', { user: AI, group: G })
  const mkText = JSON.stringify(mk.would_reply_with)
  ok(
    !mkText.includes('直近でリプライされた'),
    '「めんかく」に「りぷかく」の案内文が出ない'
  )
  const rp = await simulate('りぷかく', { user: AI, group: G })
  ok(
    !JSON.stringify(rp.would_reply_with).includes('直近でメンションされた'),
    '「りぷかく」に「めんかく」の案内文が出ない'
  )

  // =====================================================================
  console.log('\n=== 6. 保持期間(7日) ===')
  const oldT = 'Urp_test_old'
  const om = await say('古い発言', { user: oldT })
  await replyTo(om, '古い返信', { user: RY })
  await dbg({ op: 'age', target: oldT, days: 8 })
  let oldRows = (await dbg({ op: 'list', target: oldT, group: G })).rows
  ok(oldRows.length === 1, '8日前に改変した記録が存在する(前提確認)', `${oldRows.length}件`)
  await simulate('りぷかく', { user: oldT, group: G })
  oldRows = (await dbg({ op: 'list', target: oldT, group: G })).rows
  ok(oldRows.length === 0, '7日を過ぎた記録は「りぷかく」実行時に削除される', `${oldRows.length}件`)

  // 7日以内は消えない
  const keepT = 'Urp_test_keep'
  const km = await say('残る発言', { user: keepT })
  await replyTo(km, '残る返信', { user: RY })
  await dbg({ op: 'age', target: keepT, days: 6 })
  await simulate('りぷかく', { user: keepT, group: G })
  const keepRows = (await dbg({ op: 'list', target: keepT, group: G })).rows
  ok(keepRows.length === 1, '7日以内の記録は消えない(6日前は残る)', `${keepRows.length}件`)

  // =====================================================================
  console.log('\n=== 7. 個人トークでは使わない ===')
  r = await simulate('りぷかく', { user: AI, group: null })
  const isReplyCard =
    Array.isArray(r.would_reply_with) &&
    r.would_reply_with.some((m) => m?.text?.includes('直近でリプライされた'))
  ok(!isReplyCard, '個人トークでは「りぷかく」が反応しない')

  // =====================================================================
  console.log('\n=== 結果 ===')
  console.log(`  成功 ${pass} / 失敗 ${fail}`)
  if (failures.length) {
    console.log('\n  失敗した項目:')
    for (const f of failures) console.log(`   - ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
