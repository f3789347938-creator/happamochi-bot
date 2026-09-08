# 葉っぱもち Bot (HappaMochi Bot)

## Project Overview
- **Name**: happamochi-bot (line-group-bbs)
- **Goal**: LINEグループ公式Botのゼロからの再構築版。既存の本番D1データベース(33万件超のメッセージ、7000件超のメンバー)に接続しつつ、危険人物リスト・ガチャ機能を除いた全機能を実装。
- **Core design constraint**: LINEのPush API(月間無料枠あり、超過で429エラー)には依存せず、全ての「Bot発信」通知(取り消し通知、誕生日、占い、ランキング等)をReply API(無料・無制限)に便乗させて配信する。

## 実装済み機能
- **メッセージ取り消し通知**: グループ内でメッセージが削除(unsend)されたことを検知し、次にそのグループで誰かが発言した際のReplyに便乗して通知
- **グループメンバー・活動追跡**: メッセージ受信ごとにメンバー情報・発言をキャッシュ
- **誕生日通知**: `誕生日登録 [月]/[日]` で登録、当日になったら次のメッセージ時に自動でお祝い通知(cron不使用、遅延評価方式)
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
- **個人ステータス(レベル/EXP/ポイント)**: メッセージ1通ごとに 1 EXP と 1 ポイントがたまる。
  グループでもトークでも加算対象で、スタンプ・画像・コマンドも1通として数える。獲得上限・
  連呼制限・参加登録は無し。同じイベントの再受信だけは二重加算しないよう`exp_events`の
  一意キーで防いでいる(「1通を1回と数える」ための重複排除で、レート制限ではない)。
  必要EXPは`100 + 8 × (現在のレベル − 1)`で、レベル上限は無い(称号のLv.200は解放条件であって
  上限ではない)。累計EXPだけを保存し、レベルとレベル内EXPは都度計算するので、計算式を
  後から直しても過去データが壊れない。`ステータス`コマンドで自分のカードを表示する。
- **着せ替え(カードテーマ)**: 水色(無料) / ホワイト(300P) / ブラック(500P) / さくらピンク(700P)。
  プレビューは無料、購入と適用は別操作、所持は永続で再適用も無料。購入は確認→確定の2段で、
  台帳(`point_ledger`)の`reason_key`一意制約と条件付きUPDATE(`WHERE points >= ?`)により
  二重引き落としと残高不足での購入を防ぐ。ステータスカードと、以後に生成する名言カードに反映される
  (すでに送信済みのカードは書き換えない)。
- **共通称号(300種)**: 自由選択240種 / レベル解放40種 / オセロ実績20種、14カテゴリ。
  `共通称号一覧`・`共通称号装備 [称号名]`・`共通称号確認`・`称号検索 [文字]`で、
  グループ内のまま一覧・検索・変更・交換まで完結する。解放履歴を持つので、あとで
  レベルが下がっても没収しない。**既存の`称号一覧`/`称号装備`/`称号確認`(グループごと)は
  従来どおり別管理**で、名前が同じでも自動では統合しない。
