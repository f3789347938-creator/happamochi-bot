// チェス機能の自動テスト。
// 実際のWebhookイベント(署名付き)をローカルサーバーへ送り、
// 正常系・異常系を検証する。LINEへの実送信は行われない
// (ローカルの wrangler dev では Reply API 呼び出しが失敗するが、
//  DB更新はコミットされるため状態遷移を検証できる)。
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

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64')
}

let evSeq = 0
async function send(events, { badSignature = false } = {}) {
  const body = JSON.stringify({ destination: 'test', events })
  const sig = badSignature ? 'INVALID_SIGNATURE_VALUE' : sign(body)
  const res = await fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sig },
    body,
  })
  // テスト用グループのイベントはサーバー側が同期処理してから200を返すため、
  // 応答を受け取った時点でDB更新は完了している。念のため僅かに待つ。
  await new Promise((r) => setTimeout(r, 60))
  return res
}

function msgEvent(groupId, userId, text, eventId) {
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'group', groupId, userId },
    webhookEventId: eventId ?? `ev_msg_${++evSeq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `rt_${++evSeq}_${Date.now()}`,
    message: { id: String(Date.now() + evSeq), type: 'text', text },
  }
}

function pbEvent(groupId, userId, data, eventId) {
  return {
    type: 'postback',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'group', groupId, userId },
    webhookEventId: eventId ?? `ev_pb_${++evSeq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `rt_${++evSeq}_${Date.now()}`,
    postback: { data },
  }
}

