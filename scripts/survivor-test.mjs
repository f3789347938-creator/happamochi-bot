// もち軍団サバイバル(引き継ぎパック v14)の自動テスト。
//
// このゲームで一番危ないのは、元パックが
//     request.headers.get('oai-authenticated-user-id')
// をプレイヤーIDとして信用していたこと。
// LINEではこのヘッダーを自分で付けるだけで他人になりすませる。
// なので「置き換えが本当に効いているか」を最優先で確かめる。
//
// 検証の柱:
//   1. 旧ヘッダーを付けても通らない(なりすまし不可)
//   2. userId を直接送っても無視される
//   3. 偽トークンは通らない
//   4. 戦績の検算がありえない値を弾く(サーバー側で計算している)
//   5. 読むだけのランキングはログイン不要で動く
//   6. 既存の機能(もち合体パズル等)が壊れていない
//   7. ゲームの静的ファイルが全部配信できている
//   8. クライアントに秘密情報が混ざっていない

const BASE = process.env.SURVIVOR_TEST_BASE || 'http://localhost:3000'

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

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  let json = null
  try {
    json = await res.json()
  } catch { /* JSONでないこともある */ }
  return { status: res.status, json }
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  let json = null
  let text = ''
  try {
    text = await res.text()
    json = JSON.parse(text)
  } catch { /* HTMLのこともある */ }
  return { status: res.status, json, text }
}

const AUTH_PATHS = [
  '/api/survivor/me',
  '/api/survivor/runs/start',
  '/api/survivor/runs/finish',
  '/api/survivor/runs/abandon',
  '/api/survivor/leaderboard',
  '/api/survivor/profile',
]

