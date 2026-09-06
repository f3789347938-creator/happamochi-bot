// グループ発言数ランキングの公開ページ。
//
// 既存の pageLayout(ヘッダー/フッター/OGP)をそのまま再利用し、
// 掲示板・ギャラリーとデザインを揃える。数値はすべて実データで、
// サンプル値は一切埋め込まない。データが無い場合・集計開始前・
// 取得エラーはそれぞれ別の文言で区別して表示する。
import {
  SITE_NAME,
  SITE_URL,
  escapeHtml,
  escapeAttrPublic as escapeAttr,
  renderWithLayout,
} from './bbs'
import type {
  GroupDetail,
  RankingPeriod,
  RankingResult,
  SizeFilter,
} from './groupRanking'
import { sizeFilterLabel } from './groupRanking'

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

function periodDates(range: { start: string; end: string }): string {
  return `${range.start.replace(/-/g, '.')} — ${range.end.replace(/-/g, '.')} (JST)`
}

function dowLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()]
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === null) continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

function deltaCell(delta: number | null): string {
  if (delta === null) {
    return `<span class="rk-delta rk-delta-new">NEW</span>`
  }
  if (delta === 0) {
    return `<span class="rk-delta rk-delta-flat" aria-label="変動なし">—</span>`
  }
  if (delta > 0) {
    return `<span class="rk-delta rk-delta-up"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i>${delta}</span>`
  }
  return `<span class="rk-delta rk-delta-down"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i>${Math.abs(delta)}</span>`
}

function groupInitial(name: string | null): string {
  if (!name) return '?'
  return Array.from(name)[0] ?? '?'
}

export interface RankingPageState {
  result: RankingResult
  detail: GroupDetail | null
  period: RankingPeriod
  size: SizeFilter
  q: string
  /** 最終更新日時(このページを生成した時刻, JST) */
  generatedAt: string
}

