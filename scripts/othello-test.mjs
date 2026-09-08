// オセロの自動テスト。
//
// 今回追加した「対局終了カードの📊オセロ戦績ボタン」を中心に検証する。
// オセロ専用のテストがこれまで1つも無かったので、既存の回帰も一緒に見る。
//
// 検証の柱:
//   1. 戦績ボタンは終局(finished)のときだけ出る。対局中・相手待ちでは出ない
//   2. ボタンは message アクションで、押すと「オセロ戦績」が送信される
//      (トークに発言として残り、他の人にもコマンド名が伝わるのが目的)
//   3. ボタン経由でも既存の `オセロ戦績` コマンドがそのまま動く
//   4. 対局していない人が押しても落ちず、遊び方を案内する
//   5. 既存の盤面タップ(postback `othello:r,c`)が壊れていない
//   6. 盤面の描画・ルール表示が壊れていない(回帰)
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

// 同期処理されるテスト用IDの接頭辞を使う。
// 戦績は group_id + user_id ごとに積み上がるので、
// 「まだ対局結果がありません」の検証が前回実行に影響されないよう
// グループIDは実行ごとに変える。
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
const G = `Cpf_test_othello_${RUN}`
const A = 'Upf_test_oth_alice_00000000000001'
const B = 'Upf_test_oth_bob_000000000000002'
const C = 'Upf_test_oth_carol_00000000000003'

let seq = 0
const sign = (b) => crypto.createHmac('sha256', SECRET).update(b).digest('base64')

async function simulate(text, { group = G, user = A } = {}) {
  const res = await fetch(`${BASE}/debug/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, groupId: group, userId: user }),
  })
  return res.json()
}

async function card(payload) {
  const res = await fetch(`${BASE}/debug/othello-card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json() }
}

async function postWebhook(events) {
  const body = JSON.stringify({ destination: 'test', events })
  const res = await fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(body) },
    body,
  })
  await new Promise((r) => setTimeout(r, 150))
  return res
}

function postbackEvent(data, { group = G, user = B } = {}) {
  return {
    type: 'postback',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'group', groupId: group, userId: user },
    webhookEventId: `wo_${++seq}_${Date.now()}`,
    deliveryContext: { isRedelivery: false },
    replyToken: `wo_rt_${++seq}_${Date.now()}`,
    postback: { data },
  }
}

/** カード内の全ノードを平坦に集める */
function nodes(node, out = []) {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((x) => nodes(x, out))
    else if (v && typeof v === 'object') nodes(v, out)
  }
  return out
}

/** カード内の全テキストを集める */
function texts(node) {
  return nodes(node)
    .filter((n) => n.type === 'text' && typeof n.text === 'string')
    .map((n) => n.text)
}

/** カード内の全アクションを集める */
function actions(node) {
  return nodes(node)
    .map((n) => n.action)
    .filter((a) => a && typeof a === 'object')
}

/** 「オセロ戦績」を送るボタンを探す */
function recordButtons(node) {
  return actions(node).filter((a) => a.text === 'オセロ戦績' || a.label?.includes('オセロ戦績'))
}

/** 終局した盤面(64マスすべて埋まって黒の勝ち) */
function finishedBoard() {
  // 黒40 / 白24 = 黒の勝ち。空きマスが無いので必ず終局形。
  return 'B'.repeat(40) + 'W'.repeat(24)
}

