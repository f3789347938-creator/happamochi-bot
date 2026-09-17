// 「めんかく」(メンション確認)の自動テスト。
//
// 実際のWebhookイベント(署名付き)をローカルサーバーへ送り、
// メンションが記録され、引用付きで返ることを検証する。
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
  // 短く待つと未コミット状態で検証してしまうため、余裕を持って待つ。
  await new Promise((r) => setTimeout(r, 1200))
  return res
}

const G = 'Cmn_test_grp1'
const G2 = 'Cmn_test_grp2'
const AI = 'Umn_test_airi'       // メンションされる人(愛璃役)
const YU = 'Umn_test_yuu'        // メンションする人
const AY = 'Umn_test_ayumu'      // メンションする人
const OU = 'Umn_test_ou'         // メンションする人
const BOT = 'Umn_test_bot_self'  // ボット自身

/** メンション付きテキストメッセージを組み立てる */
function mentionMsg(text, mentionees, { user = YU, group = G, name = null } = {}) {
  const id = String(Date.now() + ++seq)
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: group ? { type: 'group', groupId: group, userId: user } : { type: 'user', userId: user },
    webhookEventId: `mn_ev_${++seq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `mn_rt_${++seq}_${Date.now()}`,
    message: {
      id,
      type: 'text',
      text,
      quoteToken: `qt_${id}`,
      ...(mentionees ? { mention: { mentionees } } : {}),
    },
  }
}

/** 素のテキスト(メンションなし) */
function plainMsg(text, { user = YU, group = G } = {}) {
  return mentionMsg(text, null, { user, group })
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
  fetch(`${BASE}/debug/mentions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json())