export function renderRankingPage(state: RankingPageState): string {
  const { result, detail, period, size, q } = state
  const { range } = result

  // ---- 左サイドバー: 期間・規模の絞り込み ----
  const periods: { key: RankingPeriod; label: string }[] = [
    { key: 'today', label: '今日' },
    { key: 'week', label: '今週' },
    { key: 'month', label: '今月' },
  ]
  const periodLinks = periods
    .map((p) => {
      const href = `/ranking${buildQuery({ period: p.key, size, q, group: detail?.groupId })}`
      const active = p.key === period
      return `<a href="${escapeAttr(href)}" class="rk-side-link ${active ? 'is-active' : ''}" ${active ? 'aria-current="page"' : ''}>${escapeHtml(p.label)}</a>`
    })
    .join('')

  const sizes: SizeFilter[] = ['all', 'small', 'medium', 'large']
  const sizeLinks = sizes
    .map((s) => {
      const href = `/ranking${buildQuery({ period, size: s, q, group: detail?.groupId })}`
      const active = s === size
      return `<a href="${escapeAttr(href)}" class="rk-side-link ${active ? 'is-active' : ''}" ${active ? 'aria-current="page"' : ''}>${escapeHtml(sizeFilterLabel(s))}</a>`
    })
    .join('')

  // ---- 中央: 一覧 ----
  let listBody: string
  if (result.errored) {
    listBody = `<div class="rk-empty rk-empty-error">
      <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
      <p><strong>集計データを取得できませんでした。</strong><br>時間をおいて再度お試しください。</p>
    </div>`
  } else if (result.total === 0) {
    const reason = q
      ? `「${escapeHtml(q)}」に一致するグループは見つかりませんでした。`
      : `この期間の発言はまだ集計されていません。<br>Botが参加しているグループで発言があると、ここに反映されます。`
    listBody = `<div class="rk-empty">
      <i class="fa-regular fa-comment-dots" aria-hidden="true"></i>
      <p>${reason}</p>
    </div>`
  } else {
    const rows = result.rows
      .map((r) => {
        const href = `/ranking${buildQuery({ period, size, q, group: r.groupId })}`
        const selected = detail?.groupId === r.groupId
        const name = r.groupName ? escapeHtml(r.groupName) : '<span class="rk-noname">名称未取得のグループ</span>'
        const crown = r.rank === 1 ? `<i class="fa-solid fa-crown rk-crown" aria-hidden="true"></i>` : ''
        return `<a href="${escapeAttr(href)}" class="rk-row ${selected ? 'is-selected' : ''}" ${selected ? 'aria-current="true"' : ''}>
          <span class="rk-rank">${String(r.rank).padStart(2, '0')}${crown}</span>
          <span class="rk-group">
            <span class="rk-avatar" aria-hidden="true">${escapeHtml(groupInitial(r.groupName))}</span>
            <span class="rk-group-text">
              <span class="rk-group-name">${name}</span>
              <span class="rk-group-sub">発言した人 ${r.speakers}人</span>
            </span>
          </span>
          <span class="rk-count"><strong>${fmt(r.messages)}</strong><span class="rk-unit">件</span></span>
          <span class="rk-delta-cell">${deltaCell(r.delta)}</span>
          <span class="rk-chevron" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></span>
        </a>`
      })
      .join('')
    listBody = `<div class="rk-rows" role="list">${rows}</div>`
  }

  // ---- ページネーション ----
  let pagination = ''
  if (result.totalPages > 1) {
    const parts: string[] = []
    const link = (p: number, label: string, cls = '') =>
      `<a href="${escapeAttr(`/ranking${buildQuery({ period, size, q, page: p === 1 ? undefined : p, group: detail?.groupId })}`)}" class="bbs-page-link ${cls}">${label}</a>`
    if (result.page > 1) parts.push(link(result.page - 1, '<i class="fa-solid fa-chevron-left" aria-hidden="true"></i>前へ'))
    const start = Math.max(1, result.page - 2)
    const end = Math.min(result.totalPages, result.page + 2)
    for (let p = start; p <= end; p++) {
      parts.push(
        p === result.page
          ? `<span class="bbs-page-link is-active" aria-current="page">${p}</span>`
          : link(p, String(p))
      )
    }
    if (result.page < result.totalPages) parts.push(link(result.page + 1, '次へ<i class="fa-solid fa-chevron-right" aria-hidden="true"></i>'))
    pagination = `<nav class="bbs-pagination" aria-label="ページナビゲーション">${parts.join('')}</nav>`
  }

  // ---- 右: 詳細 ----
  const detailHtml = renderDetailPanel(detail, period)

  const title = `グループ発言数ランキング | ${SITE_NAME}`
  const description =
    'LINE Botが集計した、グループごとの発言数ランキング。今日・今週・今月の期間で、会話が活発なグループを探せます。'

  const body = `
  <section class="rk-hero">
    <div class="rk-hero-main">
      <p class="rk-eyebrow">GROUP ACTIVITY</p>
      <h1 class="rk-title">${escapeHtml(state.period === 'today' ? '今日' : state.period === 'month' ? '今月' : '今週')}のグループランキング</h1>
      <p class="rk-lead">会話の数から、気になるグループを見つけよう。</p>
    </div>
  </section>

  <div class="rk-layout">
    <aside class="rk-side" aria-label="絞り込み">
      <div class="rk-side-block">
        <h2 class="rk-side-title">集計期間</h2>
        <div class="rk-side-links">${periodLinks}</div>
      </div>
      <div class="rk-side-block">
        <h2 class="rk-side-title">グループ規模</h2>
        <div class="rk-side-links">${sizeLinks}</div>
        <p class="rk-side-note">発言実績のある人数で判定しています。</p>
      </div>
      <div class="rk-side-block">
        <a href="/ranking/personal" class="rk-rules-link"><i class="fa-solid fa-user" aria-hidden="true"></i>個人ランキング</a>
        <p class="rk-side-note">累計EXPの多い順。グループをまたいだ個人の順位です。</p>
      </div>
      <div class="rk-side-block">
        <a href="/ranking/rules" class="rk-rules-link"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>集計ルール</a>
      </div>
    </aside>

    <section class="rk-main" aria-label="ランキング一覧">
      <form class="rk-search" method="GET" action="/ranking" role="search">
        <input type="hidden" name="period" value="${escapeAttr(period)}">
        <input type="hidden" name="size" value="${escapeAttr(size)}">
        <label for="rk-q" class="rk-visually-hidden">グループ名で検索</label>
        <i class="fa-solid fa-magnifying-glass rk-search-icon" aria-hidden="true"></i>
        <input id="rk-q" type="search" name="q" value="${escapeAttr(q)}" placeholder="グループ名で検索" class="rk-search-input" maxlength="60">
        <button type="submit" class="rk-search-btn">検索</button>
      </form>

      <div class="rk-listhead">
        <div>
          <p class="rk-range">${escapeHtml(periodDates(range))}</p>
          <p class="rk-updated">最終更新 ${escapeHtml(state.generatedAt)}</p>
        </div>
        <p class="rk-total">${result.total > 0 ? `${fmt(result.total)}グループ` : ''}</p>
      </div>

      <div class="rk-tablehead" aria-hidden="true">
        <span>順位</span><span>グループ</span><span class="rk-th-num">発言数</span><span class="rk-th-num">前期間比</span><span></span>
      </div>

      ${listBody}
      ${pagination}
    </section>

    ${detailHtml}
  </div>

  <p class="rk-footnote">
    Botが参加しているグループの発言数を集計しています。会話の内容は公開されません。
  </p>`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: `${SITE_URL}/ranking`,
  }

  return renderWithLayout(
    { title, description, path: '/ranking', jsonLd },
    body,
    'ranking'
  )
}

