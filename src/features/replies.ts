// 「りぷかく」= リプライ確認。
//
// 自分の発言にリプライ(引用返信)された分を、引用付きで最大4件返す。
//
// 【「めんかく」との違い】
//   ・めんかく = @メンションされた   → message.mention.mentionees[]
//   ・りぷかく = 自分の発言に返信された → message.quotedMessageId
//
// quotedMessageId は「返信元メッセージのID」なので、それを group_messages から
// 引いて元の発言者を特定する必要がある。この照会は「めいく」で既に使っている
// 仕組みと同じ(LINEには任意の過去メッセージを取るAPIが無いため、自前の
// キャッシュしか手がかりがない)。
//
// 【LINEの仕様で決まっている制約】
//   ・応答メッセージは1回に最大5通。案内文1通 + 引用4通 = ちょうど5通。
//   ・引用トークンはそのトーク内でしか使えない → 取得は group_id で絞る。
//   ・元の発言が group_messages に無い(記録開始前・テキスト以外)場合は
//     誰への返信か分からないので記録できない。
import type { LineEnv } from '../lib/line'
import { getGroupMessage } from './groupTracking'

// 1回に出すリプライの最大件数(LINEの「1リプライ5通」制限 − 案内文1通)。
export const REPLY_LIMIT = 4

// 記録を保持する日数。
export const REPLY_RETENTION_DAYS = 7

export interface ReplyRow {
  sender_id: string
  sender_name: string | null
  message_id: string
  message_text: string | null
  quote_token: string | null
  created_at: string
}

/**
 * Webhookのメッセージが「誰かへのリプライ」なら記録する。
 *
 * 元の発言者は group_messages から引く。見つからない場合(記録開始前の発言、
 * 画像・スタンプへの返信など)は誰宛か特定できないので黙って飛ばす。
 *
 * 失敗しても例外を投げない(既存のBot処理を止めないため)。
 */
export async function recordReply(
  env: LineEnv,
  groupId: string,
  senderId: string,
  senderName: string | null,
  message: any
): Promise<void> {
  try {
    const quotedId = message?.quotedMessageId
    if (typeof quotedId !== 'string' || quotedId.length === 0) return

    const messageId: string | undefined = message?.id
    if (!messageId) return

    // 返信元の発言を引いて、元の発言者(=リプライされた人)を特定する。
    const original = await getGroupMessage(env, groupId, quotedId)
    if (!original?.user_id) return

    const targetId = original.user_id
    // 自分の発言に自分で返信した分は出しても意味がないので除く。
    if (targetId === senderId) return

    const text: string | null = typeof message?.text === 'string' ? message.text : null
    const quoteToken: string | null =
      typeof message?.quoteToken === 'string' ? message.quoteToken : null

    await env.DB.prepare(
      `INSERT OR IGNORE INTO replies
         (target_id, group_id, sender_id, sender_name, message_id, message_text, quote_token)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(targetId, groupId, senderId, senderName, messageId, text, quoteToken)
      .run()
  } catch {
    /* リプライ記録の失敗は既存機能に影響させない */
  }
}

/**
 * 自分宛の直近リプライを新しい順に取得する。
 * quoteToken はそのトーク内でしか使えないため、必ず group_id で絞る。
 */
export async function getRecentReplies(
  env: LineEnv,
  groupId: string,
  targetId: string,
  limit: number = REPLY_LIMIT
): Promise<ReplyRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT sender_id, sender_name, message_id, message_text, quote_token, created_at
       FROM replies
      WHERE target_id = ? AND group_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?`
  )
    .bind(targetId, groupId, limit)
    .all<ReplyRow>()
  return results ?? []
}

/**
 * 保持期間(7日)を過ぎたリプライを削除する。
 * cronが使えないので「りぷかく」実行のついでに掃除する。
 */
export async function pruneOldReplies(env: LineEnv): Promise<void> {
  try {
    await env.DB.prepare(
      `DELETE FROM replies
        WHERE created_at < datetime('now', '-${REPLY_RETENTION_DAYS} days')`
    ).run()
  } catch {
    /* 掃除の失敗はコマンド本体に影響させない */
  }
}

/**
 * 「りぷかく」への応答メッセージを組み立てる。
 * 見本どおり、案内文1通 + 各リプライを引用した本文1通ずつ。
 */
export function buildReplyMessages(rows: ReplyRow[]): any[] {
  if (rows.length === 0) {
    return [
      {
        type: 'text',
        text: 'まだリプライされてないみたい！\n（「りぷかく」を作る前のリプライは見れないよ）',
      },
    ]
  }

  const messages: any[] = [
    {
      type: 'text',
      text: `直近でリプライされたメッセージ最大${REPLY_LIMIT}件をリプライするよ！`,
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

  if (messages.length === 1) {
    return [
      {
        type: 'text',
        text: 'リプライは見つかったけど、引用できる情報が残ってなかったよ…',
      },
    ]
  }

  return messages
}