- **もち合体パズル(LINEの中で遊べるゲーム)**: `ヘルプ` → ゲームカードの
  「もち合体パズル」から開く、ひとり用の物理パズル。同じもちをくっつけて
  大きく進化させていく。
  - **もちは11種類**。小さいものから順にくっつけて育てる。最終段階まで作ると
    「超合体」の演出が出る。段階の定義は `public/static/game/physics.mjs` の
    `STAGES`。
  - **スキルは3種類**（`physics.mjs` の `SKILLS`）。合体でたまるゲージを使って
    盤面に介入できる。使用条件・効果もすべて `physics.mjs` 側で持っている。
  - **演出**（`effects.mjs`）: 合体時のパーティクル・画面ゆれなど。
    `prefers-reduced-motion` を尊重するので、端末側で動きを減らす設定に
    していれば控えめになる。
  - **結果シェア**（`share.mjs`）: 終了後に結果を画像かテキストで共有できる。
    シェア先で遊べるURLは `line-config.js` の `shareUrl`(LIFF URL)を使う。
  - **スタート画面**: 開いた直後は「タップしてはじめる」の画面が出て、
    タップして初めてもちが落ちてくる。読み込み中に勝手に始まってしまわないよう、
    `ready` は `startGameFromScreen()` の中でしか true にしない
    (`public/static/game/game.js`)。ベストスコアがあればこの画面にも出る。
  - 実体は静的ファイル(`public/static/game/`)で、Cloudflare Pagesが配信する。
    `_routes.json` が `/static/*` をWorkerから除外しているので、Workerの
    バンドルには入らない(画像2MBを含むため、これは必須)。
  - 物理演算は Matter.js 0.20.0(MIT)を同梱。実行時に外部CDNへ接続しない。
  - ベストスコアと音の設定だけを、その端末のlocalStorageに保存する。
    サーバーには何も送らない(BotのD1とは無関係)。課金・ランキング・
    ユーザー情報の取得はしていない。
  - **LIFF設定済み**: LINEアプリの中で「✕ / タイトル / ドメイン」のヘッダー付きで開く。
    - LIFF ID: `2011492233-0cUBhY55`（公開して良い値）
    - LIFF URL: `https://liff.line.me/2011492233-0cUBhY55`
    - チャネル: プロバイダー `nano` の LINEログインチャネル「葉っぱ」
      （Messaging APIチャネルにはLIFFを追加できないため別チャネル。
      LINEミニアプリチャネルは審査が必要だったのでLINEログインで作成）
    - エンドポイントURL: `https://line-group-bbs.pages.dev/static/game/`
    - サイズ `Full` / Scope は `profile` のみ（`openid`か`profile`のどちらかが必須）
    - モジュールモードはオフ（オンにすると閉じるボタンが消える）
    - 設定箇所は2つ。両方に同じLIFF IDを入れる:
      1. `src/features/menu/gameLink.ts` の `LIFF_ID` … Flexボタンのリンク先を
         `liff.line.me` に切り替える。空ならHTTPS URLのまま。
      2. `public/static/game/line-config.js` の `liffId` … ゲーム側でLIFF SDKを
         読み込んで `liff.init()` する。空ならSDKを読み込まない。
    - ゲームは `liff.getProfile()` を呼ばないので、名前やアイコンは取得しない。
    - チャネルシークレットやアクセストークンはクライアントに書かない。
  - 検証:
    - `node scripts/game-test.mjs`(51項目) … 配信物としての検証。必要なファイルが
      揃っているか、`_routes.json` が `/static/*` を除外しているか、LIFF IDが
      2箇所で一致しているか、スタート画面のタップまで `ready` にならないか。
    - `node --test tests/game/`(33項目) … ゲームのロジック検証。
      物理(11) / スキル(14) / 演出(2) / シェア(6)。
      Matter.js は CommonJS なので、このリポジトリ(`"type": "module"`)から
      そのままは読めない。`tests/game/matter-loader.mjs` がテスト内でだけ
      CommonJSとして評価して渡している(**Bot本体の`package.json`は変更していない**)。
- **ウェルカムメッセージ(初期オフ)**: 新メンバー参加時の歓迎メッセージ。
  `ウェルカムオン` を送ったグループだけ送る。
  - **既定はオフ**。`group_welcome_settings` に行が無いグループでは送らない。
    (以前は行が無いと送る=既定オンだったため、何も設定していないグループでも
    参加のたびに送られていた。2026-09-07にこの判定を反転し、既存の
    有効だった6グループも `enabled=0` にリセットした。カスタム文は消していない)
  - **二重送信の防止**: `memberJoined` に重複排除が無く、LINEが同じイベントを
    再送すると歓迎メッセージが2通出ていた(実機で発生)。`markEventProcessed` で
    同じ `webhookEventId` を1回だけ処理するようにした。
    `webhookEventId` が無いイベントでも取りこぼさないよう、
    「グループ + 参加した人 + 分単位の時刻」のキーでも一度だけに絞っている。
  - 検証: `node scripts/welcome-test.mjs`(13項目)。再送・eventId欠落・
    グループごとの独立・カスタム文の設定解除を確認する。
