// 「ヘルプ」のカルーセルの自動テスト。
//
// 検証の柱:
//   1. ようこそカード + コマンド一覧のカルーセルが返る
//   2. 各コマンドが押せるボタンになっている(message アクション)
//   3. ボタンが送る文字が、実際に動く本物のコマンドである
//      (存在しないコマンドをボタンにすると、押しても無反応になる)
//   4. 引数が必要なコマンドは押せるボタンにしない(無反応を防ぐ)
//   5. Flexの上限30,000バイトを超えない(超えると1枚も表示されない)
//   6. LINE Flexの禁止事項を踏んでいない(image に width を付けない)
//   7. 従来のカード型メニューが消えていない(Postbackから開ける)
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

const G = 'Cmenu_test_help'
const U = 'Umenu_test_help_0000000000000001'
// 既存コマンドの動作確認は同期処理される接頭辞で行う
const GS = 'Cpf_test_helpcmd'
const US = 'Upf_test_helpcmd_00000000000001'

async function simulate(text, { group = GS, user = US } = {}) {
  const res = await fetch(`${BASE}/debug/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, groupId: group, userId: user }),
  })
  return res.json()
}

async function menu(data) {
  const res = await fetch(`${BASE}/debug/menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, groupId: G, userId: U }),
  })
  return { status: res.status, body: await res.json() }
}

const nodes = (n, out = []) => {
  if (!n || typeof n !== 'object') return out
  out.push(n)
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((x) => nodes(x, out))
    else if (v && typeof v === 'object') nodes(v, out)
  }
  return out
}
const texts = (n) =>
  nodes(n)
    .filter((x) => x.type === 'text' && typeof x.text === 'string')
    .map((x) => x.text)
const actions = (n) =>
  nodes(n)
    .map((x) => x.action)
    .filter((a) => a && typeof a === 'object')

