// 個人ステータス・着せ替え・共通称号のコマンドとPostback処理。
//
// 安全性の要点(指示どおり):
//   ・操作主体は必ずサーバーが受信したイベントの source.userId で決める。
//     Postbackのデータに入っている値は信用しない。そのため Postback には
//     ユーザーIDを一切載せていない(押した人=本人として処理する)。
//     結果として「他人のカードを押しても、その人のポイント・装備は
//     変わらず、押した人自身の画面が出る」という安全な挙動になる。
//   ・購入は確認 → 確定の2段。確定時もサーバーの価格を正とする。
//   ・存在しないテーマ・称号、改ざんされたページ番号は安全な範囲へ補正。
import type { LineEnv, LineMessage } from '../../lib/line'
import {
  DEFAULT_THEME_ID,
  dailyFortune,
  ensureProfile,
  equipCommonTitle,
  findTitlesByName,
  getCommonTitle,
  getOthelloWins,
  getPersonalRank,
  getTheme,
  judgeTitle,
  levelFromTotalExp,
  listOwnedThemeIds,
  listThemes,
  listTitleCategories,
  listUnlockedTitleIds,
  applyTheme,
  purchaseTheme,
  resolveThemeForUser,
  type CommonTitle,
  type Theme,
} from './core'
import {
  TITLES_PER_PAGE,
  buildCategoryCard,
  buildPurchaseConfirm,
  buildStatusCard,
  buildThemeCard,
  buildTitleListCard,
} from './flex'

export interface ProfileCtx {
  userId: string | null
  displayName: string | null
  pictureUrl: string | null
  baseUrl: string
}

const text = (t: string): LineMessage => ({ type: 'text', text: t })

/** 操作画面(着せ替え・称号一覧)は水色に統一する(指示) */
async function uiTheme(env: LineEnv): Promise<Theme> {
  const t = await getTheme(env, DEFAULT_THEME_ID)
  return (
    t ?? {
      id: DEFAULT_THEME_ID,
      name: '水色',
      price: 0,
      header_bg: '#009FDE',
      body_bg: '#E4F7FF',
      text_color: '#17364C',
      accent: '#16BCEC',
      header_text: '#FFFFFF',
      display_order: 1,
    }
  )
}

// === ステータス ==========================================================
async function statusMessage(
  env: LineEnv,
  ctx: ProfileCtx,
  opts?: { previewThemeId?: string; note?: string }
): Promise<LineMessage> {
  const userId = ctx.userId!
  const profile = await ensureProfile(env, userId, ctx.displayName, ctx.pictureUrl)
  const level = levelFromTotalExp(profile.total_exp)
  const rank = await getPersonalRank(env, userId)

  let theme = await resolveThemeForUser(env, userId)
  let preview: { themeName: string; applyData: string; backData: string } | undefined
  if (opts?.previewThemeId) {
    const pv = await getTheme(env, opts.previewThemeId)
    if (pv) {
      theme = pv
      preview = {
        themeName: pv.name,
        // プレビューから直接「使う」に進めるのは所持済みのときだけ。
        // 未所持なら購入確認へ送る。
        applyData: (await listOwnedThemeIds(env, userId)).includes(pv.id)
          ? `pf|apply|${pv.id}`
          : `pf|buy|${pv.id}`,
        backData: 'pf|themes',
      }
    }
  }

  let titleName: string | null = null
  if (profile.equipped_title) {
    const t = await getCommonTitle(env, profile.equipped_title)
    titleName = t?.name ?? null
  }

  return buildStatusCard({
    profile,
    level,
    theme,
    rank,
    titleName,
    fortune: dailyFortune(userId),
    preview,
    note: opts?.note,
  })
}

// === 着せ替え ============================================================
async function themesMessage(env: LineEnv, ctx: ProfileCtx): Promise<LineMessage> {
  const userId = ctx.userId!
  const profile = await ensureProfile(env, userId, ctx.displayName, ctx.pictureUrl)
  const level = levelFromTotalExp(profile.total_exp)
  const themes = await listThemes(env)
  const owned = new Set(await listOwnedThemeIds(env, userId))
  return buildThemeCard({
    profile,
    level,
    uiTheme: await uiTheme(env),
    themes,
    ownedIds: owned,
    activeId: profile.active_theme,
  })
}

