# 葉っぱもち Bot (HappaMochi Bot)

## Project Overview
- **Name**: happamochi-bot (line-group-bbs)
- **Goal**: LINEグループ公式Botのゼロからの再構築版。既存の本番D1データベース(33万件超のメッセージ、7000件超のメンバー)に接続しつつ、危険人物リスト・ガチャ機能を除いた全機能を実装。
- **Core design constraint**: LINEのPush API(月間無料枠あり、超過で429エラー)には依存せず、全ての「Bot発信」通知(取り消し通知、誕生日、占い、ランキング等)をReply API(無料・無制限)に便乗させて配信する。

## 実装済み機能
- **メッセージ取り消し通知**: グループ内でメッセージが削除(unsend)されたことを検知し、次にそのグループで誰かが発言した際のReplyに便乗して通知
- **グループメンバー・活動追跡**: メッセージ受信ごとにメンバー情報・発言をキャッシュ
- **誕生日通知**: `誕生日登録 [月]/[日]` で登録、当日になったら次のメッセージ時に自動でお祝い通知(cron不使用、遅延評価方式)
- **星座占い**: `星座登録 [星座名]`→`運勢`で日替わり運勢を取得(シード付き疑似ランダムで同日は同じ結果)
- **週間ランキング**: グループの活動量ランキングを週次で自動配信(cron不使用、遅延評価方式)
- **名言カード**: `名言:[テキスト]` でLINE Flex Messageのカード形式の名言を生成(画像生成非対応環境のため)
- **ウェルカムメッセージ**: 新メンバー参加時の歓迎メッセージ、`ウェルカムオン/オフ`、`ウェルカムメッセージ設定 [本文]` でカスタマイズ
- **タグ機能**: `タグ追加/削除/一覧 [タグ名]`
- **称号システム**: `称号一覧`、`称号装備 [称号名]`、`称号確認`(既存の本番データ: 5種のSSR称号、付与済み2件を引き継ぎ)

## 実装していない機能(意図的に除外)
- 危険人物リスト機能
- ガチャ機能(user_gacha_count / gacha_history)

## コマンド一覧(LINEグループ内でのテキスト送信)
```
ヘルプ                          - コマンド一覧を表示
運勢 / 今日の運勢                - 今日の星座運勢を表示
星座登録 [星座名]                - 星座を登録
誕生日登録 [月]/[日]             - 誕生日を登録
取り消し通知オン / オフ          - 削除通知の切替
ウェルカムオン / オフ            - 新メンバー歓迎メッセージの切替
ウェルカムメッセージ設定 [本文]   - カスタム歓迎文を設定
名言:[テキスト]                  - 名言カードを生成
タグ追加/削除/一覧 [タグ名]
称号一覧 / 称号装備 [称号名] / 称号確認
```

## アーキテクチャ

### Push-free broadcast queue
LINEのPush APIには月間無料枠制限がある一方、Reply API(replyTokenを使った応答)は無料・無制限。
本プロジェクトはBotが自発的に発信したいメッセージ(取り消し通知・誕生日・占い・ランキング等)を
即時Pushせず、`pending_broadcasts` テーブルに一旦キューイングし、そのグループで次にメッセージが
届いた際のReply呼び出しに便乗させてまとめて配信する。

```
[イベント発生] → enqueueBroadcast() → pending_broadcasts (delivered=0)
[次のメッセージ受信] → peekBroadcasts() → Reply APIで送信
   → 送信成功なら markBroadcastsDelivered() で delivered=1
   → 送信失敗なら delivered=0 のまま残り、次回の受信時に再試行
```
LINEの1リプライあたり最大5メッセージ制限に対応し、キューが多い場合は次回に繰り越す。
**重要**: Reply呼び出しが実際に成功したことを確認してから delivered フラグを更新するため、
一時的なネットワークエラーやトークン期限切れがあっても通知が失われない設計になっている。

