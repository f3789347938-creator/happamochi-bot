// LINEグループ募集掲示板 (BBS) + オープンチャット — public website feature.
//
// Rebuilt from the historical `threads` / `chat_messages` D1 tables (see
// migrations/0008_bbs.sql). Unlike every other feature in this bot, this is
// a real PUBLIC WEBSITE served via ordinary GET/POST routes in index.tsx —
// not a LINE chat command. No LINE Reply/Push API involved here at all.
//
// SECURITY: the historical data contains multiple literal, unescaped XSS
// payloads submitted through the original (now-gone) site's public form —
// proof it never escaped output. Every function in this file that renders
// user-supplied `title` / `content` / `author` / `category` as HTML MUST
// go through escapeHtml() below. The underlying DB rows are never modified
// or filtered (per the "never destroy data" rule) — only escaped at render
// time.
import type { LineEnv } from '../lib/line'

export const SITE_NAME = 'Circle Board'
export const SITE_DESCRIPTION =
  'Circle Boardは、恋愛・結婚、趣味・ゲーム、暮らし・雑談など、参加したいLINEグループを安心して探せる募集掲示板です。'
export const SITE_URL = 'https://line-group-bbs.pages.dev'

export interface Thread {
  id: string
  category: string
  title: string
  content: string
  author: string
  created_at: string
  likes: number
  views: number
  is_pinned: number
  image_url: string | null
  qr_code_url: string | null
}

export interface ChatMessage {
  id: string
  content: string
  author: string
  created_at: string
}

export interface ThreadComment {
  id: string
  thread_id: string
  author: string
  content: string
  created_at: string
}

// カテゴリ一覧。既存3種(love/hobby/other)は本番データそのまま維持。
// "life"(暮らし・雑談)はCircle Boardデザインに合わせて追加する新カテゴリで、
// 既存データには影響しない(今後の新規投稿から選択可能になるだけ)。
export const CATEGORIES: { value: string; label: string; icon: string; pillClass: string }[] = [
  { value: 'love', label: '恋愛・結婚', icon: 'fa-heart', pillClass: 'pill-love' },
  { value: 'hobby', label: '趣味・ゲーム', icon: 'fa-gamepad', pillClass: 'pill-hobby' },
  { value: 'life', label: '暮らし・雑談', icon: 'fa-house', pillClass: 'pill-life' },
  { value: 'other', label: 'その他', icon: 'fa-comments', pillClass: 'pill-other' },
]

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: '新着順' },
  { value: 'likes', label: 'いいね順' },
  { value: 'views', label: '閲覧数順' },
]

const PAGE_SIZE = 20

// --- HTML escaping (Cloudflare Workers has no DOM, so this is manual) ---
export function escapeHtml(input: string | null | undefined): string {
  if (input == null) return ''
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// meta description / JSON-LD などダブルクオート内に埋め込む用途の追加エスケープ
function escapeAttr(input: string | null | undefined): string {
  return escapeHtml(input).replace(/\n/g, ' ')
}

function categoryInfo(value: string): { label: string; icon: string; pillClass: string } {
  const found = CATEGORIES.find((c) => c.value === value)
  return found ?? { label: value, icon: 'fa-tag', pillClass: 'pill-other' }
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function excerpt(text: string, len = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > len ? `${flat.slice(0, len)}…` : flat
}

// --- Data access ---

export interface ListThreadsOptions {
  category?: string | null
  sort?: string | null
  q?: string | null
  page?: number
}

export interface ListThreadsResult {
  threads: Thread[]
  total: number
  page: number
  totalPages: number
}

export async function listThreads(env: LineEnv, opts: ListThreadsOptions = {}): Promise<ListThreadsResult> {
  const category = opts.category || null
  const q = (opts.q || '').trim()
  const sort = opts.sort || 'new'
  const page = Math.max(1, opts.page || 1)

  const where: string[] = []
  const binds: unknown[] = []
  if (category) {
    where.push('category = ?')
    binds.push(category)
  }
  if (q) {
    where.push('(title LIKE ? OR content LIKE ?)')
    binds.push(`%${q}%`, `%${q}%`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const orderSql =
    sort === 'likes'
      ? 'ORDER BY is_pinned DESC, likes DESC, created_at DESC'
      : sort === 'views'
      ? 'ORDER BY is_pinned DESC, views DESC, created_at DESC'
      : 'ORDER BY is_pinned DESC, created_at DESC'

  const countRow = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM threads ${whereSql}`)
    .bind(...binds)
    .first<{ cnt: number }>()
  const total = countRow?.cnt ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const offset = (safePage - 1) * PAGE_SIZE

  const { results } = await env.DB.prepare(
    `SELECT * FROM threads ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  )
    .bind(...binds, PAGE_SIZE, offset)
    .all<Thread>()

  return { threads: results ?? [], total, page: safePage, totalPages }
}

export async function listAllThreadIds(env: LineEnv): Promise<{ id: string; created_at: string }[]> {
  const { results } = await env.DB.prepare(`SELECT id, created_at FROM threads ORDER BY created_at DESC`).all<{
    id: string
    created_at: string
  }>()
  return results ?? []
}

export async function getThread(env: LineEnv, id: string): Promise<Thread | null> {
  const row = await env.DB.prepare(`SELECT * FROM threads WHERE id = ?`).bind(id).first<Thread>()
  return row ?? null
}

export async function incrementThreadViews(env: LineEnv, id: string): Promise<void> {
  await env.DB.prepare(`UPDATE threads SET views = views + 1 WHERE id = ?`).bind(id).run()
}

export async function likeThread(env: LineEnv, id: string): Promise<number | null> {
  await env.DB.prepare(`UPDATE threads SET likes = likes + 1 WHERE id = ?`).bind(id).run()
  const row = await env.DB.prepare(`SELECT likes FROM threads WHERE id = ?`).bind(id).first<{ likes: number }>()
  return row?.likes ?? null
}

export interface NewThreadInput {
  category: string
  title: string
  content: string
  author: string
}

export async function createThread(env: LineEnv, input: NewThreadInput): Promise<string> {
  const id = genId()
  const createdAt = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO threads (id, category, title, content, author, created_at, likes, views, is_pinned, image_url, qr_code_url)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL)`
  )
    .bind(id, input.category, input.title, input.content, input.author, createdAt)
    .run()
  return id
}

export async function listChatMessages(env: LineEnv, limit = 100): Promise<ChatMessage[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?`
  )
    .bind(limit)
    .all<ChatMessage>()
  return (results ?? []).reverse()
}

export async function postChatMessage(env: LineEnv, content: string, author: string): Promise<ChatMessage> {
  const id = genId()
  const createdAt = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, content, author, created_at) VALUES (?, ?, ?, ?)`
  )
    .bind(id, content, author, createdAt)
    .run()
  return { id, content, author, created_at: createdAt }
}

// 疑似リアルタイム用: 指定した created_at より新しい発言だけを取得する(ポーリングAPI用)。
// created_at が完全一致するケース(同一ミリ秒の投稿)も取り漏らさないよう、
// 同時に直前の既知ID一覧を渡して除外する。
export async function listChatMessagesAfter(env: LineEnv, afterCreatedAt: string, excludeIds: string[] = []): Promise<ChatMessage[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM chat_messages WHERE created_at >= ? ORDER BY created_at ASC LIMIT 50`
  )
    .bind(afterCreatedAt)
    .all<ChatMessage>()
  const excludeSet = new Set(excludeIds)
  return (results ?? []).filter((m) => !excludeSet.has(m.id))
}

