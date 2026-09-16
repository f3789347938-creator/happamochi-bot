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
    // 見出しは青帯ではなく本文の上から2番目のテキスト
    const titles = cards.slice(1).map((c) => c.body?.contents?.[1]?.text)
    ok(
      titles.every((t) => t === 'コマンド一覧'),
      '2枚目以降はすべて「コマンド一覧」(カテゴリ分けしていない)',
      JSON.stringify(titles)
    )
    ok(t0.includes('葉っぱもちへようこそ'), '1枚目に「葉っぱもちへようこそ」がある', t0.slice(0, 80))
    ok(t0.includes('グループでも、1対1でも。'), '1枚目に紹介文がある', t0.slice(0, 80))
    ok(t0.includes('いつものトークで楽しもう。'), '紹介文が最後まで入っている')
    // イラスト
    const imgs = nodes(cards[0]).filter((x) => x.type === 'image')
    ok(imgs.length === 1, '1枚目にイラストが1つある', `個数=${imgs.length}`)
    ok(
      imgs[0]?.url?.endsWith('/static/happamochi-e061df69.jpg'),
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

  console.log('\n=== 3b. 1ページ5件で詰まっている ===')
  {
    // 新デザイン: 各項目は白背景・角丸の横並びボックス
    const itemsOf = (c) =>
      (c.body?.contents ?? []).filter(
        (x) => x.type === 'box' && x.layout === 'horizontal' && x.backgroundColor === '#FFFFFF'
      )
    const rows = cards.slice(1).map((c) => itemsOf(c).length)
    ok(
      rows.every((n) => n === 5),
      '一覧ページは必ず5項目',
      JSON.stringify(rows)
    )
    ok(cards.length <= 12, 'カルーセルの上限内', `${cards.length}枚`)
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

  console.log('\n=== 7. 指定どおりの配色 ===')
  {
    // 指定: フッター背景 / 公式サイトボタン / コマンド名 は同じ #039BE5
    const ACCENT = '#039BE5'
    for (const [i, c] of cards.entries()) {
      ok(c.body?.backgroundColor === '#F1FAFE', `${i + 1}枚目のカード背景が淡い水色`, `${c.body?.backgroundColor}`)
      ok(c.footer?.backgroundColor === ACCENT, `${i + 1}枚目のフッターが#039BE5`, `${c.footer?.backgroundColor}`)
      const ft = c.footer?.contents?.[0]
      ok(ft?.text === '© 2026 HappaMochi Bot', `${i + 1}枚目の表記が正式名`, `${ft?.text}`)
      ok(ft?.color === '#FFFFFF' && ft?.align === 'center', `${i + 1}枚目の著作権が白・中央`)
      // ページ番号は出さない
      ok(!/\d+\s*\/\s*\d+/.test(ft?.text ?? ''), `${i + 1}枚目にページ番号がない`)
    }
    // 公式サイトボタンが同じ青
    const btn = (cards[0].body?.contents ?? []).find((x) => x.type === 'button')
    ok(btn?.color === ACCENT, '公式サイトボタンが#039BE5', `${btn?.color}`)
    // コマンド名が青、説明は濃い色。項目全体は白のまま塗りつぶさない。
    const items = cards
      .slice(1)
      .flatMap((c) => (c.body?.contents ?? []).filter((x) => x.type === 'box' && x.backgroundColor === '#FFFFFF'))
    ok(items.length === 20, '項目が20件ある', `${items.length}件`)
    ok(
      items.every((it) => it.contents[0].contents[0].color === ACCENT),
      'コマンド名が#039BE5'
    )
    ok(
      items.every((it) => it.contents[0].contents[1].color === '#425C6E'),
      '説明文が落ち着いた濃い色'
    )
    ok(
      items.every((it) => it.borderColor === '#CFE7F3' && it.cornerRadius),
      '項目が細い枠線と角丸を持つ'
    )
    // 左のアイコンや丸背景を付けていないこと
    ok(
      items.every((it) => it.contents.length === 2),
      '項目の左にアイコンや丸背景を置いていない'
    )
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
    const res = await fetch(`${BASE}/static/happamochi-e061df69.jpg`)
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

  console.log('\n=== 11. 5ページ構成・掲載順・高さ揃え(デザイン指定) ===')
  {
    // 指定: 表紙1 + 一覧4 = 5枚。一覧は必ず1ページ5項目。
    ok(cards.length === 5, 'カードは5枚(表紙+一覧4)', `${cards.length}枚`)

    const itemsOf = (c) =>
      (c.body?.contents ?? []).filter(
        (x) => x.type === 'box' && x.layout === 'horizontal' && x.backgroundColor === '#FFFFFF'
      )
    const counts = cards.slice(1).map((c) => itemsOf(c).length)
    ok(
      JSON.stringify(counts) === JSON.stringify([5, 5, 5, 5]),
      '各ページの件数が 5 / 5 / 5 / 5',
      JSON.stringify(counts)
    )

    // 掲載順(指定どおり)
    const labelsOf = (c) => itemsOf(c).map((it) => it.contents[0].contents[0].text)
    const expected = [
      ['ヘルプ', 'ステータス', 'ランキング', 'お知らせ', '着せ替え'],
      ['パズル', 'サバイバル', 'オセロ', 'オセロ参加', 'オセロ戦績'],
      ['チェス', '盤面', 'めいく 装飾', 'めいく:本文', '返信して めいく'],
      ['めいく bold虹7:文', 'ウェルカムオン', 'ウェルカムオフ', '取り消し通知オン', '取り消し通知オフ'],
    ]
    cards.slice(1).forEach((c, i) => {
      ok(
        JSON.stringify(labelsOf(c)) === JSON.stringify(expected[i]),
        `${i + 2}枚目の掲載順が指定どおり`,
        JSON.stringify(labelsOf(c))
      )
    })

    // 掲載しない項目が復活していないこと
    const allLabels = cards.slice(1).flatMap(labelsOf)
    for (const ng of ['称号一覧', '称号確認', '称号検索 文字']) {
      ok(!allLabels.includes(ng), `「${ng}」を掲載していない`)
    }

    // 全ページで横幅・フッターが揃う
    ok(cards.every((c) => c.footer), '全ページにフッターがある')
    ok(
      cards.every((c) => c.size === cards[0].size),
      '全ページで横幅(size)が同じ',
      cards.map((c) => c.size).join(',')
    )

    // ★高さ揃え★
    // LINEはカルーセルを一番高いカードに自動で揃える。
    // 余りは末尾の filler が受け取るので、項目そのものは引き伸ばされない。
    cards.forEach((c, i) => {
      const last = (c.body?.contents ?? []).slice(-1)[0]
      const hasFiller = (c.body?.contents ?? []).some((x) => x.type === 'filler')
      ok(hasFiller, `${i + 1}枚目に余白を受け取る filler がある`)
    })
    ok(
      cards.slice(1).every((c) =>
        itemsOf(c).every((it) => it.flex === undefined || it.flex === 0)
      ),
      '項目を縦に引き伸ばしていない'
    )

    // 表紙の画像。正式素材をそのまま使い、縦横比を保つ。
    const img = nodes(cards[0]).find((x) => x.type === 'image')
    ok(img?.aspectMode === 'fit', '画像が縦横比を保って収まる(葉や足が切れない)', `${img?.aspectMode}`)
    ok(!('width' in (img ?? {})), '画像に width を付けていない(LINEで400になる)')
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
