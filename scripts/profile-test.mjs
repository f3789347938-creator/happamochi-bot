// 個人ステータス(EXP/レベル/ポイント)・着せ替え・共通称号の自動テスト。
//
// 実際のWebhookイベント(署名付き)をローカルサーバーへ送り、
// 正常系・異常系を検証する。DB照会はテスト用HTTPエンドポイント経由。
// (wrangler CLI をテストごとに起動するとメモリを食ってサーバーが落ちる)
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
function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64')
}

async function post(events, { badSignature = false } = {}) {
  const body = JSON.stringify({ destination: 'test', events })
  const sig = badSignature ? 'INVALID' : sign(body)
  const res = await fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
    body,
  })
  await new Promise((r) => setTimeout(r, 60))
  return res
}

const G = 'Cpf_test_grp1'
const G2 = 'Cpf_test_grp2'
const A = 'Upf_test_alice_0000000000000001'
const B = 'Upf_test_bob_00000000000000002'

function msg(text, { user = A, group = G, eventId, messageId } = {}) {
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: group ? { type: 'group', groupId: group, userId: user } : { type: 'user', userId: user },
    webhookEventId: eventId ?? `pf_ev_${++seq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `pf_rt_${++seq}_${Date.now()}`,
    message: { id: messageId ?? String(Date.now() + seq), type: 'text', text },
  }
}

function pb(data, { user = A, group = G, eventId } = {}) {
  return {
    type: 'postback',
    mode: 'active',
    timestamp: Date.now(),
    source: group ? { type: 'group', groupId: group, userId: user } : { type: 'user', userId: user },
    webhookEventId: eventId ?? `pf_pb_${++seq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `pf_rt_${++seq}_${Date.now()}`,
    postback: { data },
  }
}