// JSON API(ポーリング/Ajax投稿)向けにチャットメッセージをプレーンなデータへ変換。
// HTMLエスケープはしない — クライアント側で textContent を使って挿入するため、
// ここで生の値のまま返してよい(JSONレスポンスはHTMLとして解釈されない)。
export function chatMessageToJson(m: ChatMessage): { id: string; author: string; content: string; createdAt: string; timeLabel: string } {
  return { id: m.id, author: m.author, content: m.content, createdAt: m.created_at, timeLabel: formatDateShort(m.created_at) }
}

export async function listComments(env: LineEnv, threadId: string): Promise<ThreadComment[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM thread_comments WHERE thread_id = ? ORDER BY created_at ASC`
  )
    .bind(threadId)
    .all<ThreadComment>()
  return results ?? []
}

export async function postComment(env: LineEnv, threadId: string, author: string, content: string): Promise<string> {
  const id = genId()
  const createdAt = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO thread_comments (id, thread_id, author, content, created_at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, threadId, author, content, createdAt)
    .run()
  return id
}

// 利用ガイドページの「通報・お問い合わせ」フォーム送信内容をD1へ保存する。
// デモHTML(bbs-guide.html)は偽の「受け付けました」表示のみだったが、
// 本実装では実際にcontact_messagesテーブルへ保存し、保存成功後にのみ
// 成功メッセージを返す(フェイク成功表示は禁止)。
export async function saveContactMessage(env: LineEnv, content: string): Promise<string> {
  const id = genId()
  const createdAt = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO contact_messages (id, content, created_at) VALUES (?, ?, ?)`
  )
    .bind(id, content, createdAt)
    .run()
  return id
}

// --- Lightweight spam / rate-limit guard ---
// D1-backed (no in-memory state survives across Worker invocations). Keyed
// by a caller-supplied client key (typically a hash of IP + route). Returns
// true if the action should be BLOCKED (posted too recently).
const RATE_LIMIT_SECONDS = 15

export async function isRateLimited(env: LineEnv, clientKey: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT last_posted_at FROM post_rate_limits WHERE client_key = ?`)
    .bind(clientKey)
    .first<{ last_posted_at: string }>()
  if (!row) return false
  const elapsed = (Date.now() - new Date(row.last_posted_at).getTime()) / 1000
  return elapsed < RATE_LIMIT_SECONDS
}

export async function touchRateLimit(env: LineEnv, clientKey: string): Promise<void> {
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO post_rate_limits (client_key, last_posted_at, post_count) VALUES (?, ?, 1)
     ON CONFLICT(client_key) DO UPDATE SET last_posted_at = excluded.last_posted_at, post_count = post_count + 1`
  )
    .bind(clientKey, now)
    .run()
}

export async function getStats(env: LineEnv): Promise<{ threadCount: number; chatCount: number; totalLikes: number }> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM threads) as threadCount,
       (SELECT COUNT(*) FROM chat_messages) as chatCount,
       (SELECT COALESCE(SUM(likes), 0) FROM threads) as totalLikes`
  ).first<{ threadCount: number; chatCount: number; totalLikes: number }>()
  return row ?? { threadCount: 0, chatCount: 0, totalLikes: 0 }
}

// --- 名言カードギャラリー ---
// 「めいく」コマンド(features/quote.ts)で生成されたPNGは quote_images に
// 保存され、既に /quote-image/:id で配信されている(LINEのimageMessageが
// 直接参照する既存の仕組み)。ここではその画像データ自体には一切触れず、
// メタ情報(id/quote_text/author_name/created_at)のみを一覧取得して
// ギャラリーページの描画に使う。image_data(BLOB本体)は取得しない
// (一覧クエリを軽量に保つため。表示時は既存の /quote-image/:id を
// そのまま<img src>に使う)。
export interface GalleryImage {
  id: string
  quote_text: string | null
  author_name: string | null
  created_at: string
}

export interface GalleryResult {
  images: GalleryImage[]
  total: number
  page: number
  totalPages: number
}

const GALLERY_PAGE_SIZE = 24

export async function listGalleryImages(env: LineEnv, page = 1): Promise<GalleryResult> {
  const safePage = Math.max(1, page || 1)
  const offset = (safePage - 1) * GALLERY_PAGE_SIZE

  const [countRow, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as total FROM quote_images`).first<{ total: number }>(),
    env.DB.prepare(
      `SELECT id, quote_text, author_name, created_at FROM quote_images ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(GALLERY_PAGE_SIZE, offset)
      .all<GalleryImage>(),
  ])

  const total = countRow?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / GALLERY_PAGE_SIZE))
  return { images: rows.results ?? [], total, page: safePage, totalPages }
}

export async function getGalleryImageMeta(env: LineEnv, id: string): Promise<GalleryImage | null> {
  const row = await env.DB.prepare(
    `SELECT id, quote_text, author_name, created_at FROM quote_images WHERE id = ?`
  )
    .bind(id)
    .first<GalleryImage>()
  return row ?? null
}

// 管理者専用の削除(features/galleryAdmin.ts の isAdminRequest チェックを
// 通過したリクエストからのみ呼ばれる想定 — 呼び出し側 index.tsx で認可済み
// であることを前提とする)。quote_images 以外のテーブル・「めいく」コマンド
// 処理には一切影響しない。戻り値は実際に削除された行があったかどうか。
export async function deleteGalleryImage(env: LineEnv, id: string): Promise<boolean> {
  const result = await env.DB.prepare(`DELETE FROM quote_images WHERE id = ?`).bind(id).run()
  return (result.meta?.rows_written ?? 0) > 0
}

// --- HTML rendering (server-rendered, professional design, SEO-optimized) ---

export interface PageMeta {
  title: string
  description: string
  path: string // e.g. "/bbs" or "/bbs/123"
  type?: 'website' | 'article'
  noindex?: boolean
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

function renderJsonLd(jsonLd: Record<string, unknown> | Record<string, unknown>[] | undefined): string {
  if (!jsonLd) return ''
  const list = Array.isArray(jsonLd) ? jsonLd : [jsonLd]
  return list
    .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`)
    .join('\n')
}

function pageLayout(
  meta: PageMeta,
  bodyHtml: string,
  activeNav: 'bbs' | 'chat' | 'guide' | 'gallery' | 'other' = 'other'
): string {
  const canonical = `${SITE_URL}${meta.path}`
  const robots = meta.noindex ? 'noindex, nofollow' : 'index, follow'
  const ogType = meta.type ?? 'website'

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${escapeAttr(meta.description)}">
<meta name="robots" content="${robots}">
<meta name="theme-color" content="#197c4c">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/rss+xml" title="${escapeAttr(SITE_NAME)} 新着スレッド" href="${SITE_URL}/bbs/feed.xml">

<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${escapeAttr(meta.title)}">
<meta property="og:description" content="${escapeAttr(meta.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="ja_JP">
<meta property="og:image" content="${SITE_URL}/static/og-image.png">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(meta.title)}">
<meta name="twitter:description" content="${escapeAttr(meta.description)}">
<meta name="twitter:image" content="${SITE_URL}/static/og-image.png">

