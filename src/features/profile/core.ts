// 個人ステータス(レベル/EXP/ポイント)・テーマ・共通称号のデータ層。
//
// 設計の要点:
//   ・累計EXP(total_exp)だけを保存し、レベルとレベル内EXPは都度計算する。
//     計算式を後で直しても過去データが壊れないため。
//   ・人単位・全グループ共通。既存のグループ別称号(user_titles)には触らない。
//   ・EXP加算は「1通=1EXP」。同じイベントの再受信で二重加算しないよう
//     exp_events に一意キーを入れてから加算する。
//   ・ポイントはEXPと同時に1増える。購入時の引き落としは point_ledger の
//     reason_key の一意制約で二重成立を防ぐ。
import type { LineEnv } from '../../lib/line'

// === レベル計算 ==========================================================
// 必要EXP = 100 + 8 * (level - 1)
//   Lv.1→2 = 100 / Lv.19→20 = 100 + 8*18 = 244
// レベル上限は設けない。称号のLv.200は解放条件であって上限ではない。
export function expForLevel(level: number): number {
  return 100 + 8 * (Math.max(1, level) - 1)
}

// === 運勢(ステータスカードの表示項目) ====================================
// 見本(01-status.png)にある「中吉」のバッジ。削除済みの星座占い自動配信とは
// 無関係で、DBも使わない。「人 + 日付」から決定的に決まるので、同じ日に何度
// ステータスを開いても同じ結果になり、日付が変わると変わる。
export const FORTUNE_LABELS = ['大吉', '中吉', '小吉', '吉', '末吉'] as const

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** JSTの日付文字列(YYYY-MM-DD)。運勢の切り替わりを日本時間の0時に合わせる。 */
export function jstDateString(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

/** その人のその日の運勢。ユーザーIDは表に出さず、ハッシュ経由でのみ使う。 */
export function dailyFortune(userId: string, now: Date = new Date()): string {
  const h = hashString(`${jstDateString(now)}|${userId}`)
  return FORTUNE_LABELS[h % FORTUNE_LABELS.length]
}

export interface LevelInfo {
  level: number
  /** 現在レベル内で獲得済みのEXP */
  expInLevel: number
  /** 次のレベルに必要なEXP */
  expNeeded: number
  /** 0〜100 に丸めた進捗率 */
  percent: number
}

/**
 * 累計EXPからレベルと進捗を求める。
 * レベルアップ時の余りは次のレベルへ繰り越される(単純な逐次減算)。
 *
 * 上限が無いので理屈上は無限ループになりうるが、必要EXPは
 * レベルとともに増えるため実際の累計EXPで終わる。安全のため
 * 極端な値でも止まるように上限回数を入れてある。
 */
export function levelFromTotalExp(totalExp: number): LevelInfo {
  let remaining = Math.max(0, Math.floor(totalExp))
  let level = 1
  // 100万レベルまで回れば現実的な累計EXPは必ず収まる(保険)。
  for (let i = 0; i < 1_000_000; i++) {
    const need = expForLevel(level)
    if (remaining < need) {
      const percent = need > 0 ? Math.min(100, Math.max(0, (remaining / need) * 100)) : 0
      return { level, expInLevel: remaining, expNeeded: need, percent }
    }
    remaining -= need
    level++
  }
  const need = expForLevel(level)
  return { level, expInLevel: remaining, expNeeded: need, percent: 0 }
}

// === プロフィール ========================================================
export interface UserProfile {
  user_id: string
  public_id: string
  display_name: string | null
  picture_url: string | null
  total_exp: number
  points: number
  active_theme: string
  equipped_title: string | null
}

/** 公開ページ用のID。LINEのユーザーIDは絶対に使わない。 */
function newPublicId(): string {
  const b = new Uint8Array(9)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14)
}

/**
 * プロフィールを取得する。無ければ作る(初期値 Lv.1 / EXP0 / ポイント0)。
 * 参加登録・参加確認は不要という指示に従い、初回アクセスで自動作成する。
 */
