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
- **名言カード**: `名言:[テキスト]` で、satori + @resvg/resvg-wasm によって実際にPNG画像(1280x720)をCloudflare Workers上でレンダリングし、LINEの`imageMessage`(`originalContentUrl`/`previewImageUrl`)として配信する。生成したPNGはCloudflare D1の`quote_images.image_data`にBLOBとして保存し、`GET /quote-image/:id`で公開配信する。過去の一時的なリビルドでLINE Flex Message(偽の吹き出し)に差し替えられていたが、本来の実画像生成に復元済み。
  デザインは本番D1に残っていたレガシー画像を実際に取得・比較して再現した2パターン切り替え式:
  - プロフィール画像が取得できる場合: 左半分に実写プロフィール画像(右端が黒へソフトフェード)、
    右半分は黒背景に引用文/`@表示名`/ユーザーID/右下に`HappaMochi Bot`の透かし文字。
  - プロフィール画像が取得できない場合(フォールバック): ネイビー/インディゴの斜めグラデーション
    背景 + 四隅に半透明の装飾引用符 + 中央揃えの引用文 + `— 表示名`。透かしなし。
- **ウェルカムメッセージ**: 新メンバー参加時の歓迎メッセージ、`ウェルカムオン/オフ`、`ウェルカムメッセージ設定 [本文]` でカスタマイズ
- **タグ機能**: `タグ追加/削除/一覧 [タグ名]`
- **称号システム**: `称号一覧`、`称号装備 [称号名]`、`称号確認`(既存の本番データ: 5種のSSR称号、付与済み2件を引き継ぎ)。
  `grantTitle()`の実際のトリガーは「オセロで3勝したら`絶対王者`を自動付与」(下記オセロ戦績と連動)。
- **オセロ**: `オセロ開始/参加/終了`に加え、`オセロ戦績`で自分の累計勝敗数(勝ち/負け/引き分け)を確認可能。
  対局が決着した瞬間に`othello_records`テーブルへ記録され、3勝目で称号が付与される。
- **LINEグループ募集掲示板 (BBS) + オープンチャット**: `/bbs` で公開。かつて存在した(現在は削除された)
  同名サイトのD1データ(`threads`/`chat_messages`、2025-11-09〜のデータ、40件+35件)をそのまま
  引き継いで再構築した、認証不要の公開Webページ(LINEのコマンドではない)。
  - `GET /bbs` — 募集一覧(カテゴリ絞り込み: 恋愛/趣味/その他、固定表示対応)
  - `GET /bbs/new` / `POST /bbs/new` — 新規投稿フォーム/投稿
  - `GET /bbs/:id` — 投稿詳細(閲覧数は表示ごとに+1)
  - `POST /bbs/:id/like` — いいね
  - `GET /bbs/chat` / `POST /bbs/chat` — オープンチャット一覧/投稿
  - 元サイトはXSS対策がなく履歴データに実際の攻撃ペイロードが混入していたため、
    `src/features/bbs.ts`の`escapeHtml()`で全てのユーザー入力(title/content/author)を
    確実にエスケープしてレンダリングしている(元データは一切変更・削除していない)。
- **グループ発言数ランキング**: `/ranking` で公開。LINE Botが集計した`group_activities`を
  集計源に、グループ単位の発言数ランキングを表示する(個人単位のランキング・個人名は非公開)。
  - 期間切り替え(今日/今週/今月)、グループ規模の絞り込み、グループ名検索、ページ送り、
    グループを選ぶと右カラムに詳細(発言数・発言した人数・日別グラフ・主な活動時間帯)を表示。
  - 順位は発言数順で同数は同順位。前期間比は直前の同じ長さの期間の順位との差。
    比較データが無い場合は`NEW`、変動なしは`—`。
  - `GET /ranking/rules` に集計ルールを明記。
  - LINEコマンド`ランキング`(別名`順位`)で、そのグループの今週の順位・発言数・サイトURLを返信。
  - **重要な前提**: 集計源の`group_activities.activity_date`は既存実装が**UTC日付**で
    積んでいるため、一覧・日別グラフの期間境界もUTCで揃えている(JSTで切ると既存44,942行と
    ずれて数が合わなくなる)。一方、新規追加した`group_hourly_activity`は「主な活動時間帯」
    専用でJSTの日付・時で記録する。この差は意図的なもの。
  - **主な活動時間帯は集計開始(2026-09-05)以降のデータのみ**。既存テーブルに時刻が
    保存されていないため過去分は復元できず、データが貯まるまでは非表示になる。