function renderDetailPanel(detail: GroupDetail | null, period: RankingPeriod): string {
  if (!detail) {
    return `<aside class="rk-detail" aria-label="グループ詳細">
      <div class="rk-detail-card rk-detail-empty">
        <i class="fa-regular fa-hand-pointer" aria-hidden="true"></i>
        <p>一覧からグループを選ぶと、<br>発言数の内訳が表示されます。</p>
      </div>
    </aside>`
  }

  const name = detail.groupName ? escapeHtml(detail.groupName) : '名称未取得のグループ'
  const periodWord = period === 'today' ? '今日' : period === 'month' ? '今月' : '今週'

  // 日別グラフ。合計は必ず期間合計と一致する(0件の日も含めて出している)。
  const max = Math.max(1, ...detail.daily.map((d) => d.count))
  const bars = detail.daily
    .map((d) => {
      const h = Math.round((d.count / max) * 100)
      const label = detail.daily.length <= 8 ? dowLabel(d.date) : d.date.slice(8)
      return `<div class="rk-bar-col">
        <div class="rk-bar-track"><div class="rk-bar" style="height:${Math.max(d.count > 0 ? 4 : 0, h)}%" title="${escapeAttr(`${d.date}: ${fmt(d.count)}件`)}"></div></div>
        <span class="rk-bar-label">${escapeHtml(label)}</span>
        <span class="rk-bar-value">${fmt(d.count)}</span>
      </div>`
    })
    .join('')

  const dailySum = detail.daily.reduce((s, d) => s + d.count, 0)

  const peak =
    detail.peakHours !== null
      ? `${String(detail.peakHours.from).padStart(2, '0')}:00-${String(detail.peakHours.to).padStart(2, '0')}:00`
      : null

  const peakBlock = peak
    ? `<p class="rk-detail-peak-value">${escapeHtml(peak)}</p>`
    : `<p class="rk-detail-peak-none">時間帯の集計を開始しました。データが貯まると表示されます。</p>`

  const threadBtn = detail.thread
    ? `<a href="/bbs/${encodeURIComponent(detail.thread.id)}" class="rk-detail-cta">募集ページを見る<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>`
    : `<a href="/bbs" class="rk-detail-cta rk-detail-cta-alt">掲示板で募集を探す<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>`

  const rankBadge =
    detail.rank !== null
      ? `<span class="rk-detail-rank">${periodWord} ${detail.rank}位</span>`
      : `<span class="rk-detail-rank rk-detail-rank-none">集計中</span>`

  return `<aside class="rk-detail" aria-label="グループ詳細">
    <div class="rk-detail-card">
      <h2 class="rk-detail-heading">グループ詳細</h2>
      <div class="rk-detail-id">
        <span class="rk-detail-avatar" aria-hidden="true">${escapeHtml(groupInitial(detail.groupName))}</span>
        <div>
          <p class="rk-detail-name">${name}</p>
          ${rankBadge}
        </div>
      </div>

      <div class="rk-detail-stats">
        <div>
          <p class="rk-detail-stat-label">${escapeHtml(periodWord)}の発言</p>
          <p class="rk-detail-stat-value">${fmt(detail.messages)}<span class="rk-unit">件</span></p>
        </div>
        <div>
          <p class="rk-detail-stat-label">${escapeHtml(periodWord)}発言した人</p>
          <p class="rk-detail-stat-value">${fmt(detail.speakers)}<span class="rk-unit">人</span></p>
        </div>
      </div>

      <div class="rk-detail-block">
        <p class="rk-detail-block-title">日別の発言数<span class="rk-detail-sum">合計 ${fmt(dailySum)}件</span></p>
        <div class="rk-chart">${bars}</div>
      </div>

      <div class="rk-detail-block">
        <p class="rk-detail-block-title">主な活動時間帯</p>
        ${peakBlock}
      </div>

      ${threadBtn}
    </div>

    <div class="rk-line-card">
      <i class="fa-brands fa-line" aria-hidden="true"></i>
      <div>
        <p class="rk-line-title">LINEでも順位を確認</p>
        <p class="rk-line-sub">Botに「ランキング」と送るだけ。</p>
      </div>
    </div>
  </aside>`
}