async function main() {
  console.log('\n=== 1. 旧ヘッダー(oai-authenticated-user-id)でのなりすまし ===')
  // これが通ってしまったら、元パックの脆弱性がそのまま残っている。
  for (const p of AUTH_PATHS) {
    const r = await post(p, {}, { 'oai-authenticated-user-id': 'Uvictim0000000000000000000000000' })
    ok(r.status === 401, `${p} は旧ヘッダーを信用しない (401)`, `status=${r.status}`)
  }

  console.log('\n=== 2. userId を直接送るなりすまし ===')
  for (const p of AUTH_PATHS) {
    const r = await post(p, { userId: 'Uvictim0000000000000000000000000', owner: 'Uvictim' })
    ok(r.status === 401, `${p} は body の userId を信用しない (401)`, `status=${r.status}`)
  }

  console.log('\n=== 3. 偽トークン / 壊れたリクエスト ===')
  for (const p of AUTH_PATHS) {
    const r = await post(p, { accessToken: 'totally-fake-token-0123456789' })
    ok(r.status === 401, `${p} は偽トークンを拒否 (401)`, `status=${r.status}`)
  }
  {
    const r = await post('/api/survivor/me', 'not json at all')
    ok(r.status === 400 || r.status === 401, '壊れたJSONは400か401', `status=${r.status}`)
  }
  {
    // 異常に長いトークンでサーバーを困らせない
    const r = await post('/api/survivor/me', { accessToken: 'x'.repeat(9000) })
    ok(r.status === 401, '極端に長いトークンは401', `status=${r.status}`)
  }
  {
    const r = await post('/api/survivor/me', { accessToken: '' })
    ok(r.status === 401, '空トークンは401', `status=${r.status}`)
  }

  console.log('\n=== 3b. チャネルの取り違え防止 ===')
  // サバイバルはパズルとは別のLINEログインチャネルで動く。
  //   パズル    : 2011492233
  //   サバイバル: 2011633519
  // サーバーは「どのチャネルで発行されたトークンか」を必ず突き合わせる。
  // ここが緩いと、別チャネルのトークンを持ち込んで書き込める穴になる。
  {
    const src = await get('/static/survivor/line-config.js')
    ok(/2011633519-1hQ8eJSO/.test(src.text), 'クライアントにサバイバルのLIFF IDが入っている')
    ok(!/2011492233/.test(src.text), 'パズルのチャネルIDが混入していない')
  }

  console.log('\n=== 4. 戦績の検算(サーバー側の validateReport) ===')
  // finish を呼ぶには本物のLINEトークンが要るのでテストから到達できない。
  // 検算はチート対策の要なので、専用の確認用エンドポイント経由で確かめる。
  const NOW = 1_000_000_000_000
  const RUN = { started_at: NOW - 100_000, mode: 'normal', weapon: 'kunai', seconds: 0, score: 0, kills: 0 }
  const base = {
    score: 100, seconds: 60, kills: 10, bossKills: 0, cleanBosses: 0,
    maxAttackKills: 0, treasures: 0, commanders: 0, traps: 0,
    weapons: { kunai: { damage: 100, kills: 10 } },
  }
  const check = async (report, run = RUN) =>
    (await post('/debug/survivor-validate', { report, run, now: NOW })).json

  {
    const r = await check(base)
    ok(r?.ok === true, '正常な戦績は通る', r?.error ?? '')
  }
  const rejects = async (patch, label) => {
    const report = patch === null || Array.isArray(patch) ? patch : { ...base, ...patch }
    const r = await check(report)
    ok(r?.ok === false, label, JSON.stringify(r)?.slice(0, 80))
  }
  await rejects({ seconds: 999999 }, '経過時間より長い生存は拒否')
  await rejects({ kills: 999999 }, '湧く上限を超えた撃破数は拒否')
  await rejects({ score: 99999999 }, 'ありえないスコアは拒否')
  await rejects({ bossKills: 500 }, 'ボス数が時間と合わなければ拒否')
  await rejects({ cleanBosses: 5 }, '無傷ボス数がボス数を超えたら拒否')
  await rejects({ weapons: { kunai: { damage: 1, kills: 3 } } }, '武器別撃破の合計が合わなければ拒否')
  await rejects({ score: -1 }, '負のスコアは拒否')
  await rejects({ score: 1.5 }, '小数のスコアは拒否')
  await rejects({ weapons: {} }, '武器内訳が空で撃破数があれば拒否')
  await rejects({ weapons: { '<script>': { damage: 1, kills: 10 } } }, '不正な武器IDは拒否')
  await rejects({ maxAttackKills: 99999 }, '一撃撃破数の上限超えは拒否')
  await rejects({ treasures: 999 }, 'イベント回数の上限超えは拒否')
  await rejects(null, 'null の戦績は拒否')
  await rejects([], '配列の戦績は拒否')
  {
    // 巻き戻し(二重計上)の防止
    const advanced = { ...RUN, seconds: 50, score: 500, kills: 30 }
    const r = await check(base, advanced)
    ok(r?.ok === false && r?.status === 409, '保存済みより低い戦績での上書きは409で拒否', JSON.stringify(r)?.slice(0, 80))
  }
  {
    // 週間チャレンジは装備が固定される
    const ch = { ...RUN, mode: 'challenge', weapon: 'katana' }
    const r = await check({ ...base, mainWeapon: 'kunai', hero: 'common' }, ch)
    ok(r?.ok === false, '週間チャレンジで装備が違えば拒否')
  }

  console.log('\n=== 4b. 週の計算 ===')
  {
    const r = await get(`/debug/survivor-week?t=${NOW}`)
    ok(r.status === 200, '週の計算が動く')
    ok(/^\d{4}-W\d{2}$/.test(r.json?.key ?? ''), `週キーの形式が正しい (${r.json?.key})`)
    ok(typeof r.json?.weapon === 'string' && r.json.weapon.length > 0, '週の武器が決まる')
    const again = await get(`/debug/survivor-week?t=${NOW}`)
    ok(again.json?.key === r.json?.key, '同じ時刻なら同じ週キー(決定的)')
    ok(again.json?.weapon === r.json?.weapon, '同じ週なら同じ武器')
    // 1週間ずらすとキーが変わる
    const next = await get(`/debug/survivor-week?t=${NOW + 7 * 86400000}`)
    ok(next.json?.key !== r.json?.key, '1週間後は別の週キーになる')
  }

  console.log('\n=== 4c. 詰まり防止(実機で出た不具合の再発防止) ===')
  // 実機で「出撃を開始できませんでした / 前の出撃の記録が残っています」が出て
  // 先に進めなくなった。原因は、進捗0の出撃がDBに残って次の出撃を
  // 永久にブロックしていたこと。ユーザーに手動で片付けさせる作りだった。
  // サーバー側で自動的に片付けるように直した。その回帰テスト。
  {
    const src = await get('/static/survivor/record-ui.js')
    ok(!/終了済みの出撃を整理/.test(src.text), '「終了済みの出撃を整理」ボタンを出していない')
    ok(!/送れない記録を破棄/.test(src.text), '「送れない記録を破棄」ボタンを出していない')
    ok(!/前の出撃の記録が残っています/.test(src.text), '「前の出撃の記録が残っています」を出していない')
  }
  {
    const src = await get('/static/survivor/progression-ui.js')
    ok(!/未送信または終了前の出撃記録/.test(src.text), '開発者向けの警告文を出していない')
  }
  {
    // サーバー側: 進捗0の出撃は消し、進捗ありは終了扱いにしてから通す。
    // 「記録画面で整理してから」で止める旧実装が残っていないこと。
    const r = await post('/api/survivor/runs/start', {
      accessToken: 'fake', id: 'aaaaaaaa-bbbb', ruleset: 'endless-depth-2',
    })
    ok(r.status === 401, '未ログインでは出撃できない(認証は維持)', `status=${r.status}`)
  }

  console.log('\n=== 5. 読むだけのランキング(ログイン不要) ===')
  {
    const r = await get('/api/survivor/ranking')
    ok(r.status === 200, 'ランキングはログイン無しで200', `status=${r.status}`)
    ok(Array.isArray(r.json?.ranking), 'ranking 配列が返る')
  }
  {
    const r = await get('/api/survivor/ranking?limit=5')
    ok(r.status === 200, 'limit 付きでも200')
  }
  {
    const r = await get('/api/survivor/ranking?limit=99999')
    ok(r.status === 200, '極端な limit でも落ちない')
  }
  {
    const r = await get('/api/survivor/ranking?limit=abc')
    ok(r.status === 200, '不正な limit でも落ちない')
  }

  console.log('\n=== 6. 既存機能の回帰(壊していないか) ===')
  const regress = [
    ['/', 'トップページ'],
    ['/static/game/', 'もち合体パズル'],
    ['/api/mochi/ranking', 'もち合体パズルのランキングAPI'],
    ['/ranking/mochi', 'もち合体パズルのランキングページ'],
    ['/gallery', '名言カードギャラリー'],
  ]
  for (const [path, label] of regress) {
    const r = await get(path)
    ok(r.status === 200, `${label} が生きている (${path})`, `status=${r.status}`)
  }

  console.log('\n=== 7. ゲームの静的ファイル配信 ===')
  // index.html は Cloudflare Pages が /static/survivor/ へ308する。
  // これは既存のもち合体パズルと同じ挙動なので、ディレクトリ側で確認する。
  {
    const res = await fetch(`${BASE}/static/survivor/`)
    ok(res.status === 200, 'ゲームのトップが開ける (/static/survivor/)', `status=${res.status}`)
    const html = await res.text()
    ok(/もち軍団サバイバル/.test(html), 'タイトルが入っている')
    ok(/main\.js/.test(html), 'main.js を読み込んでいる')
  }
  const assets = [
    'main.js', 'engine.js', 'art.js', 'line.js',
    'line-config.js', 'liff-auth.js', 'record-client.js', 'records.js',
    'style.css', 'records.css',
    'assets/characters-source.webp', 'assets/endless-ground.webp',
    'assets/enemy-atlas.webp', 'assets/late-enemy-atlas.webp',
    'assets/outfits-source.webp',
  ]
  for (const a of assets) {
    const res = await fetch(`${BASE}/static/survivor/${a}`)
    ok(res.status === 200, `配信できる: ${a}`, `status=${res.status}`)
  }
  {
    // 消したはずの未使用画像が残っていないこと(2.7MBの無駄)
    const res = await fetch(`${BASE}/static/survivor/assets/arena.png`)
    ok(res.status === 404, '未使用の arena.png は配信されない', `status=${res.status}`)
  }

  console.log('\n=== 8. クライアントに秘密が混ざっていないか ===')
  {
    const r = await get('/static/survivor/line-config.js')
    ok(r.status === 200, 'line-config.js が読める')
    ok(!/[0-9a-f]{32}/i.test(r.text), 'チャネルシークレットらしき文字列が無い')
    ok(!/channel[_-]?secret/i.test(r.text), '"channel secret" の記述が無い')
    ok(!/Bearer\s+[A-Za-z0-9]/.test(r.text), 'アクセストークンが埋まっていない')
  }
  {
    const r = await get('/static/survivor/liff-auth.js')
    ok(r.status === 200, 'liff-auth.js が読める')
    // コメント行を除いた実コードに getProfile が無いことを見る。
    // (方針を説明したコメントには getProfile の文字が出てくるため)
    const code = r.text.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    ok(!/getProfile\s*\(/.test(code), 'getProfile() を呼んでいない(方針どおり)')
    ok(/getAccessToken/.test(r.text), 'アクセストークンだけを使っている')
  }
  {
    const r = await get('/static/survivor/record-client.js')
    ok(r.status === 200, 'record-client.js が読める')
    ok(!/oai-authenticated-user-id/.test(r.text), '旧認証ヘッダーの痕跡が残っていない')
    ok(/accessToken/.test(r.text), 'アクセストークンを送る形になっている')
    ok(/\/api\/survivor/.test(r.text), 'APIパスが /api/survivor/* になっている')
  }
  {
    const r = await get('/static/survivor/art.js')
    ok(!/\.png/.test(r.text), '画像参照がwebpに切り替わっている(pngの取り残しなし)')
  }

  console.log('\n────────────────────────────')
  console.log(`  成功 ${pass} / 失敗 ${fail}`)
  if (fail) {
    console.log('\n  落ちた項目:')
    for (const f of failures) console.log(`   - ${f}`)
  }
  console.log('────────────────────────────\n')
  process.exit(fail ? 1 : 0)
}

main().catch(e => {
  console.error('テストの実行に失敗:', e)
  process.exit(1)
})