<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
<link rel="stylesheet" href="/static/bbs.css">
${renderJsonLd(meta.jsonLd)}
</head>
<body class="bbs-body">
<a href="#main-content" class="skip-link">本文へスキップ</a>
<div class="bbs-topline"></div>
<header class="bbs-header">
  <div class="bbs-header-inner">
    <a href="/bbs" class="bbs-logo" aria-label="${escapeAttr(SITE_NAME)} トップへ">
      <span class="bbs-logo-icon"><i class="fa-solid fa-circle-nodes" aria-hidden="true"></i></span>
      <span class="bbs-logo-text">${escapeHtml(SITE_NAME)}</span>
    </a>
    <nav class="bbs-nav" aria-label="メインナビゲーション">
      <a href="/bbs" class="bbs-nav-link ${activeNav === 'bbs' ? 'is-active' : ''}" ${activeNav === 'bbs' ? 'aria-current="page"' : ''}><i class="fa-solid fa-list-ul" aria-hidden="true"></i><span>掲示板</span></a>
      <a href="/bbs/chat" class="bbs-nav-link ${activeNav === 'chat' ? 'is-active' : ''}" ${activeNav === 'chat' ? 'aria-current="page"' : ''}><i class="fa-solid fa-comments" aria-hidden="true"></i><span>チャット</span></a>
      <a href="/gallery" class="bbs-nav-link ${activeNav === 'gallery' ? 'is-active' : ''}" ${activeNav === 'gallery' ? 'aria-current="page"' : ''}><i class="fa-solid fa-images" aria-hidden="true"></i><span>ギャラリー</span></a>
      <a href="/bbs/guide" class="bbs-nav-link ${activeNav === 'guide' ? 'is-active' : ''}" ${activeNav === 'guide' ? 'aria-current="page"' : ''}><i class="fa-solid fa-circle-question" aria-hidden="true"></i><span>ガイド</span></a>
    </nav>
    <a href="/bbs/new" class="bbs-nav-cta"><span>＋</span><span>LINEグループを募集</span></a>
  </div>
</header>
<main id="main-content" class="bbs-main">
${bodyHtml}
</main>
<footer class="bbs-footer">
  <div class="bbs-footer-inner">
    <p class="bbs-footer-brand"><i class="fa-solid fa-circle-nodes" aria-hidden="true"></i> ${escapeHtml(SITE_NAME)}</p>
    <p class="bbs-footer-desc">LINEグループ・オープンチャットの参加者募集ができる無料の掲示板サービス。</p>
    <nav class="bbs-footer-nav" aria-label="フッターナビゲーション">
      <a href="/bbs">掲示板一覧</a>
      <a href="/bbs/chat">オープンチャット</a>
      <a href="/gallery">名言カードギャラリー</a>
      <a href="/bbs/guide">利用ガイド</a>
      <a href="/bbs/new">新規投稿</a>
      <a href="/bbs/feed.xml">RSS</a>
    </nav>
    <p class="bbs-footer-copy">© ${new Date().getFullYear()} ${escapeHtml(SITE_NAME)}　${escapeHtml(SITE_NAME)}はLINEの公式サービスではありません。</p>
  </div>
</footer>
</body>
</html>`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return escapeHtml(iso)
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDateShort(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return escapeHtml(iso)
  const now = Date.now()
  const diffMs = now - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}時間前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay}日前`
  return d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
}

function buildQueryString(params: Record<string, string | number | null | undefined>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') usp.set(k, String(v))
  }
  const s = usp.toString()
  return s ? `?${s}` : ''
}

export interface ThreadsListPageState {
  result: ListThreadsResult
  activeCategory: string | null
  sort: string
  q: string
  stats: { threadCount: number; chatCount: number; totalLikes: number }
}