- **ヘルプメニュー**: `ヘルプ`(既存の別名 `help` も同じ)を送ると、横スワイプの
  カード6枚(名言カード / ステータス / ゲーム / ランキング / グループ設定 / ガイド)が出る。
  そこから各機能の案内へ進める。文字のコマンド一覧は「ガイド → 全コマンド」に4ページで載せた。
  設計上の要点:
  - **実装済みFlexは作り直さない**。ステータス・着せ替え・購入確認・共通称号一覧・
    カテゴリ選択・チェス3種・オセロ盤面・お知らせは、既存のビルダーが返した物を
    そのまま送る。メニューのデザインやフッター、戻るボタンを既存カードに足していない。
  - **ボタンで状態を変えない**。オセロ・チェスは「開始」「募集」がDBを書き換えるので、
    ボタンからは実行せず送り方の案内に留める。ボタンから呼べる既存コマンドは
    表示のみと確認できたものだけの許可リスト(`SAFE_EXISTING_COMMANDS`)に限る。
  - **設定変更は確認をはさむ**。確認の意図は`menu_confirmations`に保存し、
    押した本人・グループ・期限・未使用を照合してから既存コマンドの処理を呼ぶ。
    他人が押しても実行されず、連打しても二重に実行されない。
  - **Flexの中に入力欄は作らない**。通常のトークで既存コマンドを送る方法を案内する。
    次の雑談を本文として勝手に拾うことはしない。
  - 装飾の選択状態はpostbackのトークンで持ち回る(Flexは送信済みカードを書き換えられない)。
    許可リストに無い値は捨てるので、トークンを書き換えても表示に混ざらない。
  - メニューの組み立てに失敗しても、`ヘルプ`は従来のテキスト一覧に必ず落ちる。
- **個人ランキング**: 累計EXPの多い順に全員を掲載。同じ累計EXPは同順位(1位、2位、2位、4位…)。
  `/ranking/personal`で公開し、名前を押すとその人の公開ステータス`/u/:publicId`へ移動する。
  URLにはLINEのIDとは無関係なランダムな公開ID(`public_id`)だけを使い、会話の内容・
  LINEユーザーID・非公開のグループ情報・誕生日の日付は公開しない。
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
ヘルプ                          - メニュー(横スワイプのカード6枚)を表示
                                  ※ 文字のコマンド一覧は「ガイド → 全コマンド」から
ランキング / 順位                - このグループの今週の順位と発言数を表示
誕生日登録 [月]/[日]             - 誕生日を登録
誕生日登録解除                   - 誕生日の登録を解除
取り消し通知オン / オフ          - 削除通知の切替
ウェルカムオン / オフ            - 新メンバー歓迎メッセージの切替
ウェルカムメッセージ設定 [本文]   - カスタム歓迎文を設定
ウェルカムメッセージ解除         - カスタム歓迎文を解除してデフォルトに戻す
名言:[テキスト]                  - 名言カードを生成
タグ追加/削除/一覧 [タグ名]
称号一覧 / 称号装備 [称号名] / 称号確認   - グループごとの称号(従来どおり)
オセロ開始 / 参加 / 終了 / 戦績