export async function ensureProfile(
  env: LineEnv,
  userId: string,
  displayName?: string | null,
  pictureUrl?: string | null
): Promise<UserProfile> {
  const existing = await env.DB.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`)
    .bind(userId)
    .first<UserProfile>()

  if (existing) {
    // 表示名・アイコンは最新に追随させる(Web公開にも使うため)。
    if (
      (displayName && displayName !== existing.display_name) ||
      (pictureUrl && pictureUrl !== existing.picture_url)
    ) {
      await env.DB.prepare(
        `UPDATE user_profiles SET display_name = COALESCE(?, display_name),
                picture_url = COALESCE(?, picture_url), updated_at = datetime('now')
          WHERE user_id = ?`
      )
        .bind(displayName ?? null, pictureUrl ?? null, userId)
        .run()
      return {
        ...existing,
        display_name: displayName ?? existing.display_name,
        picture_url: pictureUrl ?? existing.picture_url,
      }
    }
    return existing
  }

  // 作成。public_id が衝突したら作り直す(UNIQUE制約で弾かれる)。
  for (let i = 0; i < 5; i++) {
    try {
      await env.DB.prepare(
        `INSERT INTO user_profiles (user_id, public_id, display_name, picture_url)
         VALUES (?, ?, ?, ?)`
      )
        .bind(userId, newPublicId(), displayName ?? null, pictureUrl ?? null)
        .run()
      break
    } catch {
      // 同時作成で user_id が既に入った場合も含めて、次のSELECTで拾う。
      const now = await env.DB.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`)
        .bind(userId)
        .first<UserProfile>()
      if (now) return now
    }
  }

  const created = await env.DB.prepare(`SELECT * FROM user_profiles WHERE user_id = ?`)
    .bind(userId)
    .first<UserProfile>()
  if (created) return created
  // ここに来るのは異常系。呼び出し側を落とさないため既定値を返す。
  return {
    user_id: userId,
    public_id: '',
    display_name: displayName ?? null,
    picture_url: pictureUrl ?? null,
    total_exp: 0,
    points: 0,
    active_theme: 'aqua',
    equipped_title: null,
  }
}

export async function getProfileByPublicId(
  env: LineEnv,
  publicId: string
): Promise<UserProfile | null> {
  return await env.DB.prepare(`SELECT * FROM user_profiles WHERE public_id = ?`)
    .bind(publicId)
    .first<UserProfile>()
}

// === EXP / ポイントの加算 ================================================
/**
 * 本人が新しく送った1通に対して EXP+1 / ポイント+1 する。
 *
 * eventKey は「その1通」を一意に表す文字列(webhookEventId、無ければ
 * message.id)。exp_events に INSERT OR IGNORE してから加算するため、
 * Webhookの再送や同じメッセージの再受信では2回目が加算されない。
 * これは連呼対策ではなく「1通を1回と数える」ための処理。
 *
 * 連呼対策(C案): 直前と同じ本文なら加算しない。
 *   ・「あ」「あ」→ 2通目は加算なし。「あ」「い」「あ」→ 全部加算。
 *   ・1日/時間あたりの獲得制限は付けない(方針どおり)。
 *   ・比較できるのはテキストだけなので、スタンプ・画像などは従来どおり
 *     常に加算し、直前本文の記録は消して連続扱いにしない。
 *   ・前後の空白のみを揃えて比較する。大文字小文字や全角半角は
 *     区別したまま(むやみに同一視すると正当な発言まで落ちるため)。
 *
 * 失敗しても例外を投げない(既存のBot処理を止めないため)。
 * 戻り値はレベルアップしたときだけ新レベルを返す。
 */