async function main() {
  console.log('=== 1. 戦績ボタンは終局のときだけ出る ===')
  {
    const fin = await card({ status: 'finished', board: finishedBoard() })
    ok(fin.status === 200, '終局カードが生成できる', JSON.stringify(fin.body).slice(0, 120))
    const finBtns = recordButtons(fin.body?.message)
    ok(finBtns.length === 1, '終局カードに戦績ボタンが1個だけ出る', `個数=${finBtns.length}`)

    const playing = await card({ status: 'playing' })
    ok(playing.status === 200, '対局中カードが生成できる')
    ok(
      recordButtons(playing.body?.message).length === 0,
      '対局中カードには戦績ボタンが出ない'
    )

    const waiting = await card({ status: 'waiting' })
    ok(waiting.status === 200, '相手待ちカードが生成できる')
    ok(
      recordButtons(waiting.body?.message).length === 0,
      '相手待ちカードには戦績ボタンが出ない'
    )
  }

  console.log('\n=== 2. ボタンは押すと「オセロ戦績」が発言される(message アクション) ===')
  {
    const fin = await card({ status: 'finished', board: finishedBoard() })
    const btn = recordButtons(fin.body?.message)[0]
    ok(btn?.type === 'message', 'アクション種別が message である', `type=${btn?.type}`)
    ok(
      btn?.text === 'オセロ戦績',
      '送信される本文が既存コマンドと完全に一致する',
      `text=${JSON.stringify(btn?.text)}`
    )
    ok(
      typeof btn?.label === 'string' && btn.label.includes('オセロ戦績'),
      'ボタンの文字にコマンド名が含まれる(知ってもらうのが目的)',
      `label=${JSON.stringify(btn?.label)}`
    )
    // postback にしてしまうと発言として残らず、周りに伝わらない
    ok(btn?.type !== 'postback', 'postback ではない(発言として残す必要がある)')
    const t = texts(fin.body?.message)
    ok(
      t.some((x) => x.includes('自分の勝敗数')),
      'ボタンの下に何が起きるか書いてある',
      JSON.stringify(t).slice(0, 200)
    )
  }

  console.log('\n=== 3. ボタンが送る文言で既存コマンドが動く ===')
  {
    // まず戦績を作る: 対局を1つ終わらせる
    await simulate('オセロ開始', { user: A })
    await simulate('オセロ参加', { user: B })

    const r = await simulate('オセロ戦績', { user: A })
    const body = JSON.stringify(r.would_reply_with ?? [])
    ok(r.would_reply_with?.length > 0, '「オセロ戦績」に返信がある')
    ok(body.includes('オセロ戦績') || body.includes('対局結果'), '戦績の返信が返る', body.slice(0, 200))
  }

  console.log('\n=== 4. 対局したことがない人が押しても落ちない ===')
  {
    const r = await simulate('オセロ戦績', { user: C })
    const t = (r.would_reply_with ?? []).map((m) => m.text ?? '').join('\n')
    ok(r.would_reply_with?.length > 0, '未対局でも返信がある')
    ok(t.includes('まだ対局結果がありません'), '未対局だと分かる文言が出る', t.slice(0, 160))
    ok(t.includes('オセロ開始'), '遊び方(オセロ開始)も案内する', t.slice(0, 160))
  }

  console.log('\n=== 5. 既存の盤面タップが壊れていない(回帰) ===')
  {
    // 進行中の対局を作る
    const g2 = `${G}_b`
    await simulate('オセロ開始', { group: g2, user: A })
    await simulate('オセロ参加', { group: g2, user: B })
    const before = await simulate('オセロ開始', { group: g2, user: A })
    const beforeText = JSON.stringify(before.would_reply_with ?? [])
    ok(beforeText.includes('既にオセロが進行中'), '対局が進行中である', beforeText.slice(0, 160))

    // 黒の初手は (2,3)(2,4 相当)などが合法。カードから合法手を取り出して押す。
    const playing = await card({ status: 'playing' })
    const cellActions = actions(playing.body?.message).filter(
      (a) => a.type === 'postback' && /^othello:\d+,\d+$/.test(a.data ?? '')
    )
    ok(cellActions.length === 4, '初期配置で合法手が4つある(盤面描画の回帰)', `個数=${cellActions.length}`)

    const res = await postWebhook([postbackEvent(cellActions[0].data, { group: g2, user: A })])
    ok(res.ok, '盤面タップのPostbackが受理される', `status=${res.status}`)
  }

  console.log('\n=== 6. 盤面カードの中身が壊れていない(回帰) ===')
  {
    const playing = await card({ status: 'playing' })
    const all = nodes(playing.body?.message)
    // 8x8=64マス。マスは CELL_PX=42px の box。
    const cells = all.filter((n) => n.type === 'box' && n.width === '42px' && n.height === '42px')
    ok(cells.length === 64, '盤面が64マスある', `個数=${cells.length}`)

    const t = texts(playing.body?.message)
    ok(t.some((x) => x.includes('の番です')), 'ヘッダーに手番が出る', JSON.stringify(t).slice(0, 160))

    const fin = await card({ status: 'finished', board: finishedBoard() })
    const ft = texts(fin.body?.message)
    ok(ft.some((x) => x.includes('の勝ちです')), '終局カードに勝敗が出る', JSON.stringify(ft).slice(0, 160))

    const wait = await card({ status: 'waiting' })
    const wt = texts(wait.body?.message)
    ok(
      wt.some((x) => x.includes('オセロ参加')),
      '相手待ちカードに参加方法が出る',
      JSON.stringify(wt).slice(0, 160)
    )
  }

  console.log('\n=== 7. カードのサイズがLINEの上限内 ===')
  {
    for (const st of ['waiting', 'playing', 'finished']) {
      const r = await card({ status: st, board: st === 'finished' ? finishedBoard() : undefined })
      const bytes = new TextEncoder().encode(JSON.stringify(r.body?.message?.contents ?? {})).length
      ok(bytes < 30000, `${st} のカードが30,000バイト未満`, `${bytes}バイト`)
    }
  }

  console.log('\n=== 8. 長い名前でも上限を超えない(実際に超えていた不具合) ===')
  {
    // 盤面だけで約27,000バイトあり、上限30,000にかなり近い。
    // 結合絵文字は1文字25バイト前後になるため、名前を短くする前は
    // 「👨‍👩‍👧‍👦」×20 の2人で 30,557バイト = 上限超えになり、
    // LINEが400を返してカードが1枚も届かなかった。
    const cases = [
      ['日本語20文字', 'あ'.repeat(20)],
      ['絵文字20文字', '😀'.repeat(20)],
      ['結合絵文字20文字', '👨‍👩‍👧‍👦'.repeat(20)],
      ['異常に長い名前100文字', '👨‍👩‍👧‍👦'.repeat(100)],
    ]
    for (const [label, name] of cases) {
      const r = await card({
        status: 'finished',
        board: finishedBoard(),
        blackName: name,
        whiteName: name,
      })
      const contents = r.body?.message?.contents ?? {}
      const bytes = new TextEncoder().encode(JSON.stringify(contents)).length
      ok(bytes < 30000, `終局カード(${label})が30,000バイト未満`, `${bytes}バイト`)
      // サイズを削るために肝心のボタンまで消えてしまっては意味がない
      ok(
        recordButtons(r.body?.message).length === 1,
        `終局カード(${label})でも戦績ボタンが残る`
      )
    }

    // 対局中カードも名前を含むので確認する
    const playing = await card({
      status: 'playing',
      blackName: '👨‍👩‍👧‍👦'.repeat(20),
      whiteName: '👨‍👩‍👧‍👦'.repeat(20),
    })
    const pb = new TextEncoder().encode(JSON.stringify(playing.body?.message?.contents ?? {})).length
    ok(pb < 30000, '対局中カード(長い名前)が30,000バイト未満', `${pb}バイト`)
  }

  console.log('\n=== 9. 不正な入力を安全に扱う ===')
  {
    const bad1 = await card({ status: 'nope' })
    ok(bad1.status === 400, '知らない状態は400で断る', `status=${bad1.status}`)
    const bad2 = await card({ status: 'playing', board: 'X'.repeat(64) })
    ok(bad2.status === 400, '不正な盤面は400で断る', `status=${bad2.status}`)
    const bad3 = await card({ status: 'playing', board: 'B'.repeat(10) })
    ok(bad3.status === 400, '長さの違う盤面は400で断る', `status=${bad3.status}`)
  }

  console.log('\n=== 結果 ===')
  console.log(`  成功 ${pass} / 失敗 ${fail}`)
  if (failures.length > 0) {
    console.log('\n失敗した項目:')
    failures.forEach((f) => console.log(`  - ${f}`))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
