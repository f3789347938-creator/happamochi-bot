# グループ通話の自動記録・既読確認

葉っぱもちの公式アカウント管理APIでグループ通話履歴を受け取り、終了後に同じグループへ通話時間を送信する独立Worker。既存のPages Botやポイントの処理は変更しない。

```text
グループ通話が終了しました
通話時間：1時間23分45秒
```

## 接続・配備

Cloudflare WranglerにWorkers ScriptsとD1の書き込み権限でログインする。

```sh
wrangler d1 execute line-group-bbs-db --remote --file workers/group-call-monitor/schema.sql --config workers/group-call-monitor/wrangler.jsonc
wrangler d1 execute line-group-bbs-db --remote --file workers/group-call-monitor/read-schema.sql --config workers/group-call-monitor/wrangler.jsonc
wrangler d1 execute line-group-bbs-db --remote --file workers/group-call-monitor/read-group-migration.sql --config workers/group-call-monitor/wrangler.jsonc
wrangler deploy --config workers/group-call-monitor/wrangler.jsonc
wrangler secret put OA_COOKIE --config workers/group-call-monitor/wrangler.jsonc
wrangler secret put ADMIN_TOKEN --config workers/group-call-monitor/wrangler.jsonc
```

`OA_COOKIE` はLINE Official Account Managerの管理セッション。通常のMessaging APIトークンではない。`ADMIN_TOKEN` は32バイト以上のランダムな値を使う。どちらもCloudflareのSecretへ入力し、設定ファイル・Git・ログに書かない。管理セッションが期限切れになった場合は `OA_COOKIE` を更新する。

`wrangler.jsonc` の `CHAT_SCOPE` で送信先を指定する。カンマ区切りの管理画面chatId、または `all`（GROUP_CALLが届くグループ全体）を使用。管理画面chatIdとMessaging APIのgroupIdは別のIDなので、混用しない。`SEND_ENABLED` が文字列 `true` のときのみ送信する。送信を有効化した時や対象を拡大した時も、変更前の履歴は通知しない。

## 動作

- 公式アカウントごとに1つのDurable ObjectがSSEを継続監視する。接続は最大4分で更新し、終了後250msで次のalarmを予約する。毎分のCronは監視の起動確認だけを行う。
- SSEへ先に接続し、履歴照合は並行して行う。終了速報には `message.id` が含まれないため、その場で対象グループの履歴を取得し、正式なIDで記録・送信する。履歴がまだ反映されていなければ再確認を予約し、SSEカーソルを進めず短いbackoff後に再取得する。
- チャット一覧は管理APIで受理される25件ずつ取得。ページ上限に達した場合は位置をD1に保存し、次回から続ける。履歴の遅延反映に備えて直近15分を重ねて読み、送信結果が不明なチャットは24時間照合する。
- `callHistory / GROUP_CALL / INFO` かつ正の整数 `duration` を終了候補とし、ミリ秒を日本語の時間に整形する。0の記録では送信しない。
- 履歴とSSEの両方に届いても、グループ＋メッセージIDで重複排除。IDは文字列のまま保持する。
- 初回・対象変更前の履歴と、15分より古い通知は送信しない。
- 管理APIの送信に公開された冪等性保証はない。タイムアウトや送信途中のクラッシュは `uncertain` として保存し、自動再送しない。管理画面の履歴・送信イベントで同じ `sendId` を確認できた場合のみ `sent` に解決する。
- 接続が無通信になった場合は30秒で張り直す。失敗時は2〜60秒のbackoffで再試行し、401/403/429では60秒間隔にする。期限切れ・権限不足はログに状態コードだけを記録し、認証情報・会話本文は記録しない。
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)の実行前に復旧用の次回alarmを保存する。通常時の遅延を抑える構成であり、LINE側の遅延やCloudflare障害時まで通知時間を保証するものではない。

管理画面の非公開APIを利用するため、LINE側の変更や管理セッションの期限切れで停止する可能性がある。`GET /status` の `last_success_at` と `last_error`、CloudflareのWorkerログで稼働を確認する。401/403の場合は管理画面に再ログインして `OA_COOKIE` を更新する。送信だけ止める場合は `SEND_ENABLED` を `false` に変更して再配備する。

## 既読確認

`READ_RECEIPTS_ENABLED` と `SEND_ENABLED` が `true` の場合、対象グループで次のコマンドが使える。

| コマンド | 動作 |
| --- | --- |
| 既読セット | グループ共通の確認を開始・やり直す。前の既読記録をリセットし、この投稿以降の既読イベントを記録する。 |
| 既読確認 | 最後にセットした位置から既読を確認できた、現在のグループメンバーの名前を表示する。誰でも同じ結果を参照できる。 |

- 確認はグループごとに1つ。誰かが「既読セット」を送ると、そのグループ全員の確認基準が切り替わり、以前の既読記録はリセットされる。確認中のグループだけを記録する。
- SSE の `chatRead` にある `source.userId` と `read.watermark` を使う。OA管理者側の `read` イベントや、発言した事実から既読を推測しない。
- 履歴APIの既読イベントには読者IDが欠けるため、セット前やイベントを取り逃した期間の既読者を復元しない。未受信を「未読」とは表示しない。
- 現在のメンバー一覧で名前を照合し、最大40人を表示する。以降は残人数を明示する。IDをグループへ表示しない。
- 同じコマンドの再配信はグループ＋SSEイベントIDで重複排除。セット時の基準更新・旧既読記録の削除・コマンド取得をD1 batchで一体化する。送信結果不明時は自動再送しない。

### 保存と移行

共有セッションは `oa_read_group_sessions` にグループごとに保存する。`read-schema.sql` の後に `read-group-migration.sql` を適用し、その後Workerを配備する。既存の利用者別セッションからは、各グループの最新の確認基準を移行する。移行済みマーカーにより再実行可能で、移行済みの共有セッションや、その後にセットした基準を上書きしない。旧利用者別テーブルは残す。

保存上限としてセッションのTTLは24時間とし、期限切れの確認と不要な既読記録を削除する。コマンド重複防止情報は7日保持する。利用者向けのコマンド案内には期限や終了コマンドを表示しない。既存のポイントやグループ設定は変更しない。

実機の根拠と制限は [READ-RECEIPT-EVIDENCE.md](./READ-RECEIPT-EVIDENCE.md) を参照。

## 管理用エンドポイント

すべて `Authorization: Bearer <ADMIN_TOKEN>` が必要。未認証リクエストは404。

- `GET /status`: 稼働時刻、接続監視の状態、送信状態、直近の通話記録と通知遅延。
- `GET /probe`: テストグループの履歴とSSE認証の読み取り確認。送信なし。
- `POST /run`: 監視の起動を確認し、未起動ならalarmを予約。起動中は2本目の接続を作らない。

## 検証

```sh
node --test workers/group-call-monitor/tests/*.test.mjs
wrangler deploy --dry-run --config workers/group-call-monitor/wrangler.jsonc
```

実機では、通話中に通知が出ないこと、全員退出後に1件だけ届くこと、次の実行でも増えないことを確認する。複数人通話の途中退出の扱いは別途確認が必要。実データの取得と公開コードから分かった根拠は `CALL-EVENT-EVIDENCE.md` に記載。
