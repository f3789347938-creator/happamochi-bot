import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const compiled = await build({
  stdin: {
    contents: 'export * from "./src/features/menu/casinoLink.ts"',
    resolveDir: new URL('../../', import.meta.url).pathname,
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22',
})
const { casinoMode, casinoOpenUrl, casinoLaunchUrl, buildCasinoCommand } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
)

test('casino launch only enables its own LIFF when configured and explicitly enabled', () => {
  assert.equal(casinoLaunchUrl({}, 'duel'), '/static/casino/?mode=duel')
  assert.equal(casinoLaunchUrl({ CASINO_LIFF_ID: '123-test' }, 'draw'), '/static/casino/?mode=draw')
  assert.equal(casinoLaunchUrl({ CASINO_ENABLED: 'true', CASINO_LIFF_ID: ' 123-test ' }, 'blackjack'), 'https://liff.line.me/123-test?mode=blackjack')
  assert.equal(casinoMode('duel'), 'duel')
  assert.equal(casinoMode('https://untrusted.example'), 'draw')
  assert.equal(casinoOpenUrl('https://bot.example/', 'draw'), 'https://bot.example/casino?mode=draw')
})

test('all casino launch commands offer three navigation-only actions', () => {
  for (const [command, first] of [['カジノ', 'draw'], ['ポーカー', 'draw'], ['上級ポーカー', 'duel'], ['ブラックジャック', 'blackjack']]) {
    const messages = buildCasinoCommand(command, 'https://bot.example')
    const actions = []
    function walk(value) {
      if (!value || typeof value !== 'object') return
      if (value.action) actions.push(value.action)
      Object.values(value).forEach(walk)
    }
    walk(messages)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].type, 'flex')
    assert.equal(actions.length, 3)
    assert.ok(actions.every(action => action.type === 'uri'))
    assert.equal(actions[0].uri, `https://bot.example/casino?mode=${first}`)
    assert.equal(new Set(actions.map(action => action.uri)).size, 3)
  }
  assert.equal(buildCasinoCommand('既存のコマンド', 'https://bot.example'), null)
  for (const key of ['constructor', 'toString', '__proto__']) {
    assert.equal(buildCasinoCommand(key, 'https://bot.example'), null)
  }
})
