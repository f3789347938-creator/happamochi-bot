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

export const CATEGORIES: { value: string; label: string }[] = [
  { value: 'love', label: '恋愛' },
  { value: 'hobby', label: '趣味' },
  { value: 'other', label: 'その他' },
]

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

function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? escapeHtml(value)
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// --- Data access ---

export async function listThreads(env: LineEnv, category?: string | null): Promise<Thread[]> {
  const query = category
    ? `SELECT * FROM threads WHERE category = ? ORDER BY is_pinned DESC, created_at DESC`
    : `SELECT * FROM threads ORDER BY is_pinned DESC, created_at DESC`
  const stmt = category ? env.DB.prepare(query).bind(category) : env.DB.prepare(query)
  const { results } = await stmt.all<Thread>()
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

export async function postChatMessage(env: LineEnv, content: string, author: string): Promise<string> {
  const id = genId()
  const createdAt = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, content, author, created_at) VALUES (?, ?, ?, ?)`
  )
    .bind(id, content, author, createdAt)
    .run()
  return id
}

// --- HTML rendering (server-rendered, Tailwind via CDN, all user data escaped) ---

function pageLayout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-50 min-h-screen">
<header class="bg-emerald-700 text-white shadow">
  <div class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
    <a href="/bbs" class="text-lg font-bold"><i class="fa-solid fa-leaf mr-2"></i>葉っぱもち掲示板</a>
    <nav class="text-sm flex gap-4">
      <a href="/bbs" class="hover:underline">募集掲示板</a>
      <a href="/bbs/chat" class="hover:underline">オープンチャット</a>
    </nav>
  </div>
</header>
<main class="max-w-3xl mx-auto px-4 py-6">
${bodyHtml}
</main>
<footer class="text-center text-xs text-gray-400 py-6">© ${new Date().getFullYear()} 葉っぱもち</footer>
</body>
</html>`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return escapeHtml(iso)
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

export function renderThreadsListPage(threads: Thread[], activeCategory: string | null): string {
  const tabs = [{ value: '', label: 'すべて' }, ...CATEGORIES]
    .map((t) => {
      const isActive = (activeCategory ?? '') === t.value
      const href = t.value ? `/bbs?category=${encodeURIComponent(t.value)}` : '/bbs'
      const cls = isActive
        ? 'bg-emerald-700 text-white'
        : 'bg-white text-emerald-700 border border-emerald-300'
      return `<a href="${href}" class="px-3 py-1 rounded-full text-sm ${cls}">${escapeHtml(t.label)}</a>`
    })
    .join('')

  const rows = threads
    .map((t) => {
      const pin = t.is_pinned ? '<span class="text-red-500 mr-1"><i class="fa-solid fa-thumbtack"></i></span>' : ''
      return `<a href="/bbs/${encodeURIComponent(t.id)}" class="block bg-white rounded-lg border border-gray-200 p-4 hover:border-emerald-400 transition">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">${escapeHtml(categoryLabel(t.category))}</span>
          <span class="text-xs text-gray-400">${formatDate(t.created_at)}</span>
        </div>
        <h2 class="font-semibold text-gray-800 break-words">${pin}${escapeHtml(t.title)}</h2>
        <div class="flex gap-4 mt-2 text-xs text-gray-400">
          <span><i class="fa-regular fa-heart mr-1"></i>${t.likes}</span>
          <span><i class="fa-regular fa-eye mr-1"></i>${t.views}</span>
          <span><i class="fa-regular fa-user mr-1"></i>${escapeHtml(t.author)}</span>
        </div>
      </a>`
    })
    .join('')

  const empty = threads.length === 0 ? `<p class="text-center text-gray-400 py-10">まだ投稿がありません。</p>` : ''

  return pageLayout(
    'LINEグループ募集掲示板',
    `<div class="flex items-center justify-between mb-4">
      <h1 class="text-xl font-bold text-gray-800">募集掲示板</h1>
      <a href="/bbs/new${activeCategory ? `?category=${encodeURIComponent(activeCategory)}` : ''}" class="bg-emerald-700 text-white text-sm px-4 py-2 rounded-lg hover:bg-emerald-800">
        <i class="fa-solid fa-plus mr-1"></i>投稿する
      </a>
    </div>
    <div class="flex gap-2 mb-4 flex-wrap">${tabs}</div>
    <div class="space-y-3">${rows}</div>
    ${empty}`
  )
}

export function renderThreadDetailPage(t: Thread, liked = false): string {
  const image = t.image_url
    ? `<img src="${escapeHtml(t.image_url)}" alt="添付画像" class="rounded-lg max-w-full my-3">`
    : ''
  const qr = t.qr_code_url
    ? `<div class="my-3"><p class="text-xs text-gray-400 mb-1">QRコード</p><img src="${escapeHtml(t.qr_code_url)}" alt="QRコード" class="rounded-lg max-w-[200px]"></div>`
    : ''
  const pin = t.is_pinned ? '<span class="text-red-500 mr-1"><i class="fa-solid fa-thumbtack"></i>固定</span>' : ''

  return pageLayout(
    t.title,
    `<a href="/bbs${t.category ? `?category=${encodeURIComponent(t.category)}` : ''}" class="text-sm text-emerald-700 hover:underline"><i class="fa-solid fa-arrow-left mr-1"></i>掲示板に戻る</a>
    <article class="bg-white rounded-lg border border-gray-200 p-5 mt-3">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">${escapeHtml(categoryLabel(t.category))}</span>
        <span class="text-xs text-gray-400">${formatDate(t.created_at)}</span>
      </div>
      <h1 class="text-lg font-bold text-gray-800 break-words mb-2">${pin}${escapeHtml(t.title)}</h1>
      <p class="text-xs text-gray-400 mb-3"><i class="fa-regular fa-user mr-1"></i>${escapeHtml(t.author)}</p>
      <p class="text-gray-700 whitespace-pre-wrap break-words">${escapeHtml(t.content)}</p>
      ${image}
      ${qr}
      <div class="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100">
        <form method="POST" action="/bbs/${encodeURIComponent(t.id)}/like">
          <button type="submit" class="text-sm px-3 py-1.5 rounded-full border ${liked ? 'border-red-400 text-red-500' : 'border-gray-300 text-gray-500'} hover:border-red-400 hover:text-red-500">
            <i class="fa-solid fa-heart mr-1"></i>いいね ${t.likes}
          </button>
        </form>
        <span class="text-xs text-gray-400"><i class="fa-regular fa-eye mr-1"></i>${t.views} views</span>
      </div>
    </article>`
  )
}

export function renderNewThreadPage(defaultCategory: string | null, error?: string): string {
  const options = CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c.value)}" ${defaultCategory === c.value ? 'selected' : ''}>${escapeHtml(c.label)}</option>`
  ).join('')
  const errorHtml = error
    ? `<p class="text-red-600 text-sm mb-3"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${escapeHtml(error)}</p>`
    : ''

  return pageLayout(
    '新規投稿',
    `<a href="/bbs" class="text-sm text-emerald-700 hover:underline"><i class="fa-solid fa-arrow-left mr-1"></i>掲示板に戻る</a>
    <h1 class="text-xl font-bold text-gray-800 mt-3 mb-4">新規投稿</h1>
    ${errorHtml}
    <form method="POST" action="/bbs/new" class="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">カテゴリ</label>
        <select name="category" class="w-full border border-gray-300 rounded-lg px-3 py-2">${options}</select>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">タイトル</label>
        <input type="text" name="title" required maxlength="100" class="w-full border border-gray-300 rounded-lg px-3 py-2">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">本文</label>
        <textarea name="content" required maxlength="2000" rows="6" class="w-full border border-gray-300 rounded-lg px-3 py-2"></textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">お名前</label>
        <input type="text" name="author" required maxlength="30" class="w-full border border-gray-300 rounded-lg px-3 py-2">
      </div>
      <button type="submit" class="w-full bg-emerald-700 text-white py-2.5 rounded-lg font-medium hover:bg-emerald-800">投稿する</button>
    </form>`
  )
}

