// チェスの各状態のFlex JSONサンプルを出力し、サイズを検証する。
//
// ハードコードした「見本」ではなく、実際にLINEへ送信するのと同じ
// コードパス(boardMessage / resultMessage / recruitMessage /
// buildPromotionCard)を Worker 上で通した結果を取得している。
// そのため、ここで出たJSONが実配信されるものと一致する。
//
// LINEのFlex Messageは1メッセージあたり 30,000 バイト以内(bubble の
// JSON表現)という制限がある。ここでは安全側に 30,720 を上限として扱い、
// 各サンプルが収まっていることを確認する。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const BASE = process.env.CHESS_TEST_BASE || 'http://localhost:3000'
const SECRET = process.env.CHESS_TEST_SECRET || 'c03a8d1e26cc700d461f8ff9b35ecfad'
const OUT_DIR = path.resolve(import.meta.dirname, '..', 'samples', 'chess-flex')

// LINEのFlex上限。公式ドキュメントの上限は 30,000 バイト。
// 実運用では余裕を持たせたいので、警告しきい値も併せて出す。
const LIMIT = 30000
const WARN = 24000

const A = 'Uchess_alice_000000000000000000001'
const B = 'Uchess_bob_00000000000000000000002'

let evSeq = 0
function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64')
}
async function send(events) {
  const body = JSON.stringify({ destination: 'sample', events })
  await fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(body) },
    body,
  })
  await new Promise((r) => setTimeout(r, 60))
}
function msgEvent(groupId, userId, text) {
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'group', groupId, userId },
    webhookEventId: `ev_s_${++evSeq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `rt_${++evSeq}_${Date.now()}`,
    message: { id: String(Date.now() + evSeq), type: 'text', text },
  }
}
function pbEvent(groupId, userId, data) {
  return {
    type: 'postback',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'group', groupId, userId },
    webhookEventId: `ev_s_${++evSeq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `rt_${++evSeq}_${Date.now()}`,
    postback: { data },
  }
}
async function dbg(payload) {
  const res = await fetch(`${BASE}/debug/chess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}
const game = async (g) => (await dbg({ op: 'get', groupId: g })).game
const reset = (g) => dbg({ op: 'reset', groupId: g })
const patch = (g, id, set) => dbg({ op: 'patch', groupId: g, id, set })
const flex = async (g, kind, extra = {}) =>
  (await dbg({ op: 'flex', groupId: g, kind, ...extra })).message

/** 募集を作って対局を成立させ、任意の局面に差し替える */
async function setup(groupId, fen, turn = 'w') {
  await reset(groupId)
  await send([msgEvent(groupId, A, 'チェス')])
  let g = await game(groupId)
  await send([pbEvent(groupId, B, `cj|${g.id}`)])
  g = await game(groupId)
  if (fen) {
    await patch(groupId, g.id, {
      start_fen: fen, current_fen: fen, moves_json: '[]', turn, status: 'playing',
    })
    g = await game(groupId)
  }
  return g
}

/** 手番の側で from をタップして選択状態にする */
async function select(groupId, from) {
  let g = await game(groupId)
  const mover = g.turn === 'w' ? g.white_user_id : g.black_user_id
  await send([pbEvent(groupId, mover, `cs|${g.id}|${g.version}|${from}`)])
  return await game(groupId)
}

/** 選択済みの状態から to をタップして確定する */
async function move(groupId, to) {
  let g = await game(groupId)
  const mover = g.turn === 'w' ? g.white_user_id : g.black_user_id
  await send([pbEvent(groupId, mover, `cm|${g.id}|${g.version}|${g.sel_token}|${to}`)])
  return await game(groupId)
}

let fail = 0
const rows = []

function record(name, file, message, desc) {
  const json = JSON.stringify(message.contents)
  const bytes = Buffer.byteLength(json, 'utf8')
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(message, null, 2))
  const within = bytes <= LIMIT
  if (!within) fail++
  const mark = within ? (bytes <= WARN ? '✅' : '⚠️ ') : '❌'
  const pct = ((bytes / LIMIT) * 100).toFixed(1)
  console.log(
    `  ${mark} ${name.padEnd(14, '　')} ${String(bytes).padStart(6)} bytes ` +
      `(上限の${pct}%) 余裕 ${LIMIT - bytes} bytes  → samples/chess-flex/${file}`
  )
  rows.push({ name, file, bytes, altText: message.altText, desc })
  return bytes
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  console.log(`\nFlex JSONサンプルを出力します(上限 ${LIMIT} bytes)\n`)

  // --- 0. 募集中 ---------------------------------------------------------
  const S0 = 'Cchess_test_s0'
  await reset(S0)
  await send([msgEvent(S0, A, 'チェス')])
  record('募集中', '00-recruit.json', await flex(S0, 'recruit'), '「チェス」直後。参加/取り消しボタンのみ')

  // --- 1. 初期盤面 -------------------------------------------------------
  const S1 = 'Cchess_test_s1'
  await setup(S1, null)
  record('初期盤面', '01-initial.json', await flex(S1, 'board'), '対局成立直後。白の手番、選択なし')

  // --- 2. 選択中(移動先ハイライト) --------------------------------------
  const S2 = 'Cchess_test_s2'
  await setup(S2, null)
  await select(S2, 'e2')
  record('選択中', '02-selected.json', await flex(S2, 'board'), 'e2のポーンを選択。e3/e4に移動先マーク')

  // 駒を取れる選択も出しておく(枠表示の確認用)
  const S2b = 'Cchess_test_s2b'
  await setup(S2b, 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')
  await select(S2b, 'e4')
  record('選択中(取れる)', '02b-selected-capture.json', await flex(S2b, 'board'), 'e4のポーンでd5を取れる状態')

  // --- 3. チェック中 -----------------------------------------------------
  const S3 = 'Cchess_test_s3'
  // 白Qh5 が f7 を抜けて黒Ke8 にチェックをかけている(黒の手番)。
  // f7のポーンが残っていると利きが通らないので、f7は空にしてある
  // (chess.js の inCheck()===true を確認済み)。
  await setup(S3, 'rnbqkbnr/pppp2pp/8/4p2Q/8/8/PPPPPPPP/RNB1KBNR b KQkq - 0 3', 'b')
  record('チェック中', '03-check.json', await flex(S3, 'board'), '黒Kがチェックされている。King枠が赤')

  // --- 4. 昇格待ち -------------------------------------------------------
  const S4 = 'Cchess_test_s4'
  // 白ポーン b7、8列目は空。b7-b8 で昇格
  await setup(S4, '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1')
  await select(S4, 'b7')
  await move(S4, 'b8')
  let g4 = await game(S4)
  if (!g4.pending_token) {
    console.log('  ❌ 昇格待ちの状態が作れませんでした')
    fail++
  } else {
    record('昇格待ち', '04-promotion.json', await flex(S4, 'promotion'), 'b7→b8。Q/R/B/N を選ぶまで確定しない')
  }

  // --- 5. 引き分け提案中 -------------------------------------------------
  const S5 = 'Cchess_test_s5'
  let g5 = await setup(S5, null)
  await send([pbEvent(S5, g5.white_user_id, `cd|${g5.id}|${g5.version}`)])
  g5 = await game(S5)
  if (!g5.draw_by) {
    console.log('  ❌ 引き分け提案の状態が作れませんでした')
    fail++
  } else {
    record('引き分け提案中', '05-draw-offer.json', await flex(S5, 'board'), '承諾/拒否ボタンが追加された盤面')
  }

  // --- 6. 終局(チェックメイト) ------------------------------------------
  const S6 = 'Cchess_test_s6'
  await setup(S6, 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4')
  await select(S6, 'f3')
  await move(S6, 'f7')
  const g6 = await game(S6)
  if (g6.status !== 'finished') {
    console.log(`  ❌ 終局の状態が作れませんでした (status=${g6.status})`)
    fail++
  } else {
    record('終局', '06-finished.json', await flex(S6, 'result'), `${g6.result_reason}。再戦ボタン付き`)
  }

  // --- 一覧を書き出す ----------------------------------------------------
  const maxBytes = Math.max(...rows.map((r) => r.bytes))
  const index = [
    '# チェス Flex Message サンプル',
    '',
    '実際にLINEへ送信するのと同じコード（`boardMessage` / `resultMessage` /',
    '`recruitMessage` / `buildPromotionCard`）をローカルのWorker上で実行して',
    '取得したJSONです。`scripts/chess-flex-samples.mjs` で再生成できます。',
    '',
    `LINEのFlex Messageの上限は **${LIMIT.toLocaleString()} バイト**（bubbleのJSON表現）です。`,
    `本実装の最大は **${maxBytes.toLocaleString()} バイト**（余裕 ${(LIMIT - maxBytes).toLocaleString()} バイト）でした。`,
    '',
    '| 状態 | サイズ | 上限比 | ファイル | 内容 |',
    '|---|--:|--:|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.bytes.toLocaleString()} B | ${((r.bytes / LIMIT) * 100).toFixed(1)}% | [\`${r.file}\`](./${r.file}) | ${r.desc} |`
    ),
    '',
    '## altText（通知・トーク一覧に出る文字列）',
    '',
    ...rows.map((r) => `- **${r.name}**: ${r.altText}`),
    '',
  ].join('\n')
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), index)

  console.log(`\n  最大 ${maxBytes} bytes / 上限 ${LIMIT} bytes（余裕 ${LIMIT - maxBytes} bytes）`)
  console.log(`  一覧: samples/chess-flex/README.md`)
  console.log(fail === 0 ? '\n  すべて上限内でした\n' : `\n  ${fail}件が上限を超えました\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('サンプル生成エラー:', e)
  process.exit(1)
})
