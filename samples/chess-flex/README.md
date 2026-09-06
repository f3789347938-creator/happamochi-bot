# チェス Flex Message サンプル

実際にLINEへ送信するのと同じコード（`boardMessage` / `resultMessage` /
`recruitMessage` / `buildPromotionCard`）をローカルのWorker上で実行して
取得したJSONです。`scripts/chess-flex-samples.mjs` で再生成できます。

LINEのFlex Messageの上限は **30,000 バイト**（bubbleのJSON表現）です。
本実装の最大は **23,537 バイト**（余裕 6,463 バイト）でした。

| 状態 | サイズ | 上限比 | ファイル | 内容 |
|---|--:|--:|---|---|
| 募集中 | 2,005 B | 6.7% | [`00-recruit.json`](./00-recruit.json) | 「チェス」直後。参加/取り消しボタンのみ |
| 初期盤面 | 22,851 B | 76.2% | [`01-initial.json`](./01-initial.json) | 対局成立直後。白の手番、選択なし |
| 選択中 | 23,223 B | 77.4% | [`02-selected.json`](./02-selected.json) | e2のポーンを選択。e3/e4に移動先マーク |
| 選択中(取れる) | 23,139 B | 77.1% | [`02b-selected-capture.json`](./02b-selected-capture.json) | e4のポーンでd5を取れる状態 |
| チェック中 | 22,838 B | 76.1% | [`03-check.json`](./03-check.json) | 黒Kがチェックされている。King枠が赤 |
| 昇格待ち | 3,275 B | 10.9% | [`04-promotion.json`](./04-promotion.json) | b7→b8。Q/R/B/N を選ぶまで確定しない |
| 引き分け提案中 | 23,537 B | 78.5% | [`05-draw-offer.json`](./05-draw-offer.json) | 承諾/拒否ボタンが追加された盤面 |
| 終局 | 18,988 B | 63.3% | [`06-finished.json`](./06-finished.json) | チェックメイト。再戦ボタン付き |

## altText（通知・トーク一覧に出る文字列）

- **募集中**: チェス[募集中] 作成者さんが対局相手を募集中
- **初期盤面**: チェス[対局中] 白(白) vs 黒(黒) — 白さんの番
- **選択中**: チェス[対局中] 白(白) vs 黒(黒) — 白さんの番
- **選択中(取れる)**: チェス[対局中] 白(白) vs 黒(黒) — 白さんの番
- **チェック中**: チェス[対局中] 白(白) vs 黒(黒) — 黒さんの番
- **昇格待ち**: チェス[昇格待ち] 白さんがポーンの昇格先を選択中
- **引き分け提案中**: チェス[対局中] 白(白) vs 黒(黒) — 白さんの番
- **終局**: チェス[終局] 白(白) vs 黒(黒)