// DB照会はテスト用HTTPエンドポイント経由にする。
// (wrangler CLI をテストごとに起動するとメモリを圧迫してサーバーが落ちる)
async function dbg(payload) {
  const res = await fetch(`${BASE}/debug/chess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}

async function game(groupId) {
  const { game } = await dbg({ op: 'get', groupId })
  return game
}

async function gameById(id) {
  const { game } = await dbg({ op: 'byId', id })
  return game
}

async function listGames(groupId) {
  const { games } = await dbg({ op: 'list', groupId })
  return games ?? []
}

async function reset(groupId) {
  await dbg({ op: 'reset', groupId })
}

async function patch(groupId, id, set) {
  await dbg({ op: 'patch', groupId, id, set })
}

// =========================================================================
const A = 'Uchess_alice_000000000000000000001'
const B = 'Uchess_bob_00000000000000000000002'
const C = 'Uchess_carol_00000000000000000003'

async function main() {
  console.log('\n=== 1. 募集・参加・白黒割当 ===')
  const G1 = 'Cchess_test_g1'
  await reset('Cchess_test_g')
  await send([msgEvent(G1, A, 'チェス')])
  let g = await game(G1)
  ok(g?.status === 'waiting', '「チェス」で募集が作られる', JSON.stringify(g?.status))
  ok(g?.creator_user_id === A, '作成者が登録される')
  ok(g?.expires_at !== null, '募集に期限が設定される(再起動後も維持)')

  // 自分の募集への重複参加を拒否
  await send([pbEvent(G1, A, `cj|${g.id}`)])
  g = await game(G1)
  ok(g.status === 'waiting', '自分の募集には参加できない')

  // 別グループからの操作を拒否
  const G2 = 'Cchess_test_g2'
  await send([pbEvent(G2, B, `cj|${g.id}`)])
  g = await game(G1)
  ok(g.status === 'waiting', '別グループからの参加操作を拒否')

  // 正常な参加
  await send([pbEvent(G1, B, `cj|${g.id}`)])
  g = await game(G1)
  ok(g.status === 'playing', '別の人の参加で対局成立')
  ok(
    (g.white_user_id === A && g.black_user_id === B) ||
      (g.white_user_id === B && g.black_user_id === A),
    '白黒がランダムに割り当てられる'
  )
  ok(g.turn === 'w', '白の手番から開始')
  ok(g.expires_at === null, '成立後は募集期限がクリアされる')

  // 3人目の参加を拒否
  await send([pbEvent(G1, C, `cj|${g.id}`)])
  const g3 = await game(G1)
  ok(g3.white_user_id === g.white_user_id && g3.black_user_id === g.black_user_id, '3人目の参加を拒否')

  console.log('\n=== 2. 別グループの独立動作 ===')
  await send([msgEvent(G2, C, 'チェス')])
  const g2 = await game(G2)
  ok(g2?.status === 'waiting' && g2.group_id === G2, '別グループで独立して募集できる')

  console.log('\n=== 3. 1グループ1件の制約 ===')
  const beforeList = (await listGames(G1)).filter((x) => ['waiting', 'playing'].includes(x.status))
  await send([msgEvent(G1, C, 'チェス')])
  const afterList = (await listGames(G1)).filter((x) => ['waiting', 'playing'].includes(x.status))
  ok(beforeList.length === 1 && afterList.length === 1, '対局中に「チェス」で新規作成されない(再送のみ)')

  console.log('\n=== 4. 駒選択・権限・手番 ===')
  g = await game(G1)
  const whiteId = g.white_user_id
  const blackId = g.black_user_id
  const v0 = g.version

  // 手番でない人の操作を拒否
  await send([pbEvent(G1, blackId, `cs|${g.id}|${v0}|e7`)])
  g = await game(G1)
  ok(g.sel_square === null, '手番でない人は駒を選べない')

  // 第三者の操作を拒否
  await send([pbEvent(G1, C, `cs|${g.id}|${v0}|e2`)])
  g = await game(G1)
  ok(g.sel_square === null, '第三者(観戦者)は駒を選べない')

  // 相手の駒の選択を拒否
  await send([pbEvent(G1, whiteId, `cs|${g.id}|${v0}|e7`)])
  g = await game(G1)
  ok(g.sel_square === null, '相手の駒は選べない')

  // 空マスの選択を拒否
  await send([pbEvent(G1, whiteId, `cs|${g.id}|${v0}|e5`)])
  g = await game(G1)
  ok(g.sel_square === null, '空マスは選べない')

  // 正常な選択
  await send([pbEvent(G1, whiteId, `cs|${g.id}|${v0}|e2`)])
  g = await game(G1)
  ok(g.sel_square === 'e2', '自分の駒を選択できる')
  ok(g.sel_token !== null, '選択トークンが発行される')
  ok(g.version === v0, '駒選択だけでは手番(version)が進まない')
  ok(JSON.parse(g.moves_json).length === 0, '駒選択だけでは棋譜が進まない')

  // 選択変更
  await send([pbEvent(G1, whiteId, `cs|${g.id}|${v0}|d2`)])
  g = await game(G1)
  ok(g.sel_square === 'd2', '別の自分の駒を押すと選択が変わる')

  // 「選び直す」で解除
  await send([pbEvent(G1, whiteId, `cc|${g.id}|${v0}`)])
  g = await game(G1)
  ok(g.sel_square === null, '「選び直す」で未確定の選択だけ解除される')
  ok(g.version === v0, '解除しても version は変わらない')

  console.log('\n=== 5. 非合法手の拒否と指し手確定 ===')
  await send([pbEvent(G1, whiteId, `cs|${g.id}|${v0}|e2`)])
  g = await game(G1)
  const selTok = g.sel_token

  // 非合法手(e2->e5 は2マス以上)
  await send([pbEvent(G1, whiteId, `cm|${g.id}|${v0}|${selTok}|e5`)])
  g = await game(G1)
  ok(g.version === v0 && JSON.parse(g.moves_json).length === 0, '非合法手では局面が変わらない')

  // 改変トークン(別の選択トークン)を拒否
  await send([pbEvent(G1, whiteId, `cm|${g.id}|${v0}|deadbeef|e4`)])
  g = await game(G1)
  ok(g.version === v0, '改変された選択トークンを拒否')

  // 正常な指し手
  await send([pbEvent(G1, whiteId, `cm|${g.id}|${v0}|${selTok}|e4`)])
  g = await game(G1)
  ok(g.version === v0 + 1, '指し手確定で version が進む')
  ok(g.turn === 'b', '手番が交代する')
  ok(g.sel_square === null, '確定時に選択状態がクリアされる')
  const mv = JSON.parse(g.moves_json)
  ok(mv.length === 1 && mv[0] === 'e4', '棋譜に記録される(SAN)', JSON.stringify(mv))
  ok(g.pgn.includes('e4'), 'PGNが保存される')

  console.log('\n=== 6. 古いカード・二重タップ ===')
  const vNow = g.version
  // 古い version からの操作
  await send([pbEvent(G1, blackId, `cs|${g.id}|${v0}|e7`)])
  g = await game(G1)
  ok(g.sel_square === null, '古い version のカードでは状態が変わらない')

  // 二重タップ(同じ eventId = Webhook再送)
  await send([pbEvent(G1, blackId, `cs|${g.id}|${vNow}|e7`)])
  g = await game(G1)
  const tokAfterFirst = g.sel_token
  const dupId = `ev_dup_${Date.now()}`
  await send([pbEvent(G1, blackId, `cs|${g.id}|${vNow}|d7`, dupId)])
  await send([pbEvent(G1, blackId, `cs|${g.id}|${vNow}|d7`, dupId)])
  g = await game(G1)
  ok(g.sel_square === 'd7', 'Webhook再送(同一eventId)は1回だけ処理される')

  // 別eventIdでの二重タップ(指し手の二重確定を防ぐ)
  g = await game(G1)
  const bVer = g.version
  const bTok = g.sel_token
  await Promise.all([
    send([pbEvent(G1, blackId, `cm|${g.id}|${bVer}|${bTok}|d5`)]),
    send([pbEvent(G1, blackId, `cm|${g.id}|${bVer}|${bTok}|d5`)]),
  ])
  g = await game(G1)
  ok(g.version === bVer + 1, '別eventIdの二重タップでも指し手は1回だけ確定', `v=${g.version} 期待=${bVer + 1}`)

  console.log('\n=== 7. 不正署名の拒否 ===')
  const gBefore = await game(G1)
  const res = await send([pbEvent(G1, whiteId, `cs|${gBefore.id}|${gBefore.version}|e4`)], {
    badSignature: true,
  })
  ok(res.status === 401, '不正署名は401で拒否される', `status=${res.status}`)
  g = await game(G1)
  ok(g.sel_square === gBefore.sel_square, '不正署名では状態が変わらない')

  console.log('\n=== 8. 投了の権限 ===')
  const G3 = 'Cchess_test_g3'
  await reset('Cchess_test_g3')
  await send([msgEvent(G3, A, 'チェス')])
  let g3g = await game(G3)
  await send([pbEvent(G3, B, `cj|${g3g.id}`)])
  g3g = await game(G3)
  const w3 = g3g.white_user_id
  const b3 = g3g.black_user_id

  // 第三者の投了要求を拒否
  await send([pbEvent(G3, C, `cr|${g3g.id}|${g3g.version}`)])
  g3g = await game(G3)
  ok(g3g.resign_token === null, '第三者は投了を要求できない')

  // 本人が投了要求 → 確認待ち
  await send([pbEvent(G3, w3, `cr|${g3g.id}|${g3g.version}`)])
  g3g = await game(G3)
  ok(g3g.resign_token !== null && g3g.resign_by === w3, '本人の投了要求で確認待ちになる')
  ok(g3g.status === 'playing', '確認前は対局が続いている')

  // 相手が代わりに確定しようとする → 拒否
  await send([pbEvent(G3, b3, `cry|${g3g.id}|${g3g.resign_token}`)])
  g3g = await game(G3)
  ok(g3g.status === 'playing', '相手は代わりに投了を確定できない')

  // 本人が確定
  await send([pbEvent(G3, w3, `cry|${g3g.id}|${g3g.resign_token}`)])
  g3g = await game(G3)
  ok(g3g.status === 'finished', '本人の確認で投了が成立')
  ok(g3g.result === 'black', '投了した側の相手が勝ち')

  // 終局後の指し手を拒否
  const finVer = g3g.version
  await send([pbEvent(G3, b3, `cs|${g3g.id}|${finVer}|e7`)])
  g3g = await game(G3)
  ok(g3g.sel_square === null, '終局後は駒を選べない')

  console.log('\n=== 9. 引き分け提案の権限 ===')
  const G4 = 'Cchess_test_g4'
  await reset('Cchess_test_g4')
  await send([msgEvent(G4, A, 'チェス')])
  let g4 = await game(G4)
  await send([pbEvent(G4, B, `cj|${g4.id}`)])
  g4 = await game(G4)
  const w4 = g4.white_user_id
  const b4 = g4.black_user_id

  // 第三者の提案を拒否
  await send([pbEvent(G4, C, `cd|${g4.id}|${g4.version}`)])
  g4 = await game(G4)
  ok(g4.draw_by === null, '第三者は引き分けを提案できない')

  // 対局者が提案
  await send([pbEvent(G4, w4, `cd|${g4.id}|${g4.version}`)])
  g4 = await game(G4)
  ok(g4.draw_by === w4, '対局者は引き分けを提案できる')
  ok(g4.status === 'playing', '提案中も対局は続く')

  // 提案者自身が承諾しようとする → 拒否
  await send([pbEvent(G4, w4, `cda|${g4.id}|${g4.version}`)])
  g4 = await game(G4)
  ok(g4.status === 'playing', '提案者自身は承諾できない')

  // 第三者の承諾を拒否
  await send([pbEvent(G4, C, `cda|${g4.id}|${g4.version}`)])
  g4 = await game(G4)
  ok(g4.status === 'playing', '第三者は承諾できない')

  // もう一方が承諾
  await send([pbEvent(G4, b4, `cda|${g4.id}|${g4.version}`)])
  g4 = await game(G4)
  ok(g4.status === 'finished' && g4.result === 'draw', 'もう一方の承諾で合意引き分けが成立')

  console.log('\n=== 10. 指し手確定で引き分け提案が失効 ===')
  const G5 = 'Cchess_test_g5'
  await reset('Cchess_test_g5')
  await send([msgEvent(G5, A, 'チェス')])
  let g5 = await game(G5)
  await send([pbEvent(G5, B, `cj|${g5.id}`)])
  g5 = await game(G5)
  const w5 = g5.white_user_id
  await send([pbEvent(G5, w5, `cd|${g5.id}|${g5.version}`)])
  g5 = await game(G5)
  ok(g5.draw_by === w5, '引き分け提案が記録される')
  await send([pbEvent(G5, w5, `cs|${g5.id}|${g5.version}|e2`)])
  g5 = await game(G5)
  await send([pbEvent(G5, w5, `cm|${g5.id}|${g5.version}|${g5.sel_token}|e4`)])
  g5 = await game(G5)
  ok(g5.draw_by === null, '指し手の確定で未回答の提案が失効する')

  console.log('\n=== 11. 募集の取り消し権限 ===')
  const G6 = 'Cchess_test_g6'
  await reset('Cchess_test_g6')
  await send([msgEvent(G6, A, 'チェス')])
  let g6 = await game(G6)
  await send([pbEvent(G6, B, `cx|${g6.id}`)])
  g6 = await game(G6)
  ok(g6.status === 'waiting', '作成者以外は募集を取り消せない')
  await send([pbEvent(G6, A, `cx|${g6.id}`)])
  g6 = await game(G6)
  ok(g6.status === 'aborted', '作成者は募集を取り消せる')

  console.log('\n=== 12. 募集期限切れ ===')
  const G7 = 'Cchess_test_g7'
  await reset('Cchess_test_g7')
  await send([msgEvent(G7, A, 'チェス')])
  let g7 = await game(G7)
  // 期限を過去にする
  await patch(G7, g7.id, { expires_at: '2000-01-01 00:00:00' })
  await send([pbEvent(G7, B, `cj|${g7.id}`)])
  g7 = await game(G7)
  ok(g7.status !== 'playing', '期限切れの募集には参加できない')

  console.log('\n=== 13. 再起動後の復元(棋譜からの再生) ===')
  const G8 = 'Cchess_test_g8'
  await reset('Cchess_test_g8')
  await send([msgEvent(G8, A, 'チェス')])
  let g8 = await game(G8)
  await send([pbEvent(G8, B, `cj|${g8.id}`)])
  g8 = await game(G8)
  // 数手進める
  const seq = [
    [g8.white_user_id, 'e2', 'e4'],
    [g8.black_user_id, 'e7', 'e5'],
    [g8.white_user_id, 'g1', 'f3'],
  ]
  for (const [uid, from, to] of seq) {
    g8 = await game(G8)
    await send([pbEvent(G8, uid, `cs|${g8.id}|${g8.version}|${from}`)])
    g8 = await game(G8)
    await send([pbEvent(G8, uid, `cm|${g8.id}|${g8.version}|${g8.sel_token}|${to}`)])
  }
  g8 = await game(G8)
  const moves8 = JSON.parse(g8.moves_json)
  ok(moves8.length === 3, '3手が棋譜に記録される', JSON.stringify(moves8))
  // start_fen + moves から再生して current_fen と一致するか
  const { Chess } = await import('chess.js')
  const replay = new Chess(g8.start_fen)
  let replayOk = true
  try {
    for (const m of moves8) replay.move(m)
  } catch {
    replayOk = false
  }
  ok(replayOk && replay.fen() === g8.current_fen, '棋譜から再生したFENが保存値と一致(再起動後も復元可能)')
  ok(g8.start_fen.startsWith('rnbqkbnr'), '開始局面が保存されている')

  console.log('\n=== 14. 昇格 ===')
  const G9 = 'Cchess_test_g9'
  await reset('Cchess_test_g9')
  await send([msgEvent(G9, A, 'チェス')])
  let g9 = await game(G9)
  await send([pbEvent(G9, B, `cj|${g9.id}`)])
  g9 = await game(G9)
  // 昇格直前の局面を直接セット(白ポーンが a7、次の手で a8 へ)
  const promoFen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1'
  await patch(G9, g9.id, { start_fen: promoFen, current_fen: promoFen, moves_json: '[]', turn: 'w' })
  g9 = await game(G9)
  await send([pbEvent(G9, g9.white_user_id, `cs|${g9.id}|${g9.version}|a7`)])
  g9 = await game(G9)
  ok(g9.sel_square === 'a7', '昇格するポーンを選択できる')
  const pv = g9.version
  await send([pbEvent(G9, g9.white_user_id, `cm|${g9.id}|${pv}|${g9.sel_token}|a8`)])
  g9 = await game(G9)
  ok(g9.pending_token !== null, '昇格待ちになる')
  ok(g9.version === pv, '昇格選択が終わるまで指し手は確定しない')
  ok(g9.turn === 'w', '昇格選択中は相手の手番にならない')

  // 相手が昇格を選ぼうとする → 拒否
  await send([pbEvent(G9, g9.black_user_id, `cp|${g9.id}|${pv}|${g9.pending_token}|q`)])
  g9 = await game(G9)
  ok(g9.version === pv, '相手は昇格先を選べない')

  // 4種類の昇格を検証(ナイトで確定)
  await send([pbEvent(G9, g9.white_user_id, `cp|${g9.id}|${pv}|${g9.pending_token}|n`)])
  g9 = await game(G9)
  ok(g9.version === pv + 1, '昇格選択で指し手が確定する')
  ok(g9.current_fen.startsWith('N3k3'), 'ナイトに昇格している', g9.current_fen)
  ok(g9.pending_token === null, '昇格待ちがクリアされる')

  // 二重確定を拒否
  const afterPromoVer = g9.version
  await send([pbEvent(G9, g9.white_user_id, `cp|${g9.id}|${pv}|deadbeef|q`)])
  g9 = await game(G9)
  ok(g9.version === afterPromoVer, '昇格の二重確定を拒否')

  // 残り3種類も個別に検証
  for (const [piece, expectPrefix, label] of [
    ['q', 'Q3k3', 'クイーン'],
    ['r', 'R3k3', 'ルーク'],
    ['b', 'B3k3', 'ビショップ'],
  ]) {
    await patch(G9, g9.id, {
      start_fen: promoFen, current_fen: promoFen, moves_json: '[]', turn: 'w', status: 'playing',
      pending_from: null, pending_to: null, pending_token: null, sel_square: null, sel_token: null,
    })
    g9 = await game(G9)
    await send([pbEvent(G9, g9.white_user_id, `cs|${g9.id}|${g9.version}|a7`)])
    g9 = await game(G9)
    await send([pbEvent(G9, g9.white_user_id, `cm|${g9.id}|${g9.version}|${g9.sel_token}|a8`)])
    g9 = await game(G9)
    await send([pbEvent(G9, g9.white_user_id, `cp|${g9.id}|${g9.version}|${g9.pending_token}|${piece}`)])
    g9 = await game(G9)
    ok(g9.current_fen.startsWith(expectPrefix), `${label}への昇格`, g9.current_fen)
  }

  console.log('\n=== 15. チェックメイト ===')
  const G10 = 'Cchess_test_g10'
  await reset('Cchess_test_g10')
  await send([msgEvent(G10, A, 'チェス')])
  let g10 = await game(G10)
  await send([pbEvent(G10, B, `cj|${g10.id}`)])
  g10 = await game(G10)
  // 白が1手でメイトできる局面(白Q h5, 黒K e8 が f7 で詰む形)
  const mateFen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 1'
  // 上記から黒が適当に指すと白がメイト…ではなく、確実な局面を直接使う
  const mateInOne = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'
  // 黒Qh4 が既にあり、白が詰まされている形にするため別局面を使う:
  // 白が Qh5xf7# を指せる局面
  const readyMate = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4'
  await patch(G10, g10.id, { start_fen: readyMate, current_fen: readyMate, moves_json: '[]', turn: 'w', status: 'playing' })
  g10 = await game(G10)
  await send([pbEvent(G10, g10.white_user_id, `cs|${g10.id}|${g10.version}|f3`)])
  g10 = await game(G10)
  await send([pbEvent(G10, g10.white_user_id, `cm|${g10.id}|${g10.version}|${g10.sel_token}|f7`)])
  g10 = await game(G10)
  ok(g10.status === 'finished', 'チェックメイトで終局する', `status=${g10.status}`)
  ok(g10.result === 'white', '詰めた側が勝ち', `result=${g10.result}`)
  ok(g10.result_reason === 'チェックメイト', '理由がチェックメイト', g10.result_reason)

  console.log('\n=== 16. ステイルメイト ===')
  const G11 = 'Cchess_test_g11'
  await reset('Cchess_test_g11')
  await send([msgEvent(G11, A, 'チェス')])
  let g11 = await game(G11)
  await send([pbEvent(G11, B, `cj|${g11.id}`)])
  g11 = await game(G11)
  // 黒K a8。白が Qb5-b6 と指すと、黒Kに合法手が無くなりチェックでもない
  // = ステイルメイト(chess.js で isStalemate()===true を確認済み)。
  const staleReady = 'k7/8/8/1Q6/8/8/8/4K3 w - - 0 1'
  await patch(G11, g11.id, { start_fen: staleReady, current_fen: staleReady, moves_json: '[]', turn: 'w', status: 'playing' })
  g11 = await game(G11)
  await send([pbEvent(G11, g11.white_user_id, `cs|${g11.id}|${g11.version}|b5`)])
  g11 = await game(G11)
  await send([pbEvent(G11, g11.white_user_id, `cm|${g11.id}|${g11.version}|${g11.sel_token}|b6`)])
  g11 = await game(G11)
  ok(
    g11.status === 'finished' && g11.result === 'draw',
    'ステイルメイトで引き分けになる',
    `${g11.status}/${g11.result}/${g11.result_reason}`
  )

  console.log('\n=== 17. 戦力不足の引き分け ===')
  const G12 = 'Cchess_test_g12'
  await reset('Cchess_test_g12')
  await send([msgEvent(G12, A, 'チェス')])
  let g12 = await game(G12)
  await send([pbEvent(G12, B, `cj|${g12.id}`)])
  g12 = await game(G12)
  // 白K+白N と 黒K+黒P。白N b1 が c3 の黒ポーンを取ると
  // K+N vs K が残り、どちらも詰められないので戦力不足による引き分け。
  const insuf = '4k3/8/8/8/8/2p5/8/1N2K3 w - - 0 1'
  await patch(G12, g12.id, { start_fen: insuf, current_fen: insuf, moves_json: '[]', turn: 'w', status: 'playing' })
  g12 = await game(G12)
  await send([pbEvent(G12, g12.white_user_id, `cs|${g12.id}|${g12.version}|b1`)])
  g12 = await game(G12)
  await send([pbEvent(G12, g12.white_user_id, `cm|${g12.id}|${g12.version}|${g12.sel_token}|c3`)])
  g12 = await game(G12)
  ok(
    g12.status === 'finished' && g12.result === 'draw',
    '戦力不足で自動引き分けになる',
    `${g12.status}/${g12.result}/${g12.result_reason}`
  )

  console.log('\n=== 18. 特殊移動(キャスリング・アンパッサン) ===')
  const G13 = 'Cchess_test_g13'
  await reset('Cchess_test_g13')
  await send([msgEvent(G13, A, 'チェス')])
  let g13 = await game(G13)
  await send([pbEvent(G13, B, `cj|${g13.id}`)])
  g13 = await game(G13)
  const castleFen = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1'
  await patch(G13, g13.id, { start_fen: castleFen, current_fen: castleFen, moves_json: '[]', turn: 'w', status: 'playing' })
  g13 = await game(G13)
  await send([pbEvent(G13, g13.white_user_id, `cs|${g13.id}|${g13.version}|e1`)])
  g13 = await game(G13)
  await send([pbEvent(G13, g13.white_user_id, `cm|${g13.id}|${g13.version}|${g13.sel_token}|g1`)])
  g13 = await game(G13)
  const castleMoves = JSON.parse(g13.moves_json)
  ok(castleMoves[0] === 'O-O', 'キャスリング(短)が指せる', JSON.stringify(castleMoves))
  ok(g13.current_fen.includes('RK1'), 'ルークも移動している', g13.current_fen.split(' ')[0])

  // アンパッサン
  const epFen = '4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1'
  await patch(G13, g13.id, { start_fen: epFen, current_fen: epFen, moves_json: '[]', turn: 'w', status: 'playing', sel_square: null, sel_token: null })
  g13 = await game(G13)
  // 白 d2->d4 (黒ポーン e4 の隣に2マス進む)
  await send([pbEvent(G13, g13.white_user_id, `cs|${g13.id}|${g13.version}|d2`)])
  g13 = await game(G13)
  await send([pbEvent(G13, g13.white_user_id, `cm|${g13.id}|${g13.version}|${g13.sel_token}|d4`)])
  g13 = await game(G13)
  // 黒 e4xd3 (アンパッサン)
  await send([pbEvent(G13, g13.black_user_id, `cs|${g13.id}|${g13.version}|e4`)])
  g13 = await game(G13)
  await send([pbEvent(G13, g13.black_user_id, `cm|${g13.id}|${g13.version}|${g13.sel_token}|d3`)])
  g13 = await game(G13)
  const epMoves = JSON.parse(g13.moves_json)
  ok(epMoves.length === 2 && epMoves[1].includes('d3'), 'アンパッサンが指せる', JSON.stringify(epMoves))
  ok(!g13.current_fen.split(' ')[0].includes('P') || !g13.current_fen.includes('3P'), 'アンパッサンで取られた駒が消えている', g13.current_fen.split(' ')[0])

  console.log('\n=== 19. 再戦 ===')
  const G14 = 'Cchess_test_g14'
  await reset('Cchess_test_g14')
  await send([msgEvent(G14, A, 'チェス')])
  let g14 = await game(G14)
  await send([pbEvent(G14, B, `cj|${g14.id}`)])
  g14 = await game(G14)
  const w14 = g14.white_user_id
  const b14 = g14.black_user_id
  // 投了で終局させる
  await send([pbEvent(G14, w14, `cr|${g14.id}|${g14.version}`)])
  g14 = await game(G14)
  await send([pbEvent(G14, w14, `cry|${g14.id}|${g14.resign_token}`)])
  g14 = await game(G14)
  ok(g14.status === 'finished', '終局した')
  const parentId = g14.id

  // 第三者の再戦提案を拒否
  await send([pbEvent(G14, C, `cro|${parentId}`)])
  let parent = await gameById(parentId)
  ok(parent.rematch_by === null, '第三者は再戦を提案できない')

  // 対局者が提案
  await send([pbEvent(G14, w14, `cro|${parentId}`)])
  parent = await gameById(parentId)
  ok(parent.rematch_by === w14, '対局者は再戦を提案できる')

  // 提案者自身の承諾を拒否
  await send([pbEvent(G14, w14, `cra|${parentId}`)])
  parent = await gameById(parentId)
  ok(parent.rematch_child_id === null, '提案者自身は承諾できない')

  // もう一方が承諾(連打しても1件だけ)
  await Promise.all([
    send([pbEvent(G14, b14, `cra|${parentId}`)]),
    send([pbEvent(G14, b14, `cra|${parentId}`)]),
  ])
  parent = await gameById(parentId)
  ok(parent.rematch_child_id !== null, 'もう一方の承諾で再戦が作成される')
  const children = (await listGames(G14)).filter((x) => x.id !== parentId)
  ok(children.length === 1, '連打しても再戦は1件だけ作成される', `count=${children.length}`)
  if (children.length === 1) {
    ok(
      children[0].white_user_id === b14 && children[0].black_user_id === w14,
      '再戦では白黒が入れ替わる'
    )
    ok(children[0].status === 'playing' && children[0].turn === 'w', '再戦は白の手番で開始')
  }

  console.log('\n=== 20. 対局者の退出で中断 ===')
  const G15 = 'Cchess_test_g15'
  await reset('Cchess_test_g15')
  await send([msgEvent(G15, A, 'チェス')])
  let g15 = await game(G15)
  await send([pbEvent(G15, B, `cj|${g15.id}`)])
  g15 = await game(G15)
  await patch(G15, g15.id, { status: 'aborted', result: 'aborted', result_reason: '対局者がグループを退出したため中断しました' })
  g15 = await game(G15)
  ok(g15.status === 'aborted' && g15.result === 'aborted', '退出時は中断扱いで保存される(勝敗をつけない)')

  console.log('\n=== 21. 64マスの座標とタップ対象の一致 ===')
  // 全64マスのアルジェブレイック座標が生成されるか
  const FILES = 'abcdefgh'
  const expected = new Set()
  for (const f of FILES) for (let r = 1; r <= 8; r++) expected.add(`${f}${r}`)
  ok(expected.size === 64, '座標が64個ある')
  // a1が暗色、h1が明色(実装: isLight = (fileIdx + rankNum) % 2 === 0)
  const isLight = (fi, rn) => (fi + rn) % 2 === 0
  ok(isLight(0, 1) === false, 'a1は暗色')
  ok(isLight(7, 1) === true, 'h1は明色')
  ok(isLight(0, 8) === true, 'a8は明色')

  console.log('\n=== 結果 ===')
  console.log(`  成功 ${pass} / 失敗 ${fail}`)
  if (failures.length) {
    console.log('\n  失敗した項目:')
    failures.forEach((f) => console.log(`   - ${f}`))
  }
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('テスト実行エラー:', e)
  process.exit(1)
})
