// ヘルプメニュー(横スワイプのカルーセル + 案内画面)の自動テスト。
//
// 検証の柱:
//   1. `ヘルプ` でカルーセルが出る(文字の一覧は「全コマンド」から見られる)
//   2. 既存コマンドがすべて壊れていない(回帰)
//   3. ボタンを押すだけで状態が変わらない(対局開始・購入・装備を呼ばない)
//   4. 設定変更は確認をはさみ、他人・古い確認・連打で実行されない
//   5. 実装済みFlexが作り直されていない(既存の出力がそのまま返る)
//   6. 改ざんされたトークン・不正なページ番号が安全に扱われる
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

const G = 'Cmenu_test_grp1'
const A = 'Umenu_test_alice_000000000000001'
const B = 'Umenu_test_bob_00000000000000002'

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

// dm:true のときは groupId を送らない(JSONでは undefined が消えるため、
// キー自体を落とす必要がある)。個人トークの検証で使う。
async function menu(data, { group = G, user = A, dm = false } = {}) {
  const payload = dm ? { data, userId: user } : { data, groupId: group, userId: user }
  const res = await fetch(`${BASE}/debug/menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json() }
}

/** カード内の全テキストを平坦に集める(文言検査用) */
function texts(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const n of node) texts(n, out)
    return out
  }
  if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
  for (const k of Object.keys(node)) {
    if (k !== 'text') texts(node[k], out)
  }
  return out
}

/** カード内の全postbackデータを集める */
function datas(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const n of node) datas(n, out)
    return out
  }
  if (node.type === 'postback' && typeof node.data === 'string') out.push(node.data)
  for (const k of Object.keys(node)) datas(node[k], out)
  return out
}

/**
 * カードの「骨組み」を文字列化する。
 * text の中身と postback の data は除く(表示名やトークンは呼び出し元で
 * 変わるので、「既存Flexを作り直していないか」の判定には使えない)。
 * キーの並び・色・レイアウト・ボタン数はこれで比較できる。
 */
function structure(node) {
  const walk = (n) => {
    if (Array.isArray(n)) return n.map(walk)
    if (n && typeof n === 'object') {
      const out = {}
      for (const k of Object.keys(n).sort()) {
        if (k === 'text' || k === 'data' || k === 'altText' || k === 'uri' || k === 'url') {
          out[k] = '<v>'
        } else {
          out[k] = walk(n[k])
        }
      }
      return out
    }
    return n
  }
  return JSON.stringify(walk(node))
}

const first = (r) => (r.would_reply_with ?? [])[0]
const allText = (r) => texts(r.would_reply_with ?? []).join('\n')

async function main() {
  console.log('=== 1. ヘルプがコマンド一覧のカルーセルになる ===')
  {
    // 「ヘルプ」の出力は、押せるコマンド一覧のカルーセルに差し替えた。
    // 詳しい検証は scripts/help-card-test.mjs 側で行う。
    // ここでは入口が生きていることと、従来メニューが残っていることを見る。
    const r = await simulate('ヘルプ')
    const m = first(r)
    ok(m?.type === 'flex', 'ヘルプでFlexが返る', `type=${m?.type}`)
    ok(m?.contents?.type === 'carousel', 'カルーセル形式である', `${m?.contents?.type}`)
    ok((m?.contents?.contents?.length ?? 0) >= 2, 'カードが2枚以上ある', `${m?.contents?.contents?.length}`)
    const t = allText(r)
    ok(t.includes('葉っぱもち'), 'Bot名が入っている')
    ok(t.includes('© 2026 HappaMochi Bot'), 'フッターの著作権表記がある')
    // 英語の別名も残っている
    const r2 = await simulate('help')
    ok(first(r2)?.contents?.type === 'carousel', '既存の別名 help も同じものを出す')
  }

  console.log('\n=== 1b. 従来のカード型メニューが残っている ===')
  {
    // 案内画面の「戻る」から開く従来メニュー(hm|n|M)は消していない。
    const { status, body } = await menu('hm|n|M')
    const m = (body.would_reply_with ?? [])[0]
    ok(status === 200, '従来メニューのPostbackが動く', `status=${status}`)
    ok(m?.contents?.type === 'carousel', '従来メニューがカルーセルで返る', `${m?.contents?.type}`)
    ok(m?.contents?.contents?.length === 6, '従来メニューは6枚のまま', `${m?.contents?.contents?.length}`)
    const t = texts(body.would_reply_with ?? []).join('\n')
    for (const title of ['名言カード', 'ステータス', 'ゲーム', 'ランキング', 'グループ設定', 'ガイド']) {
      ok(t.includes(title), `従来メニューに「${title}」がある`)
    }
    ok(t.includes('01 / 06') && t.includes('06 / 06'), '従来メニューのページ番号が入っている')
  }

  console.log('\n=== 2. 全コマンド一覧が「ガイド → 全コマンド」から見られる ===')
  {
    const r = await menu('hm|n|H03')
    const t = texts(r.body.would_reply_with).join('\n')
    ok(t.includes('全コマンド'), '全コマンド画面が開ける')
    // 4ページすべてを開いて、主要コマンドが網羅されているか確認
    let allPages = ''
    for (let p = 1; p <= 4; p++) {
      const rp = await menu(`hm|n|H03:${p}`)
      allPages += texts(rp.body.would_reply_with).join('\n')
    }
    // 既存の別名を消していないことを確認(ページをまたいで探す)
    ok(allPages.includes('順位'), '別名「順位」が載っている')
    ok(allPages.includes('チェスヘルプ'), '別名「チェスヘルプ」が載っている')
    ok(allPages.includes('テスト'), '「テスト」コマンドが載っている')
    const must = [
      'ヘルプ', 'お知らせ', 'ランキング', 'ステータス', '着せ替え',
      '共通称号一覧', '共通称号装備', '共通称号確認', '称号検索',
      '称号一覧', '称号装備', '称号確認',
      'めいく', 'めいく装飾', 'bold', '虹', 'フォント',
      'オセロ開始', 'オセロ参加', 'オセロ終了', 'オセロ戦績',
      'チェス', '盤面', '誕生日登録', '誕生日登録解除',
      '取り消し通知オン', '取り消し通知オフ',
      'ウェルカムオン', 'ウェルカムオフ', 'ウェルカムメッセージ設定', 'ウェルカムメッセージ解除',
      'タグ追加', 'タグ削除', 'タグ一覧',
    ]
    const missing = must.filter((m) => !allPages.includes(m))
    ok(missing.length === 0, '全コマンドが4ページに網羅されている', `不足: ${missing.join(', ')}`)
    // ページ境界
    const p1 = await menu('hm|n|H03:1')
    const d1 = datas(p1.body.would_reply_with)
    ok(!d1.some((d) => d === 'hm|n|H03:0'), '1ページ目に「前へ」の有効リンクが無い')
    const p4 = await menu('hm|n|H03:4')
    const d4 = datas(p4.body.would_reply_with)
    ok(!d4.some((d) => d === 'hm|n|H03:5'), '最終ページに「次へ」の有効リンクが無い')
    const pOut = await menu('hm|n|H03:999')
    ok(
      texts(pOut.body.would_reply_with).join('').includes('4 / 4'),
      '範囲外のページ番号は最終ページに補正される'
    )
    const pNeg = await menu('hm|n|H03:-5')
    ok(
      texts(pNeg.body.would_reply_with).join('').includes('1 / 4'),
      '負のページ番号は1ページ目に補正される'
    )
  }

  console.log('\n=== 3. 既存の実装済みFlexが作り直されていない ===')
  {
    // ステータスを直接コマンドで出した結果と、メニュー経由の結果が一致するか
    const direct = await simulate('ステータス')
    const viaMenu = await menu('hm|x|ステータス')
    ok(viaMenu.body.ran_existing_command === 'ステータス', 'メニューから既存コマンドが呼ばれる')
    // 表示名はデブッグ端点ごとに固定値が違うので、そこを抜いて
    // カードの構造(キーと色・ボタンの並び)が同一かを見る。
    const a = structure(first(direct))
    const b = structure((viaMenu.body.would_reply_with ?? [])[0])
    ok(a === b, 'メニュー経由のステータスが既存出力と同一構造', `len ${a.length} vs ${b.length}`)
    // 新メニューのフッター文言を既存カードへ足していないか
    const st = texts(first(direct)).join('\n')
    ok(st.includes('© 2026 HappaMochi Bot'), '既存ステータスのフッターは元のまま存在する')

    for (const cmd of ['着せ替え', '共通称号一覧', '称号一覧', 'お知らせ', 'ランキング', 'タグ一覧', 'めいく装飾', 'チェス ヘルプ', 'オセロ戦績']) {
      const d = await simulate(cmd)
      const v = await menu(`hm|x|${cmd}`)
      const x = structure(d.would_reply_with ?? [])
      const y = structure(v.body.would_reply_with ?? [])
      ok(x === y, `「${cmd}」がメニュー経由でも既存と同一構造の出力`)
    }
  }

  console.log('\n=== 4. ボタンで状態を変えない ===')
  {
    // ゲームはボタンから始められる(押した人が対局したいと明示した操作)
    for (const [cmd, label] of [['オセロ開始', 'オセロ'], ['オセロ参加', 'オセロ参加'], ['チェス', 'チェス']]) {
      const r = await menu(`hm|x|${cmd}`)
      ok(
        r.body.ran_existing_command === cmd,
        `ボタンから「${label}」を始められる`,
        `ran=${r.body.ran_existing_command}`
      )
    }
    // メインメニューのゲームカードから直接始まる
    const main = await menu('hm|n|M')
    const mainDatas = datas(main.body.would_reply_with)
    ok(mainDatas.includes('hm|x|オセロ開始'), 'メニューのオセロボタンが「オセロ開始」を呼ぶ')
    ok(mainDatas.includes('hm|x|チェス'), 'メニューのチェスボタンが「チェス」を呼ぶ')
    // 遊び方は別ボタンとして残っている
    ok(mainDatas.includes('hm|n|G01'), '「遊び方」は別ボタンとして残っている')

    // もち合体パズル(LINEの中で開くWebゲーム)のリンク
    const uris = []
    const collectUris = (n) => {
      if (Array.isArray(n)) return n.forEach(collectUris)
      if (n && typeof n === 'object') {
        if (n.type === 'uri' && n.uri) uris.push(n.uri)
        Object.values(n).forEach(collectUris)
      }
    }
    collectUris(main.body.would_reply_with)
    ok(
      uris.some((u) => u.includes('/static/game/') || u.includes('liff.line.me')),
      'ゲームカードにもち合体パズルのリンクがある',
      uris.join(', ')
    )
    const g22 = await menu('hm|n|G22')
    const t22 = texts(g22.body.would_reply_with).join('\n')
    ok(t22.includes('もち合体パズル'), 'もち合体パズルの遊び方画面が開ける')
    ok(t22.includes('白') && t22.includes('こんがり'), '進化の順番が書かれている')
    ok(g22.body.ran_existing_command === null, '遊び方画面は既存コマンドを実行しない')

    // 対局の終了はボタンに置かない(他人が進行中の対局を消せてしまう)
    const endBtn = await menu('hm|x|オセロ終了')
    ok(
      endBtn.body.ran_existing_command === null,
      '「オセロ終了」はボタンからは実行されない',
      `ran=${endBtn.body.ran_existing_command}`
    )

    // 個人トークではゲームを始めない
    const dmGame = await menu('hm|x|オセロ開始', { dm: true })
    ok(
      dmGame.body.ran_existing_command === null,
      '個人トークではゲームを始めない',
      `ran=${dmGame.body.ran_existing_command}`
    )
    ok(
      texts(dmGame.body.would_reply_with).join('').includes('グループ'),
      '個人トークではグループで遊ぶよう案内する'
    )

    // ゲーム以外の状態変更はボタンから実行できない
    for (const bad of ['共通称号装備 夜型', '取り消し通知オフ', 'めいく:test', '誕生日登録 1/1', '称号装備 伝説の勇者', 'タグ追加 test', 'オセロ終了']) {
      const r = await menu(`hm|x|${bad}`)
      ok(
        r.body.ran_existing_command === null,
        `「${bad}」はボタンからは実行されない`,
        `ran=${r.body.ran_existing_command}`
      )
    }
    // メニュー画面のボタンに、状態を変える既存コマンドが仕込まれていないか
    const screens = ['M', 'Q01', 'Q02', 'Q06', 'Q07', 'Q08', 'G01', 'G20', 'G21', 'G22', 'R01', 'C01', 'C02', 'C03', 'C04', 'C05', 'H01', 'H03']
    // 完全一致で判定する。「チェス ヘルプ」は表示だけで安全なので、
    // 「チェス」の前方一致で巻き込んではいけない。
    // ゲームの開始・参加はボタンに載って良い(利用者が明示した操作)。
    // それ以外の状態変更が混ざっていないかを見る。
    const dangerous = new Set([
      'オセロ終了',
      '称号装備', '共通称号装備', '誕生日登録', '誕生日登録解除',
      'タグ追加', 'タグ削除', '取り消し通知オン', '取り消し通知オフ',
      'ウェルカムオン', 'ウェルカムオフ', 'ウェルカムメッセージ解除',
    ])
    let found = []
    for (const s of screens) {
      const r = await menu(`hm|n|${s}`)
      for (const d of datas(r.body.would_reply_with)) {
        if (d.startsWith('hm|x|')) {
          const cmd = d.slice(5)
          // 引数付き(めいく:〜 など)も弾く
          if (dangerous.has(cmd) || cmd.startsWith('めいく:') || cmd.startsWith('めいく：')) {
            found.push(`${s}:${cmd}`)
          }
        }
      }
    }
    ok(found.length === 0, '全画面のボタンに状態変更コマンドが無い', found.join(', '))
  }

  console.log('\n=== 5. 設定変更は確認をはさむ ===')
  {
    const before = await simulate('ヘルプ') // ウォームアップ
    const c = await menu('hm|c|unsend_off')
    const t = texts(c.body.would_reply_with).join('\n')
    ok(c.body.ran_existing_command === null, '確認カードの時点では実行しない')
    ok(t.includes('この内容で変更しますか'), '確認カードが出る')
    ok(t.includes('変更前') && t.includes('変更後'), '変更前と変更後を表示する')
    const ids = datas(c.body.would_reply_with).filter((d) => d.startsWith('hm|k|'))
    ok(ids.length === 1, '確認IDのボタンが1つある')
    const cid = ids[0]

    // 他人が押しても実行されない
    const other = await menu(cid, { user: B })
    ok(
      other.body.ran_existing_command === null,
      '他人が確認ボタンを押しても実行されない',
      `ran=${other.body.ran_existing_command}`
    )
    ok(
      texts(other.body.would_reply_with).join('').includes('ほかの方のもの'),
      '他人には案内が出る'
    )

    // 本人なら実行される
    const mine = await menu(cid, { user: A })
    ok(mine.body.ran_existing_command === '取り消し通知オフ', '本人が押すと既存コマンドが実行される')

    // 連打しても二重に実行されない
    const again = await menu(cid, { user: A })
    ok(
      again.body.ran_existing_command === null,
      '同じ確認を連打しても二重実行されない',
      `ran=${again.body.ran_existing_command}`
    )
    ok(
      texts(again.body.would_reply_with).join('').includes('使えなくなりました'),
      '使用済みの確認には案内が出る'
    )

    // 存在しない確認IDは実行されない
    const fake = await menu('hm|k|deadbeefdead')
    ok(fake.body.ran_existing_command === null, '存在しない確認IDでは実行されない')

    // 元に戻す(オンへ)
    const c2 = await menu('hm|c|unsend_on')
    const cid2 = datas(c2.body.would_reply_with).filter((d) => d.startsWith('hm|k|'))[0]
    const done2 = await menu(cid2)
    ok(done2.body.ran_existing_command === '取り消し通知オン', '設定を元に戻せた')

    // 許可されていない操作名
    const badOp = await menu('hm|c|delete_everything')
    ok(badOp.body.ran_existing_command === null, '許可リストに無い操作は確認すら作らない')
  }

  console.log('\n=== 6. グループ設定は個人トークでは変更させない ===')
  {
    const r = await menu('hm|c|welcome_on', { dm: true })
    ok(
      r.body.ran_existing_command === null,
      'DMではグループ設定の確認を作らない',
      `ran=${r.body.ran_existing_command}`
    )
    ok(
      texts(r.body.would_reply_with).join('').includes('グループのトークで'),
      'DMではグループで操作するよう案内する'
    )
    // 誕生日は個人の設定なのでDMでも確認できる
    const b = await menu('hm|c|birthday_off', { dm: true })
    const ids = datas(b.body.would_reply_with).filter((d) => d.startsWith('hm|k|'))
    ok(ids.length === 1, '誕生日の解除はDMでも確認できる（個人の設定）')
  }

  console.log('\n=== 7. 名言の装飾を選ぶ動線 ===')
  {
    const q01 = await menu('hm|n|Q01')
    const t = texts(q01.body.would_reply_with).join('\n')
    ok(t.includes('めいく:こんにちは'), '初期状態では装飾なしの例が出る')
    ok(t.includes('入力欄はありません'), 'Flex内に入力欄が無いと案内している')

    // 装飾を選ぶと例が変わる
    const bold = await menu('hm|q|bold')
    ok(
      texts(bold.body.would_reply_with).join('').includes('めいくbold:こんにちは'),
      'boldを選ぶと例が「めいくbold:こんにちは」になる'
    )
    // 色を選ぶと積み上がる
    const rainbow = await menu('hm|q|虹~bold')
    const tr = texts(rainbow.body.would_reply_with).join('')
    ok(tr.includes('めいくbold虹:こんにちは'), '色を足すと積み上がる')
    // フォントも足す
    const font = await menu('hm|q|7~bold,虹')
    ok(
      texts(font.body.would_reply_with).join('').includes('めいくbold虹7:こんにちは'),
      '仕様書の例「めいくbold虹7」を組み立てられる'
    )
    // 色は1つだけ(置き換わる)
    const twoColors = await menu('hm|q|赤~bold,虹,7')
    const t2 = texts(twoColors.body.would_reply_with).join('')
    ok(t2.includes('赤') && !t2.includes('虹:') , '色を選び直すと置き換わる（2色にならない）')
    // リセット
    const rst = await menu('hm|q|-~bold,虹,7')
    ok(
      texts(rst.body.would_reply_with).join('').includes('めいく:こんにちは'),
      '装飾をリセットできる'
    )
    // 知らないトークンは無視する(改ざん対策)
    const bad = await menu('hm|q|<script>~bold')
    const tb = texts(bad.body.would_reply_with).join('')
    ok(!tb.includes('<script>'), '知らない装飾値は捨てられる')
    ok(tb.includes('めいくbold:こんにちは'), '既存の選択は保たれる')

    // 選択が次の画面へ持ち回られる
    const carry = await menu('hm|n|Q02~bold,虹,7')
    ok(
      texts(carry.body.would_reply_with).join('').includes('bold虹7'),
      '選択状態が装飾メニューへ引き継がれる'
    )
    // 選択肢のページ送り
    const q04 = await menu('hm|n|Q04:1')
    ok(texts(q04.body.would_reply_with).join('').includes('1 / 3'), 'カラーは3ページに分かれる')
    const q04out = await menu('hm|n|Q04:99')
    ok(
      texts(q04out.body.would_reply_with).join('').includes('3 / 3'),
      'カラーの範囲外ページは補正される'
    )
    const q05 = await menu('hm|n|Q05:1')
    ok(texts(q05.body.would_reply_with).join('').includes('フォント 1'), 'フォント選択が出る')
  }

  console.log('\n=== 8. 画面遷移の健全性 ===')
  {
    // 全画面が開けて、ボタンのリンク先が実在する
    const ids = ['M', 'M01', 'Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08',
      'G01', 'G20', 'G21', 'G22', 'R01', 'C01', 'C02', 'C03', 'C04', 'C05', 'H01', 'H03']
    const broken = []
    const navTargets = new Set()
    for (const id of ids) {
      const r = await menu(`hm|n|${id}`)
      const m = (r.body.would_reply_with ?? [])[0]
      if (!m || m.type !== 'flex') broken.push(id)
      for (const d of datas(r.body.would_reply_with)) {
        if (d.startsWith('hm|n|')) {
          navTargets.add(d.slice(5).split('~')[0].split(':')[0])
        }
      }
    }
    ok(broken.length === 0, '全画面がFlexとして開ける', `開けない: ${broken.join(', ')}`)

    const dead = []
    for (const t of navTargets) {
      const r = await menu(`hm|n|${t}`)
      const txt = texts(r.body.would_reply_with).join('')
      if (txt.includes('開けませんでした')) dead.push(t)
    }
    ok(dead.length === 0, 'ボタンのリンク先がすべて実在する', `行き先なし: ${dead.join(', ')}`)

    // 未知の画面IDは安全に案内へ落ちる
    const unknown = await menu('hm|n|ZZZ')
    ok(
      texts(unknown.body.would_reply_with).join('').includes('開けませんでした'),
      '知らない画面IDは案内カードになる'
    )
    // 壊れたトークン
    for (const bad of ['hm|', 'hm|zzz|x', 'hm||', 'hm|n|', 'hm|k|', 'hm|x|', 'hm|c|']) {
      const r = await menu(bad)
      ok(
        (r.body.would_reply_with ?? []).length > 0 && r.body.ran_existing_command === null,
        `壊れたトークン「${bad}」でも安全に応答する`
      )
    }
  }

  console.log('\n=== 9. Flexの構造上の制約 ===')
  {
    const ids = ['M', 'Q01', 'Q04', 'C01', 'C04', 'H01', 'H03', 'G01']
    let maxBytes = 0
    let tooBig = []
    let badImage = []
    for (const id of ids) {
      const r = await menu(`hm|n|${id}`)
      const m = (r.body.would_reply_with ?? [])[0]
      const json = JSON.stringify(m?.contents ?? {})
      const bytes = Buffer.byteLength(json, 'utf8')
      maxBytes = Math.max(maxBytes, bytes)
      if (bytes > 30000) tooBig.push(`${id}:${bytes}`)
      // 以前チェスが実機で無反応になった原因(imageにwidthを指定)の再発防止
      if (/"type":"image"[^}]*"width"/.test(json)) badImage.push(id)
    }
    ok(tooBig.length === 0, `全カードが30,000バイト以内（最大 ${maxBytes}）`, tooBig.join(', '))
    ok(badImage.length === 0, 'imageにwidthを付けていない（実機400の再発防止）', badImage.join(', '))

    // 押せないボタンには action を付けていない
    const p1 = await menu('hm|n|H03:1')
    const json = JSON.stringify((p1.body.would_reply_with ?? [])[0])
    ok(!json.includes('"data":""'), '空のpostbackデータを送っていない')
  }

  console.log('\n=== 10. テスト用エンドポイントの保護 ===')
  {
    const r = await fetch(`${BASE}/debug/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'hm|n|M', userId: 'U_real_user_id', groupId: 'C_real_group' }),
    })
    ok(r.status === 403, '本番の利用者IDではデバッグ用エンドポイントが動かない', `status=${r.status}`)
  }

  console.log('\n=== 11. 既存機能の回帰 ===')
  {
    const cases = [
      ['テスト', 'テスト成功'],
      ['ランキング', null],
      ['順位', null],
      ['お知らせ', null],
      ['ステータス', null],
      ['着せ替え', null],
      ['共通称号一覧', null],
      ['共通称号確認', null],
      ['称号一覧', null],
      ['称号確認', null],
      ['称号検索 夜', null],
      ['タグ一覧', null],
      ['めいく装飾', null],
      ['チェス ヘルプ', null],
      ['チェスヘルプ', null],
      ['オセロ戦績', null],
      ['めいく:こんにちは', null],
    ]
    for (const [cmd, expect] of cases) {
      const r = await simulate(cmd)
      const msgs = r.would_reply_with ?? []
      const good = msgs.length > 0 && (!expect || JSON.stringify(msgs).includes(expect))
      ok(good, `既存コマンド「${cmd}」が動作する`, JSON.stringify(msgs).slice(0, 80))
    }
    // 署名検証が生きているか
    const body = JSON.stringify({ destination: 'test', events: [] })
    const bad = await fetch(`${BASE}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-line-signature': 'INVALID' },
      body,
    })
    ok(bad.status === 401, '不正署名のWebhookは401で拒否される', `status=${bad.status}`)
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
