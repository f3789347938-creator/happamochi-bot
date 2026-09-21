// Pure native-Flex render regression coverage; no credentials or LINE sends.
// Run: node --test tests/login-bonus/flex.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'

// This renderer imports types only. Transforming the real source in memory
// avoids bundling the rest of the application or creating a generated fixture.
const source = readFileSync(new URL('../../src/features/loginBonus/flex.ts', import.meta.url), 'utf8')
const built = await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })
const { buildLoginBonusCard } = await import(`data:text/javascript;base64,${Buffer.from(built.code).toString('base64')}`)

const sample = {
  claimed: true, day: '2026-09-22', totalDays: 5, streakDays: 5,
  rewardDays: 5, rewardPoints: 2500, balance: 4123,
}
function nodes(value) {
  if (!value || typeof value !== 'object') return []
  return [value, ...Object.values(value).flatMap(nodes)]
}
const texts = value => nodes(value).filter(node => node.type === 'text').map(node => node.text)

function assertReadableNativeCard(message) {
  assert.equal(message.type, 'flex')
  assert.equal(message.contents.type, 'bubble', 'the reference contains one complete login card, not a cropped second card')
  assert.equal(message.contents.size, 'kilo', 'retain the compact native card width')
  assert.ok(Buffer.byteLength(JSON.stringify(message.contents)) < 30_000)
  assert.ok(message.altText.length <= 1500)
  const visit = (node, ancestors = []) => {
    if (!node || typeof node !== 'object') return
    assert.notEqual(node.type, 'image', 'login information remains readable native text')
    assert.equal(node.minHeight, undefined, 'do not introduce unsupported Flex Box minHeight')
    if (node.type === 'text') {
      assert.equal(node.wrap, true, 'larger LINE fonts and longer counts can wrap')
      assert.equal(node.scaling, true)
      assert.equal(node.maxLines, undefined, 'do not truncate reward information')
      for (const ancestor of [...ancestors, node]) {
        assert.equal(ancestor.height, undefined, 'text cannot sit inside a fixed-height box')
        assert.equal(ancestor.maxHeight, undefined, 'text cannot sit inside a capped-height box')
        assert.notEqual(ancestor.position, 'absolute', 'text remains in normal flow')
      }
    }
    for (const child of node.contents ?? []) visit(child, [...ancestors, node])
    for (const key of ['header', 'body', 'footer']) if (node[key]) visit(node[key], [...ancestors, node])
  }
  visit(message.contents)
}

test('successful claim reproduces the login summary, receipt and working status action as a compact native card', () => {
  const message = buildLoginBonusCard(sample)
  assertReadableNativeCard(message)
  assert.deepEqual(texts(message), [
    'ログインボーナス', '今日も来てくれてありがとう！',
    '合計ログイン', '5日', '連続ログイン', '5日', '2,500ポイント',
    '連続5日分 ×500', '連続ログインは7日分まで増えるよ',
    'ステータスを確認する', '© 2026 HappaMochi Bot',
  ])
  const bubble = message.contents
  assert.equal(bubble.header.backgroundColor, bubble.footer.backgroundColor)
  assert.equal(bubble.body.backgroundColor, '#E4F7FF')
  const panel = bubble.body.contents[0]
  assert.equal(panel.backgroundColor, '#FFFFFF')
  assert.ok(panel.cornerRadius)
  assert.equal(nodes(panel).filter(node => node.type === 'separator').length, 2)
  const stats = nodes(panel).filter(node => node.type === 'box' && node.layout === 'baseline')
  assert.equal(stats.length, 2)
  for (const row of stats) {
    assert.equal(row.contents[1].align, 'end')
    assert.equal(row.contents[1].color, bubble.header.backgroundColor)
  }
  const reward = nodes(panel).find(node => node.text === '2,500ポイント')
  assert.equal(reward.weight, 'bold')
  assert.equal(reward.color, bubble.header.backgroundColor)
  const actions = nodes(message).filter(node => node.type === 'postback' || node.type === 'message')
  assert.deepEqual(actions, [{ type: 'postback', label: 'ステータスを確認する', data: 'pf|status' }])
  assert.match(message.altText, /2,500ポイントを受け取りました/)
  assert.match(message.altText, /4,123/)
});

test('a repeated claim clearly reports an existing receipt instead of another award', () => {
  const message = buildLoginBonusCard({ ...sample, claimed: false })
  assertReadableNativeCard(message)
  assert.ok(texts(message).includes(`${sample.day.replaceAll('-', '/')}分は受け取り済み`))
  assert.ok(!texts(message).includes('今日も来てくれてありがとう！'))
  assert.match(message.altText, /分は受け取り済み/)
  assert.doesNotMatch(message.altText, /を受け取りました/)
  assert.ok(texts(message).includes('2,500ポイント'), 'the existing receipt amount remains visible')
  assert.equal(nodes(message).filter(node => node.type === 'postback').length, 1)
});

test('a streak above the seven-day reward cap shows the actual streak and the capped award separately', () => {
  const message = buildLoginBonusCard({ ...sample, totalDays: 25, streakDays: 12, rewardDays: 7, rewardPoints: 3500 })
  assertReadableNativeCard(message)
  for (const value of ['25日', '12日', '3,500ポイント', '連続7日分 ×500']) assert.ok(texts(message).includes(value))
  assert.ok(!texts(message).includes('連続12日分 ×500'), 'reward calculation must not imply an uncapped payout')
});

test('a first-day award and large historical totals remain complete without extra layout or announcements', () => {
  const first = buildLoginBonusCard({ ...sample, totalDays: 1, streakDays: 1, rewardDays: 1, rewardPoints: 500, balance: 500 })
  const large = buildLoginBonusCard({ ...sample, totalDays: 1234567, streakDays: 12345, rewardDays: 7, rewardPoints: 3500, balance: 987654321 })
  for (const message of [first, large]) assertReadableNativeCard(message)
  assert.ok(texts(first).includes('500ポイント'))
  assert.ok(texts(first).includes('連続1日分 ×500'))
  assert.ok(texts(large).includes('1,234,567日'))
  assert.ok(texts(large).includes('12,345日'))
  assert.match(large.altText, /987,654,321/)
  assert.equal(nodes(large).some(node => node.type === 'carousel'), false)
  assert.equal(nodes(large).some(node => node.type === 'uri'), false)
});