// === 共通称号一覧 ========================================================
// 絞り込み状態は Postback のデータに載せる(送信済みFlexは編集できないため、
// 状態を持ち回る必要がある)。ユーザーIDは載せない。
//   pf|tl|<filter>|<category|->|<query|->|<page>
type Filter = 'all' | 'usable' | 'locked'

function encodeQuery(q: string): string {
  // 区切り文字と衝突しないようにする
  return encodeURIComponent(q).replace(/\|/g, '%7C')
}
function decodeQuery(q: string): string {
  try {
    return decodeURIComponent(q)
  } catch {
    return ''
  }
}

function titleListToken(filter: Filter, category: string | null, query: string, page: number): string {
  return `pf|tl|${filter}|${category ?? '-'}|${query ? encodeQuery(query) : '-'}|${page}`
}

async function titleListMessage(
  env: LineEnv,
  ctx: ProfileCtx,
  filter: Filter,
  category: string | null,
  query: string,
  page: number
): Promise<LineMessage> {
  const userId = ctx.userId!
  const profile = await ensureProfile(env, userId, ctx.displayName, ctx.pictureUrl)
  const level = levelFromTotalExp(profile.total_exp)
  const wins = await getOthelloWins(env, userId)
  const unlocked = await listUnlockedTitleIds(env, userId)

  // 総数(絞り込み無しの全件)
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM common_title_master`).first<{
    c: number
  }>()
  const totalCount = totalRow?.c ?? 0

  // カテゴリ・検索で候補を絞る(取得状態フィルタは判定が必要なのでJS側)
  let candidates: CommonTitle[]
  if (query) {
    candidates = await findTitlesByName(env, query)
    if (category) candidates = candidates.filter((t) => t.category === category)
  } else if (category) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM common_title_master WHERE category = ? ORDER BY display_order`
    )
      .bind(category)
      .all<CommonTitle>()
    candidates = results ?? []
  } else {
    const { results } = await env.DB.prepare(
      `SELECT m.* FROM common_title_master m
         JOIN common_title_category c ON c.id = m.category
        ORDER BY c.display_order, m.display_order`
    ).all<CommonTitle>()
    candidates = results ?? []
  }

  const judged = candidates.map((t) => {
    const j = judgeTitle(t, { level, othelloWins: wins, unlockedIds: unlocked })
    return {
      title: t,
      usable: j.usable,
      lockLabel: j.lockLabel,
      equipped: profile.equipped_title === t.id,
    }
  })
  const filtered =
    filter === 'usable'
      ? judged.filter((x) => x.usable)
      : filter === 'locked'
        ? judged.filter((x) => !x.usable)
        : judged

  // ページ番号は絞り込み後の件数から計算し、改ざんされていても補正する
  const pageCount = Math.ceil(filtered.length / TITLES_PER_PAGE)
  const safePage = pageCount === 0 ? 1 : Math.min(Math.max(1, Math.floor(page) || 1), pageCount)
  const items = filtered.slice((safePage - 1) * TITLES_PER_PAGE, safePage * TITLES_PER_PAGE)

  // 見出しの説明
  const cats = await listTitleCategories(env)
  const catName = category ? (cats.find((c) => c.id === category)?.name ?? 'カテゴリ') : null
  const parts: string[] = []
  if (catName) parts.push(catName)
  if (query) parts.push(`「${query}」`)
  const scopeLabel = parts.length ? parts.join(' / ') : 'すべての称号'

  return buildTitleListCard({
    ui: await uiTheme(env),
    profile,
    level,
    items,
    scopeLabel,
    totalCount,
    filteredCount: filtered.length,
    page: safePage,
    pageCount,
    filter,
    // 絞り込みを維持したままページ送り
    pageData: (p) => titleListToken(filter, category, query, p),
    // フィルタ変更時は1ページ目に戻す
    filterData: (f) => titleListToken(f, category, query, 1),
    categoryData: `pf|cat|${filter}|${query ? encodeQuery(query) : '-'}|1`,
    searchData: `pf|searchhelp`,
    // 装備後も同じ絞り込み・ページに戻る
    equipData: (titleId) =>
      `pf|equipp|${titleId}|${filter}|${category ?? '-'}|${query ? encodeQuery(query) : '-'}|${safePage}`,
  })
}

