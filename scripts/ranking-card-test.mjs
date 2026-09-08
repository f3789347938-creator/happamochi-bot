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

  console.log('\n=== 6. 見本と同じ色配置・構造になっている ===')
  {
    const BLUE = '#039BE5'
    const BODY_BG = '#E1F5FE'
    const ROW_BG = '#FFFFFF'
    const BORDER = '#BFE3EF'

    for (const [i, label] of [[0, '1枚目'], [1, '2枚目']]) {
      const c = cards[i]

      // カード幅。mega より一段細い kilo にそろえる(見本の幅に合わせる)
      ok(c?.size === 'kilo', `${label}の size が kilo`, `size=${c?.size}`)

      // 上帯・主ボタン・下帯が同じ青
      const btn = (c?.body?.contents ?? []).find((x) => x.type === 'button')
      ok(c?.header?.backgroundColor === BLUE, `${label}の上帯が ${BLUE}`, `${c?.header?.backgroundColor}`)
      ok(btn?.color === BLUE, `${label}の主ボタンが同じ青`, `${btn?.color}`)
      ok(c?.footer?.backgroundColor === BLUE, `${label}の下帯が同じ青`, `${c?.footer?.backgroundColor}`)

      // 本文の土台は水色、各順位行は白(ここが見本との一番大きな違いだった)
      ok(c?.body?.backgroundColor === BODY_BG, `${label}の本文が水色 ${BODY_BG}`, `${c?.body?.backgroundColor}`)
      const rows = (c?.body?.contents ?? []).filter((x) => x.type === 'box')
      ok(rows.length > 0, `${label}に行がある`)
      ok(
        rows.every((r) => r.backgroundColor === ROW_BG),
        `${label}の各行が白`,
        JSON.stringify(rows.map((r) => r.backgroundColor))
      )
      ok(
        rows.every((r) => r.borderColor === BORDER && r.borderWidth === '1px'),
        `${label}の各行が薄い水色の細枠`,
        JSON.stringify(rows.map((r) => `${r.borderColor}/${r.borderWidth}`))
      )
      // 角丸は小さく(見本は control 程度)。'md' のような大きい丸みは使わない
      ok(
        rows.every((r) => /^[0-9]+px$/.test(r.cornerRadius ?? '') && parseInt(r.cornerRadius) <= 6),
        `${label}の各行の角丸が小さい`,
        JSON.stringify(rows.map((r) => r.cornerRadius))
      )

      // 下端の青帯は左右いっぱい(paddingを左右に付けると両端が白く残る)
      ok(c?.footer?.paddingAll === '0px', `${label}の下帯が左右いっぱい`, `pad=${c?.footer?.paddingAll}`)
      const ft = c?.footer?.contents?.[0]
      ok(ft?.color === '#FFFFFF', `${label}の著作権文字が白`, `${ft?.color}`)
      ok(ft?.align === 'center', `${label}の著作権文字が中央`, `${ft?.align}`)
      ok(ft?.weight === 'bold', `${label}の著作権文字が太字`, `${ft?.weight}`)
      ok(ft?.text === '© 2026 HappaMochi Bot', `${label}の表記が正式名`, `${ft?.text}`)

      // ボタンは本文側(水色の上)に置く。footer に入れると青帯と重なる
      ok(btn !== undefined, `${label}のボタンが本文側にある`)
      ok(
        (c?.footer?.contents ?? []).every((x) => x.type !== 'button'),
        `${label}の下帯にボタンが入っていない`
      )
    }

    // 参照元のBot名や根拠のない名前が混ざっていないこと
    const all = texts(msg.contents).join(' ')
    ok(!all.includes('nano-bot'), '根拠のない nano-bot 表記が残っていない')
    ok(!all.includes('uparupa'), '参照元の Bot 名をコピーしていない')
  }

  console.log('\n=== 6b. 行の中身が見本の並びになっている ===')
  {
    const c = cards[0]
    const rows = (c?.body?.contents ?? []).filter((x) => x.type === 'box')
    const r0 = rows[0]
    ok(r0?.layout === 'horizontal', '行は横並び', `${r0?.layout}`)
    ok(r0?.alignItems === 'center', '行の中身は縦中央ぞろえ', `${r0?.alignItems}`)

    // 「順位数字 → アバター → 名前と数値」の順
    const kinds = (r0?.contents ?? []).map((x) => x.type)
    ok(kinds.length === 3, '行は3列(順位/アバター/文字)', JSON.stringify(kinds))

    // アバターは正方形・小さい角丸・細枠。丸アイコンにしない
    const av = r0?.contents?.[1]
    ok(av?.width === av?.height, 'アバターが正方形', `${av?.width} x ${av?.height}`)
    ok(
      parseInt(av?.cornerRadius ?? '99') <= 6,
      'アバターの角丸が小さい(丸アイコンでない)',
      `${av?.cornerRadius}`
    )
    ok(av?.borderColor === '#BFE3EF', 'アバターに薄い水色の枠', `${av?.borderColor}`)

    // 順位数字は名前より控えめ(小さめ)。金銀銅
    const rankText = r0?.contents?.[0]?.contents?.[0]
    const nameText = r0?.contents?.[2]?.contents?.[0]
    const order = ['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl']
    ok(
      order.indexOf(rankText?.size) < order.indexOf(nameText?.size),
      '順位数字が名前より小さい',
      `順位=${rankText?.size} 名前=${nameText?.size}`
    )
    ok(rankText?.color === '#D4AF37', '1位が金色', `${rankText?.color}`)
    ok(rows[1]?.contents?.[0]?.contents?.[0]?.color === '#949DA3', '2位が銀色')
    ok(rows[2]?.contents?.[0]?.contents?.[0]?.color === '#B87939', '3位が銅色')

    // 名前は濃いグレーの太字、数値は灰色の通常の太さ
    ok(nameText?.color === '#333333' && nameText?.weight === 'bold', '名前が濃いグレーの太字')
    const subText = r0?.contents?.[2]?.contents?.[1]
    ok(subText?.color === '#6F858B', '数値が灰色', `${subText?.color}`)
    ok(subText?.weight !== 'bold', '数値は太字にしない', `${subText?.weight}`)

    // 高さは固定しない(端末の文字サイズを大きくすると切れるため)
    ok(
      rows.every((r) => r.height === undefined),
      '行に固定の高さを付けていない(文字切れ防止)'
    )
  }

  console.log('\n=== 6c. 数値の表記 ===')
  {
    const t1 = texts(cards[0]).join(' ')
    const t2 = texts(cards[1]).join(' ')
    // exp: / best: のコロン付き。既存の値の意味は変えない
    if (/exp/.test(t1)) {
      ok(/exp:\s/.test(t1), 'EXPが「exp: 」形式', t1.slice(0, 120))
      ok(!/exp\s\d/.test(t1), '古い「exp 316」形式が残っていない', t1.slice(0, 120))
    } else {
      ok(true, 'EXP行なし(記録0件のためスキップ)')
    }
    if (/best/.test(t2)) {
      ok(/best:\s/.test(t2), 'スコアが「best: 」形式', t2.slice(0, 120))
    } else {
      ok(true, 'スコア行なし(記録0件のためスキップ)')
    }
  }

  console.log('\n=== 7. 別名「順位」も同じものを返す ===')
  {
    const r2 = await simulate('順位')
    const m2 = r2.would_reply_with?.[0]
    ok(m2?.contents?.type === 'carousel', '「順位」でもカルーセルが返る', `${m2?.contents?.type}`)
    ok(
      (m2?.contents?.contents ?? []).length === (msg?.contents?.contents ?? []).length,
      '「順位」と「ランキング」で同じ枚数',
    )
  }

  console.log('\n=== 8. アイコンが無い人でも崩れない ===')
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

  console.log('\n=== 9. もっと見るページが表示できる ===')
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