export function renderThreadsListPage(state: ThreadsListPageState): string {
  const { result, activeCategory, sort, q, stats } = state
  const { threads, total, page, totalPages } = result

  // サイドバーのカテゴリ別件数は実データ(stats)からではなく、現在のクエリと無関係に
  // カテゴリ単位で件数を出す必要があるが、count用の追加クエリは行わず、いま表示中の
  // 一覧のtotalのみをカテゴリ別バッジには使わない(誤解を招く数字を出さないため、
  // 件数バッジは省略し、リンクのみ表示する = フェイクデータを出さない方針)。
  const tabs = [{ value: '', label: 'すべて', icon: 'fa-border-all' }, ...CATEGORIES]
    .map((t) => {
      const isActive = (activeCategory ?? '') === t.value
      const href = `/bbs${buildQueryString({ category: t.value || null, sort, q: q || null })}`
      return `<a href="${href}" class="bbs-tab ${isActive ? 'is-active' : ''}"><i class="fa-solid ${t.icon}" aria-hidden="true"></i><span>${escapeHtml(t.label)}</span></a>`
    })
    .join('')

  const sortLinks = SORT_OPTIONS.map((s) => {
    const isActive = sort === s.value
    const href = `/bbs${buildQueryString({ category: activeCategory, sort: s.value, q: q || null })}`
    return `<a href="${href}" class="bbs-sort-link ${isActive ? 'is-active' : ''}">${escapeHtml(s.label)}</a>`
  }).join('')

  const rows = threads
    .map((t) => {
      const info = categoryInfo(t.category)
      const pin = t.is_pinned
        ? '<span class="bbs-pin-badge" title="固定表示"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i>注目の募集</span>'
        : ''
      return `<article class="bbs-thread-card">
        <a href="/bbs/${encodeURIComponent(t.id)}" class="bbs-thread-card-link">
          <div>
            <div class="bbs-thread-card-top">
              <span class="bbs-category-badge bbs-category-${escapeHtml(t.category)}"><i class="fa-solid ${info.icon}" aria-hidden="true"></i>${escapeHtml(info.label)}</span>
              ${pin}
              <time class="bbs-thread-time" datetime="${escapeHtml(t.created_at)}">${formatDateShort(t.created_at)}</time>
            </div>
            <h2 class="bbs-thread-title">${escapeHtml(t.title)}</h2>
            <p class="bbs-thread-excerpt">${escapeHtml(excerpt(t.content))}</p>
            <div class="bbs-thread-card-bottom">
              <span class="bbs-meta-item"><i class="fa-regular fa-heart" aria-hidden="true"></i>${t.likes}</span>
              <span class="bbs-meta-item"><i class="fa-regular fa-eye" aria-hidden="true"></i>${t.views}</span>
              <span class="bbs-meta-item bbs-meta-author"><i class="fa-regular fa-user" aria-hidden="true"></i>${escapeHtml(t.author)}</span>
            </div>
          </div>
          <span class="bbs-thread-action">詳細を見る<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>
        </a>
      </article>`
    })
    .join('')

  const empty =
    threads.length === 0
      ? `<div class="bbs-empty"><i class="fa-regular fa-folder-open" aria-hidden="true"></i><p>該当する投稿が見つかりませんでした。</p></div>`
      : ''

  const pagination = renderPagination(page, totalPages, { category: activeCategory, sort, q: q || null })

  const heroSubtitle = activeCategory
    ? `「${escapeHtml(categoryInfo(activeCategory).label)}」カテゴリの投稿一覧`
    : SITE_DESCRIPTION

  const title = activeCategory
    ? `${categoryInfo(activeCategory).label}のLINEグループ募集 | ${SITE_NAME}`
    : `LINEグループ募集掲示板｜${SITE_NAME}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: heroSubtitle,
    url: `${SITE_URL}/bbs`,
  }

  return pageLayout(
    { title, description: heroSubtitle, path: `/bbs${buildQueryString({ category: activeCategory, sort: sort === 'new' ? null : sort, q: q || null })}`, jsonLd },
    `<section class="bbs-hero">
      <div>
        <h1 class="bbs-hero-title">LINEグループを、安心して探せる。</h1>
        <p class="bbs-hero-desc">${escapeHtml(heroSubtitle)}</p>
      </div>
      <div class="bbs-stats" role="list" aria-label="サイト統計">
        <span role="listitem"><strong>${stats.threadCount}</strong>件のスレッド</span>
        <span role="listitem"><strong>${stats.chatCount}</strong>件のチャット発言</span>
        <span role="listitem"><strong>${stats.totalLikes}</strong>件のいいね</span>
      </div>
    </section>

    <form method="GET" action="/bbs" class="bbs-search-form" role="search" aria-label="スレッド検索">
      <input type="hidden" name="category" value="${escapeAttr(activeCategory ?? '')}">
      <input type="hidden" name="sort" value="${escapeAttr(sort)}">
      <label class="sr-only" for="bbs-search-input">キーワード検索</label>
      <input id="bbs-search-input" type="search" name="q" value="${escapeAttr(q)}" placeholder="グループ名・趣味・キーワードで検索" class="bbs-search-input" maxlength="100">
      <button type="submit" class="bbs-search-button">検索する</button>
    </form>

    <div class="bbs-layout">
      <aside class="bbs-panel bbs-side">
        <h2>CATEGORY</h2>
        <nav class="bbs-tabs" aria-label="カテゴリ絞り込み">${tabs}</nav>
        <div class="bbs-side-rule"></div>
        <a class="bbs-guide-link" href="/bbs/guide">利用ガイド</a>
        <a class="bbs-guide-link" href="/bbs/guide#safety">安全に使うために</a>
        <a class="bbs-guide-link" href="/bbs/guide#contact">通報・お問い合わせ</a>
      </aside>

      <section>
        <div class="bbs-board-head">
          <h2 class="bbs-list-count">募集を探す <strong>${total}件${q ? `(「${escapeHtml(q)}」で検索)` : ''}</strong></h2>
          <div class="bbs-sort" aria-label="並び替え">${sortLinks}</div>
        </div>
        <div class="bbs-thread-list">${rows}</div>
        ${empty}
        ${pagination}
      </section>

      <aside class="bbs-right">
        <div class="bbs-notice"><b>安心して使うために</b>LINE ID・電話番号・招待リンクの公開にはご注意ください。迷惑行為は通報機能からお知らせいただけます。</div>
        <div class="bbs-panel bbs-side-post">
          <h3>LINEグループを募集する</h3>
          <p>あなたのLINEグループに合う仲間を、無料で探せます。</p>
          <a href="/bbs/new${buildQueryString({ category: activeCategory })}" class="bbs-new-button">LINEグループを募集する<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        </div>
      </aside>
    </div>`,
    'bbs'
  )
}

function renderPagination(page: number, totalPages: number, ctx: { category: string | null; sort: string; q: string | null }): string {
  if (totalPages <= 1) return ''
  const link = (p: number) => `/bbs${buildQueryString({ ...ctx, page: p === 1 ? null : p })}`
  const parts: string[] = []
  if (page > 1) {
    parts.push(`<a href="${link(page - 1)}" class="bbs-page-link" rel="prev"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i>前へ</a>`)
  }
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, page + 2)
  for (let p = start; p <= end; p++) {
    parts.push(`<a href="${link(p)}" class="bbs-page-link ${p === page ? 'is-active' : ''}" aria-current="${p === page ? 'page' : 'false'}">${p}</a>`)
  }
  if (page < totalPages) {
    parts.push(`<a href="${link(page + 1)}" class="bbs-page-link" rel="next">次へ<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>`)
  }
  return `<nav class="bbs-pagination" aria-label="ページナビゲーション">${parts.join('')}</nav>`
}

export function renderThreadDetailPage(t: Thread, comments: ThreadComment[], liked = false): string {
  const info = categoryInfo(t.category)
  const image = t.image_url
    ? `<img src="${escapeHtml(t.image_url)}" alt="投稿添付画像" class="bbs-detail-image" loading="lazy">`
    : ''
  const qr = t.qr_code_url
    ? `<div class="bbs-detail-qr"><p class="bbs-detail-qr-label">参加用QRコード</p><img src="${escapeHtml(t.qr_code_url)}" alt="LINEグループ参加用QRコード" loading="lazy"></div>`
    : ''
  const pin = t.is_pinned
    ? '<span class="bbs-pin-badge"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i>注目の募集</span>'
    : ''

  const commentRows = comments
    .map(
      (cm) => `<li class="bbs-comment">
        <div class="bbs-comment-head">
          <span class="bbs-comment-author"><i class="fa-regular fa-user" aria-hidden="true"></i>${escapeHtml(cm.author)}</span>
          <time class="bbs-comment-time" datetime="${escapeHtml(cm.created_at)}">${formatDateShort(cm.created_at)}</time>
        </div>
        <p class="bbs-comment-body">${escapeHtml(cm.content)}</p>
      </li>`
    )
    .join('')
  const commentEmpty = comments.length === 0 ? `<p class="bbs-comment-empty">まだコメントはありません。最初のコメントを投稿してみましょう。</p>` : ''

  // アバターの2文字イニシャルは投稿者名(実データ)から生成する。
  // デザインモックにあった「活動場所/参加人数/活動頻度/こんな方へ」欄は
  // 実スキーマ(Thread型)に該当フィールドが存在しないため、架空の値を
  // 補うことはせず、この欄自体を省略する(フェイクデータを出さない方針)。
  const hostInitials = t.author.trim().slice(0, 2).toUpperCase() || '？'

  const description = excerpt(t.content, 150)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    headline: t.title,
    text: t.content,
    datePublished: t.created_at,
    author: { '@type': 'Person', name: t.author },
    about: { '@type': 'Thing', name: info.label },
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: t.likes },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ViewAction', userInteractionCount: t.views },
    ],
    commentCount: comments.length,
    mainEntityOfPage: `${SITE_URL}/bbs/${t.id}`,
  }

  return pageLayout(
    { title: `${t.title} | ${SITE_NAME}`, description, path: `/bbs/${t.id}`, type: 'article', jsonLd },
    `<nav class="bbs-breadcrumb" aria-label="パンくずリスト">
      <a href="/bbs">掲示板</a><span aria-hidden="true"> / </span>
      <a href="/bbs?category=${encodeURIComponent(t.category)}">${escapeHtml(info.label)}</a><span aria-hidden="true"> / </span>
      <span aria-current="page">${escapeHtml(excerpt(t.title, 30))}</span>
    </nav>
    <div class="bbs-detail-layout">
      <div class="bbs-detail-content">
        <article class="bbs-detail-card">
          <div class="bbs-detail-head">
            <span class="bbs-category-badge bbs-category-${escapeHtml(t.category)}"><i class="fa-solid ${info.icon}" aria-hidden="true"></i>${escapeHtml(info.label)}</span>
            ${pin}
            <time class="bbs-thread-time" datetime="${escapeHtml(t.created_at)}">${formatDate(t.created_at)}</time>
          </div>
          <h1 class="bbs-detail-title">${escapeHtml(t.title)}</h1>
          <p class="bbs-detail-author"><i class="fa-regular fa-user" aria-hidden="true"></i>${escapeHtml(t.author)}</p>
          <div class="bbs-detail-body">${escapeHtml(t.content)}</div>
          ${image}
          ${qr}
          <div class="bbs-detail-actions">
            <form method="POST" action="/bbs/${encodeURIComponent(t.id)}/like">
              <button type="submit" class="bbs-like-button ${liked ? 'is-liked' : ''}">
                <i class="fa-solid fa-heart" aria-hidden="true"></i>気になる ${t.likes}
              </button>
            </form>
            <span class="bbs-meta-item"><i class="fa-regular fa-eye" aria-hidden="true"></i>${t.views} 回表示</span>
            <div class="bbs-share">
              <a href="https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(`${SITE_URL}/bbs/${t.id}`)}" target="_blank" rel="noopener noreferrer" class="bbs-share-link" aria-label="LINEで共有"><i class="fa-brands fa-line" aria-hidden="true"></i></a>
              <a href="https://twitter.com/intent/tweet?url=${encodeURIComponent(`${SITE_URL}/bbs/${t.id}`)}&text=${encodeURIComponent(t.title)}" target="_blank" rel="noopener noreferrer" class="bbs-share-link" aria-label="Xで共有"><i class="fa-brands fa-x-twitter" aria-hidden="true"></i></a>
            </div>
          </div>
        </article>

        <section class="bbs-section bbs-comments-section" aria-labelledby="comments-heading">
          <h2 id="comments-heading" class="bbs-section-heading"><i class="fa-regular fa-comment" aria-hidden="true"></i>コメント ${comments.length}件</h2>
          <ul class="bbs-comment-list">${commentRows}</ul>
          ${commentEmpty}
          <form method="POST" action="/bbs/${encodeURIComponent(t.id)}/comment" class="bbs-comment-form">
            <div class="bbs-form-row">
              <label for="comment-author" class="bbs-form-label">お名前</label>
              <input id="comment-author" type="text" name="author" required maxlength="30" class="bbs-form-input" placeholder="ニックネーム">
            </div>
            <div class="bbs-form-row">
              <label for="comment-content" class="bbs-form-label">コメント</label>
              <textarea id="comment-content" name="content" required maxlength="500" rows="3" class="bbs-form-textarea" placeholder="コメントを入力してください"></textarea>
            </div>
            <button type="submit" class="bbs-submit-button"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i>コメントする</button>
          </form>
        </section>

        <div class="bbs-back-link">
          <a href="/bbs?category=${encodeURIComponent(t.category)}"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>掲示板一覧に戻る</a>
        </div>
      </div>

      <aside class="bbs-side-panel">
        <div class="bbs-host">
          <span class="bbs-avatar" aria-hidden="true">${escapeHtml(hostInitials)}</span>
          <div>
            <p class="bbs-host-label">投稿者</p>
            <strong class="bbs-host-name">${escapeHtml(t.author)}</strong>
          </div>
        </div>
        <a class="bbs-join-link" href="/bbs/chat">共通チャットへ参加する</a>
        <a class="bbs-chat-link" href="/bbs/guide#rules">参加前のルールを見る<i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>
        <p class="bbs-side-note">参加前に、募集内容と利用ガイドを確認してください。</p>
        <a class="bbs-report-link" href="/bbs/guide#contact">この投稿を通報する</a>
      </aside>
    </div>`,
    'bbs'
  )
}

export function renderNewThreadPage(defaultCategory: string | null, error?: string): string {
  const options = CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c.value)}" ${defaultCategory === c.value ? 'selected' : ''}>${escapeHtml(c.label)}</option>`
  ).join('')
  const errorHtml = error
    ? `<p class="bbs-form-error" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>${escapeHtml(error)}</p>`
    : ''

  return pageLayout(
    { title: `LINEグループ募集を投稿 | ${SITE_NAME}`, description: 'LINEグループ・オープンチャットの参加者募集を新規投稿できます。', path: '/bbs/new', noindex: true },
    `<nav class="bbs-breadcrumb" aria-label="パンくずリスト">
      <a href="/bbs">掲示板</a><span aria-hidden="true"> / </span><span aria-current="page">新規投稿</span>
    </nav>
    <h1 class="bbs-page-title">LINEグループ募集を投稿</h1>
    <p class="bbs-page-lead">LINEグループ・オープンチャットの参加者募集を投稿できます。個人情報の書きすぎにはご注意ください。</p>
    ${errorHtml}
    <form method="POST" action="/bbs/new" class="bbs-form-card">
      <div class="bbs-form-row">
        <label for="new-title" class="bbs-form-label">LINEグループ名 <span class="bbs-required">必須</span></label>
        <input id="new-title" type="text" name="title" required maxlength="100" class="bbs-form-input" placeholder="例: 週末のカフェ巡りLINEグループ">
      </div>
      <div class="bbs-form-row">
        <label for="new-category" class="bbs-form-label">カテゴリ <span class="bbs-required">必須</span></label>
        <select id="new-category" name="category" required class="bbs-form-select">${options}</select>
      </div>
      <div class="bbs-form-row">
        <label for="new-content" class="bbs-form-label">募集内容 <span class="bbs-required">必須</span></label>
        <textarea id="new-content" name="content" required maxlength="2000" rows="8" class="bbs-form-textarea" placeholder="グループの雰囲気、募集条件、参加方法を書いてください"></textarea>
      </div>
      <div class="bbs-form-row">
        <label for="new-author" class="bbs-form-label">お名前 <span class="bbs-required">必須</span></label>
        <input id="new-author" type="text" name="author" required maxlength="30" class="bbs-form-input" placeholder="ニックネーム">
      </div>
      <button type="submit" class="bbs-submit-button bbs-submit-button-large">LINEグループ募集を公開する</button>
    </form>
    <div class="bbs-back-link">
      <a href="/bbs"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>掲示板一覧に戻る</a>
    </div>`,
    'bbs'
  )
}

