// 個人ランキングと公開ステータスのWebページ。
//
// 公開範囲(指示どおり):
//   公開する: 表示名・アイコン・衣装・背景・レベル・EXP・個人順位・共通称号・テーマ・ポイント
//   公開しない: 会話本文、LINEユーザーID、非公開のグループ情報、誕生日の日付
//   → URLには public_id(LINEのIDとは無関係なランダム値)だけを使う。
import type { LineEnv } from '../../lib/line'
import { escapeAttrPublic, renderWithLayout } from '../bbs'
import { appearanceUrl, hasCustomAppearance } from '../dressup/art'
import { getCosmetic } from '../dressup/catalog'
import { getAppearance } from '../dressup/store'
import { getRankingIconsByPublicIds, rankingIconUrl } from '../rankingIcon'
import {
  countProfiles,
  dailyFortune,
  getCommonTitle,
  getProfileByPublicId,
  getTheme,
  levelFromTotalExp,
  listRanking,
  getPersonalRank,
  type Theme,
} from './core'

const esc = escapeAttrPublic

const FALLBACK_THEME: Theme = {
  id: 'aqua',
  name: '水色',
  price: 0,
  header_bg: '#009FDE',
  body_bg: '#E4F7FF',
  text_color: '#17364C',
  accent: '#16BCEC',
  header_text: '#FFFFFF',
  display_order: 1,
}