--- 個人ステータス(人単位・全グループ共通) ---
ステータス                       - 自分のステータスカードを表示
着せ替え                         - カードテーマの選択・購入
共通称号一覧                     - 共通称号(300種)の一覧
共通称号装備 [称号名]            - 共通称号を装備
共通称号確認                     - 装備中の共通称号を確認
称号検索 [文字]                  - 共通称号を名前で検索
```

※ グループでもトークでも使えます。トークへの誘導はしません。
※ 「ステータス」で表示されるのは、コマンドを送った本人のカードだけです。

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
GET  /ranking/personal - 個人ランキング(累計EXP順、1ページ50人、?page=N)
GET  /u/:publicId      - その人の公開ステータス(存在しないIDは404)

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
  othello_records, threads(BBS), chat_messages(BBS), chess_games, chess_moves, chess_seats,
  user_profiles(新規), exp_events(新規), theme_master(新規), user_themes(新規),
  point_ledger(新規), common_title_category(新規), common_title_master(新規),
  user_common_titles(新規)
- **個人ステータスのデータモデル(0015/0016)**:
  - `user_profiles`: 人単位・全グループ共通。`user_id`主キー、`public_id`(公開ページ用の
    ランダム値/UNIQUE)、`total_exp`(累計のみ保存)、`points`、`active_theme`、`equipped_title`。
    索引`idx_user_profiles_exp (total_exp DESC)`で個人ランキングを引く。
  - `exp_events`: `event_key`主キー。`INSERT OR IGNORE`の`meta.changes`で二重加算を判定する。
  - `theme_master` / `user_themes`: テーマ定義と「所持」。所持と「適用中」(`active_theme`)は別管理。
  - `point_ledger`: `reason_key`をUNIQUEにして、購入処理が二重に成立しないようにしている。
  - `common_title_category` / `common_title_master` / `user_common_titles`:
    新しい共通称号(300種)。既存の`title_master`/`user_titles`(グループごと)とは**完全に別テーブル**で、
    名前が同じでも自動では結び付けない。
- **menu_confirmations(0017)**: ヘルプメニューからの設定変更の確認意図。
  `id`(サーバー発行の短い識別子。postbackにはこれだけを載せる)、`user_id`、`group_id`、
  `op`(許可リストにある操作名)、`used`、`expires_at`。確定時は
  `UPDATE ... WHERE id = ? AND used = 0`の変更行数で1回だけ成立させる。
- **運勢の扱い**: 星座占いの自動配信は削除済み。ステータスカードに出る運勢は
  「その人 + 日本時間の日付」から決まる表示専用の値で、DBには保存していない
  (同じ日は何度開いても同じ結果、日付が変わると変わる)。
  `daily_fortune_sent`テーブルは**誕生日通知機能が流用している**ため、絶対にドロップしない。
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
- **Status**: ✅ 本番デプロイ済み(2026-09-08)。もち合体パズルを新版に差し替え、
  スタート画面を追加。デプロイID `72c1ce01`。
  - もちは5種類 → **11種類**。スキル3種類・合体演出・結果シェアを追加。
  - 開いた直後は「タップしてはじめる」の画面。タップするまで始まらない。
  - LIFF ID `2011492233-0cUBhY55` を `gameLink.ts` と `line-config.js` の両方に設定済み。
  - 本番の配信を確認: `index.html`(→`/static/game/`) と `game.js` / `physics.mjs` /
    `effects.mjs` / `share.mjs` / `style.css` / `line-config.js` /
    `assets/matter.min.js` / `assets/mochi-atlas.png`(1,991,351バイト) すべて200。
    ブラウザで開いてコンソールのエラー・警告は0件、`#start-screen`が表示される。
  - マイグレーションの追加・変更なし(本番D1は `0017` のまま、既存データに一切触っていない)。
  - 自動テスト: ゲーム配信 51 + ゲームロジック 33 + menu 114 + welcome 13 +
    個人ステータス 89 + チェス 90 = **390項目すべて成功**。
  - `scripts/welcome-test.mjs` の「初期状態では送らない」が2回目以降落ちていたのは
    テスト側の問題(グループIDが固定で、前回の`ウェルカムオン`が設定テーブルに残っていた)。
    グループIDを実行ごとに変えて修正。**製品側の不具合ではない**。
  - ⚠️ **実機のLINEアプリでの表示・操作は未確認**(検証用の端末がないため)。
    特にLIFFで開いたときの動作、チャネルが「開発中」の状態でグループの全員が
    開けるかどうかは未検証。
  - ⚠️ **ゲームのスコアランキングは未実装**。LINEログインチャネル「葉っぱ」の
    **チャネルID(10桁の数字)** が必要なため保留中。