export function renderChatPage(messages: ChatMessage[]): string {
  const rows = messages
    .map(
      (m) => `<div class="bg-white rounded-lg border border-gray-200 p-3">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-medium text-gray-800">${escapeHtml(m.author)}</span>
          <span class="text-xs text-gray-400">${formatDate(m.created_at)}</span>
        </div>
        <p class="text-gray-700 whitespace-pre-wrap break-words">${escapeHtml(m.content)}</p>
      </div>`
    )
    .join('')
  const empty = messages.length === 0 ? `<p class="text-center text-gray-400 py-10">まだ発言がありません。</p>` : ''

  return pageLayout(
    'オープンチャット',
    `<h1 class="text-xl font-bold text-gray-800 mb-4">オープンチャット</h1>
    <form method="POST" action="/bbs/chat" class="bg-white rounded-lg border border-gray-200 p-4 mb-4 space-y-3">
      <input type="text" name="author" placeholder="お名前" required maxlength="30" class="w-full border border-gray-300 rounded-lg px-3 py-2">
      <textarea name="content" placeholder="メッセージ" required maxlength="1000" rows="3" class="w-full border border-gray-300 rounded-lg px-3 py-2"></textarea>
      <button type="submit" class="w-full bg-emerald-700 text-white py-2 rounded-lg font-medium hover:bg-emerald-800">送信</button>
    </form>
    <div class="space-y-2">${rows}</div>
    ${empty}`
  )
}