export async function addExpForMessage(
  env: LineEnv,
  userId: string,
  eventKey: string | null,
  displayName?: string | null,
  pictureUrl?: string | null,
  messageText?: string | null
): Promise<{ leveledUpTo: number | null }> {
  try {
    if (!eventKey) return { leveledUpTo: null }

    const claimed = await env.DB.prepare(
      `INSERT OR IGNORE INTO exp_events (event_key, user_id) VALUES (?, ?)`
    )
      .bind(eventKey, userId)
      .run()
    // 既に処理済み = 二重加算しない
    if (!claimed.meta.changes) return { leveledUpTo: null }

    // --- 連呼対策: 直前と同じ本文なら加算しない -------------------------
    // テキスト以外は本文が無いので比較しない(= 必ず加算する)。
    const text = typeof messageText === 'string' ? messageText.trim() : null
    if (text !== null && text.length > 0) {
      const prev = await env.DB.prepare(
        `SELECT last_text FROM exp_last_message WHERE user_id = ?`
      )
        .bind(userId)
        .first<{ last_text: string | null }>()

      if (prev?.last_text !== null && prev?.last_text !== undefined && prev.last_text === text) {
        // 直前と同じ本文 = 連呼。加算しないが、記録は最新に保つ。
        await env.DB.prepare(
          `INSERT INTO exp_last_message (user_id, last_text, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(user_id) DO UPDATE SET
             last_text = excluded.last_text, updated_at = datetime('now')`
        )
          .bind(userId, text)
          .run()
        return { leveledUpTo: null }
      }

      // 別の本文 = 加算対象。直前本文を更新しておく。
      await env.DB.prepare(
        `INSERT INTO exp_last_message (user_id, last_text, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           last_text = excluded.last_text, updated_at = datetime('now')`
      )
        .bind(userId, text)
        .run()
    } else {
      // スタンプ・画像など、本文で比較できないもの。
      // 直前本文を消し、「あ」→スタンプ→「あ」が連呼扱いにならないようにする。
      await env.DB.prepare(
        `INSERT INTO exp_last_message (user_id, last_text, updated_at)
         VALUES (?, NULL, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           last_text = NULL, updated_at = datetime('now')`
      )
        .bind(userId)
        .run()
    }

    const before = await ensureProfile(env, userId, displayName, pictureUrl)
    const beforeLevel = levelFromTotalExp(before.total_exp).level

    // EXPとポイントを同時に1増やす。
    await env.DB.prepare(
      `UPDATE user_profiles
          SET total_exp = total_exp + 1, points = points + 1, updated_at = datetime('now')
        WHERE user_id = ?`
    )
      .bind(userId)
      .run()

    const afterLevel = levelFromTotalExp(before.total_exp + 1).level
    return { leveledUpTo: afterLevel > beforeLevel ? afterLevel : null }
  } catch {
    return { leveledUpTo: null }
  }
}

// === テーマ ==============================================================
export interface Theme {
  id: string
  name: string
  price: number
  header_bg: string
  body_bg: string
  text_color: string
  accent: string
  header_text: string
  display_order: number
}

export const DEFAULT_THEME_ID = 'aqua'

export async function listThemes(env: LineEnv): Promise<Theme[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM theme_master ORDER BY display_order`
  ).all<Theme>()
  return results ?? []
}

export async function getTheme(env: LineEnv, themeId: string): Promise<Theme | null> {
  return await env.DB.prepare(`SELECT * FROM theme_master WHERE id = ?`)
    .bind(themeId)
    .first<Theme>()
}

/**
 * テーマ設定を取得する。欠損・読み込み失敗時は必ず水色に戻す。
 * (名言カード生成をテーマの不備で壊さないため)
 */
export async function resolveThemeForUser(env: LineEnv, userId: string | null): Promise<Theme> {
  const fallback: Theme = {
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
  try {
    if (!userId) return fallback
    const row = await env.DB.prepare(
      `SELECT t.* FROM user_profiles p JOIN theme_master t ON t.id = p.active_theme
        WHERE p.user_id = ?`
    )
      .bind(userId)
      .first<Theme>()
    return row ?? fallback
  } catch {
    return fallback
  }
}

export async function listOwnedThemeIds(env: LineEnv, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT theme_id FROM user_themes WHERE user_id = ?`
  )
    .bind(userId)
    .all<{ theme_id: string }>()
  const owned = (results ?? []).map((r) => r.theme_id)
  // 無料テーマは購入不要で常に所持扱い。
  if (!owned.includes(DEFAULT_THEME_ID)) owned.push(DEFAULT_THEME_ID)
  return owned
}

export async function ownsTheme(env: LineEnv, userId: string, themeId: string): Promise<boolean> {
  if (themeId === DEFAULT_THEME_ID) return true
  const t = await getTheme(env, themeId)
  if (t && t.price === 0) return true
  const row = await env.DB.prepare(
    `SELECT 1 FROM user_themes WHERE user_id = ? AND theme_id = ?`
  )
    .bind(userId, themeId)
    .first()
  return !!row
}

