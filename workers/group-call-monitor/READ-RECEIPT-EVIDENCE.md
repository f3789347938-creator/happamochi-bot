# グループ既読イベントの実機検証

検証日：2026-09-20（JST）。対象は利用者が管理する葉っぱもちの「botテスト」。認証情報、読者ID、メンバー一覧は掲載しない。

## 管理画面の表示制限と実データ

公式配信の [CMS JavaScript](https://vos.line-scdn.net/line-oa-crm-pc/js/cms.DwkJzN5V.js) は `chatRead` による `userLastReadAt` 更新と既読マーク表示を `isUserChat` に限定している。ただし、これはグループへ既読イベントが届かない証拠ではなかった。

実際のSSE再生では対象グループの `chatRead` が6件あり、各 `payload.source.userId` が `/api/v1/bots/{botId}/chats/{chatId}/members` の同一メンバーに一致した。`read.watermark` と `payload.timestamp` は正の整数ミリ秒で一致した。履歴API側の既読イベントでは `source.userId` が省略されていた。

匿名化した実イベントの形：

```json
{
  "event": "chat",
  "subEvent": "chatRead",
  "botId": "<OA>",
  "chatId": "<GROUP>",
  "payload": {
    "type": "chatRead",
    "timestamp": 1789841375102,
    "source": { "chatId": "<GROUP>", "userId": "<READER>" },
    "read": { "watermark": 1789841375102 }
  }
}
```

## 開閉を制御した検証

1. 利用者がスマートフォンで対象トークを閉じたと回答。
2. 接続済みのSSEで受信を待ちながら、対象グループにテスト文を1件送信。送信開始は `1789841363868`。
3. 利用者へ対象トークを開くよう依頼し、「開いた」と回答を得た。
4. その間に `chatRead` を受信。既読時刻/水位は `1789841375102`、受信時刻は `1789841378662`。
5. 読者IDはその利用者のグループメンバー情報に一致し、OA自身のIDとは異なった。

この検証は、グループで名前と対応付けられる既読イベントを取得できることを確認した。イベントが全端末・全期間で漏れなく届くことや、本文を本人が熟読したことまで保証するものではない。

## 区別するもの

- `chatRead`：今回実証した読者側の既読イベント。読者IDを持つSSEだけを採用する。
- `read`：OA管理画面の既読状態更新。グループメンバーの既読者として扱わない。
- 履歴中の読者IDなし `read.watermark`：人数や読者を推測しない。
- UI の `isUserChat` 条件：画面が表示しないという制限。サーバーイベントの有無とは別。