function renderChatMessageLi(m: ChatMessage): string {
  const initials = m.author.trim().slice(0, 2).toUpperCase() || '？'
  return `<li class="bbs-chat-message" data-msg-id="${escapeAttr(m.id)}">
        <span class="bbs-chat-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
        <div>
          <div class="bbs-chat-head">
            <span class="bbs-chat-author">${escapeHtml(m.author)}</span>
            <time class="bbs-chat-time" datetime="${escapeHtml(m.created_at)}">${formatDateShort(m.created_at)}</time>
          </div>
          <p class="bbs-chat-body">${escapeHtml(m.content)}</p>
        </div>
      </li>`
}

export function renderChatPage(messages: ChatMessage[]): string {
  const rows = messages.map(renderChatMessageLi).join('')
  const empty = messages.length === 0 ? `<p class="bbs-comment-empty">まだ発言がありません。最初の発言をしてみましょう。</p>` : ''
  const latestCreatedAt = messages.length > 0 ? messages[messages.length - 1].created_at : new Date(0).toISOString()
  const latestIds = messages.slice(-50).map((m) => m.id)

  return pageLayout(
    {
      title: `LINEグル募集の相談チャット | ${SITE_NAME}`,
      description: '誰でも自由に参加できるオープンチャットです。LINEグループ探しの雑談にもご利用ください。全員が同じ1つのチャット部屋にリアルタイムで参加できます。',
      path: '/bbs/chat',
      noindex: true,
    },
    `<nav class="bbs-breadcrumb" aria-label="パンくずリスト">
      <a href="/bbs">掲示板</a><span aria-hidden="true"> / </span><span aria-current="page">オープンチャット</span>
    </nav>
    <section class="bbs-hero">
      <div>
        <p class="bbs-eyebrow">LINE GROUP BOARD CHAT</p>
        <h1 class="bbs-hero-title">LINEグル募集の相談チャット</h1>
        <p class="bbs-hero-desc">参加前の疑問やグループの雰囲気を、ひとつの共通スペースで相談できます。</p>
      </div>
    </section>
    <article class="bbs-conversation" aria-label="Circle Board 共通チャット">
      <div class="bbs-form-error" role="alert" id="chat-error" hidden></div>
      <ul id="chat-list" class="bbs-chat-list" data-latest-at="${escapeAttr(latestCreatedAt)}" data-latest-ids="${escapeAttr(latestIds.join(','))}" aria-live="polite">${rows}</ul>
      <p id="chat-empty" class="bbs-comment-empty" style="padding:0 25px 20px" ${messages.length > 0 ? 'hidden' : ''}>まだ発言がありません。最初の発言をしてみましょう。</p>
      <form id="chat-form" method="POST" action="/bbs/chat" class="bbs-chat-form">
        <div class="bbs-form-row">
          <label for="chat-author" class="bbs-form-label sr-only">お名前</label>
          <input id="chat-author" type="text" name="author" placeholder="お名前" required maxlength="30" class="bbs-form-input" autocomplete="off">
        </div>
        <div class="bbs-form-row">
          <label for="chat-content" class="bbs-form-label sr-only">メッセージ</label>
          <input id="chat-content" type="text" name="content" placeholder="メッセージを入力..." required maxlength="1000" class="bbs-form-input" autocomplete="off">
        </div>
        <button type="submit" id="chat-submit" class="bbs-submit-button">送信</button>
      </form>
    </article>
    <p class="bbs-side-note" style="margin-top:13px">投稿前に <a href="/bbs/guide#safety" style="color:var(--bbs-green)">安全に使うための案内</a> をご確認ください。</p>
    <script>
    (function () {
      var list = document.getElementById('chat-list');
      var emptyMsg = document.getElementById('chat-empty');
      var form = document.getElementById('chat-form');
      var submitBtn = document.getElementById('chat-submit');
      var errorBox = document.getElementById('chat-error');
      var authorInput = document.getElementById('chat-author');
      var contentInput = document.getElementById('chat-content');
      var POLL_INTERVAL_MS = 3000;
      var polling = false;

      function scrollToBottomIfNearEnd() {
        var nearBottom = (window.innerHeight + window.scrollY) >= (document.body.offsetHeight - 200);
        return nearBottom;
      }

      function appendMessage(msg, isOwn) {
        var known = list.getAttribute('data-latest-ids').split(',').filter(Boolean);
        if (known.indexOf(msg.id) !== -1) return;
        var li = document.createElement('li');
        li.className = 'bbs-chat-message' + (isOwn ? ' bbs-chat-message-own' : ' bbs-chat-message-new');
        li.setAttribute('data-msg-id', msg.id);

        var avatar = document.createElement('span');
        avatar.className = 'bbs-chat-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = (msg.author || '').trim().slice(0, 2).toUpperCase() || '？';

        var copy = document.createElement('div');

        var head = document.createElement('div');
        head.className = 'bbs-chat-head';
        var authorSpan = document.createElement('span');
        authorSpan.className = 'bbs-chat-author';
        authorSpan.appendChild(document.createTextNode(msg.author));
        var time = document.createElement('time');
        time.className = 'bbs-chat-time';
        time.setAttribute('datetime', msg.createdAt);
        time.textContent = msg.timeLabel;
        head.appendChild(authorSpan);
        head.appendChild(time);

        var body = document.createElement('p');
        body.className = 'bbs-chat-body';
        body.textContent = msg.content;

        copy.appendChild(head);
        copy.appendChild(body);
        li.appendChild(avatar);
        li.appendChild(copy);

        var wasNearBottom = scrollToBottomIfNearEnd();
        list.appendChild(li);
        emptyMsg.hidden = true;

        known.push(msg.id);
        if (known.length > 80) known = known.slice(-80);
        list.setAttribute('data-latest-ids', known.join(','));
        list.setAttribute('data-latest-at', msg.createdAt);

        if (wasNearBottom || isOwn) {
          li.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }

      function poll() {
        if (polling) return;
        polling = true;
        var after = list.getAttribute('data-latest-at');
        fetch('/bbs/chat/messages?after=' + encodeURIComponent(after))
          .then(function (r) { return r.ok ? r.json() : { messages: [] }; })
          .then(function (data) {
            (data.messages || []).forEach(function (m) { appendMessage(m, false); });
          })
          .catch(function () { /* ネットワーク一時エラーは無視して次回ポーリングで回復 */ })
          .finally(function () { polling = false; });
      }

      setInterval(poll, POLL_INTERVAL_MS);
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) poll();
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        errorBox.hidden = true;
        var author = authorInput.value.trim();
        var content = contentInput.value.trim();
        if (!author || !content) return;

        submitBtn.disabled = true;
        var body = new URLSearchParams();
        body.set('author', author);
        body.set('content', content);

        fetch('/bbs/chat/messages', { method: 'POST', body: body })
          .then(function (r) {
            if (r.status === 429) {
              throw new Error('投稿間隔が短すぎます。少し待ってから再度お試しください。');
            }
            if (!r.ok) throw new Error('送信に失敗しました。もう一度お試しください。');
            return r.json();
          })
          .then(function (data) {
            if (data && data.message) appendMessage(data.message, true);
            contentInput.value = '';
          })
          .catch(function (err) {
            errorBox.textContent = err.message || '送信に失敗しました。';
            errorBox.hidden = false;
          })
          .finally(function () {
            submitBtn.disabled = false;
          });
      });
    })();
    </script>
    <noscript><p class="bbs-comment-empty">JavaScriptを有効にすると新着メッセージが自動表示されます。無効の場合はページを再読み込みしてください。</p></noscript>`,
    'chat'
  )
}