/** 所持しているテーマを適用する。適用・再適用は無料。 */
export async function applyTheme(
  env: LineEnv,
  userId: string,
  themeId: string
): Promise<{ ok: boolean; reason?: string }> {
  const theme = await getTheme(env, themeId)
  if (!theme) return { ok: false, reason: 'そのテーマは存在しません。' }
  if (!(await ownsTheme(env, userId, themeId))) {
    return { ok: false, reason: 'そのテーマはまだ持っていません。' }
  }
  await env.DB.prepare(
    `UPDATE user_profiles SET active_theme = ?, updated_at = datetime('now') WHERE user_id = ?`
  )
    .bind(themeId, userId)
    .run()
  return { ok: true }
}

export type PurchaseResult =
  | { ok: true; spent: number; balance: number }
  | { ok: false; reason: string; kind: 'already' | 'notfound' | 'free' | 'insufficient' | 'error' }

/**
 * テーマを購入する。
 *
 * 二重消費を防ぐ仕組み:
 *   1. point_ledger.reason_key を `theme:<userId>:<themeId>` にして UNIQUE。
 *      同じテーマの購入は何回押しても1行しか入らない。
 *   2. 残高チェックは条件付きUPDATE(`WHERE points >= ?`)で行い、
 *      変更行数が0なら残高不足として扱う。SELECT→UPDATEの間に
 *      別の操作が走っても二重に引き落とされない。
 *   3. 台帳を先に確保 → 減算 → 所持登録の順にする。減算に失敗したら
 *      台帳を戻し、ポイントだけ減る状態を作らない。
 *
 * 価格はサーバーの theme_master を正とする(古い確認画面の価格は使わない)。
 */
export async function purchaseTheme(
  env: LineEnv,
  userId: string,
  themeId: string
): Promise<PurchaseResult> {
  try {
    const theme = await getTheme(env, themeId)
    if (!theme) return { ok: false, kind: 'notfound', reason: 'そのテーマは存在しません。' }
    if (theme.price <= 0) {
      return { ok: false, kind: 'free', reason: 'そのテーマは無料なので購入は不要です。' }
    }
    if (await ownsTheme(env, userId, themeId)) {
      return { ok: false, kind: 'already', reason: 'そのテーマはすでに持っています。' }
    }

    const profile = await ensureProfile(env, userId)
    if (profile.points < theme.price) {
      return {
        ok: false,
        kind: 'insufficient',
        reason: `ポイントが足りません（必要 ${theme.price} / 保有 ${profile.points}）。`,
      }
    }

    // 1. 台帳を確保(同じ購入の2回目はここで弾かれる)
    const reasonKey = `theme:${userId}:${themeId}`
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO point_ledger (user_id, delta, reason, reason_key)
       VALUES (?, ?, ?, ?)`
    )
      .bind(userId, -theme.price, `テーマ購入: ${theme.name}`, reasonKey)
      .run()
    if (!claim.meta.changes) {
      // すでに購入処理が走っている。所持登録だけ念のため保証する。
      await env.DB.prepare(
        `INSERT OR IGNORE INTO user_themes (user_id, theme_id) VALUES (?, ?)`
      )
        .bind(userId, themeId)
        .run()
      return { ok: false, kind: 'already', reason: 'そのテーマはすでに持っています。' }
    }

    // 2. 残高を条件付きで減算(足りなければ0行 → 台帳を戻す)
    const dec = await env.DB.prepare(
      `UPDATE user_profiles SET points = points - ?, updated_at = datetime('now')
        WHERE user_id = ? AND points >= ?`
    )
      .bind(theme.price, userId, theme.price)
      .run()
    if (!dec.meta.changes) {
      await env.DB.prepare(`DELETE FROM point_ledger WHERE reason_key = ?`).bind(reasonKey).run()
      const p = await ensureProfile(env, userId)
      return {
        ok: false,
        kind: 'insufficient',
        reason: `ポイントが足りません（必要 ${theme.price} / 保有 ${p.points}）。`,
      }
    }

    // 3. 所持登録
    await env.DB.prepare(`INSERT OR IGNORE INTO user_themes (user_id, theme_id) VALUES (?, ?)`)
      .bind(userId, themeId)
      .run()

    const after = await ensureProfile(env, userId)
    return { ok: true, spent: theme.price, balance: after.points }
  } catch {
    return { ok: false, kind: 'error', reason: '購入処理に失敗しました。もう一度お試しください。' }
  }
}

// === 共通称号 ============================================================
export interface CommonTitle {
  id: string
  category: string
  name: string
  name_norm: string
  display_order: number
  unlock_type: 'free' | 'level' | 'othello_wins'
  unlock_value: number | null
  unlock_label: string
  rule_status: string
}

export interface TitleCategory {
  id: string
  name: string
  kind: string
  display_order: number
}

/** 検索・比較用の正規化。表示名は書き換えない。 */
export function normalizeName(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim()
}

export async function listTitleCategories(env: LineEnv): Promise<TitleCategory[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM common_title_category ORDER BY display_order`
  ).all<TitleCategory>()
  return results ?? []
}