async function dbg(payload) {
  const res = await fetch(`${BASE}/debug/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}
const get = (userId) => dbg({ op: 'get', userId })
const reset = (userId) => dbg({ op: 'reset', userId })
const patch = (userId, set) => dbg({ op: 'patch', userId, set })

// 必要EXP = 100 + 8*(level-1)
const need = (lv) => 100 + 8 * (lv - 1)
function cumulative(level) {
  let s = 0
  for (let l = 1; l < level; l++) s += need(l)
  return s
}

async function main() {
  await reset('Upf_test_')

  // =====================================================================
  console.log('\n=== 1. EXPとポイントの加算 ===')
  await post([msg('あ')])
  let p = (await get(A)).profile
  ok(p !== null, 'メッセージ1通でプロフィールが自動作成される(参加登録なし)')
  ok(p?.total_exp === 1, '1通で累計EXPが1', `exp=${p?.total_exp}`)
  ok(p?.points === 1, '1通でポイントが1', `points=${p?.points}`)
  ok(p?.active_theme === 'aqua', '初期テーマは水色')
  ok(p?.equipped_title === null, '共通称号の初期値は未設定')
  ok(!!p?.public_id && !p.public_id.includes('Upf_test'), '公開用IDがLINEのIDと別物')

  // 中身の違う10通は10増える(回数・時間による獲得制限は無い)
  for (let i = 0; i < 9; i++) await post([msg(`連投${i}`)])
  p = (await get(A)).profile
  ok(p.total_exp === 10, '中身が違えば10通で10EXP(回数制限なし)', `exp=${p.total_exp}`)
  ok(p.points === 10, 'ポイントも10', `points=${p.points}`)

  // メッセージ種別で除外しない
  const stamp = msg('x')
  stamp.message = { id: String(Date.now() + ++seq), type: 'sticker', packageId: '1', stickerId: '1' }
  await post([stamp])
  const img = msg('y')
  img.message = { id: String(Date.now() + ++seq), type: 'image' }
  await post([img])
  await post([msg('ヘルプ')]) // コマンドも加算対象
  p = (await get(A)).profile
  ok(p.total_exp === 13, 'スタンプ・画像・コマンドも加算される', `exp=${p.total_exp}`)

  // 個人トークも対象
  await post([msg('個人トーク', { group: null })])
  p = (await get(A)).profile
  ok(p.total_exp === 14, '個人トークも加算対象', `exp=${p.total_exp}`)

  // =====================================================================
  console.log('\n=== 1-b. 連呼対策(直前と同じ本文は加算しない) ===')
  {
    const U = 'Upf_test_rep1'
    const me = (t, o = {}) => msg(t, { ...o, user: U })
    // 同じ本文を5連投 → 1回だけ
    for (let i = 0; i < 5; i++) await post([me('あ')])
    let q = (await get(U)).profile
    ok(q.total_exp === 1, '同じ本文5連投で1EXPだけ', `exp=${q.total_exp}`)
    ok(q.points === 1, 'ポイントも1だけ', `points=${q.points}`)

    // 違う本文を挟めば加算される
    await post([me('い')])
    q = (await get(U)).profile
    ok(q.total_exp === 2, '違う本文なら加算される', `exp=${q.total_exp}`)

    // 交互(あ→い→あ)は連続でないので全部加算
    await post([me('あ')])
    q = (await get(U)).profile
    ok(q.total_exp === 3, '「あ→い→あ」は直前と違うので加算される', `exp=${q.total_exp}`)

    // 前後の空白だけの違いは同一扱い
    await post([me('  あ  ')])
    q = (await get(U)).profile
    ok(q.total_exp === 3, '前後の空白だけの違いは同じ本文とみなす', `exp=${q.total_exp}`)

    // 1文字でも違えば別物
    await post([me('ああ')])
    q = (await get(U)).profile
    ok(q.total_exp === 4, '「あ」と「ああ」は別の本文として加算', `exp=${q.total_exp}`)
  }

  {
    // スタンプ・画像は本文が無いので常に加算され、連呼判定もリセットする
    const U = 'Upf_test_rep2'
    const me = (t, o = {}) => msg(t, { ...o, user: U })
    await post([me('ほ')])
    const st = me('x')
    st.message = { id: String(Date.now() + ++seq), type: 'sticker', packageId: '1', stickerId: '1' }
    await post([st])
    const st2 = me('x')
    st2.message = { id: String(Date.now() + ++seq), type: 'sticker', packageId: '1', stickerId: '1' }
    await post([st2])
    let q = (await get(U)).profile
    ok(q.total_exp === 3, 'スタンプ連投は従来どおり加算される(本文が無いため)', `exp=${q.total_exp}`)

    // 「ほ」→スタンプ→「ほ」は連続扱いにしない
    await post([me('ほ')])
    q = (await get(U)).profile
    ok(q.total_exp === 4, '間にスタンプが入れば同じ本文でも加算される', `exp=${q.total_exp}`)
  }

  {
    // 別人の発言は互いに影響しない(人単位で判定)
    const U1 = 'Upf_test_rep3'
    const U2 = 'Upf_test_rep4'
    await post([msg('おなじ', { user: U1 })])
    await post([msg('おなじ', { user: U2 })])
    const q1 = (await get(U1)).profile
    const q2 = (await get(U2)).profile
    ok(q1.total_exp === 1 && q2.total_exp === 1, '別人が同じ本文を送っても双方に加算される', `${q1.total_exp}/${q2.total_exp}`)
  }

  {
    // グループをまたいでも人単位で連呼判定する
    const U = 'Upf_test_rep5'
    await post([msg('また', { user: U })])
    await post([msg('また', { user: U, group: G2 })])
    const q = (await get(U)).profile
    ok(q.total_exp === 1, '別グループでも同じ本文の連投は加算されない(人単位)', `exp=${q.total_exp}`)
  }

  // =====================================================================
  console.log('\n=== 2. 二重加算の防止(1通を1回と数える) ===')
  const dupId = `pf_dup_${Date.now()}`
  await post([msg('再送テスト', { eventId: dupId, messageId: 'mid_dup_1' })])
  const afterFirst = (await get(A)).profile.total_exp
  await post([msg('再送テスト', { eventId: dupId, messageId: 'mid_dup_1' })])
  let after = (await get(A)).profile.total_exp
  ok(after === afterFirst, '同じwebhookEventIdの再送では加算されない', `${afterFirst}→${after}`)

  // eventId が無い場合は message.id で判定する
  const noEv = msg('IDなし', { messageId: 'mid_same_2' })
  delete noEv.webhookEventId
  await post([noEv])
  const b1 = (await get(A)).profile.total_exp
  const noEv2 = msg('IDなし', { messageId: 'mid_same_2' })
  delete noEv2.webhookEventId
  await post([noEv2])
  after = (await get(A)).profile.total_exp
  ok(after === b1, 'eventIdが無くても同じmessage.idは1回だけ', `${b1}→${after}`)

  // 別グループの発言は同じ人に合算される(人単位)
  const before2 = (await get(A)).profile.total_exp
  await post([msg('別グループ', { group: G2 })])
  after = (await get(A)).profile.total_exp
  ok(after === before2 + 1, '別グループの発言も同じ人に合算される(人単位)')

  // =====================================================================
  console.log('\n=== 3. レベル計算 ===')
  ok(need(1) === 100, 'Lv.1→2 の必要EXPが100')
  ok(need(19) === 244, 'Lv.19→20 の必要EXPが244')

  await patch(A, { total_exp: 99 })
  await post([msg('境界1')])
  p = (await get(A)).profile
  ok(p.total_exp === 100, '99→100EXP になる')

  // Lv.19 / 188 / 244 の見本を再現できるか
  await patch(A, { total_exp: cumulative(19) + 188 })
  const st = await post([msg('ステータス')])
  ok(st.status === 200, 'ステータス表示が成功する')

  // =====================================================================
  console.log('\n=== 4. テーマ購入(残高不足) ===')
  await patch(A, { points: 100 })
  await post([pb('pf|buyok|white')])
  let d = await get(A)
  ok(d.profile.points === 100, '残高不足では引き落とされない', `points=${d.profile.points}`)
  ok(!d.themes.includes('white'), '残高不足では所持されない')
  ok(d.ledger.length === 0, '残高不足では台帳に記録されない')

  // =====================================================================
  console.log('\n=== 5. テーマ購入(正常) ===')
  await patch(A, { points: 1000 })
  await post([pb('pf|buyok|white')])
  d = await get(A)
  ok(d.profile.points === 700, 'ホワイト300Pで残高が700', `points=${d.profile.points}`)
  ok(d.themes.includes('white'), 'ホワイトを所持した')
  ok(d.ledger.length === 1 && d.ledger[0].delta === -300, '台帳に-300が1件')
  ok(d.profile.active_theme === 'aqua', '購入しただけでは切り替わらない(購入と適用は別)')

  // =====================================================================
  console.log('\n=== 6. 二重購入・連打の防止 ===')
  await post([pb('pf|buyok|white')])
  d = await get(A)
  ok(d.profile.points === 700, '同じテーマの再購入で二重引き落としされない', `points=${d.profile.points}`)
  ok(d.ledger.length === 1, '台帳も1件のまま')

  // 同一eventIdの再送
  const evDup = `pf_buy_dup_${Date.now()}`
  await post([pb('pf|buyok|black', { eventId: evDup })])
  const afterBuy = (await get(A)).profile.points
  await post([pb('pf|buyok|black', { eventId: evDup })])
  d = await get(A)
  ok(d.profile.points === afterBuy, 'Postback再送で二重購入されない', `points=${d.profile.points}`)
  ok(d.themes.filter((t) => t === 'black').length === 1, 'ブラックの所持は1件だけ')
  ok(d.profile.points === 200, 'ブラック500Pを引いて残高200', `points=${d.profile.points}`)

  // =====================================================================
  console.log('\n=== 7. テーマの適用と再適用 ===')
  await post([pb('pf|apply|white')])
  d = await get(A)
  ok(d.profile.active_theme === 'white', '所持テーマを適用できる')
  const pBefore = d.profile.points
  await post([pb('pf|apply|white')])
  d = await get(A)
  ok(d.profile.points === pBefore, '再適用は無料(ポイントが減らない)')

  await post([pb('pf|apply|sakura')])
  d = await get(A)
  ok(d.profile.active_theme === 'white', '未所持テーマは適用できない')

  await post([pb('pf|apply|aqua')])
  d = await get(A)
  ok(d.profile.active_theme === 'aqua', '水色へ戻せる')
  ok(d.themes.includes('white') && d.themes.includes('black'), '水色に戻しても他テーマの所持は消えない')

  // プレビューは無料・変更しない
  const beforePv = (await get(A)).profile
  await post([pb('pf|preview|sakura')])
  d = await get(A)
  ok(
    d.profile.active_theme === beforePv.active_theme && d.profile.points === beforePv.points,
    'プレビューではテーマもポイントも変わらない'
  )

  // 存在しないテーマ
  await post([pb('pf|buyok|nonexistent')])
  await post([pb('pf|apply|nonexistent')])
  d = await get(A)
  ok(d.profile.active_theme === 'aqua', '存在しないテーマは拒否される')

  // =====================================================================
  console.log('\n=== 8. 他人のカードを押しても他人のデータは変わらない ===')
  await reset('Upf_test_bob')
  await post([msg('ぼぶ', { user: B })])
  const aBefore = (await get(A)).profile
  // Bさんが「Aさんのカード」のボタンを押す状況を再現。
  // Postbackにユーザーidは入っていないので、押した本人(B)の操作になる。
  await post([pb('pf|buyok|sakura', { user: B })])
  const aAfter = (await get(A)).profile
  const bAfter = (await get(B)).profile
  ok(
    aAfter.points === aBefore.points && aAfter.active_theme === aBefore.active_theme,
    '他人が押してもAさんのポイント・テーマは変わらない'
  )
  ok(bAfter.points === 1, 'Bさん自身は残高不足で買えていない(1P)', `points=${bAfter.points}`)

  // =====================================================================
  console.log('\n=== 9. 共通称号(自由選択) ===')
  await post([msg('共通称号装備 夜型')])
  d = await get(A)
  ok(d.profile.equipped_title !== null, '自由選択の称号を装備できる', `title=${d.profile.equipped_title}`)
  const yagata = d.profile.equipped_title

  await post([msg('共通称号装備 存在しない称号名')])
  d = await get(A)
  ok(d.profile.equipped_title === yagata, '存在しない称号名では変わらない')

  // =====================================================================
  console.log('\n=== 10. 共通称号(条件付き)の解放境界 ===')
  // ベテラン相当: Lv.30 で解放される称号を探して境界を確認する
  // カタログのレベル解放は earned_growth_006 が Lv.30
  await patch(A, { total_exp: cumulative(29) })
  await post([pb('pf|equip|earned_growth_006')])
  d = await get(A)
  ok(d.profile.equipped_title === yagata, 'Lv.29ではLv.30称号を装備できない')

  await patch(A, { total_exp: cumulative(30) })
  await post([pb('pf|equip|earned_growth_006')])
  d = await get(A)
  ok(d.profile.equipped_title === 'earned_growth_006', 'Lv.30になったら装備できる')
  ok(d.unlocked.includes('earned_growth_006'), '解放履歴が記録される')

  // 解放後にレベルを下げても没収しない
  await patch(A, { total_exp: cumulative(5) })
  d = await get(A)
  ok(d.profile.equipped_title === 'earned_growth_006', 'レベルが下がっても装備は自動で外れない')
  await post([pb('pf|equip|earned_growth_006')])
  d = await get(A)
  ok(d.profile.equipped_title === 'earned_growth_006', '解放履歴があるので再装備もできる(没収しない)')

  // オセロ実績: 勝利数0なら未解放
  await post([pb('pf|equip|earned_othello_004')])
  d = await get(A)
  ok(d.profile.equipped_title === 'earned_growth_006', 'オセロ0勝ではオセロ10勝の称号を装備できない')

  // =====================================================================
  console.log('\n=== 11. 一覧のフィルタ・カテゴリ・検索・ページ境界 ===')
  const cases = [
    ['pf|tl|all|-|-|1', 'すべて 1ページ目'],
    ['pf|tl|usable|-|-|1', '使えるのみ'],
    ['pf|tl|locked|-|-|1', '未解放のみ'],
    ['pf|tl|all|daily|-|1', 'カテゴリ絞り込み(暮らし・時間)'],
    ['pf|tl|all|daily|-|4', 'カテゴリ 4ページ目(20件÷5=4)'],
    ['pf|tl|all|daily|-|99', '範囲外のページ番号(補正される)'],
    ['pf|tl|all|daily|-|-5', '負のページ番号(補正される)'],
    ['pf|tl|all|-|%E5%A4%9C|1', '検索(夜)'],
    ['pf|tl|all|-|zzzzz|1', '該当0件の検索'],
    ['pf|tl|bogus|-|-|1', '不正なフィルタ値(allに補正)'],
    ['pf|cat|all|-|1', 'カテゴリ選択画面 1ページ'],
    ['pf|cat|all|-|2', 'カテゴリ選択画面 2ページ'],
    ['pf|titles', '称号一覧を開く'],
    ['pf|themes', '着せ替えを開く'],
    ['pf|status', 'ステータスに戻る'],
    ['pf|searchhelp', '検索の案内'],
  ]
  for (const [data, label] of cases) {
    const r = await post([pb(data)])
    ok(r.status === 200, label)
  }

  // 装備してもページと絞り込みを維持する経路
  const r2 = await post([pb('pf|equipp|free_daily_002|all|daily|-|1')])
  ok(r2.status === 200, '一覧から装備してもページを維持できる')
  d = await get(A)
  ok(d.profile.equipped_title === 'free_daily_002', '一覧からの装備が反映される')

  // =====================================================================
  console.log('\n=== 12. 不正署名の拒否 ===')
  const bad = await post([msg('不正')], { badSignature: true })
  ok(bad.status === 401, '不正署名は401で拒否される')

  // =====================================================================
  console.log('\n=== 13. カタログの件数 ===')
  const counts = await dbg({ op: 'counts' })
  ok(counts.titles === 300, '共通称号が300件', `${counts.titles}`)
  ok(counts.categories === 14, 'カテゴリが14件', `${counts.categories}`)
  ok(counts.themes === 4, 'テーマが4件', `${counts.themes}`)
  const byType = Object.fromEntries(counts.byType.map((r) => [r.unlock_type, r.c]))
  ok(byType.free === 240, '自由選択240件')
  ok(byType.level === 40, 'レベル解放40件')
  ok(byType.othello_wins === 20, 'オセロ実績20件')
  ok(counts.byCategory.every((r) => r.c === 20 || r.c === 40), '各カテゴリの件数が定義通り')

  // 再取り込みで増えないこと(INSERT OR IGNORE)
  ok(counts.legacyTitleMaster === 5, '既存のグループ別称号マスタが5件のまま(壊していない)')

  // =====================================================================
  console.log('\n=== 14. Web公開範囲 ===')
  const pub = (await get(A)).profile.public_id
  const page = await fetch(`${BASE}/u/${pub}`)
  const html = await page.text()
  ok(page.status === 200, '公開ステータスページが開ける')
  ok(!html.includes(A), 'LINEユーザーIDが含まれていない')
  ok(!html.includes(G) && !html.includes(G2), 'グループIDが含まれていない')
  ok(html.includes('© 2026 HappaMochi Bot'), 'フッターの著作権表記がある')
  ok(html.includes('保有ポイント'), 'ポイントは公開される')

  const rank = await fetch(`${BASE}/ranking/personal`)
  const rankHtml = await rank.text()
  ok(rank.status === 200, '個人ランキング一覧が開ける')
  ok(!rankHtml.includes(A), 'ランキングにLINEユーザーIDが含まれていない')
  ok(rankHtml.includes(`/u/${pub}`), 'ランキングから公開ステータスへのリンクがある')

  const nf = await fetch(`${BASE}/u/does_not_exist_xyz`)
  ok(nf.status === 404, '存在しない公開IDは404')

  // =====================================================================
  console.log('\n=== 15. 既存機能の回帰 ===')
  const legacy = [
    ['ヘルプ', 'ヘルプ'],
    ['称号一覧', '既存のグループ別称号一覧'],
    ['称号確認', '既存のグループ別称号確認'],
    ['ランキング', '既存のグループランキング'],
    ['お知らせ', 'お知らせ'],
    ['テスト', 'テストコマンド'],
    ['めいく:テーマ確認', '名言カード生成'],
  ]
  for (const [text, label] of legacy) {
    const r = await post([msg(text)])
    ok(r.status === 200, `${label} が動作する`)
  }

  console.log(`\n=== 結果 ===\n  成功 ${pass} / 失敗 ${fail}`)
  if (failures.length) {
    console.log('\n  失敗した項目:')
    for (const f of failures) console.log(`   - ${f}`)
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('テスト実行エラー:', e)
  process.exit(1)
})