// === 個人ランキング一覧 ==================================================
export async function renderPersonalRankingPage(
  env: LineEnv,
  siteUrl: string,
  page = 1
): Promise<string> {
  const PER = 50
  const total = await countProfiles(env)
  const pageCount = Math.max(1, Math.ceil(total / PER))
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount)
  const rows = await listRanking(env, PER, (p - 1) * PER)
  const icons = await getRankingIconsByPublicIds(env, rows.map((r) => r.public_id))

  const items = rows
    .map((r) => {
      const name = esc(r.display_name ?? '名前未設定')
      const icon = icons[r.public_id]
      const pictureUrl = rankingIconUrl(siteUrl, icon, r.picture_url)
      const avatar = pictureUrl
        ? `<img class="pf-rank-avatar" style="object-fit:${icon?.costumeId ? 'contain' : 'cover'};border-radius:5px" src="${esc(pictureUrl)}" alt="" width="48" height="48" loading="lazy" referrerpolicy="no-referrer">`
        : `<span class="pf-rank-avatar pf-rank-avatar-none" aria-hidden="true">${esc(
            Array.from((r.display_name ?? '?').trim() || '?')[0] ?? '?'
          )}</span>`
      const medal = r.rank <= 3 ? ` pf-rank-top pf-rank-top${r.rank}` : ''
      return `
      <li class="pf-rank-item${medal}">
        <span class="pf-rank-no">${r.rank}<small>位</small></span>
        ${avatar}
        <a class="pf-rank-name" href="/u/${esc(r.public_id)}">${name}</a>
        <span class="pf-rank-lv">Lv.${r.level}</span>
        <span class="pf-rank-exp">${r.total_exp.toLocaleString('ja-JP')} exp</span>
      </li>`
    })
    .join('')

  const nav = `
    <nav class="pf-pager" aria-label="ページ送り">
      ${p > 1 ? `<a class="pf-pager-btn" href="/ranking/personal?page=${p - 1}">前へ</a>` : `<span class="pf-pager-btn pf-pager-off">前へ</span>`}
      <span class="pf-pager-now">${p} / ${pageCount}</span>
      ${p < pageCount ? `<a class="pf-pager-btn" href="/ranking/personal?page=${p + 1}">次へ</a>` : `<span class="pf-pager-btn pf-pager-off">次へ</span>`}
    </nav>`

  const body = `
  <section class="pf-hero" id="personal-ranking-hero">
    <h1 class="pf-hero-title">個人ランキング</h1>
    <p class="pf-hero-sub">累計EXPの多い順です。全${total.toLocaleString('ja-JP')}人。</p>
    <p class="pf-hero-links"><a class="pf-pager-btn" href="/ranking">グループ別ランキングへ</a></p>
  </section>

  <section class="pf-section" id="personal-ranking-list">
    ${
      rows.length === 0
        ? `<p class="pf-empty">まだデータがありません。LINEでメッセージを送るとEXPがたまります。</p>`
        : `<ol class="pf-rank-list">${items}</ol>${nav}`
    }
  </section>

  <section class="pf-section" id="personal-point-rules">
    <h2 class="pf-h2">ポイントとEXPのため方</h2>
    <p class="pf-hero-sub">加算対象の1通につき1 EXP。基本ポイントは本文の有効文字数で決まります。空白・URL・絵文字・記号は数えず、文字や語句の繰り返しをまとめて判定します。</p>
    <table style="width:100%;max-width:460px;margin:14px 0;border-collapse:collapse;color:#15384d;font-size:14px;line-height:1.8">
      <thead><tr style="background:#e4f7ff"><th scope="col" style="padding:6px 12px;text-align:left">有効な文字数</th><th scope="col" style="padding:6px 12px;text-align:right">基本ポイント</th></tr></thead>
      <tbody>
        <tr><th scope="row" style="padding:5px 12px;text-align:left;font-weight:400">1〜9文字</th><td style="padding:5px 12px;text-align:right">1P</td></tr>
        <tr style="background:#f4fbff"><th scope="row" style="padding:5px 12px;text-align:left;font-weight:400">10〜29文字</th><td style="padding:5px 12px;text-align:right">2P</td></tr>
        <tr><th scope="row" style="padding:5px 12px;text-align:left;font-weight:400">30〜79文字</th><td style="padding:5px 12px;text-align:right">3P</td></tr>
        <tr style="background:#f4fbff"><th scope="row" style="padding:5px 12px;text-align:left;font-weight:400">80〜149文字</th><td style="padding:5px 12px;text-align:right">5P</td></tr>
        <tr><th scope="row" style="padding:5px 12px;text-align:left;font-weight:400">150文字以上</th><td style="padding:5px 12px;text-align:right">8P</td></tr>
      </tbody>
    </table>
    <ul class="pf-notes">
      <li>同じグループの他の人のメッセージに引用返信すると＋2P。合計は1通最大10Pです。</li>
      <li>返信元と投稿者を確認できた場合だけ加算します。自分への返信・投稿者不明・別グループの引用は対象外です。</li>
      <li>スタンプ・画像など文字以外は基本1P。グループと個別トークで残高・EXP・加算間隔を共有します。</li>
      <li>加算は5秒間隔です。前回加算された本文と同じ・よく似た内容は、EXPもポイントも加算しません。</li>
      <li>空白や繰り返しで文字数を水増ししても、ポイントの段階は上がりません。</li>
    </ul>
  </section>

  <section class="pf-section" id="personal-ranking-about">
    <h2 class="pf-h2">集計と公開について</h2>
    <ul class="pf-notes">
      <li>ランキングは累計EXPで決まります。獲得ポイントが多い場合も、EXPは加算対象1通につき1です。</li>
      <li>次のレベルに必要なEXPは「100 + 8 ×（現在のレベル − 1）」です。</li>
      <li>同じ累計EXPの人は同じ順位になります（1位、2位、2位、4位…）。</li>
      <li>名前を押すと、その人の公開ステータスを見られます。</li>
      <li>アイコンはLINEプロフィール画像が初期設定です。LINEで「設定」→「ランキングアイコン」から獲得済みの衣装に変更できます。</li>
      <li>公開しているのは、表示名・アイコン・衣装・背景・レベル・EXP・順位・称号・テーマ・運勢・ポイントです。</li>
      <li>会話の内容、参加しているグループ、誕生日の日付は公開していません。</li>
    </ul>
  </section>`

  return renderWithLayout(
    {
      title: '個人ランキング | 葉っぱもち Bot',
      description: '葉っぱもち Botの個人ランキング。累計EXPの多い順に並んでいます。',
      canonical: `${siteUrl}/ranking/personal`,
    },
    body,
    'ranking'
  )
}