// --- 利用ガイドページ (はじめ方/利用ルール/安全のために/よくある質問/お問い合わせ) ---
// デザイン: design/bbs-guide.html。お問い合わせフォームは実際にD1へ保存する
// (デモ版のように「受け付けました」を偽装表示するだけの実装は禁止 — 送信成功
// が確認できた場合のみメッセージを表示する)。

export interface GuideContactState {
  sent?: boolean
  error?: string
}

export function renderGuidePage(state: GuideContactState = {}): string {
  const { sent, error } = state
  const statusHtml = sent
    ? `受け付けました。ご連絡ありがとうございます。`
    : error
    ? `<span class="is-error-inline">${escapeHtml(error)}</span>`
    : ''

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: 'ja',
    mainEntity: [
      {
        '@type': 'Question',
        name: '投稿は無料ですか？',
        acceptedAnswer: { '@type': 'Answer', text: '募集の作成・閲覧・共通チャットの利用は無料です。' },
      },
      {
        '@type': 'Question',
        name: '不適切な投稿を見つけた場合は？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '投稿の詳細画面から通報できます。内容を確認し、必要に応じて非表示・削除の対応を行います。',
        },
      },
      {
        '@type': 'Question',
        name: '募集に参加する前に確認することは？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '活動の目的、対象、頻度、ルールを読んで、無理のない雰囲気かを確認してください。少しでも不安があれば、参加を急がず通報・お問い合わせ窓口を利用してください。',
        },
      },
    ],
  }

  return pageLayout(
    {
      title: `LINEグループ募集の利用ガイド | ${SITE_NAME}`,
      description: 'Circle BoardのLINEグループ募集ガイド。募集の探し方、参加前に確認すること、投稿・会話のルール、安全な使い方を案内します。',
      path: '/bbs/guide',
      type: 'article',
      jsonLd,
    },
    `<nav class="bbs-breadcrumb" aria-label="パンくずリスト">
      <a href="/bbs">掲示板</a><span aria-hidden="true"> / </span><span aria-current="page">利用ガイド</span>
    </nav>
    <section class="bbs-guide-intro">
      <p class="bbs-eyebrow">GUIDE &amp; SAFETY</p>
      <h1 class="bbs-page-title">安心して、ちょうどいいLINEグループを。</h1>
      <p class="bbs-page-lead">LINEグループ募集を気持ちよく使うための、投稿・参加・会話の基本ルールです。</p>
    </section>
    <div class="bbs-guide-layout">
      <nav class="bbs-toc" aria-label="ガイド内目次">
        <h2>CONTENTS</h2>
        <a href="#start">はじめ方</a>
        <a href="#rules">利用ルール</a>
        <a href="#safety">安全のために</a>
        <a href="#faq">よくある質問</a>
        <a href="#contact">お問い合わせ</a>
      </nav>
      <div class="bbs-guide-content">
        <section class="bbs-guide-section" id="start">
          <h2>はじめ方</h2>
          <p>LINEグループの募集を見つけて、内容と参加方法を確認してから参加を検討します。無理のない距離感で、まずは案内を確認しましょう。</p>
          <div class="bbs-steps">
            <article class="bbs-step"><span class="bbs-step-no">01</span><h3>LINEグループを探す</h3><p>カテゴリやキーワードから、興味の近いLINEグループを探します。</p></article>
            <article class="bbs-step"><span class="bbs-step-no">02</span><h3>募集内容・参加方法を確認する</h3><p>目的、頻度、人数、参加方法を読んで、雰囲気を確かめます。</p></article>
            <article class="bbs-step"><span class="bbs-step-no">03</span><h3>LINEで参加希望を伝える</h3><p>募集の案内に沿って、短いあいさつと参加したい理由を添えます。</p></article>
          </div>
        </section>
        <section class="bbs-guide-section" id="rules">
          <h2>利用ルール</h2>
          <p>誰もが安心して過ごせる場にするため、次のことを守ってください。</p>
          <div class="bbs-rules">
            <article class="bbs-rule"><span class="bbs-rule-mark">✓</span><div><h3>相手を尊重する</h3><p>人格を否定する発言、威圧的な言葉、嫌がらせはしないでください。</p></div></article>
            <article class="bbs-rule"><span class="bbs-rule-mark">✓</span><div><h3>募集内容を正確に書く</h3><p>目的・対象・活動内容が分かるように記載し、誤解を招く表現は避けましょう。</p></div></article>
            <article class="bbs-rule"><span class="bbs-rule-mark">✓</span><div><h3>宣伝・勧誘はしない</h3><p>商業目的、投資、宗教、ネットワークビジネスなどへの勧誘は禁止です。</p></div></article>
          </div>
        </section>
        <section class="bbs-guide-section" id="safety">
          <h2>安全に使うために</h2>
          <div class="bbs-safety">
            <h3>LINE ID・QRコード・招待リンクは、急いで公開しない。</h3>
            <p>電話番号、住所、勤務先、金銭に関する情報とあわせて、LINE ID・QRコード・招待リンクの公開には注意してください。少しでも不安なやり取りがあれば、参加を止めて通報してください。掲載されるLINEグループは、それぞれ独立して運営されています。</p>
          </div>
        </section>
        <section class="bbs-guide-section" id="faq">
          <h2>よくある質問</h2>
          <div class="bbs-faq">
            <details><summary>投稿は無料ですか？</summary><p>募集の作成・閲覧・共通チャットの利用は無料です。</p></details>
            <details><summary>不適切な投稿を見つけた場合は？</summary><p>投稿の詳細画面から通報できます。内容を確認し、必要に応じて非表示・削除の対応を行います。</p></details>
            <details><summary>募集に参加する前に確認することは？</summary><p>活動の目的、対象、頻度、ルールを読んで、無理のない雰囲気かを確認してください。少しでも不安があれば、参加を急がず通報・お問い合わせ窓口を利用してください。</p></details>
          </div>
        </section>
        <section class="bbs-guide-section" id="contact">
          <h2>通報・お問い合わせ</h2>
          <div class="bbs-contact-box">
            <p>困ったことや、気になる投稿があればお知らせください。内容を確認し、必要に応じて対応します。</p>
            <form class="bbs-contact-form" id="contact-form" method="POST" action="/bbs/guide/contact">
              <label for="contact-content">内容 <span class="bbs-required">必須</span></label>
              <textarea id="contact-content" name="content" required maxlength="800" placeholder="投稿のタイトルや、気になった理由を入力してください"></textarea>
              <button type="submit" id="contact-submit">送信する</button>
              <p class="bbs-form-status ${error ? 'is-error' : ''}" id="contact-status" aria-live="polite">${statusHtml}</p>
            </form>
          </div>
        </section>
      </div>
    </div>
    <script>
    (function () {
      var form = document.getElementById('contact-form');
      var status = document.getElementById('contact-status');
      var submitBtn = document.getElementById('contact-submit');
      var textarea = document.getElementById('contact-content');
      if (!form) return;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var content = textarea.value.trim();
        if (!content) return;
        submitBtn.disabled = true;
        status.classList.remove('is-error');
        status.textContent = '';
        var body = new URLSearchParams();
        body.set('content', content);
        fetch('/bbs/guide/contact', { method: 'POST', body: body, headers: { 'X-Requested-With': 'fetch' } })
          .then(function (r) {
            if (r.status === 429) throw new Error('送信間隔が短すぎます。少し待ってから再度お試しください。');
            if (!r.ok) throw new Error('送信に失敗しました。もう一度お試しください。');
            return r.json();
          })
          .then(function () {
            status.textContent = '受け付けました。ご連絡ありがとうございます。';
            form.reset();
          })
          .catch(function (err) {
            status.classList.add('is-error');
            status.textContent = err.message || '送信に失敗しました。';
          })
          .finally(function () {
            submitBtn.disabled = false;
          });
      });
    })();
    </script>`,
    'guide'
  )
}