async function main() {
  const r = await simulate('ヘルプ')
  const msg = r.would_reply_with?.[0]

  console.log('=== 1. ようこそ + コマンド一覧のカルーセル ===')
  ok(msg?.type === 'flex', 'Flexで返る', `type=${msg?.type}`)
  ok(msg?.contents?.type === 'carousel', '横スワイプのカルーセル', `${msg?.contents?.type}`)
  const cards = msg?.contents?.contents ?? []
  ok(cards.length >= 2, 'カードが2枚以上', `枚数=${cards.length}`)
  ok(cards.length <= 12, 'カルーセルの上限12枚以内', `枚数=${cards.length}`)

  {
    const t0 = texts(cards[0]).join(' ')
    ok(t0.includes('ヘルプ'), '1枚目がヘルプの見出し', t0.slice(0, 80))
    // カテゴリで分けず、2枚目以降はすべて「コマンド一覧」
    const titles = cards.slice(1).map((c) => c.header?.contents?.[0]?.text)
    ok(
      titles.every((t) => t === 'コマンド一覧'),
      '2枚目以降はすべて「コマンド一覧」(カテゴリ分けしていない)',
      JSON.stringify(titles)
    )
    ok(t0.includes('ようこそ'), '1枚目にようこその文がある', t0.slice(0, 100))
    // イラスト
    const imgs = nodes(cards[0]).filter((x) => x.type === 'image')
    ok(imgs.length === 1, '1枚目にイラストが1つある', `個数=${imgs.length}`)
    ok(
      imgs[0]?.url?.endsWith('/static/happamochi-2b2e5a62.jpg'),
      'イラストが葉っぱもちの画像',
      `${imgs[0]?.url}`
    )
    // 公式サイトのボタン
    const uris = actions(cards[0]).filter((a) => a.type === 'uri')
    ok(uris.length === 1, '1枚目に公式サイトのボタンがある', `個数=${uris.length}`)
    ok(uris[0]?.uri?.startsWith('https://'), 'リンクが https', `${uris[0]?.uri}`)
  }

  console.log('\n=== 2. コマンドが押せるボタンになっている ===')
  const msgActions = actions(msg.contents).filter((a) => a.type === 'message')
  ok(msgActions.length >= 15, `押せるコマンドが15個以上ある`, `個数=${msgActions.length}`)
  ok(
    msgActions.every((a) => typeof a.label === 'string' && a.label.length > 0),
    'すべてのボタンに文字がある'
  )
  ok(
    msgActions.every((a) => typeof a.text === 'string' && a.text.length > 0),
    'すべてのボタンが送る文字を持っている'
  )
  // postback ではなく message にする(押すと発言として残り、コマンド名が伝わる)
  ok(
    actions(msg.contents).every((a) => a.type !== 'postback'),
    'postback を使っていない(発言として残す必要がある)'
  )

  console.log('\n=== 3. ボタンが送る文字が本物のコマンドである(最重要) ===')
  {
    // 存在しないコマンドをボタンにすると、押しても何も起きない。
    // 実際に実行して返信があるか確かめる。
    const cmds = [...new Set(msgActions.map((a) => a.text))]
    let bad = []
    for (const c of cmds) {
      const rr = await simulate(c)
      const n = (rr.would_reply_with ?? []).length
      if (n === 0) bad.push(c)
    }
    ok(bad.length === 0, `全${cmds.length}個のボタンが実際に動く`, `無反応: ${JSON.stringify(bad)}`)
  }

  console.log('\n=== 3b. 詰めて並んでいる ===')
  {
    // カテゴリで分けず上から詰める。1枚に7行入れて枚数を減らす。
    const rows = cards
      .slice(1)
      .map((c) => (c.body?.contents?.[0]?.contents ?? []).filter((x) => x.type === 'box').length)
    ok(
      rows.every((n) => n >= 5),
      '各カードに5行以上入っている(詰まっている)',
      JSON.stringify(rows)
    )
    ok(cards.length <= 6, 'カード枚数が6枚以内', `${cards.length}枚`)
    // 同じコマンドが2回出ていないこと
    const all = msgActions.map((a) => a.text)
    ok(new Set(all).size === all.length, 'コマンドの重複がない', `${all.length}個`)
  }

  console.log('\n=== 4. 引数が必要なコマンドは押せるボタンにしない ===')
  {
    // 「めいく:本文」のように、そのまま送っても成立しないものは
    // 押せるボタンにしてはいけない(押して無反応だと壊れて見える)。
    const sent = msgActions.map((a) => a.text)
    const needsArg = ['めいく:本文', 'タグ追加 タグ名', '称号検索 文字', '誕生日登録 9/7', 'めいくbold虹7:文']
    for (const na of needsArg) {
      ok(!sent.includes(na), `「${na}」は押せるボタンにしていない`)
    }
    // ただし説明としては画面に出ている(使い方が分かるように)
    const all = texts(msg.contents).join(' ')
    ok(all.includes('めいく'), '名言の使い方は文字として出ている')
  }

  console.log('\n=== 5. Flexの上限を超えない ===')
  {
    const bytes = new TextEncoder().encode(JSON.stringify(msg.contents)).length
    ok(bytes < 30000, 'カルーセル全体が30,000バイト未満', `${bytes}バイト`)
    // 1枚ずつも確認(将来カードを増やしたときの目安)
    cards.forEach((c, i) => {
      const b = new TextEncoder().encode(JSON.stringify(c)).length
      ok(b < 10000, `${i + 1}枚目が10,000バイト未満`, `${b}バイト`)
    })
  }

  console.log('\n=== 6. LINE Flexの禁止事項を踏んでいない ===')
  {
    // image に width を付けるとLINEが400を返す(過去にチェスで実際に起きた)
    const imgs = nodes(msg.contents).filter((x) => x.type === 'image')
    ok(
      imgs.every((im) => im.width === undefined),
      'image に width を付けていない',
      JSON.stringify(imgs.map((i) => Object.keys(i)))
    )
    ok(
      imgs.every((im) => im.url?.startsWith('https://')),
      '画像URLはすべて https'
    )
    ok(
      cards.every((c) => c.size === 'kilo'),
      '全カードの size がそろっている',
      JSON.stringify(cards.map((c) => c.size))
    )
  }

  console.log('\n=== 7. 見本と同じ色配置 ===')
  {
    const BLUE = '#039BE5'
    for (const [i, c] of cards.entries()) {
      ok(c.header?.backgroundColor === BLUE, `${i + 1}枚目の上帯が青`, `${c.header?.backgroundColor}`)
      ok(c.body?.backgroundColor === '#E1F5FE', `${i + 1}枚目の本文が水色`, `${c.body?.backgroundColor}`)
      ok(c.footer?.backgroundColor === BLUE, `${i + 1}枚目の下帯が青`, `${c.footer?.backgroundColor}`)
      const ft = c.footer?.contents?.[0]
      ok(ft?.text === '© 2026 HappaMochi Bot', `${i + 1}枚目の表記が正式名`, `${ft?.text}`)
      ok(ft?.color === '#FFFFFF' && ft?.align === 'center', `${i + 1}枚目の著作権が白・中央`)
      ok(c.footer?.paddingAll === '0px', `${i + 1}枚目の下帯が左右いっぱい`)
    }
    const all = texts(msg.contents).join(' ')
    ok(!all.includes('uparupa'), '参照元のBot名をコピーしていない')
    ok(!all.includes('nano-bot'), '根拠のない名前が入っていない')
  }

  console.log('\n=== 8. 従来のメニューが消えていない(回帰) ===')
  {
    // ヘルプの見た目は変えたが、案内画面32種は今までどおり使える
    const m = await menu('hm|n|M')
    ok(m.status === 200, 'カード型メニューがPostbackから開ける', `status=${m.status}`)
    ok(
      m.body?.would_reply_with?.[0]?.contents?.type === 'carousel',
      'カード型メニューがカルーセルで返る'
    )
    const h03 = await menu('hm|n|H03:1')
    ok(h03.status === 200, '全コマンド画面が今までどおり開ける', `status=${h03.status}`)
  }

  console.log('\n=== 9. 別名 help も同じものを返す ===')
  {
    const r2 = await simulate('help')
    const m2 = r2.would_reply_with?.[0]
    ok(m2?.contents?.type === 'carousel', '「help」でもカルーセルが返る')
    ok(
      (m2?.contents?.contents ?? []).length === cards.length,
      '「help」と「ヘルプ」で同じ枚数'
    )
  }

  console.log('\n=== 10. イラストが配信されている ===')
  {
    const res = await fetch(`${BASE}/static/happamochi-2b2e5a62.jpg`)
    ok(res.status === 200, 'イラストが200で返る', `status=${res.status}`)
    ok(
      (res.headers.get('content-type') ?? '').includes('image/jpeg'),
      'JPEGとして配信されている',
      `${res.headers.get('content-type')}`
    )
    // 画像が重いとカードの表示が遅れる。200KB以下に収まっていること。
    // content-length は返らない場合があるので、実際に読んだバイト数で見る。
    const len = (await res.arrayBuffer()).byteLength
    ok(len > 0 && len < 200_000, `イラストが軽い (${Math.round(len / 1024)}KB)`)
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
