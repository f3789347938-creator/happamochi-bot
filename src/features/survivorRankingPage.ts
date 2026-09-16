// もち軍団サバイバルのランキング公開ページ。
// 「ランキング」コマンドの3枚目のカードから飛ぶ先。
//
// もち合体パズルのページ(mochiRankingPage.ts)と同じ見た目・同じCSSクラスを
// 使い回す。新しいCSSは足さない。
import { renderWithLayout } from './bbs'
import { getSurvivorRanking } from './survivor'
import type { LineEnv } from '../lib/line'

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const num = (n: number) => Math.floor(n).toLocaleString('ja-JP')

/** 秒を 00:00 形式にする */
const mmss = (sec: number) => {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export async function renderSurvivorRankingPage(env: LineEnv, siteUrl: string): Promise<string> {
  let rows: Awaited<ReturnType<typeof getSurvivorRanking>> = []
  try {
    rows = await getSurvivorRanking(env, 100)
  } catch {
    rows = []
  }

  const items = rows
    .map((r, i) => {
      const rank = i + 1
      const name = esc(r.display_name ?? '名前なし')
      const pic = r.picture_url && r.picture_url.startsWith('https://') ? r.picture_url : null
      const avatar = pic
        ? `<img class="pf-rank-avatar" src="${esc(pic)}" alt="" width="48" height="48" loading="lazy" referrerpolicy="no-referrer">`
        : `<span class="pf-rank-avatar pf-rank-avatar-none" aria-hidden="true">${esc(
            Array.from((r.display_name ?? '?').trim() || '?')[0] ?? '?'
          )}</span>`
      const medal = rank <= 3 ? ` pf-rank-top pf-rank-top${rank}` : ''
      return `
      <li class="pf-rank-item${medal}">
        <span class="pf-rank-no">${rank}<small>位</small></span>
        ${avatar}
        <span class="pf-rank-name">${name}</span>
        <span class="pf-rank-lv">${mmss(r.best_seconds)} 生存</span>
        <span class="pf-rank-exp">${num(r.best_score)} 点</span>
      </li>`
    })
    .join('')

  const body = `
  <section class="pf-hero" id="survivor-ranking-hero">
    <h1 class="pf-hero-title">もち軍団サバイバル ランキング</h1>
    <p class="pf-hero-sub">自己ベストの高い順です。全${num(rows.length)}人${
      rows.length >= 100 ? '（上位100人まで表示）' : ''
    }。</p>
    <p class="pf-hero-links">
      <a class="pf-pager-btn" href="/ranking/mochi">もち合体パズルへ</a>
      <a class="pf-pager-btn" href="/ranking/personal">個人ランキングへ</a>
    </p>
  </section>

  <section class="pf-section" id="survivor-ranking-list">
    ${
      rows.length === 0
        ? `<p class="pf-empty">まだ記録がありません。LINEで「サバイバル」と送ると遊べます。</p>`
        : `<ol class="pf-rank-list">${items}</ol>`
    }
  </section>

  <section class="pf-section" id="survivor-ranking-about">
    <h2 class="pf-h2">集計と公開について</h2>
    <ul class="pf-notes">
      <li>倒れると、その回の戦績が自動で登録されます。</li>
      <li>残るのは自己ベストだけです。低い記録で上書きされることはありません。</li>
      <li>LINEの中でゲームを開いたときだけ登録されます。ふつうのブラウザで遊んだ場合は記録されません。</li>
      <li>公開しているのは、表示名・アイコン・スコア・生存時間だけです。</li>
      <li>送られてきた戦績は、生存時間から計算した上限と照らし合わせてから保存しています。
          ありえない値は受け付けません。</li>
    </ul>
  </section>`

  return renderWithLayout(
    {
      title: 'もち軍団サバイバル ランキング | 葉っぱもち Bot',
      description: 'もち軍団サバイバルのスコアランキング。自己ベストの高い順に並んでいます。',
      canonical: `${siteUrl}/ranking/survivor`,
    },
    body,
    'ranking'
  )
}