// === テキストコマンド ====================================================
/**
 * 該当しなければ null を返す(無関係な会話に反応しない)。
 * 既存の「称号一覧」「称号装備」「称号確認」はグループ別称号のままなので
 * ここでは扱わない。
 */
export async function handleProfileText(
  env: LineEnv,
  ctx: ProfileCtx,
  raw: string
): Promise<LineMessage[] | null> {
  const t = raw.trim()
  if (!ctx.userId) return null

  if (t === 'ステータス') {
    return [await statusMessage(env, ctx)]
  }

  if (t === '着せ替え') {
    return [await themesMessage(env, ctx)]
  }

  if (t === '共通称号一覧') {
    return [await titleListMessage(env, ctx, 'all', null, '', 1)]
  }

  if (t === '共通称号確認') {
    const p = await ensureProfile(env, ctx.userId, ctx.displayName, ctx.pictureUrl)
    if (!p.equipped_title) return [text('共通称号は未設定です。「共通称号一覧」から選べます。')]
    const title = await getCommonTitle(env, p.equipped_title)
    return [text(title ? `装備中の共通称号: ${title.name}` : '共通称号は未設定です。')]
  }

  const equip = t.match(/^共通称号装備[ 　]*(.+)$/s)
  if (equip) {
    const name = equip[1].trim()
    const found = await findTitlesByName(env, name)
    // 完全一致(正規化後)を優先する
    const exact = found.filter((x) => x.name_norm === name.normalize('NFKC').toLowerCase().trim())
    const target = exact[0] ?? (found.length === 1 ? found[0] : null)
    if (!target) {
      if (found.length === 0) return [text(`「${name}」という共通称号は見つかりませんでした。`)]
      const names = found.slice(0, 10).map((x) => `・${x.name}`).join('\n')
      return [text(`候補が複数あります。正確な名前で指定してください。\n\n${names}`)]
    }
    const res = await equipCommonTitle(env, ctx.userId, target.id)
    if (!res.ok) return [text(res.reason ?? '装備できませんでした。')]
    return [text(`共通称号「${res.name}」を装備しました`), await statusMessage(env, ctx)]
  }

  const search = t.match(/^称号検索[ 　]*(.+)$/s)
  if (search) {
    const q = search[1].trim()
    return [await titleListMessage(env, ctx, 'all', null, q, 1)]
  }
  if (t === '称号検索') {
    return [text('「称号検索 夜」のように、探したい文字を続けて送ってください。')]
  }

  return null
}

// === Postback ============================================================
/**
 * プロフィール系のPostbackを処理する。該当しなければ null。
 *
 * 重要: 操作主体は ctx.userId(= source.userId)。データにユーザーIDは
 * 入っていないので、他人のカードを押しても押した本人の画面になり、
 * カード所有者のポイントや装備は変更されない。
 */