export async function getCommonTitle(env: LineEnv, id: string): Promise<CommonTitle | null> {
  return await env.DB.prepare(`SELECT * FROM common_title_master WHERE id = ?`)
    .bind(id)
    .first<CommonTitle>()
}

/** 名前(部分一致・正規化)で共通称号を探す */
export async function findTitlesByName(env: LineEnv, query: string): Promise<CommonTitle[]> {
  const norm = normalizeName(query)
  if (!norm) return []
  const { results } = await env.DB.prepare(
    `SELECT * FROM common_title_master WHERE name_norm LIKE ? ORDER BY display_order LIMIT 200`
  )
    .bind(`%${norm}%`)
    .all<CommonTitle>()
  return results ?? []
}

/** ユーザーのオセロ勝利数。取れなければ null(推測して解放しない)。 */
export async function getOthelloWins(env: LineEnv, userId: string): Promise<number | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(wins), 0) AS w FROM othello_records WHERE user_id = ?`
    )
      .bind(userId)
      .first<{ w: number }>()
    return row?.w ?? 0
  } catch {
    return null
  }
}

export interface TitleAvailability {
  /** 使えるか(自由選択、または条件を満たしている、または解放履歴がある) */
  usable: boolean
  /** 使えない理由(未解放時の条件表示用) */
  lockLabel: string | null
}

/**
 * 称号が使えるかを判定する。
 *
 * ・自由選択(free)は常に使える。
 * ・条件付きは「解放履歴がある」か「現在の値が条件を満たす」なら使える。
 *   一度解放したものは後から没収しない(履歴を優先)。
 * ・値が取得できない実績は推測で解放しない → 未解放表示のまま。
 */
export function judgeTitle(
  title: CommonTitle,
  ctx: { level: number; othelloWins: number | null; unlockedIds: Set<string> }
): TitleAvailability {
  if (title.unlock_type === 'free') return { usable: true, lockLabel: null }
  if (ctx.unlockedIds.has(title.id)) return { usable: true, lockLabel: null }

  if (title.unlock_type === 'level') {
    const need = title.unlock_value ?? 0
    if (ctx.level >= need) return { usable: true, lockLabel: null }
    return { usable: false, lockLabel: `Lv.${need} で解放` }
  }

  if (title.unlock_type === 'othello_wins') {
    const need = title.unlock_value ?? 0
    // 値が取れない場合は解放しない(安全側)
    if (ctx.othelloWins === null) return { usable: false, lockLabel: `オセロ${need}勝で解放` }
    if (ctx.othelloWins >= need) return { usable: true, lockLabel: null }
    return { usable: false, lockLabel: `オセロ${need}勝で解放` }
  }

  return { usable: false, lockLabel: title.unlock_label }
}

export async function listUnlockedTitleIds(env: LineEnv, userId: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    `SELECT title_id FROM user_common_titles WHERE user_id = ?`
  )
    .bind(userId)
    .all<{ title_id: string }>()
  return new Set((results ?? []).map((r) => r.title_id))
}

/** 条件を満たした称号の解放履歴を残す(以後、条件が変わっても没収しない) */
export async function recordUnlock(env: LineEnv, userId: string, titleId: string): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO user_common_titles (user_id, title_id) VALUES (?, ?)`
    )
      .bind(userId, titleId)
      .run()
  } catch {
    /* 解放履歴の記録失敗は装備判定に影響させない */
  }
}