- **過去の状態**: 本番デプロイ済み(2026-09-07)。`ヘルプ`を横スワイプのメニューに変更し、
  新規の案内画面32種を追加。ゲームはメニューのボタンから直接始められる。デプロイID `2b694495`。マイグレーション
  `0017_menu_confirmations.sql`を本番D1に適用済み。適用前後で既存データは無変化
  (title_master 5件、group_activities 45,580件、common_title_master 300件、
  daily_fortune_sent 47件)。自動テストは menu 114項目 + 個人ステータス 89項目 +
  チェス 90項目 = 293項目すべて成功。新規Flex 36種はLINE公式の検証APIで全件受理
  (最大17,256バイト / 上限30,000)。本番の既存ページはすべて200、不正署名は401、
  デバッグ用エンドポイントは本番IDで403。
  ⚠️ **実機のLINEアプリでの表示は未確認**(検証用の端末がないため)。
- **過去の状態**: 本番デプロイ済み(2026-09-06)。個人ステータス機能(レベル/EXP/ポイント/
  個人ランキング/着せ替え4種/共通称号300種)を追加。デプロイID `6fdd3902`。
  マイグレーション`0015_personalization.sql`・`0016_common_titles_seed.sql`を本番D1
  (`--remote`)に適用済み。適用の前後で既存データが変化していないことを確認済み
  (title_master 5件→5件、user_titles 8件→8件、group_activities 45,266件→45,266件、
  daily_fortune_sent 47件→47件)。新規側は共通称号300件・カテゴリ14件・テーマ4件。
  ローカルの自動テストは89項目すべて成功、Flexカード16種はLINE公式の検証API
  (`/v2/bot/message/validate/reply`)で全件受理を確認済み。本番の`/ranking/personal`は200、
  存在しない公開IDは404、不正署名のWebhookは401、既存ページ(`/bbs`・`/bbs/guide`・
  `/bbs/chat`・`/ranking`・`/ranking/rules`・`/gallery`・`/sitemap.xml`)はすべて200。
  ⚠️ ただし**実機のLINEアプリでの表示は未確認**(検証用の端末がないため)。
- **過去の状態**: 本番デプロイ済み(2026-09-05)。BBS再構築(threads/chat_messages公開サイト化)
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

---

## チェス（グループ対局）

LINEグループ内で2人が交互に指せるチェスです。駒をタップして動かします。
盤面は Flex Message で描画し、64マスすべてが個別のタップ領域になっています。

### 使い方

| 操作 | 内容 |
|---|---|
| `チェス` | 対局相手の募集カードを出す（対局中なら現在の盤面を再送） |
| `盤面` | 現在の盤面を再送する |
| `チェス ヘルプ` | ルールと操作の説明を出す |

1. 誰かが「チェス」と送ると募集カードが出ます（**10分で期限切れ**）
2. **別の人**が「対局に参加」を押すと対局開始。白黒はランダムです
3. 手番の人が自分の駒をタップ → 移動先（`•`＝移動 / 金枠＝駒を取る）をタップで確定
4. 駒を選んだだけでは手番は進みません。「選び直す」で未確定の選択だけ解除できます

### 対応しているルール

通常移動 / 駒の取得 / **キャスリング** / **アンパッサン** / チェック /
チェックメイト / ステイルメイト / ポーン昇格（Q・R・B・N から選択）/
同一局面3回・50手ルール・戦力不足による自動引き分け / 投了（本人確認あり）/
引き分け提案（相手の承諾で成立）/ 再戦（白黒を入れ替えて再開）

時間制限はありません。厳密な大会ルールへの完全準拠はうたっていません。

### 設計上の注意点

- **1グループにつき募集中／対局中は1件**。`chess_games` の
  `WHERE status IN ('waiting','playing')` を条件にした部分UNIQUEインデックスで
  DBレベルに強制しています（同時タップでも重複作成されません）
- **サーバー再起動で対局は壊れません**。局面は `current_fen` に加えて
  `start_fen` + 棋譜（SAN配列）を保存しており、再生して復元します。
  そのため同一局面3回の判定も再起動をまたいで有効です
