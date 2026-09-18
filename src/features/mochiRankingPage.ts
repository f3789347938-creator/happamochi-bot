// もち合体パズルのスコアランキングの公開ページ。
// 「ランキング」コマンドのカードにある「ランキングをもっと見る」の行き先。
//
// 既存の個人ランキングページ(profile/page.ts)と同じ見た目・同じCSSクラスを
// 使い回す。新しいCSSは足さない(見た目を揃えるため)。
import { renderWithLayout } from './bbs'
import { getRanking } from './mochiScore'
import { getRankingIconsByUserIds, rankingIconUrl } from './rankingIcon'
import type { LineEnv } from '../lib/line'

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const num = (n: number) => n.toLocaleString('ja-JP')

export async function renderMochiRankingPage(env: LineEnv, siteUrl: string): Promise<string> {
  let rows: Awaited<ReturnType<typeof getRanking>> = []
  try {
    rows = await getRanking(env, 100)
  } catch {
    rows = []
  }

  const icons = await getRankingIconsByUserIds(env, rows.map((r) => r.user_id))
  const items = rows
    .map((r, i) => {
      const rank = i + 1
      const name = esc(r.display_name ?? '名前なし')
      // アイコンは https のものだけ出す(壊れた画像を並べない)
      const icon = icons[r.user_id]
      const pic = rankingIconUrl(siteUrl, icon, r.picture_url)
      const avatar = pic
        ? `<img class="pf-rank-avatar" style="object-fit:${icon?.costumeId ? 'contain' : 'cover'};border-radius:5px" src="${esc(pic)}" alt="" width="48" height="48" loading="lazy" referrerpolicy="no-referrer">`
        : `<span class="pf-rank-avatar pf-rank-avatar-none" aria-hidden="true">${esc(
            Array.from((r.display_name ?? '?').trim() || '?')[0] ?? '?'
          )}</span>`
      const medal = rank <= 3 ? ` pf-rank-top pf-rank-top${rank}` : ''
      return `
      <li class="pf-rank-item${medal}">
        <span class="pf-rank-no">${rank}<small>位</small></span>
        ${avatar}
        <span class="pf-rank-name">${name}</span>
        <span class="pf-rank-lv">${num(r.best_merges)}回合体</span>
        <span class="pf-rank-exp">${num(r.best_score)} 点</span>
      </li>`
    })
    .join('')

  const body = `
  <section class="pf-hero" id="mochi-ranking-hero">
    <h1 class="pf-hero-title">もち合体パズル ランキング</h1>
    <p class="pf-hero-sub">自己ベストの高い順です。全${num(rows.length)}人${
      rows.length >= 100 ? '（上位100人まで表示）' : ''
    }。</p>
    <p class="pf-hero-links">
      <a class="pf-pager-btn" href="/ranking/personal">個人ランキングへ</a>
      <a class="pf-pager-btn" href="/ranking">グループ別ランキングへ</a>
    </p>
  </section>

  <section class="pf-section" id="mochi-ranking-list">
    ${
      rows.length === 0
        ? `<p class="pf-empty">まだ記録がありません。LINEで「ヘルプ」と送り、ゲームのカードから遊べます。</p>`
        : `<ol class="pf-rank-list">${items}</ol>`
    }
  </section>

  <section class="pf-section" id="mochi-ranking-about">
    <h2 class="pf-h2">集計と公開について</h2>
    <ul class="pf-notes">
      <li>ゲームが終わると、その回のスコアが自動で登録されます。</li>
      <li>残るのは自己ベストだけです。低いスコアで上書きされることはありません。</li>
      <li>0点（1回も合体していない）は登録されません。</li>
      <li>LINEの中でゲームを開いたときだけ登録されます。ふつうのブラウザで遊んだ場合は記録されません。</li>
      <li>公開しているのは、表示名・アイコン・スコア・合体回数だけです。</li>
      <li>スコアは、送られてきた値をそのまま受け取るのではなく、本人確認をしたうえで保存しています。</li>
    </ul>
  </section>`

  return renderWithLayout(
    {
      title: 'もち合体パズル ランキング | 葉っぱもち Bot',
      description: 'もち合体パズルのスコアランキング。自己ベストの高い順に並んでいます。',
      canonical: `${siteUrl}/ranking/mochi`,
    },
    body,
    'ranking'
  )
}