// --- 名言カードギャラリー ページ ---
// 「めいく」コマンドで生成された名言カードPNGを一覧表示する。画像本体は
// 既存の /quote-image/:id エンドポイントをそのまま<img src>に使い、新しい
// 画像配信経路は増やさない(データ破壊禁止・追加のみの方針と同様、既存の
// 配信ロジックにも一切触れない)。件数・件名・投稿者名はすべて実データ
// (quote_images テーブル)そのものであり、フェイクの数値は表示しない。
export function renderGalleryPage(result: GalleryResult, isAdmin = false): string {
  const { images, total, page, totalPages } = result

  // 画像自体(quote_images.image_data)にすでに引用文・著者名が描き込まれて
  // いるため、下にもう一度同じテキストをHTMLで表示すると内容が二重になり
  // 見た目が煩雑になる(ユーザー指摘: 「見た目的にもよくない」)。そのため
  // キャプションには quote_text を再掲せず、投稿日時と(管理者モードのみ)
  // 削除ボタンだけを画像下の薄いオーバーレイに乗せる、参考サイト
  // (miqx.jp/gallery 相当)に近いダークなタイル型に変更した。
  const cards = images
    .map((img) => {
      const imgUrl = `/quote-image/${encodeURIComponent(img.id)}`
      const caption = img.quote_text ? excerpt(img.quote_text, 60) : '名言カード'
      const deleteBtn = isAdmin
        ? `<button type="button" class="bbs-gallery-delete" data-delete-id="${escapeAttr(img.id)}" aria-label="この名言カードを削除"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`
        : ''
      return `<figure class="bbs-gallery-card">
        ${deleteBtn}
        <a href="${imgUrl}" target="_blank" rel="noopener noreferrer" class="bbs-gallery-link">
          <img src="${imgUrl}" alt="${escapeAttr(caption)}" class="bbs-gallery-img" loading="lazy" width="1280" height="720">
          <span class="bbs-gallery-overlay">
            <time class="bbs-gallery-time" datetime="${escapeHtml(img.created_at)}">${formatDateShort(img.created_at)}</time>
          </span>
        </a>
      </figure>`
    })
    .join('')

  const empty =
    images.length === 0
      ? `<div class="bbs-empty bbs-empty-dark"><i class="fa-regular fa-image" aria-hidden="true"></i><p>まだギャラリーに画像がありません。LINEグループで「めいく」コマンドを使うと、ここに表示されます。</p></div>`
      : ''

  const link = (p: number) => `/gallery${p === 1 ? '' : `?page=${p}`}`
  const paginationParts: string[] = []
  if (totalPages > 1) {
    if (page > 1) {
      paginationParts.push(`<a href="${link(page - 1)}" class="bbs-page-link" rel="prev"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i>前へ</a>`)
    }
    const start = Math.max(1, page - 2)
    const end = Math.min(totalPages, page + 2)
    for (let p = start; p <= end; p++) {
      paginationParts.push(`<a href="${link(p)}" class="bbs-page-link ${p === page ? 'is-active' : ''}" aria-current="${p === page ? 'page' : 'false'}">${p}</a>`)
    }
    if (page < totalPages) {
      paginationParts.push(`<a href="${link(page + 1)}" class="bbs-page-link" rel="next">次へ<i class="fa-solid fa-chevron-right" aria-hidden="true"></i></a>`)
    }
  }
  const pagination = paginationParts.length > 0 ? `<nav class="bbs-pagination" aria-label="ページナビゲーション">${paginationParts.join('')}</nav>` : ''

  const adminBar = isAdmin
    ? `<div class="bbs-admin-bar"><span><i class="fa-solid fa-user-shield" aria-hidden="true"></i>管理者としてログイン中</span><form method="POST" action="/gallery/admin/logout" style="display:inline"><button type="submit" class="bbs-admin-logout">ログアウト</button></form></div>`
    : `<div class="bbs-gallery-admin-link"><a href="/gallery/admin"><i class="fa-solid fa-lock" aria-hidden="true"></i>管理者ログイン</a></div>`

  const title = `名言カードギャラリー | ${SITE_NAME}`
  const description = 'LINE Botの「めいく」コマンドで作られた名言カードを一覧で見られるギャラリーです。'
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url: `${SITE_URL}/gallery`,
  }

  return pageLayout(
    { title, description, path: page === 1 ? '/gallery' : `/gallery?page=${page}`, jsonLd },
    `<section class="bbs-hero bbs-hero-gallery">
      <div>
        <h1 class="bbs-hero-title">名言カードギャラリー</h1>
        <p class="bbs-hero-desc">${escapeHtml(description)}</p>
      </div>
      <div class="bbs-stats" role="list" aria-label="ギャラリー統計">
        <span role="listitem"><strong>${total}</strong>枚の名言カード</span>
      </div>
    </section>

    <p class="bbs-gallery-howto"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>LINEグループで「めいく:テキスト」と送るか、誰かのメッセージに「返信」で「めいく」と送ると、名言カードが作られてここに表示されます。</p>

    ${adminBar}
    <div class="bbs-gallery-stage">
      <div class="bbs-gallery-grid">${cards}</div>
      ${empty}
    </div>
    ${pagination}
    ${isAdmin ? renderGalleryAdminScript() : ''}`,
    'gallery'
  )
}