// ---------------------------------------------------------------------------
// 集計ルールページ
// ---------------------------------------------------------------------------

export function renderRankingRulesPage(): string {
  const title = `ランキングの集計ルール | ${SITE_NAME}`
  const description = 'グループ発言数ランキングの集計方法・対象・期間の区切り方についての説明です。'

  const body = `
  <nav class="bbs-breadcrumb" aria-label="パンくずリスト">
    <a href="/ranking">ランキング</a><span aria-hidden="true"> / </span><span aria-current="page">集計ルール</span>
  </nav>
  <h1 class="bbs-page-title">ランキングの集計ルール</h1>
  <p class="bbs-page-lead">グループ発言数ランキングがどのように集計されているかを説明します。</p>

  <div class="rk-rules">
    <section>
      <h2>集計の対象</h2>
      <ul>
        <li>Botが参加しているLINEグループで受信したメッセージを、1件につき1としてカウントします。</li>
        <li>テキスト・画像・スタンプなど、Botが受信できるメッセージはすべて対象です。</li>
        <li>Bot自身が送信したメッセージはカウントしません。</li>
        <li>Botへのコマンド（「ヘルプ」「めいく」など）も、グループ内の発言としてカウントに含みます。</li>
        <li>会話の本文はランキングのために保存していません。表示するのは件数のみです。</li>
      </ul>
    </section>

    <section>
      <h2>期間の区切り</h2>
      <ul>
        <li><strong>今日</strong>… 当日の集計分</li>
        <li><strong>今週</strong>… 月曜0時から日曜終了まで</li>
        <li><strong>今月</strong>… 月初から月末まで</li>
      </ul>
    </section>

    <section>
      <h2>順位のつけ方</h2>
      <ul>
        <li>対象期間の発言数が多い順に並べます。</li>
        <li>発言数が同じ場合は同順位になります。</li>
        <li>「前期間比」は、直前の同じ長さの期間での順位との差です。</li>
        <li>比較できるデータがない場合は <strong>NEW</strong>、変動がない場合は <strong>—</strong> と表示します。</li>
      </ul>
    </section>

    <section>
      <h2>表示している数値について</h2>
      <ul>
        <li><strong>発言した人</strong>… その期間に発言が記録された人数です。現在オンラインの人数ではありません。</li>
        <li><strong>グループ規模</strong>… 発言の実績が記録されている人数で判定しています。実際の参加人数とは異なる場合があります。</li>
        <li><strong>主な活動時間帯</strong>… 時間帯別の集計は後から追加した機能のため、集計を開始した日以降のデータのみを対象としています。データが貯まるまでは表示されません。</li>
        <li>日別グラフの合計は、その期間の発言数と一致します。</li>
      </ul>
    </section>

    <section>
      <h2>公開している情報</h2>
      <ul>
        <li>公開するのはグループ名と件数のみです。</li>
        <li>会話の本文、個人のLINE ID、内部のユーザーIDは公開しません。</li>
        <li>個人単位の発言数ランキングは、このページでは公開していません。</li>
      </ul>
    </section>
  </div>

  <div class="bbs-back-link">
    <a href="/ranking"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>ランキングに戻る</a>
  </div>`

  return renderWithLayout({ title, description, path: '/ranking/rules' }, body, 'ranking')
}
