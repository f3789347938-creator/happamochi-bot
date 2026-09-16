// もち合体パズルのスコアランキングの自動テスト。
//
// 一番大事なのは「他人のスコアを勝手に登録できないこと」。
// クライアントは書き換えられる前提なので、curl から直接叩いて
// 突破できないかを確かめる。
//
// 検証の柱:
//   1. アクセストークン無しでは登録できない(誰でも登録できてはいけない)
//   2. 偽のトークンでは登録できない
//   3. リクエストに userId を入れても無視される(なりすまし不可)
//   4. ありえないスコアは拒否される
//   5. ランキングの読み取りはログイン不要で動く
//   6. 既存の機能・ページが壊れていない(回帰)
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

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* 本文がJSONでない場合もある */
  }
  return { status: res.status, body: json }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  let json = null
  try {
    json = await res.json()
  } catch {
    /* ignore */
  }
  return { status: res.status, body: json }
}

async function main() {
  console.log('=== 1. ログイン無しでは登録できない ===')
  {
    const r1 = await post('/api/mochi/score', { score: 999999, merges: 100, stage: 10 })
    ok(r1.status === 401, 'トークン無しは401で断る', `status=${r1.status}`)

    const r2 = await post('/api/mochi/score', {
      accessToken: '',
      score: 999999,
      merges: 100,
      stage: 10,
    })
    ok(r2.status === 401, '空のトークンは401で断る', `status=${r2.status}`)
  }

  console.log('\n=== 2. 偽のトークンでは登録できない ===')
  {
    const fakes = [
      ['適当な文字列', 'fake-token-12345'],
      ['JWTっぽい形', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJVMTIzIn0.aaaaaaaa'],
      ['長すぎる値', 'x'.repeat(5000)],
    ]
    for (const [label, token] of fakes) {
      const r = await post('/api/mochi/score', {
        accessToken: token,
        score: 500000,
        merges: 50,
        stage: 9,
      })
      ok(r.status === 401, `偽トークン(${label})は401で断る`, `status=${r.status}`)
    }
  }

  console.log('\n=== 3. userId を送りつけても無視される(なりすまし対策) ===')
  {
    // 攻撃者が他人のIDを指定して高得点を登録しようとする場合を再現する。
    const r = await post('/api/mochi/score', {
      accessToken: 'fake-token',
      userId: 'Uf0c013b5147413f2084ecc0ba99b0dfc',
      user_id: 'Uf0c013b5147413f2084ecc0ba99b0dfc',
      displayName: '管理者',
      score: 4999999,
      merges: 9999,
      stage: 10,
    })
    ok(r.status === 401, 'userIdを添えても認証が通らない', `status=${r.status}`)

    // 実際にDBへ書かれていないことを、ランキングから確認する
    const rank = await get('/api/mochi/ranking?limit=100')
    const names = (rank.body?.ranking ?? []).map((x) => x.name)
    ok(!names.includes('管理者'), '偽の名前がランキングに載っていない', JSON.stringify(names).slice(0, 200))
    const scores = (rank.body?.ranking ?? []).map((x) => x.score)
    ok(
      !scores.includes(4999999),
      '偽のスコアがランキングに載っていない',
      JSON.stringify(scores).slice(0, 200)
    )
  }

  console.log('\n=== 4. ありえない値は拒否される ===')
  {
    // 認証より先に値の検証をするので、トークンが偽でも400が返る。
    // (LINEへの問い合わせを無駄に増やさないため)
    const bad = [
      ['負のスコア', { score: -1, merges: 1, stage: 1 }],
      ['小数のスコア', { score: 1.5, merges: 1, stage: 1 }],
      ['文字列のスコア', { score: '999999', merges: 1, stage: 1 }],
      ['上限を超えるスコア', { score: 999999999, merges: 10, stage: 10 }],
      ['存在しない段階', { score: 100, merges: 1, stage: 99 }],
      ['合体0回で高得点', { score: 100000, merges: 0, stage: 5 }],
      ['スコアが無い', { merges: 1, stage: 1 }],
    ]
    for (const [label, payload] of bad) {
      const r = await post('/api/mochi/score', { accessToken: 'fake', ...payload })
      ok(r.status === 400, `${label}は400で断る`, `status=${r.status}`)
    }

    // 壊れたJSONでも500にならず400で返す
    const broken = await post('/api/mochi/score', '{not json')
    ok(broken.status === 400, '壊れたJSONは400で断る', `status=${broken.status}`)
  }

  console.log('\n=== 5. ランキングの読み取りはログイン不要で動く ===')
  {
    const r = await get('/api/mochi/ranking')
    ok(r.status === 200, 'ランキングは200で返る', `status=${r.status}`)
    ok(Array.isArray(r.body?.ranking), 'ranking が配列で返る', JSON.stringify(r.body).slice(0, 160))

    // 件数指定の範囲外でも落ちない
    for (const q of ['limit=0', 'limit=-5', 'limit=99999', 'limit=abc']) {
      const rr = await get(`/api/mochi/ranking?${q}`)
      ok(rr.status === 200, `?${q} でも200で返る`, `status=${rr.status}`)
    }

    // 本人の記録はログインが必要
    const me1 = await post('/api/mochi/me', {})
    ok(me1.status === 401, '本人の記録はトークン無しでは見られない', `status=${me1.status}`)
    const me2 = await post('/api/mochi/me', { accessToken: 'fake' })
    ok(me2.status === 401, '本人の記録は偽トークンでは見られない', `status=${me2.status}`)
  }

  console.log('\n=== 6. 既存のページ・機能が壊れていない(回帰) ===')
  {
    for (const [label, path] of [
      ['トップ', '/'],
      ['ランキング', '/ranking'],
      ['個人ランキング', '/ranking/personal'],
      ['掲示板', '/bbs'],
      ['ゲーム本体', '/static/game/'],
      ['ランキングJS', '/static/game/ranking.mjs'],
    ]) {
      const res = await fetch(`${BASE}${path}`)
      ok(res.status === 200, `${label} が200で返る`, `status=${res.status}`)
    }
  }

  console.log('\n=== 7. クライアントに秘密が混ざっていない ===')
  {
    // チャネルシークレットやアクセストークンが配信物に含まれていないこと。
    // 万一含まれると、誰でも他人になりすませてしまう。
    const files = ['/static/game/ranking.mjs', '/static/game/game.js', '/static/game/line-config.js']
    const SECRET = 'e0456fa75bcf90cda6d1af88e40bcc46'
    for (const f of files) {
      const text = await (await fetch(`${BASE}${f}`)).text()
      ok(!text.includes(SECRET), `${f} にチャネルシークレットが無い`)
      ok(
        !/LINE_CHANNEL_ACCESS_TOKEN|channel_secret|channelSecret/.test(text),
        `${f} にトークン類の記述が無い`
      )
    }
    // getProfile の結果をサーバーへ送っていないこと(送ると偽装できる)。
    // コメント中に「getProfileを呼ばない」と書いてあるのは問題ないので、
    // 実際の呼び出し(liff.getProfile(...) の形)が無いことを見る。
    const rk = await (await fetch(`${BASE}/static/game/ranking.mjs`)).text()
    const code = rk
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    ok(!/getProfile\s*\(/.test(code), 'ranking.mjs は getProfile を呼んでいない')
    ok(code.includes('getAccessToken'), 'ranking.mjs はアクセストークンを送っている')

    // game.js 側でもプロフィールをサーバーへ送っていないこと
    const gj = await (await fetch(`${BASE}/static/game/game.js`)).text()
    const gcode = gj
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    ok(!/getProfile\s*\(/.test(gcode), 'game.js も getProfile を呼んでいない')
  }

  console.log('\n=== 8. ランキング送信がゲームに繋がっている(実機で出た不具合) ===')
  // ranking.mjs は前から置いてあったのに、ゲーム本体を新版へ差し替えたときに
  // game.js からの呼び出しが消え、スコアが1件も保存されていなかった。
  // 「APIが動く」だけでなく「ゲームがそれを呼ぶ」ところまで必ず見る。
  {
    const gj = await (await fetch(`${BASE}/static/game/game.js`)).text()
    ok(/from '\.\/ranking\.mjs'/.test(gj), 'game.js が ranking.mjs を読み込んでいる')
    ok(/submitScore\s*\(/.test(gj), 'game.js が submitScore を呼んでいる')
    ok(/canSubmit\s*\(/.test(gj), 'LINE外では送らない判定をしている')
    // ゲーム終了(over)のところで送っていること
    // 呼び出しが「ゲーム終了(over)の分岐の中」にあることを確かめる。
    // 定義(async function ...)ではなく実際の呼び出し位置を見る。
    const overIdx = gj.indexOf("event.type === 'over'")
    const callIdx = gj.indexOf('sendScoreToRanking()', overIdx)
    ok(overIdx > 0 && callIdx > overIdx, 'ゲーム終了時に送信している', `over=${overIdx} call=${callIdx}`)
  }
  {
    const html = await (await fetch(`${BASE}/static/game/index.html`)).text()
    ok(/id="rank-status"/.test(html), '登録結果を出す場所が結果画面にある')
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