export async function handleProfilePostback(
  env: LineEnv,
  ctx: ProfileCtx,
  data: string
): Promise<LineMessage[] | null> {
  if (!data.startsWith('pf|')) return null
  if (!ctx.userId) return null
  const parts = data.split('|')
  const op = parts[1] ?? ''

  try {
    if (op === 'status') return [await statusMessage(env, ctx)]
    if (op === 'themes') return [await themesMessage(env, ctx)]
    if (op === 'titles') return [await titleListMessage(env, ctx, 'all', null, '', 1)]

    if (op === 'searchhelp') {
      return [
        text(
          '称号を名前で探せます。\n\n「称号検索 夜」のように送ってください。\n' +
            '名前の一部が一致する称号を一覧にします。'
        ),
      ]
    }

    // 一覧(絞り込み維持)
    if (op === 'tl') {
      const filter = (['all', 'usable', 'locked'].includes(parts[2]) ? parts[2] : 'all') as Filter
      const category = parts[3] && parts[3] !== '-' ? parts[3] : null
      const query = parts[4] && parts[4] !== '-' ? decodeQuery(parts[4]) : ''
      const page = Number(parts[5] ?? '1')
      return [await titleListMessage(env, ctx, filter, category, query, page)]
    }

    // カテゴリ選択画面
    if (op === 'cat') {
      const filter = (['all', 'usable', 'locked'].includes(parts[2]) ? parts[2] : 'all') as Filter
      const query = parts[3] && parts[3] !== '-' ? decodeQuery(parts[3]) : ''
      const page = Number(parts[4] ?? '1')
      const cats = await listTitleCategories(env)
      return [
        buildCategoryCard(
          await uiTheme(env),
          cats,
          page,
          (p) => `pf|cat|${filter}|${query ? encodeQuery(query) : '-'}|${p}`,
          (catId) => titleListToken(filter, catId, query, 1)
        ),
      ]
    }

    // 称号を装備
    if (op === 'equip') {
      const titleId = parts[2] ?? ''
      const res = await equipCommonTitle(env, ctx.userId, titleId)
      if (!res.ok) return [text(res.reason ?? '装備できませんでした。')]
      // 装備後も同じ絞り込み・ページを保ちたいが、Postbackにその情報が
      // 無い場合はステータスを返す。一覧からの装備は下の equipp を使う。
      return [text(`共通称号「${res.name}」を装備しました`), await statusMessage(env, ctx)]
    }

    // 一覧から装備(絞り込みとページを維持して一覧を返す)
    if (op === 'equipp') {
      const titleId = parts[2] ?? ''
      const filter = (['all', 'usable', 'locked'].includes(parts[3]) ? parts[3] : 'all') as Filter
      const category = parts[4] && parts[4] !== '-' ? parts[4] : null
      const query = parts[5] && parts[5] !== '-' ? decodeQuery(parts[5]) : ''
      const page = Number(parts[6] ?? '1')
      const res = await equipCommonTitle(env, ctx.userId, titleId)
      const list = await titleListMessage(env, ctx, filter, category, query, page)
      if (!res.ok) return [text(res.reason ?? '装備できませんでした。'), list]
      return [list]
    }

    // テーマのプレビュー(無料・変更しない)
    if (op === 'preview') {
      const themeId = parts[2] ?? ''
      const t = await getTheme(env, themeId)
      if (!t) return [text('そのテーマは存在しません。')]
      return [await statusMessage(env, ctx, { previewThemeId: themeId })]
    }

    // テーマを適用(所持済みのみ・無料)
    if (op === 'apply') {
      const themeId = parts[2] ?? ''
      const res = await applyTheme(env, ctx.userId, themeId)
      if (!res.ok) return [text(res.reason ?? '適用できませんでした。')]
      return [await statusMessage(env, ctx)]
    }

    // 購入確認(まだ消費しない)
    if (op === 'buy') {
      const themeId = parts[2] ?? ''
      const t = await getTheme(env, themeId)
      if (!t) return [text('そのテーマは存在しません。')]
      if (t.price <= 0) return [text('そのテーマは無料です。「使う」から適用できます。')]
      const owned = await listOwnedThemeIds(env, ctx.userId)
      if (owned.includes(themeId)) {
        return [text('そのテーマはすでに持っています。'), await themesMessage(env, ctx)]
      }
      const p = await ensureProfile(env, ctx.userId, ctx.displayName, ctx.pictureUrl)
      return [buildPurchaseConfirm(t, await uiTheme(env), p.points)]
    }

    // 購入確定
    if (op === 'buyok') {
      const themeId = parts[2] ?? ''
      const res = await purchaseTheme(env, ctx.userId, themeId)
      if (!res.ok) {
        // 連打・再送で2回目に来た場合は「すでに持っています」になる。
        return [text(res.reason), await themesMessage(env, ctx)]
      }
      const t = await getTheme(env, themeId)
      return [
        text(
          `「${t?.name ?? themeId}」を交換しました（-${res.spent}P / 残高 ${res.balance}P）\n` +
            '「使う」を押すと適用されます。'
        ),
        await themesMessage(env, ctx),
      ]
    }

    return null
  } catch {
    return [text('処理に失敗しました。もう一度お試しください。')]
  }
}