- **名言カードギャラリー**: `/gallery` で公開。LINEグループで「めいく」コマンドによって
  生成された名言カードPNG(`quote_images`テーブル、グループによる絞り込みなし・全177
  グループ分を1つのギャラリーとして表示 — ユーザーの明示指示による仕様)を、参考サイト
  (miqx.jp/gallery相当)に近いダークなタイルグリッドで一覧表示する。
  - `GET /gallery` — ギャラリー一覧(ページネーションあり)。画像自体(PNG)に引用文・
    著者名がすでに描き込まれているため、HTML側でテキストキャプションを再掲しない
    (旧デザインは同じ文言が二重表示されて「見た目的によくない」との指摘を受け、
    ダークなテーマ + 16:9タイル + 投稿日時のみの薄いオーバーレイに全面リデザイン済み)。
  - **管理者専用の削除機能**: `GET/POST /gallery/admin` でパスワードログインし、
    ログイン中のみ各カードに削除ボタンが表示される(`POST /gallery/admin/delete/:id`)。
    - 認証はCloudflareのシークレット`GALLERY_ADMIN_PASSWORD`と、有効期限付きの
      HMAC-SHA256署名済みステートレスCookieトークン(`src/features/galleryAdmin.ts`)による
      自前実装。セッション用のDBテーブルは追加していない(Workersはメモリ状態を
      保持できないため、署名検証だけで完結する設計)。
    - ログイン試行にはBBSと同じレート制限(`isRateLimited`/`touchRateLimit`、15秒間隔)を
      `gallery-admin-login`スコープで再利用している。
    - LINE Bot本体(`/webhook`・`quote.ts`・`imageGen.ts`)には一切関与しない、
      `/gallery/admin*` 専用の完全に独立した認証・削除フロー。

## 実装していない機能(意図的に除外)
- 危険人物リスト機能
- ガチャ機能(user_gacha_count / gacha_history)

## コマンド一覧(LINEグループ内でのテキスト送信)
```
ヘルプ                          - コマンド一覧を表示
ランキング / 順位                - このグループの今週の順位と発言数を表示
運勢 / 今日の運勢                - 今日の星座運勢を表示
星座登録 [星座名]                - 星座を登録
星座登録解除                     - 星座の登録を解除
誕生日登録 [月]/[日]             - 誕生日を登録
誕生日登録解除                   - 誕生日の登録を解除
取り消し通知オン / オフ          - 削除通知の切替
ウェルカムオン / オフ            - 新メンバー歓迎メッセージの切替
ウェルカムメッセージ設定 [本文]   - カスタム歓迎文を設定
ウェルカムメッセージ解除         - カスタム歓迎文を解除してデフォルトに戻す
名言:[テキスト]                  - 名言カードを生成
タグ追加/削除/一覧 [タグ名]
称号一覧 / 称号装備 [称号名] / 称号確認
オセロ開始 / 参加 / 終了 / 戦績
```