async function main() {
  await dbg({ op: 'reset', prefix: 'Umn_test_' })

  // =====================================================================
  console.log('\n=== 1. メンションの記録 ===')
  await post([mentionMsg('@愛璃 勝手に殺すな(  \'-\' )', [{ index: 0, length: 3, userId: AI, type: 'user' }], { user: YU })])
  let rows = (await dbg({ op: 'list', target: AI, group: G })).rows
  ok(rows.length === 1, 'メンションが1件記録される', `${rows.length}件`)
  ok(rows[0]?.sender_id === YU, 'メンションした人が記録される', `${rows[0]?.sender_id}`)
  ok(!!rows[0]?.quote_token, '引用トークンが保存される')
  ok(rows[0]?.message_text?.includes('勝手に殺すな'), '本文が保存される')

  // メンションのない発言は記録されない
  await post([plainMsg('ふつうの発言')])
  rows = (await dbg({ op: 'list', target: AI, group: G })).rows
  ok(rows.length === 1, 'メンションのない発言は記録されない', `${rows.length}件`)

  // =====================================================================
  console.log('\n=== 2. 除外すべきメンション ===')
  // ボット自身へのメンション(isSelf)は対象外
  await post([mentionMsg('@うぱるぱ やっほー', [{ index: 0, length: 5, userId: BOT, type: 'user', isSelf: true }], { user: YU })])
  let botRows = (await dbg({ op: 'list', target: BOT, group: G })).rows
  ok(botRows.length === 0, 'ボット自身へのメンションは記録しない', `${botRows.length}件`)

  // userId が欠落している(同意していないユーザー)ものは飛ばす
  await post([mentionMsg('@だれか こんにちは', [{ index: 0, length: 4, type: 'user' }], { user: YU })])
  const all = (await dbg({ op: 'count', prefix: 'Umn_test_' })).count
  ok(all === 1, 'userIdが無いメンションは記録しない(同意なしユーザー)', `合計${all}件`)

  // @all は個人宛でないので対象外
  await post([mentionMsg('@all おしらせ', [{ index: 0, length: 4, type: 'all' }], { user: YU })])
  const all2 = (await dbg({ op: 'count', prefix: 'Umn_test_' })).count
  ok(all2 === 1, '@all は記録しない', `合計${all2}件`)

  // 自分で自分をメンションしたものは出さない
  await post([mentionMsg('@愛璃 じぶん', [{ index: 0, length: 3, userId: AI, type: 'user' }], { user: AI })])
  rows = (await dbg({ op: 'list', target: AI, group: G })).rows
  ok(rows.length === 1, '自分で自分へのメンションは記録しない', `${rows.length}件`)

  // =====================================================================
  console.log('\n=== 3. 「めんかく」の応答 ===')
  // 見本と同じ4件をそろえる(1件目は既に入っているので3件追加)
  await post([mentionMsg('@愛璃 よろしく', [{ index: 0, length: 3, userId: AI, type: 'user' }], { user: AY })])
  await post([mentionMsg('@愛璃 ( *≧v≦)ﾉはぁぁい', [{ index: 0, length: 3, userId: AI, type: 'user' }], { user: AY })])
  await post([mentionMsg('@愛璃 嫁ちゃん招待していい？', [{ index: 0, length: 3, userId: AI, type: 'user' }], { user: OU })])

  let r = await simulate('めんかく', { user: AI, group: G })
  let msgs = r.would_reply_with
  ok(Array.isArray(msgs) && msgs.length === 5, '案内文1通 + 引用4通 = 5通で返る', `${msgs?.length}通`)
  ok(msgs?.[0]?.text?.includes('最大4件'), '1通目が案内文', `${msgs?.[0]?.text}`)
  ok(
    msgs?.slice(1).every((m) => m.type === 'text' && typeof m.quoteToken === 'string' && m.quoteToken.length > 0),
    '2通目以降はすべて引用トークン付きテキスト'
  )
  ok(msgs?.slice(1).every((m) => m.text === '.'), '引用メッセージの本文は「.」(見本と同じ)')
  ok(msgs.length <= 5, 'LINEの1リプライ5通制限を超えない')

  // 5件目を足しても4件に収まる(古いものが落ちる)
  await post([mentionMsg('@愛璃 5件目だよ', [{ index: 0, length: 3, userId: AI, type: 'user' }], { user: OU })])
  r = await simulate('めんかく', { user: AI, group: G })
  msgs = r.would_reply_with
  ok(msgs.length === 5, '5件以上あっても5通(案内文+4件)に収まる', `${msgs.length}通`)

  const newest = (await dbg({ op: 'list', target: AI, group: G, limit: 4 })).rows
  ok(
    newest.some((x) => x.message_text?.includes('5件目だよ')),
    '直近4件には最新のメンションが含まれる'
  )
  ok(
    !newest.some((x) => x.message_text?.includes('勝手に殺すな')),
    '4件を超えた古いメンションは表示対象から外れる'
  )

  // =====================================================================
  console.log('\n=== 4. 対象者ごと・グループごとの分離 ===')
  // 別の人が「めんかく」しても他人のメンションは出ない
  r = await simulate('めんかく', { user: YU, group: G })
  ok(
    r.would_reply_with?.[0]?.text?.includes('まだメンションされてない'),
    'メンションされていない人には「まだない」と返る',
    `${r.would_reply_with?.[0]?.text}`
  )

  // 別グループのメンションは混ざらない(quoteTokenはトーク内でしか使えない)
  await post([mentionMsg('@愛璃 別グループ', [{ index: 0, length: 3, userId: AI, type: 'user' }], { user: YU, group: G2 })])
  const g2rows = (await dbg({ op: 'list', target: AI, group: G2 })).rows
  ok(g2rows.length === 1, '別グループのメンションは別に記録される', `${g2rows.length}件`)
  ok(
    g2rows.every((x) => x.message_text?.includes('別グループ')),
    '別グループの取得結果に元グループのものが混ざらない'
  )

  // =====================================================================
  console.log('\n=== 5. 同一メッセージ内の重複 ===')
  const dupTarget = 'Umn_test_dup'
  await post([
    mentionMsg('@A @A ふたつ', [
      { index: 0, length: 2, userId: dupTarget, type: 'user' },
      { index: 3, length: 2, userId: dupTarget, type: 'user' },
    ]),
  ])
  const dupRows = (await dbg({ op: 'list', target: dupTarget, group: G })).rows
  ok(dupRows.length === 1, '同じメッセージ内の重複メンションは1件に畳む', `${dupRows.length}件`)

  // =====================================================================
  console.log('\n=== 6. 複数人を同時にメンション ===')
  const m1 = 'Umn_test_multi1'
  const m2 = 'Umn_test_multi2'
  await post([
    mentionMsg('@X @Y みんな', [
      { index: 0, length: 2, userId: m1, type: 'user' },
      { index: 3, length: 2, userId: m2, type: 'user' },
    ]),
  ])
  const r1 = (await dbg({ op: 'list', target: m1, group: G })).rows
  const r2 = (await dbg({ op: 'list', target: m2, group: G })).rows
  ok(r1.length === 1 && r2.length === 1, '複数人メンションは各人に1件ずつ記録される', `${r1.length}/${r2.length}`)

  // =====================================================================
  console.log('\n=== 7. 保持期間(7日) ===')
  const oldTarget = 'Umn_test_old'
  await post([mentionMsg('@Z ふるい', [{ index: 0, length: 2, userId: oldTarget, type: 'user' }])])
  // 8日前に改変してから「めんかく」を実行 → 掃除される
  await dbg({ op: 'age', target: oldTarget, days: 8 })
  let oldRows = (await dbg({ op: 'list', target: oldTarget, group: G })).rows
  ok(oldRows.length === 1, '8日前に改変した記録が存在する(前提確認)', `${oldRows.length}件`)
  await simulate('めんかく', { user: oldTarget, group: G })
  oldRows = (await dbg({ op: 'list', target: oldTarget, group: G })).rows
  ok(oldRows.length === 0, '7日を過ぎた記録は「めんかく」実行時に削除される', `${oldRows.length}件`)

  // 7日以内のものは消えない
  const keepTarget = 'Umn_test_keep'
  await post([mentionMsg('@W のこる', [{ index: 0, length: 2, userId: keepTarget, type: 'user' }])])
  await dbg({ op: 'age', target: keepTarget, days: 6 })
  await simulate('めんかく', { user: keepTarget, group: G })
  const keepRows = (await dbg({ op: 'list', target: keepTarget, group: G })).rows
  ok(keepRows.length === 1, '7日以内の記録は消えない(6日前は残る)', `${keepRows.length}件`)

  // =====================================================================
  console.log('\n=== 8. 個人トークでは使わない ===')
  r = await simulate('めんかく', { user: AI, group: null })
  const isMentionReply =
    Array.isArray(r.would_reply_with) &&
    r.would_reply_with.some((m) => m?.text?.includes('最大4件'))
  ok(!isMentionReply, '個人トークでは「めんかく」が反応しない')

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