/**
 * 共通称号を装備する。使える称号だけ装備できる。
 * レベルが上がっても本人の装備を自動で別の称号に変えない。
 */
export async function equipCommonTitle(
  env: LineEnv,
  userId: string,
  titleId: string
): Promise<{ ok: boolean; reason?: string; name?: string }> {
  const title = await getCommonTitle(env, titleId)
  if (!title) return { ok: false, reason: 'その称号は存在しません。' }

  const profile = await ensureProfile(env, userId)
  const level = levelFromTotalExp(profile.total_exp).level
  const wins = await getOthelloWins(env, userId)
  const unlocked = await listUnlockedTitleIds(env, userId)
  const j = judgeTitle(title, { level, othelloWins: wins, unlockedIds: unlocked })
  if (!j.usable) {
    return { ok: false, reason: `「${title.name}」はまだ解放されていません（${j.lockLabel}）。` }
  }

  // 条件付き称号を実際に使ったので解放履歴を残す
  if (title.unlock_type !== 'free') await recordUnlock(env, userId, title.id)

  await env.DB.prepare(
    `UPDATE user_profiles SET equipped_title = ?, updated_at = datetime('now') WHERE user_id = ?`
  )
    .bind(titleId, userId)
    .run()
  return { ok: true, name: title.name }
}

// === 個人ランキング ======================================================
export interface RankRow {
  rank: number
  public_id: string
  display_name: string | null
  picture_url: string | null
  total_exp: number
  level: number
}

/**
 * 累計EXPの多い順の全体順位。同じEXPは同順位で、次は人数分飛ぶ
 * (1位, 2位, 2位, 4位)。
 */
export async function getPersonalRank(env: LineEnv, userId: string): Promise<number | null> {
  try {
    const me = await env.DB.prepare(`SELECT total_exp FROM user_profiles WHERE user_id = ?`)
      .bind(userId)
      .first<{ total_exp: number }>()
    if (!me) return null
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS higher FROM user_profiles WHERE total_exp > ?`
    )
      .bind(me.total_exp)
      .first<{ higher: number }>()
    return (row?.higher ?? 0) + 1
  } catch {
    return null
  }
}

export async function getRankByPublicId(env: LineEnv, publicId: string): Promise<number | null> {
  const p = await getProfileByPublicId(env, publicId)
  if (!p) return null
  return await getPersonalRank(env, p.user_id)
}

export async function listRanking(
  env: LineEnv,
  limit = 100,
  offset = 0
): Promise<RankRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT public_id, display_name, picture_url, total_exp
       FROM user_profiles ORDER BY total_exp DESC, created_at ASC LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all<{ public_id: string; display_name: string | null; picture_url: string | null; total_exp: number }>()

  const rows = results ?? []
  // 同EXP同順位。offset があるので、先頭の順位はDBに問い合わせて求める。
  let baseRank = 1
  if (rows.length > 0) {
    const first = await env.DB.prepare(
      `SELECT COUNT(*) AS higher FROM user_profiles WHERE total_exp > ?`
    )
      .bind(rows[0].total_exp)
      .first<{ higher: number }>()
    baseRank = (first?.higher ?? 0) + 1
  }

  const out: RankRow[] = []
  let prevExp: number | null = null
  let prevRank = baseRank
  rows.forEach((r, i) => {
    let rank: number
    if (prevExp !== null && r.total_exp === prevExp) {
      rank = prevRank
    } else {
      rank = baseRank + i
      prevRank = rank
    }
    prevExp = r.total_exp
    out.push({
      rank,
      public_id: r.public_id,
      display_name: r.display_name,
      picture_url: r.picture_url,
      total_exp: r.total_exp,
      level: levelFromTotalExp(r.total_exp).level,
    })
  })
  return out
}

export async function countProfiles(env: LineEnv): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS c FROM user_profiles`).first<{ c: number }>()
  return row?.c ?? 0
}
