// ローカルサーバーに対する読み取り専用のランキング返信・リンク確認。
// DBを使った順位・デフォルト画像・所持衣装の回帰確認は tests/dressup/integration.test.mjs。
import assert from 'node:assert/strict'

const BASE = process.env.CHESS_TEST_BASE || 'http://localhost:3000'
const USER = 'Upf_test_rankcard_00000000000001'
let checks = 0
function check(condition, label) {
  assert.ok(condition, label)
  checks++
  console.log(`  ✅ ${label}`)
}
function nodes(node, out = []) {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => nodes(child, out))
    else if (value && typeof value === 'object') nodes(value, out)
  }
  return out
}
const texts = node => nodes(node).filter(n => n.type === 'text').map(n => n.text)

async function simulate(text) {
  const response = await fetch(`${BASE}/debug/simulate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, groupId: 'Cpf_test_rankcard', userId: USER }),
  })
  assert.equal(response.status, 200, 'debug/simulate')
  return (await response.json()).would_reply_with?.[0]
}

async function main() {
  const message = await simulate('ランキング')
  check(message?.type === 'flex' && message.contents?.type === 'carousel', 'ランキングはFlexカルーセル')
  const cards = message.contents.contents
  check(cards.length === 3, '個人・パズル・サバイバルの3枚')
  const expected = [
    ['葉っぱもちランキング', '/ranking/personal', /^Lv\.\d+ exp: [\d,]+$/],
    ['もち合体パズル', '/ranking/mochi', /^[\d,]+ 点 ・ [\d,]+ 回合体$/],
    ['もち軍団サバイバル', '/ranking/survivor', /^[\d,]+ pt ・ \d+:\d{2} 生存$/],
  ]
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const [title, path, scorePattern] = expected[i]
    const label = `${i + 1}枚目`
    check(card.size === 'kilo', `${label}: 見本と同じカード幅`)
    check(texts(card.header).includes(title) && texts(card.header).includes('1〜3位'), `${label}: タイトル・対象順位`)
    check(card.header.backgroundColor === '#039BE5' && card.footer.backgroundColor === '#039BE5', `${label}: 青い上下帯`)
    check(card.body.backgroundColor === '#E1F5FE', `${label}: 水色の本文`)
    check([card.header.height, card.body.height, card.footer.height].join('/') === '37px/267px/22px', `${label}: 3枚とも同じ高さ`)

    const [rowGroup, ownRank, more] = card.body.contents
    const rows = rowGroup.contents
    check(rowGroup.height === '178px' && rows.length >= 1 && rows.length <= 3, `${label}: 上位3人までの領域`)
    check(rows.every(r => r.backgroundColor === '#FFFFFF' && r.borderColor === '#BFE3EF' && r.borderWidth === '1px'), `${label}: 白い行と水色の細枠`)
    check(!texts(card).join(' ').includes('取得できませんでした'), `${label}: ランキング取得に成功`)
    for (const row of rows.filter(r => r.layout === 'horizontal')) {
      const [rank, avatar, details] = row.contents
      const rankNumber = Number(rank.contents[0].text)
      check(row.contents.length === 3 && row.height === '56px', `${label}: 順位・画像・名前の3列`)
      check(avatar.width === '44px' && avatar.height === '44px' && avatar.cornerRadius === '4px', `${label}: 角丸の正方形アイコン`)
      check(rank.contents[0].color === (['#D4AF37', '#949DA3', '#B87939'][rankNumber - 1] ?? '#6F858B'), `${label}: 金・銀・銅の順位`)
      check(details.contents[0].weight === 'bold' && details.contents[0].color === '#333333', `${label}: 太字の名前`)
      check(scorePattern.test(details.contents[1].text), `${label}: 名前の下にレベル・スコア`)
    }
    const ownText = texts(ownRank).join(' ')
    check(/^あなたの順位: [\d,]+位 \/ [\d,]+人$/.test(ownText) || ownText === 'まだ順位がついていません', `${label}: 自分の順位と参加人数`)
    check(more.action?.type === 'uri' && more.action.uri.endsWith(path), `${label}: もっと見るの移動先`)
    check(more.backgroundColor === '#039BE5' && more.height === '40px' && more.action.label === 'ランキングをもっと見る', `${label}: 見本の大きな青ボタン`)
    check(card.footer.paddingAll === '0px' && texts(card.footer)[0] === '© 2026 HappaMochi Bot', `${label}: 正式名の著作権帯`)
  }

  const allNodes = nodes(message.contents)
  const actions = allNodes.filter(n => n.action).map(n => n.action)
  check(actions.length === 3 && actions.every(a => a.type === 'uri' && a.uri.startsWith('https://')), 'URIボタン3つ、全てHTTPS')
  check(!actions.some(a => a.type === 'postback'), '見本にないステータスボタンを追加しない')
  const images = allNodes.filter(n => n.type === 'image')
  check(images.every(image => image.width === undefined && image.url.startsWith('https://')), 'LINE画像のプロパティとHTTPS')
  check(new TextEncoder().encode(JSON.stringify(message.contents)).length < 30000, 'Flexカルーセルは30KB未満')
  check(!JSON.stringify(message.contents).includes(USER), 'LINEユーザーIDを返信に含めない')
  const alias = await simulate('順位')
  check(alias?.contents?.type === 'carousel' && alias.contents.contents.length === 3, '別名「順位」も同じ3枚')

  for (const [, path] of expected) {
    const response = await fetch(`${BASE}${path}`)
    check(response.status === 200, `${path}は表示できる`)
  }
  console.log(`成功 ${checks}`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
