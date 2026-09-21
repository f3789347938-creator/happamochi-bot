# 管理セッション更新の確認（2026-09-21）

本人の許可を得て、提供された認証Cookieを `chat.line.biz`、`account.line.biz`、`manager.line.biz` の認証確認に使用した。今回の追加調査では応答ヘッダーと転送先のみを確認し、会話本文は取得していない。認証値・OAuthクエリーは記録せず、検証用Cookieはメモリ内で扱い、終了後に破棄した。

## 確認できたこと

- 以前のクライアントは固定の `OA_COOKIE` を毎回送信し、応答の `Set-Cookie` を一切取り込んでいなかった。
- 有効なCookieでの `GET /api/v1/csrfToken`、`GET /`、公式アカウントのトップページは200だったが、セッション更新Cookieは返らなかった。
- Chatの `GET /login?redirectUri=...` は一時OAuth Cookieを返し、`account.line.biz/oauth2/authorize` に転送された。そこでは `account.line.biz/login` へ転送され、本人ログイン画面で停止した。`forceOAuth2=false` でも同じ経路だった。
- ManagerのトップもAccountのOAuth認証へ転送され、本人ログイン画面で停止した。提供済みChat用Cookieだけでは自動再ログインに到達しなかった。
- Accountがこの未認証フローで発行した `RSESSION` のMax-Ageは72000秒だった。これはChat管理セッションの有効期限を示すものではなく、過去の障害が固定の2日TTLによることも証明しない。

## 実装の範囲

`ses`、`__Host-chat-ses`、`XSRF-TOKEN`、`chat-device-group` の正当な更新を取り込み、期限・削除を反映する。更新値は暗号化してDurable Objectに保存してから使用する。別の応答によって既に更新されたCookieを、遅れて到着した応答で上書きしない。明示的なSecret差し替えは保存済みの状態より優先する。

既読・通話のSSE受信、履歴照合、送信の重複防止は既存のまま。再認証のためのパスワードや別サイトの認証値を保管する処理、認証画面の回避、繰り返しログインへの転送は実装しない。

## 未確認・制限

セッションCookieの再発行条件・期限・ログアウトポリシーは非公開。通常通信の更新Cookie保存によって今回と同じ失効を防げるかは、継続稼働での確認が必要。上位のログインセッションが無ければ本人認証が必要になり、更新Cookieの保存だけでその認証を代替できない。

## 公開コードの補助根拠

- [LINELib AuthService](https://github.com/Madoa5561/LINELib/blob/5639725c47c4ca6d0f4bbf0d1c7668b3ae6b9160/LINELib/AuthService.py): Cookie jarでの管理画面再接続、失敗時は別途ログイン。無期限更新の保証はない。
- [Cloudflare Headers](https://developers.cloudflare.com/workers/runtime-apis/headers/): 個別のSet-Cookieフィールドを処理する。
- [Durable Object storage](https://developers.cloudflare.com/durable-objects/api/storage-api/): 再起動をまたぐ状態保存に利用。
