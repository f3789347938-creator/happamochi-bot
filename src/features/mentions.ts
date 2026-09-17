// 「めんかく」= メンション確認。
//
// 自分がメンションされたメッセージを、引用(リプライ)付きで最大4件返す。
//
// 【LINEの仕様で決まっている制約】
//   ・応答メッセージは1回に最大5通。案内文1通 + 引用4通 = ちょうど5通。
//     これが「最大4件」の根拠(見本のスクリーンショットもこの形)。
//   ・引用トークンを使えるのは text / sticker のみ。引用付きで出すため
//     案内文以外はテキストメッセージで送る。
//   ・引用トークンは無期限・再利用可だが、送られたトーク内でしか使えない。
//     そのため取得は必ず group_id で絞る。
//   ・過去分は遡れない(LINEは後から渡してくれない)。記録開始以降のみ。
import type { LineEnv } from '../lib/line'

// 1回に出すメンションの最大件数。
// LINEの「1リプライ5通」制限から、案内文1通を引いた数。
export const MENTION_LIMIT = 4

// 記録を保持する日数。これより古いものは消える。
export const MENTION_RETENTION_DAYS = 7

export interface MentionRow {
  sender_id: string
  sender_name: string | null
  message_id: string
  message_text: string | null
  quote_token: string | null
  created_at: string
}

/**
 * Webhookのテキストメッセージから、自分宛以外も含めた全メンションを記録する。
 *
 * mentionees[].userId は「情報の取得に同意していないユーザー」だと欠落する
 * ことがある(公式仕様)。その場合は誰宛か判定できないので黙って飛ばす。
 * isSelf(ボット自身へのメンション)は「めんかく」の対象外なので除外する。
 *
 * 失敗しても例外を投げない(既存のBot処理を止めないため)。
 */
export async function recordMentions(
  env: LineEnv,
  groupId: string,
  senderId: string,
  senderName: string | null,
  message: any
): Promise<void> {
  try {
    const mentionees = message?.mention?.mentionees
    if (!Array.isArray(mentionees) || mentionees.length === 0) return

    const messageId: string | undefined = message?.id
    if (!messageId) return

    const text: string | null = typeof message?.text === 'string' ? message.text : null
    const quoteToken: string | null =
      typeof message?.quoteToken === 'string' ? message.quoteToken : null

    // 同じメッセージ内の重複メンション(@Aを2回など)は1件に畳む。
    const targets = new Set<string>()
    for (const m of mentionees) {
      // type が 'all'(@all) のときは userId が無い。個人宛ではないので対象外。
      if (m?.type === 'all') continue
      // ボット自身へのメンションは「めんかく」の対象にしない。
      if (m?.isSelf === true) continue
      const uid = m?.userId
      // 同意していないユーザーは userId が欠落する → 誰宛か不明なので飛ばす。
      if (typeof uid !== 'string' || uid.length === 0) continue
      // 自分で自分をメンションした分は出しても意味がないので除く。
      if (uid === senderId) continue
      targets.add(uid)
    }
    if (targets.size === 0) return

    for (const targetId of targets) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO mentions
           (target_id, group_id, sender_id, sender_name, message_id, message_text, quote_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(targetId, groupId, senderId, senderName, messageId, text, quoteToken)
        .run()
    }
  } catch {
    /* メンション記録の失敗は既存機能に影響させない */
  }
}

/**
 * 自分宛の直近メンションを新しい順に取得する。
 *
 * quoteToken はそのトーク内でしか使えないため、必ず group_id で絞る。
 */
export async function getRecentMentions(
  env: LineEnv,
  groupId: string,
  targetId: string,
  limit: number = MENTION_LIMIT
): Promise<MentionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT sender_id, sender_name, message_id, message_text, quote_token, created_at
       FROM mentions
      WHERE target_id = ? AND group_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  )
    .bind(targetId, groupId, limit)
    .all<MentionRow>()
  return results ?? []
}

/**
 * 保持期間(7日)を過ぎたメンションを削除する。
 *
 * cronが使えない(Pages/Workersの制約 + hosted deployはtriggers非対応)ため、
 * 「めんかく」が呼ばれたついでに掃除する遅延実行方式。
 * 失敗してもコマンド本体は動かす。
 */
export async function pruneOldMentions(env: LineEnv): Promise<void> {
  try {
    await env.DB.prepare(
      `DELETE FROM mentions
        WHERE created_at < datetime('now', '-${MENTION_RETENTION_DAYS} days')`
    ).run()
  } catch {
    /* 掃除の失敗はコマンド本体に影響させない */
  }
}

/**
 * 「めんかく」への応答メッセージを組み立てる。
 *
 * 見本どおり、案内文1通 + 各メンションを引用した本文1通ずつ。
 * 引用だけを見せたいので本文は「.」にしてある(引用には本文が必須)。
 */
export function buildMentionMessages(rows: MentionRow[]): any[] {
  if (rows.length === 0) {
    return [
      {
        type: 'text',
        text: 'まだメンションされてないみたい！\n（「めんかく」を作る前のメンションは見れないよ）',
      },
    ]
  }

  const messages: any[] = [
    {
      type: 'text',
      text: `直近でメンションされたメッセージ最大${MENTION_LIMIT}件をリプライするよ！`,
    },
  ]

  // 新しい順で取得しているので、表示は古い順に戻す(会話の流れに合わせる)。
  for (const row of [...rows].reverse()) {
    if (!row.quote_token) continue
    messages.push({
      type: 'text',
      text: '.',
      quoteToken: row.quote_token,
    })
  }

  // 引用トークンが1件も無い場合(古い記録など)は、文面で伝える。
  if (messages.length === 1) {
    return [
      {
        type: 'text',
        text: 'メンションは見つかったけど、引用できる情報が残ってなかったよ…',
      },
    ]
  }

  return messages
}
