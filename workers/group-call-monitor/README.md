# グループ通話の自動記録

葉っぱもちの公式アカウント管理APIでグループ通話履歴を受け取り、終了後に同じグループへ通話時間を送信する独立Worker。既存のPages Botやポイントの処理は変更しない。

```text
グループ通話が終了しました
通話時間：1時間23分45秒
```

## 接続・配備

Cloudflare WranglerにWorkers ScriptsとD1の書き込み権限でログインする。

```sh
wrangler d1 execute line-group-bbs-db --remote --file workers/group-call-monitor/schema.sql --config workers/group-call-monitor/wrangler.jsonc
wrangler deploy --config workers/group-call-monitor/wrangler.jsonc
wrangler secret put OA_COOKIE --config workers/group-call-monitor/wrangler.jsonc
wrangler secret put ADMIN_TOKEN --config workers/group-call-monitor/wrangler.jsonc
```

`OA_COOKIE` はLINE Official Account Managerの管理セッション。通常のMessaging APIトークンではない。`ADMIN_TOKEN` は32バイト以上のランダムな値を使う。どちらもCloudflareのSecretへ入力し、設定ファイル・Git・ログに書かない。管理セッションが期限切れになった場合は `OA_COOKIE` を更新する。

`wrangler.jsonc` の `CHAT_SCOPE` で送信先を指定する。カンマ区切りの管理画面chatId、または `all`（GROUP_CALLが届くグループ全体）を使用。管理画面chatIdとMessaging APIのgroupIdは別のIDなので、混用しない。`SEND_ENABLED` が文字列 `true` のときのみ送信する。送信を有効化した時や対象を拡大した時も、変更前の履歴は通知しない。

## 動作

- 毎分のCronから起動。最近更新されたグループの履歴を照合してから、最大40秒のSSE接続で新着通話履歴を受信する。
- チャット一覧は管理APIで受理される25件ずつ取得。ページ上限に達した場合は位置をD1に保存し、次回から続ける。履歴の遅延反映に備えて直近15分を重ねて読み、送信結果が不明なチャットは24時間照合する。
- `callHistory / GROUP_CALL / INFO` かつ正の整数 `duration` を終了候補とし、ミリ秒を日本語の時間に整形する。0の記録では送信しない。
- 履歴とSSEの両方に届いても、グループ＋メッセージIDで重複排除。IDは文字列のまま保持する。
- 初回・対象変更前の履歴と、15分より古い通知は送信しない。
- 管理APIの送信に公開された冪等性保証はない。タイムアウトや送信途中のクラッシュは `uncertain` として保存し、自動再送しない。管理画面の履歴・送信イベントで同じ `sendId` を確認できた場合のみ `sent` に解決する。
- 接続の切れ目などで通知が次の定期実行まで待つ場合がある。期限切れ・権限不足はログに状態コードだけを記録し、認証情報・会話本文は記録しない。

管理画面の非公開APIを利用するため、LINE側の変更や管理セッションの期限切れで停止する可能性がある。`GET /status` の `last_success_at` と `last_error`、CloudflareのWorkerログで稼働を確認する。401/403の場合は管理画面に再ログインして `OA_COOKIE` を更新する。送信だけ止める場合は `SEND_ENABLED` を `false` に変更して再配備する。

## 管理用エンドポイント

すべて `Authorization: Bearer <ADMIN_TOKEN>` が必要。未認証リクエストは404。

- `GET /status`: 稼働時刻、送信状態、直近の通話記録。
- `GET /probe`: テストグループの履歴とSSE認証の読み取り確認。送信なし。
- `POST /run`: 履歴照合を即時実行。送信設定が有効な場合は新着通話を送信する。

## 検証

```sh
node --test workers/group-call-monitor/tests/*.test.mjs
wrangler deploy --dry-run --config workers/group-call-monitor/wrangler.jsonc
```

実機では、通話中に通知が出ないこと、全員退出後に1件だけ届くこと、次の実行でも増えないことを確認する。複数人通話の途中退出の扱いは別途確認が必要。実データの取得と公開コードから分かった根拠は `CALL-EVENT-EVIDENCE.md` に記載。