function renderGalleryAdminScript(): string {
  return `<script>
  (function () {
    document.querySelectorAll('[data-delete-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-delete-id');
        if (!confirm('この名言カードを削除しますか？この操作は取り消せません。')) return;
        btn.disabled = true;
        fetch('/gallery/admin/delete/' + encodeURIComponent(id), { method: 'POST' })
          .then(function (r) { if (!r.ok) throw new Error('削除に失敗しました'); })
          .then(function () {
            var card = btn.closest('.bbs-gallery-card');
            if (card) card.remove();
          })
          .catch(function (err) {
            alert(err.message || '削除に失敗しました');
            btn.disabled = false;
          });
      });
    });
  })();
  </script>`
}

// --- 管理者ログインページ ---
export function renderGalleryAdminLoginPage(error?: string): string {
  const errorHtml = error
    ? `<p class="bbs-form-error" role="alert"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>${escapeHtml(error)}</p>`
    : ''
  return pageLayout(
    { title: `管理者ログイン | ${SITE_NAME}`, description: 'ギャラリー管理者ログイン', path: '/gallery/admin', noindex: true },
    `<nav class="bbs-breadcrumb" aria-label="パンくずリスト">
      <a href="/gallery">ギャラリー</a><span aria-hidden="true"> / </span><span aria-current="page">管理者ログイン</span>
    </nav>
    <h1 class="bbs-page-title">管理者ログイン</h1>
    <p class="bbs-page-lead">名言カードギャラリーの削除機能を利用するには、管理者パスワードでログインしてください。</p>
    ${errorHtml}
    <form method="POST" action="/gallery/admin" class="bbs-form-card" style="max-width:420px">
      <div class="bbs-form-row">
        <label for="admin-password" class="bbs-form-label">パスワード <span class="bbs-required">必須</span></label>
        <input id="admin-password" type="password" name="password" required maxlength="200" class="bbs-form-input" autocomplete="current-password">
      </div>
      <button type="submit" class="bbs-submit-button bbs-submit-button-large">ログイン</button>
    </form>
    <div class="bbs-back-link">
      <a href="/gallery"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>ギャラリーに戻る</a>
    </div>`,
    'gallery'
  )
}

export function renderErrorPage(status: number, message: string): string {
  return pageLayout(
    { title: `${message} | ${SITE_NAME}`, description: message, path: '/', noindex: true },
    `<div class="bbs-error-page">
      <p class="bbs-error-code">${status}</p>
      <h1 class="bbs-page-title">${escapeHtml(message)}</h1>
      <a href="/bbs" class="bbs-new-button"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i>掲示板トップへ戻る</a>
    </div>`
  )
}

// --- RSS feed (new threads) ---
export function renderRssFeed(threads: Thread[]): string {
  const items = threads
    .slice(0, 30)
    .map((t) => {
      const link = `${SITE_URL}/bbs/${t.id}`
      return `<item>
  <title>${escapeXml(t.title)}</title>
  <link>${escapeXml(link)}</link>
  <guid isPermaLink="true">${escapeXml(link)}</guid>
  <pubDate>${new Date(t.created_at).toUTCString()}</pubDate>
  <description>${escapeXml(excerpt(t.content, 200))}</description>
</item>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeXml(SITE_NAME)}</title>
  <link>${escapeXml(SITE_URL)}/bbs</link>
  <description>${escapeXml(SITE_DESCRIPTION)}</description>
  <language>ja</language>
${items}
</channel>
</rss>`
}

function escapeXml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
