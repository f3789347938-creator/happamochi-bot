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
- **名言カード**: `名言:[テキスト]` で、satori + @resvg/resvg-wasm によって実際にPNG画像(1280x720、アバター/名言テキスト/ユーザー名/透かし入り)をCloudflare Workers上でレンダリングし、LINEの`imageMessage`(`originalContentUrl`/`previewImageUrl`)として配信する。生成したPNGはCloudflare D1の`quote_images.image_data`にBLOBとして保存し、`GET /quote-image/:id`で公開配信する。過去の一時的なリビルドでLINE Flex Message(偽の吹き出し)に差し替えられていたが、本来の実画像生成に復元済み。
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

### 名言カードの画像生成 (satori + resvg-wasm on Cloudflare Workers)
Cloudflare Workers上で本物のPNG画像を動的生成する仕組み。「Workersは画像生成できない」という
誤った前提で一度Flex Messageに後退したが、以下の対応で実現している。

- **satoriは`0.32.0`に固定**(package.jsonでcaretなしの厳密ピン)。`0.33.0`以降はHarfBuzzによる
  テキストシェイピングが追加されているが、そのEmscriptenローダーはモジュール評価(グローバル)
  スコープで`fetch('hb.wasm')`を自己実行してしまい、Cloudflare Workersの「グローバルスコープでの
  非同期I/O禁止」規則に抵触してハードクラッシュする(workerdにXMLHttpRequestが存在しないため
  フォールバックも失敗する)。`0.32.0`はHarfBuzzを含まないため、このクラスの不具合が原理的に
  発生しない。**satoriを0.32.x以降にアップグレードする際は必ずworkerd上での動作を再検証すること。**
- **WASMは静的import** (`import x from './y.wasm'`) で組み込む。動的な`WebAssembly.instantiate(bytes)`
  はWorkersで許可されない。`scripts/inject-wasm.mjs`がビルド後の`dist/_worker.js`に
  yoga.wasm/resvg.wasmの静的importとフォント(`.ttf`→`.bin`にリネーム、Pagesのbuildが`.ttf`
  ローダーを持たないため)を注入している。
- **satoriのCSSプロパティリゾルバは、styleオブジェクトのキーに明示的な`undefined`値があると
  クラッシュする**(キーが存在しないのはOK、値が`undefined`なのはNG)。`src/lib/imageGen.ts`では
  この問題を避けるため、条件によって完全に別のstyleオブジェクトを組み立てている。
- **D1のBLOBカラムに`Uint8Array`を直接bindしてはいけない**。暗黙的に`toString()`され
  (`"137,80,78,71,..."`のような10進数CSV文字列になる)、画像が壊れる。書き込み時は
  `ArrayBuffer`に変換してからbindし(`src/features/quote.ts`)、読み込み時もD1のローカル
  エミュレーションがplain Arrayとして返す場合があるため`Uint8Array.from()`で正規化してから
  `Response`に渡す(`src/index.tsx`の`/quote-image/:id`)。

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
- **Platform**: Cloudflare Pages (プロジェクト `line-group-bbs`)
- **Production URL**: https://line-group-bbs.pages.dev
- **Status**: ✅ 本番デプロイ済み。名言カードの実PNG画像生成を含む全機能を本番D1に接続した状態で
  ローカル・本番の両方で動作確認済み(`/quote-image/:id`が本番でも正しく`PNG image data`を
  返すことを確認済み)。
- **Tech Stack**: Hono + TypeScript + Cloudflare D1 + Cloudflare Workers + satori + @resvg/resvg-wasm
- **Local dev**: `npm run build && pm2 start ecosystem.config.cjs` → `curl http://localhost:3000/`
- **注意**: `wrangler.jsonc`に`rules`フィールドを追加してはいけない。Cloudflare Pagesの設定は
  `rules`フィールドを一切サポートしておらず、`wrangler pages deploy`自体が即座に失敗する
  (`.ttf`のバンドルは`scripts/inject-wasm.mjs`が`.bin`へのリネームで別途対応済みなので不要)。

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

## 既知の残課題
- LINE実機での「名言:」コマンド最終確認が未実施(本番の `/debug/simulate` と
  `/quote-image/:id` の疎通は確認済みだが、実際にLINEアプリ上でBotが画像付き
  メッセージを送ってくることの確認はユーザー側でのみ可能)
- unsend(メッセージ取り消し)イベント処理の本番環境での実地テスト未実施
- Push APIの月間429エラーの根本原因調査は未着手(現状はReply API便乗方式で
  回避しているため実害は小さいが、Push API自体を呼ぶ経路が残っていないか要確認)