### Cronなしの遅延評価パターン
Cloudflare Pages Hosted Deployではcronトリガー(`triggers`)が使えないため、誕生日・占い・
週間ランキングといった「日付依存」の機能はcronを使わず、グループでメッセージを受信した
タイミングごとに「今日はもう処理した?」をDBでチェックし、未処理なら処理する遅延評価方式を採用。

## データアーキテクチャ
- **Storage**: Cloudflare D1 (`line-group-bbs-db`, database_id: `f17e1465-7471-45a5-9217-c9b408cde5ec`)
- **主要テーブル**: group_metadata, group_members, group_activities, group_messages, line_friends,
  unsent_messages, unsend_notification_messages, unsend_restore_settings, unsend_debug_logs,
  push_api_logs, webhook_debug_logs, member_birthdays, daily_fortune_sent, user_zodiac_signs,
  daily_zodiac_fortunes, group_rankings, weekly_ranking_sends, group_welcome_settings, tags,
  group_tags, quote_images, title_master, user_titles, pending_broadcasts(新規)
- **除外テーブル(未使用)**: danger_list, user_gacha_count, gacha_history
- 全マイグレーションは `CREATE TABLE IF NOT EXISTS` で記述されており、既存の本番データを破壊しない。

## デプロイ状況
- **Platform**: Cloudflare Pages (既存プロジェクト `line-group-bbs` への上書きデプロイを想定)
- **Status**: ⚠️ ローカル動作確認済み・本番デプロイ未実施
- **Tech Stack**: Hono + TypeScript + Cloudflare D1 + Cloudflare Workers
- **Local dev**: `npm run build && pm2 start ecosystem.config.cjs` → `curl http://localhost:3000/`

## テスト用コマンド(サンドボックスから直接確認できる)

LINEアプリを開かなくても、Botのロジックが正しく動いているかを確認できます。

### 1. コマンドの返信内容を確認する(LINEには送信されない)
```bash
cd /home/user/happamochi-bot
bash scripts/test_command.sh "ヘルプ"
bash scripts/test_command.sh "称号一覧"
bash scripts/test_command.sh "運勢"
```
本番サイトの `/debug/simulate` エンドポイントに問い合わせて、「もしLINEでこのテキストを
送ったらBotは何を返信しようとするか」をその場でJSON表示する。LINEには何も送られない。
コマンドの分岐ロジックが正しいか、エラーが起きていないかはこれで分かる。
**実際にLINEアプリに届くかどうかはこれでは分からない**(replyTokenが必要なため)。

### 2. 受信ログを確認する(実際にLINEでBotに話しかけた後に実行)
```bash
cd /home/user/happamochi-bot
bash scripts/check_webhook_result.sh
```
本番D1の `webhook_debug_logs` / `group_messages` / `pending_broadcasts` を見て、
Botが実際にLINEからのメッセージを受信・保存できているか、エラーが出ていないかを確認する。

### 実際にLINEでBotからの返信を"見る"には
上記のコマンドはBotの受信〜処理ロジックの健全性を確認するものであり、実際に
LINEの画面にBotからの返信が届くかどうかは、**LINEアプリでBotに実際にメッセージを
送ってもらう以外に確認方法がない**(LINEのReply APIはLINE公式サーバーが発行した
本物のreplyTokenを要求するため、サンドボックスから模擬することができない)。

## セットアップ
```bash
npm install
npx wrangler d1 migrations apply line-group-bbs-db --local   # ローカルDB
npm run build
pm2 start ecosystem.config.cjs
```

本番デプロイ前に必ず以下を実施すること:
1. 本番D1への完全バックアップ確認(`npx wrangler d1 export line-group-bbs-db --remote`)
2. `npx wrangler d1 migrations apply line-group-bbs-db --remote` でマイグレーション適用
3. `npx wrangler pages deploy dist --project-name line-group-bbs` でデプロイ
4. LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET を本番環境のsecretとして設定されているか確認