## 公開Webページ(LINEコマンドではない)
```
GET  /bbs              - LINEグループ募集掲示板 一覧(?category=love|hobby|other)
GET  /bbs/new          - 新規投稿フォーム
POST /bbs/new          - 新規投稿
GET  /bbs/:id          - 投稿詳細
POST /bbs/:id/like     - いいね
GET  /bbs/chat         - オープンチャット
POST /bbs/chat         - オープンチャットへ投稿

GET  /ranking          - グループ発言数ランキング(?period=today|week|month&size=all|small|medium|large&q=&page=N&group=ID)
GET  /ranking/rules    - ランキングの集計ルール

GET  /gallery                    - 名言カードギャラリー一覧(?page=N)
GET  /gallery/admin               - 管理者ログインフォーム
POST /gallery/admin               - 管理者ログイン(password)
POST /gallery/admin/logout        - 管理者ログアウト
POST /gallery/admin/delete/:id    - 名言カード削除(管理者ログイン中のみ、未ログインは401)
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
- **フォントはBold(700)とRegular(400)の2ウェイトを埋め込んでいる**
  (`public/static/fonts/NotoSansJP-{Bold,Regular}.ttf` → ビルド時に`.bin`へリネームして
  `scripts/inject-wasm.mjs`が静的importを注入)。レガシー画像の実物を確認したところ本文は
  Bold単体ではなくRegularウェイトで組まれていたため、Regularも追加した。satoriの`fonts`配列に
  両方を`weight`違いで登録し、各要素の`fontWeight`で使い分ける。
- **⚠️ サンドボックスのメモリ制約に注意**: フォントを2つ(合計約10MB)埋め込むようになった影響で、
  `wrangler pages deploy`のesbuildコンパイル工程がメモリ不足で**無言で途中停止**することがある
  (`wrangler pages deploy`が`Uploaded ... already uploaded`→`Compiled Worker successfully`まで
  表示した後、`Uploading Worker bundle`/`Deploying...`が出ないまま終了コード0で終わり、
  本番には反映されない、という非常に分かりにくい失敗モード)。デプロイ前に必ず
  `pm2 delete happamochi-bot && fuser -k 3000/tcp` でローカルのwranglerサーバーを止めて
  メモリを空けてからデプロイすること。デプロイ後は`wrangler pages deployment list`で
  直近のコミットハッシュに対応する新しいデプロイIDが実際に出現しているか(タイムスタンプが
  更新されているか)を必ず確認し、「✨ Deployment complete!」という行が出力に含まれているかも
  チェックする(これが出ない場合はWorkerバンドルのアップロードまで到達していない)。

## データアーキテクチャ
- **Storage**: Cloudflare D1 (`line-group-bbs-db`, database_id: `f17e1465-7471-45a5-9217-c9b408cde5ec`)
- **主要テーブル**: group_metadata, group_members, group_activities, group_messages, line_friends,
  unsent_messages, unsend_notification_messages, unsend_restore_settings, unsend_debug_logs,
  push_api_logs, webhook_debug_logs, member_birthdays, daily_fortune_sent, user_zodiac_signs,
  daily_zodiac_fortunes, group_rankings, weekly_ranking_sends, group_welcome_settings, tags,
  group_tags, quote_images, title_master, user_titles, pending_broadcasts, othello_games,
  othello_records(新規), threads(新規/BBS), chat_messages(新規/BBS)
- **除外テーブル(意図的・危険人物リスト/ガチャ機能ごと除外)**: danger_list, user_gacha_count, gacha_history
- **未使用テーブル(存在するが現行src/では未参照・データは保持のまま放置)**: group_rankings,
  conversation_states, member_update_progress, line_friends, unsend_notification_messages。
  いずれも過去の別機能・別実装が使っていた形跡があるテーブルで、削除するとデータが失われるため
  「データを絶対に破壊しない」方針上ドロップはしない。現時点では休眠のままでよいと判断し、
  再利用するかどうかはユーザーの今後の指示待ち。
- 全マイグレーションは `CREATE TABLE IF NOT EXISTS` で記述されており、既存の本番データを破壊しない。

## デプロイ状況
- **Platform**: Cloudflare Pages (プロジェクト `line-group-bbs`)
- **Production URL**: https://line-group-bbs.pages.dev
- **Status**: ✅ 本番デプロイ済み(2026-09-05)。BBS再構築(threads/chat_messages公開サイト化)
  とPhase5監査Fix#1/3/4/5/6/7/8を含む全機能を本番D1に接続した状態で動作確認済み。
  デプロイID `37e4a9d3-793f-4c16-86d5-ecf490c733fd`、コミット `beb6b2f`。
  マイグレーション`0008_bbs.sql`・`0009_othello_stats_and_title_trigger.sql`を
  本番D1(`--remote`)に適用済みで、既存データ(threads 40件、chat_messages 35件)が
  破壊されていないことを確認済み。本番の`/bbs`一覧ページ・`/bbs/:id`詳細ページで、
  過去に投稿されたXSSペイロード(`<script>alert(...)</script>`)入りスレッドが
  正しく`&lt;script&gt;...`とエスケープ表示されることも確認済み(生の`<script>`タグは
  0件、実際に危険を及ぼさない形で表示されている)。
- **Tech Stack**: Hono + TypeScript + Cloudflare D1 + Cloudflare Workers + satori + @resvg/resvg-wasm
- **ギャラリー管理者パスワード**: `GALLERY_ADMIN_PASSWORD`(Cloudflare Pages secret)。
  ⚠️ 現在本番に設定されている値は動作確認用のテスト値。実運用パスワードにユーザー自身で
  置き換える必要がある(上記セットアップ手順の5番参照)。
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
5. ギャラリー管理者削除機能を使うには `GALLERY_ADMIN_PASSWORD` をCloudflareのsecretとして
   設定すること(未設定の場合、`/gallery/admin`はログイン不可の503を返し、削除機能は
   無効化されるだけで、LINE Bot本体の動作には影響しない)。
   ```bash
   printf '%s' 'ここに実際のパスワード' | npx wrangler pages secret put GALLERY_ADMIN_PASSWORD --project-name line-group-bbs
   ```
   **重要**: `wrangler pages secret put` はシークレットストアを即時更新するが、
   **現在稼働中のデプロイには反映されない**。次の `wrangler pages deploy` を実行して
   初めて新しい値が有効になる。また `echo "$VAR" | wrangler pages secret put ...` のように
   パイプすると末尾に改行が付与されパスワード不一致の原因になるため、必ず `printf '%s'` を
   使うこと。

## 既知の残課題
- LINE実機での「名言:」コマンド最終確認が未実施(本番の `/debug/simulate` と
  `/quote-image/:id` の疎通は確認済みだが、実際にLINEアプリ上でBotが画像付き
  メッセージを送ってくることの確認はユーザー側でのみ可能)
- unsend(メッセージ取り消し)イベント処理の本番環境での実地テスト未実施
- Push APIの月間429エラーについて調査済み: 現行コードベース(このリビルド版)には
  `pushMessage()` を実際に呼び出している箇所が一つも存在しない(`src/index.tsx` で
  importされているだけで未使用)。本番D1の `push_api_logs` テーブルも0件。よって
  429エラーは過去のレガシー版ボット(本リビルド以前)で発生していたものであり、
  現行コードでは構造的に発生し得ない。Push API経路は完全にReply API便乗方式
  (`pending_broadcasts`)に置き換わっている。