// === 公開ステータス ======================================================
export async function renderPublicStatusPage(
  env: LineEnv,
  siteUrl: string,
  publicId: string
): Promise<{ html: string; found: boolean }> {
  const profile = await getProfileByPublicId(env, publicId)
  if (!profile) {
    const body = `
    <section class="pf-hero"><h1 class="pf-hero-title">見つかりませんでした</h1>
    <p class="pf-hero-sub">このステータスページは存在しないか、公開されていません。</p>
    <p><a class="pf-pager-btn" href="/ranking/personal">個人ランキングへ</a></p></section>`
    return {
      html: renderWithLayout(
        {
          title: 'ステータスが見つかりません | 葉っぱもち Bot',
          description: '指定されたステータスページは見つかりませんでした。',
          canonical: `${siteUrl}/u/${publicId}`,
        },
        body,
        'ranking'
      ),
      found: false,
    }
  }

  const level = levelFromTotalExp(profile.total_exp)
  const rank = await getPersonalRank(env, profile.user_id)
  const theme = (await getTheme(env, profile.active_theme)) ?? FALLBACK_THEME
  const title = profile.equipped_title ? await getCommonTitle(env, profile.equipped_title) : null
  const name = esc(profile.display_name ?? '名前未設定')
  // 運勢は「人+日付」から決まる表示項目。内部IDは表に出さない。
  const fortune = dailyFortune(profile.user_id)
  const appearance = await getAppearance(env, profile.user_id).catch(() => null)
  const costume = appearance ? getCosmetic(appearance.costumeId) : undefined
  const background = appearance ? getCosmetic(appearance.backgroundId) : undefined
  // ID・画像URL・ラベルはサーバーのカタログから解決。内部LINE IDは出力しない。
  const hasAppearance = hasCustomAppearance(appearance)
  const dressupHero = hasAppearance && appearance
    ? `<figure style="margin:0 0 16px">
        <img src="${esc(appearanceUrl(siteUrl, appearance))}" alt="${esc(`${costume!.name}・${background!.name}`)}" width="768" height="512" style="display:block;width:100%;height:auto;max-height:360px;object-fit:contain;border-radius:14px">
        <figcaption style="margin-top:8px;text-align:center;font-weight:700">着せ替え中：${esc(costume!.name)}</figcaption>
      </figure>`
    : ''

  const avatar = profile.picture_url
    ? `<img class="pf-card-avatar" src="${esc(profile.picture_url)}" alt="" width="96" height="96">`
    : `<span class="pf-card-avatar pf-card-avatar-none" aria-hidden="true">${esc(
        Array.from((profile.display_name ?? '?').trim() || '?')[0] ?? '?'
      )}</span>`

  // テーマ色はインラインで当てる(テーマごとにCSSクラスを増やさないため)
  const cardStyle =
    `--pf-header:${esc(theme.header_bg)};--pf-body:${esc(theme.body_bg)};` +
    `--pf-text:${esc(theme.text_color)};--pf-accent:${esc(theme.accent)};` +
    `--pf-header-text:${esc(theme.header_text)}`

  const body = `
  <section class="pf-section" id="public-status">
    <article class="pf-card" style="${cardStyle}">
      <header class="pf-card-head">
        <p class="pf-card-rank">${rank !== null ? `Ranking：${rank.toLocaleString('ja-JP')}位` : 'Ranking：未集計'}</p>
      </header>
      <div class="pf-card-body">
        <p class="pf-card-title">${title ? esc(title.name) : '未設定'}</p>
        ${dressupHero}
        <div class="pf-card-main">
          ${hasAppearance ? '' : avatar}
          <div class="pf-card-info">
            <h1 class="pf-card-name">${name}</h1>
            <p class="pf-card-lv"><span>Lv. ${level.level}</span><span>exp ${level.expInLevel} / ${level.expNeeded}</span></p>
            <div class="pf-card-bar"><span style="width:${Math.round(level.percent)}%"></span></div>
          </div>
        </div>
        <p class="pf-card-points"><span class="pf-card-fortune">${esc(fortune)}</span>保有ポイント: ${profile.points.toLocaleString('ja-JP')}</p>
        <dl class="pf-card-meta">
          <dt>累計EXP</dt><dd>${profile.total_exp.toLocaleString('ja-JP')}</dd>
          <dt>テーマ</dt><dd>${esc(theme.name)}</dd>
          <dt>共通称号</dt><dd>${title ? esc(title.name) : '未設定'}</dd>
          <dt>今日の運勢</dt><dd>${esc(fortune)}</dd>
          ${hasAppearance ? `<dt>衣装</dt><dd>${esc(costume!.name)}</dd><dt>背景</dt><dd>${esc(background!.name)}</dd>` : ''}
        </dl>
      </div>
      <footer class="pf-card-foot">© 2026 HappaMochi Bot</footer>
    </article>

    <p class="pf-card-links">
      <a class="pf-pager-btn" href="/ranking/personal">個人ランキングへ</a>
    </p>
    <p class="pf-notes-inline">
      このページで公開しているのは、表示名・アイコン・衣装・背景・レベル・EXP・順位・称号・テーマ・運勢・ポイントだけです。
      会話の内容や参加グループ、誕生日の日付は公開していません。
    </p>
  </section>`

  return {
    html: renderWithLayout(
      {
        title: `${profile.display_name ?? 'ユーザー'} のステータス | 葉っぱもち Bot`,
        description: `${profile.display_name ?? 'ユーザー'} のレベル・EXP・称号・順位を公開しています。`,
        canonical: `${siteUrl}/u/${publicId}`,
      },
      body,
      'ranking'
    ),
    found: true,
  }
}