- **古いカードのタップは無効化されます**。各カードには生成時の `version` が
  埋め込まれ、指し手の確定は `UPDATE ... WHERE version = ?` の条件付き更新
  （楽観ロック）で行うため、古い盤面カードを押しても状態は変わりません
- **Webhookの再送は1回だけ処理されます**。`webhookEventId` を
  `chess_processed_events` に記録して重複を弾きます
- **操作者の本人確認は必ず `source.userId`** から行います。
  postbackのデータに入っている値は信用しません
  （他人の投了・他人の駒の移動ができないため）
- **Push APIは一切使いません**。すべて Reply API です

### 駒画像のライセンス

`assets/chess-svg/*.svg` の12種類（白黒 × ポーン・ナイト・ビショップ・ルーク・
クイーン・キング）は**本プロジェクトで自作したもの**です。外部の駒画像
（Wikimedia の Cburnett 版など）は使用していません。
`public/static/chess/*.png` はこのSVGを `scripts/gen-chess-png.mjs` で
PNGに変換した成果物です。再生成は次のコマンドで行えます。

```bash
node scripts/gen-chess-png.mjs
```

### 検証

```bash
# 自動テスト（正常系・異常系 90項目）
node scripts/chess-test.mjs

# 各状態のFlex JSONサンプル出力とサイズ検証
node scripts/chess-flex-samples.mjs
```

Flex Message の上限は 30,000 バイトです。本実装の最大は **23,112 バイト**
（引き分け提案中の盤面）で、約 6.9KB の余裕があります。
サンプルと計測結果は [`samples/chess-flex/README.md`](./samples/chess-flex/README.md) にあります。

---

## セットアップ（LINE側の設定）

### 1. 環境変数

```bash
cp .env.example .dev.vars   # ローカル開発用（コミット禁止）
```

本番は wrangler の secret として設定します。**secret は次回のデプロイ以降に反映されます。**

```bash
printf '%s' "$LINE_CHANNEL_ACCESS_TOKEN" | \
  npx wrangler pages secret put LINE_CHANNEL_ACCESS_TOKEN --project-name line-group-bbs
```

### 2. LINE Developers コンソールの設定

Messaging API チャネルで以下を設定します。**どれか1つでも漏れると動きません。**

| 項目 | 設定値 | 理由 |
|---|---|---|
| Webhook URL | `https://line-group-bbs.pages.dev/webhook` | |
| Webhookの利用 | **オン** | オフだとイベントが1件も届きません |
| Webhookの再送 | オン推奨 | 一時的な失敗を救済できます。重複はBOT側で弾きます |
| 応答メッセージ（自動応答） | **オフ** | オンだと定型文がBOTの返信と二重に出ます |
| あいさつメッセージ | 任意 | |
| **グループ・複数人チャットへの参加を許可する** | **オン** | **オフだとグループに追加できません** |

### 3. グループへの追加手順

1. LINEアプリでグループを開く → 「招待」→ BOTを検索して追加
   （または BOTを友だち追加した状態で、トーク画面から「グループに招待」）
2. 追加に成功すると、BOTが参加のあいさつを送ります
3. 送られない場合は上記2の「グループ・複数人チャットへの参加を許可する」を確認してください

### 4. 動作確認（ヘルスチェック）

```bash
# サイトが生きているか
curl -s -o /dev/null -w "%{http_code}\n" https://line-group-bbs.pages.dev/

# 駒画像が配信されているか（200 / image/png であること）
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  https://line-group-bbs.pages.dev/static/chess/wq.png

# 署名なしのWebhookが正しく拒否されるか（401 であること）
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://line-group-bbs.pages.dev/webhook -d '{}'
```

グループで「チェス」と送って募集カードが出れば、LINE側の設定は完了です。

### 5. ローカル開発

```bash
npm install
cp .env.example .dev.vars           # 値を書き換える
npx wrangler d1 migrations apply line-group-bbs-db --local
npm run build
pm2 start ecosystem.config.cjs      # http://localhost:3000
pm2 logs --nostream
```
