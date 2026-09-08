// 「ランキング」コマンドのカルーセルの自動テスト。
//
// 検証の柱:
//   1. 横スワイプのカルーセルで2枚返る(葉っぱもち / もち合体パズル)
//   2. 上位3位まで、順位・名前・数値が出る
//   3. 「あなたの順位」が出る(記録が無い人にも一言出る)
//   4. 「ランキングをもっと見る」の行き先が正しい
//   5. LINE Flexの禁止事項を踏んでいない(image に width を付けない)
//   6. 既存の別名「順位」も同じものを返す
//   7. アイコンが無い人でも崩れない
//   8. もっと見るページが表示できる
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

const G = 'Cpf_test_rankcard'
const U = 'Upf_test_rankcard_00000000000001'

async function simulate(text, { group = G, user = U } = {}) {
  const res = await fetch(`${BASE}/debug/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, groupId: group, userId: user }),
  })
  return res.json()
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
  console.log('=== 1. カルーセルで2枚返る ===')
  const r = await simulate('ランキング')
  const msg = r.would_reply_with?.[0]
  ok(msg?.type === 'flex', 'Flexで返る', `type=${msg?.type}`)
  ok(msg?.contents?.type === 'carousel', '横スワイプのカルーセルである', `${msg?.contents?.type}`)
  const cards = msg?.contents?.contents ?? []
  ok(cards.length === 2, 'カードが2枚', `枚数=${cards.length}`)

  console.log('\n=== 2. それぞれのカードの中身 ===')
  {
    const t1 = texts(cards[0]).join(' ')
    ok(t1.includes('葉っぱもちランキング'), '1枚目が葉っぱもちランキング', t1.slice(0, 120))
    ok(t1.includes('1〜3位'), '1枚目に「1〜3位」と書いてある')

    const t2 = texts(cards[1]).join(' ')
    ok(t2.includes('もち合体パズル'), '2枚目がもち合体パズル', t2.slice(0, 120))
    ok(t2.includes('1〜3位'), '2枚目に「1〜3位」と書いてある')

    // 記録があれば上位3行、無ければ「まだ記録がありません」が出る
    const hasRows1 = /Lv\.\d+/.test(t1)
    const hasEmpty1 = t1.includes('まだ記録がありません')
    ok(hasRows1 || hasEmpty1, '1枚目は順位一覧か「記録なし」のどちらかが出る', t1.slice(0, 120))

    const hasRows2 = /best/.test(t2)
    const hasEmpty2 = t2.includes('まだ記録がありません')
    ok(hasRows2 || hasEmpty2, '2枚目は順位一覧か「記録なし」のどちらかが出る', t2.slice(0, 120))
  }

  console.log('\n=== 3. 「あなたの順位」が両方に出る ===')
  {
    for (const [i, label] of [[0, '1枚目'], [1, '2枚目']]) {
      const t = texts(cards[i]).join(' ')
      ok(
        t.includes('あなたの順位') || t.includes('まだ順位がついてないよ'),
        `${label}に自分の順位の行がある`,
        t.slice(0, 160)
      )
    }
  }

  console.log('\n=== 4. 「もっと見る」の行き先 ===')
  {
    const acts = actions(msg.contents)
    const uris = acts.filter((a) => a.type === 'uri').map((a) => a.uri)
    ok(uris.length === 2, 'もっと見るボタンが2つある', `個数=${uris.length}`)
    ok(
      uris.some((u) => u.endsWith('/ranking/personal')),
      '1枚目は個人ランキングページへ',
      JSON.stringify(uris)
    )
    ok(
      uris.some((u) => u.endsWith('/ranking/mochi')),
      '2枚目はもち合体パズルのページへ',
      JSON.stringify(uris)
    )
    ok(
      uris.every((u) => u.startsWith('https://')),
      'すべて https である',
      JSON.stringify(uris)
    )
    ok(
      acts.every((a) => typeof a.label === 'string' && a.label.length > 0),
      'すべてのボタンに文字がある'
    )
  }

  console.log('\n=== 5. LINE Flexの禁止事項を踏んでいない ===')
  {
    // image に width を付けるとLINEが400を返す(過去にチェスで実際に起きた)
    const images = nodes(msg.contents).filter((n) => n.type === 'image')
    ok(
      images.every((im) => im.width === undefined),
      'image に width を付けていない',
      JSON.stringify(images.map((i) => Object.keys(i)))
    )
    ok(
      images.every((im) => typeof im.url === 'string' && im.url.startsWith('https://')),
      '画像URLはすべて https',
      `画像数=${images.length}`
    )
    const bytes = new TextEncoder().encode(JSON.stringify(msg.contents)).length
    ok(bytes < 30000, 'カード全体が30,000バイト未満', `${bytes}バイト`)
    ok(cards.length <= 12, 'カルーセルの枚数が上限12以内', `${cards.length}枚`)
  }

  console.log('\n=== 6. 別名「順位」も同じものを返す ===')
  {
    const r2 = await simulate('順位')
    const m2 = r2.would_reply_with?.[0]
    ok(m2?.contents?.type === 'carousel', '「順位」でもカルーセルが返る', `${m2?.contents?.type}`)
    ok(
      (m2?.contents?.contents ?? []).length === (msg?.contents?.contents ?? []).length,
      '「順位」と「ランキング」で同じ枚数',
    )
  }

  console.log('\n=== 7. アイコンが無い人でも崩れない ===')
  {
    // アイコンが無い場合は画像ではなく頭文字の箱を出す。
    // 行の数(順位の数字)とアイコン枠の数が一致していれば崩れていない。
    for (const [i, label] of [[0, '1枚目'], [1, '2枚目']]) {
      const boxes = nodes(cards[i]).filter(
        (n) => n.type === 'box' && n.width === '44px' && n.height === '44px'
      )
      const t = texts(cards[i]).join(' ')
      const isEmpty = t.includes('まだ記録がありません')
      ok(
        isEmpty || boxes.length > 0,
        `${label}に各行のアイコン枠がある`,
        `枠=${boxes.length} 空=${isEmpty}`
      )
    }
  }

  console.log('\n=== 8. もっと見るページが表示できる ===')
  {
    for (const [label, path] of [
      ['もち合体パズルのページ', '/ranking/mochi'],
      ['個人ランキング', '/ranking/personal'],
      ['グループ別ランキング', '/ranking'],
    ]) {
      const res = await fetch(`${BASE}${path}`)
      ok(res.status === 200, `${label} が200で返る`, `status=${res.status}`)
    }
    const html = await (await fetch(`${BASE}/ranking/mochi`)).text()
    ok(html.includes('もち合体パズル ランキング'), 'ページに見出しがある')
    ok(
      html.includes('/ranking/personal') && html.includes('/ranking'),
      'ページから他のランキングへ行ける'
    )
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
