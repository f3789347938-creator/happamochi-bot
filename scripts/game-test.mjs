// もち合体パズルの配信とスタート画面のテスト。
//
// 検証すること:
//   1. 全ファイルが配信できる(新規の effects.mjs / share.mjs を含む)
//   2. LIFF ID と shareUrl が設定されている
//   3. スタート画面のHTML・CSS・処理が入っている
//   4. タップするまで操作を受け付けない作りになっている
//   5. 既存Botのページに影響が無い
//
// ゲームのロジック自体は同梱の node --test（33件）で検証済み。
// ここでは「Botに載せた状態で正しく届くか」を見る。
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

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, text: res.ok ? await res.text() : '' }
}

async function main() {
  console.log('=== 1. ゲームのファイルが配信できる ===')
  const files = [
    '/static/game/',
    '/static/game/index.html',
    '/static/game/game.js',
    '/static/game/physics.mjs',
    '/static/game/effects.mjs',
    '/static/game/share.mjs',
    '/static/game/style.css',
    '/static/game/line-config.js',
    '/static/game/assets/mochi-atlas.png',
    '/static/game/assets/matter.min.js',
    '/static/game/favicon.svg',
  ]
  for (const f of files) {
    const r = await get(f)
    ok(r.status === 200, `${f} が配信できる`, `status=${r.status}`)
  }

  console.log('\n=== 2. LINEの設定 ===')
  {
    const r = await get('/static/game/line-config.js')
    ok(/liffId:\s*'2011492233-0cUBhY55'/.test(r.text), 'LIFF IDが設定されている')
    ok(/shareUrl:\s*'https:\/\/liff\.line\.me\//.test(r.text), 'シェア用URLがLIFF URLになっている')
    // 秘密情報が混ざっていないこと
    ok(!/channelSecret|accessToken|Bearer/i.test(r.text), 'チャネルシークレット等が入っていない')
  }

  console.log('\n=== 3. 11種類とスキルが入っている(差し替えの確認) ===')
  {
    const r = await get('/static/game/physics.mjs')
    for (const name of ['白もち', 'さくらもち', 'きなこもち', '葉っぱもち', '黒ごま', '紫いも', 'チョコ', 'みたらし', 'いちご大福', 'こんがり', '王様']) {
      ok(r.text.includes(name), `「${name}」がある`)
    }
    // スキル名は physics.mjs / effects.mjs 側に入っているので両方を見る
    const g = await get('/static/game/game.js')
    const e = await get('/static/game/effects.mjs')
    const all = r.text + g.text + e.text
    for (const skill of ['超合体', 'ボム', '進化']) {
      ok(all.includes(skill), `スキル「${skill}」が入っている`)
    }
    ok(/mochiPower|power|パワー/i.test(all), 'もちパワーの仕組みが入っている')
    const s = await get('/static/game/share.mjs')
    ok(s.text.length > 500, '結果シェアのモジュールが入っている')
  }

  console.log('\n=== 4. スタート画面 ===')
  {
    const h = await get('/static/game/index.html')
    ok(h.text.includes('id="start-screen"'), 'スタート画面の要素がある')
    ok(/id="start-screen"[^>]*hidden/.test(h.text), '初期状態では隠れている(準備完了後に出す)')
    ok(h.text.includes('タップしてはじめる'), '「タップしてはじめる」の文字がある')
    ok(h.text.includes('id="start-mochi"'), 'タイトルのおもちを描く場所がある')
    ok(h.text.includes('id="start-best"'), 'ベストスコアを出す場所がある')
    ok(/<button[^>]+id="start-screen"/.test(h.text), 'button要素なのでキーボードでも押せる')

    const c = await get('/static/game/style.css')
    ok(c.text.includes('.start-screen'), 'スタート画面のCSSがある')
    ok(/\.start-screen\{[^}]*position:absolute/.test(c.text), '盤面に重ねて表示する')
    ok(/prefers-reduced-motion[^}]*\}[\s\S]*start-mochi|start-mochi[\s\S]*prefers-reduced-motion/.test(c.text), '「動きを減らす」設定に配慮している')

    const g = await get('/static/game/game.js')
    ok(g.text.includes('function showStartScreen'), 'スタート画面を出す処理がある')
    ok(g.text.includes('function startGameFromScreen'), 'スタート画面から始める処理がある')
    ok(g.text.includes("$('#start-screen')?.addEventListener('click', startGameFromScreen)"), 'タップで始まるよう繋がっている')
    // ここが肝心: 準備完了時に ready を立てず、押されるまで待つ
    ok(
      !/ready = true; \$\('#loading'\)\.hidden = true/.test(g.text),
      '準備完了しただけでは操作を受け付けない(即プレイ開始にならない)'
    )
    ok(
      /startGameFromScreen\(\)[\s\S]{0,400}ready = true/.test(g.text),
      'タップした時に初めて操作を受け付ける'
    )
    ok(
      /showStartScreen\(\)[\s\S]{0,600}pause-button'\)\.disabled = true/.test(g.text),
      'スタート前は一時停止ボタンを押せない'
    )
  }

  console.log('\n=== 5. 既存Botへの影響 ===')
  {
    for (const p of ['/', '/ranking', '/ranking/personal', '/bbs', '/gallery']) {
      const r = await get(p)
      ok(r.status === 200, `${p} が今までどおり開ける`, `status=${r.status}`)
    }
    // メニューのゲームカードがLIFF URLを指している
    const res = await fetch(`${BASE}/debug/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'hm|n|M', groupId: 'Cmenu_test_grp1', userId: 'Umenu_test_alice_000000000000001' }),
    })
    const body = await res.json()
    const json = JSON.stringify(body.would_reply_with)
    ok(json.includes('liff.line.me/2011492233-0cUBhY55'), 'メニューのボタンがLIFF URLを指している')
  }

  console.log('\n=== 結果 ===')
  console.log(`  成功 ${pass} / 失敗 ${fail}`)
  if (failures.length > 0) {
    console.log('\n失敗した項目:')
    for (const f of failures) console.log(`  - ${f}`)
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
