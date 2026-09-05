# 引き継ぎプロンプト(新セッション開始時にこれをそのまま貼り付けてください)

私は葉っぱもち Bot (HappaMochi Bot / line-group-bbs) の開発を継続します。
以下は必ず守ってほしい方針・現状です。読んだら確認の一言だけ返して、指示を待ってください。

## 絶対に守ること(過去のセッションで確定済みの方針、変更禁止)
- コードは `/home/user/happamochi-bot` にある。Cloudflare Pagesプロジェクト名は `line-group-bbs`。
- LINEへの送信は **Reply APIのみ**。Push APIは絶対に使わない(月間無料枠の制約のため)。
- D1データベース(`line-group-bbs-db`)の既存データは絶対に破壊しない。
  マイグレーションは必ず追加のみ・`CREATE TABLE IF NOT EXISTS` 形式。
- 「名言カード」は必ず実際のPNG画像を `imageMessage` で送る。**Flex Messageへの後退は絶対禁止**
  (過去に一度後退して問題になった)。
- 「メモ＆BOTテスト」グループへの参加失敗調査は**保留中**。これ以上の推測や
  「自動参加」コードの提案は絶対にしないこと(明示的に禁止されている)。
- ギャラリー機能(`/gallery`)は**全177グループ分を絞り込みなしで表示する**。
  これはユーザーが既に同意済みの仕様であり、再度議論を持ち出さないこと。
- 低確率の推測(「〜かもしれません」的な当てずっぽう)は絶対にしない。分からないことは
  分からないと言う。

## デプロイ方法
- `cf-byok-deploy` スキル相当のフロー: `setup_cloudflare_api_key` →
  `wrangler pages secret put`(新しいsecretがある場合)→
  `wrangler pages deploy dist --project-name line-group-bbs --branch main --commit-dirty=true`
- **重要な既知の挙動**: `wrangler pages secret put` はシークレットストアを即時更新するが、
  **現在稼働中のデプロイには反映されない**。次の `wrangler pages deploy` を実行して
  初めて新しい値が有効になる。secretを変更したら必ず再デプロイすること。
- secretを設定する時は `echo "$VAR" | wrangler pages secret put ...` ではなく
  **`printf '%s' "$VAR" | wrangler pages secret put ...`** を使う
  (`echo`だと末尾に改行が付いて値が変わってしまう)。
- デプロイ前に `pm2 delete happamochi-bot 2>/dev/null; fuser -k 3000/tcp 2>/dev/null` で
  ローカルのwranglerサーバーを止めてメモリを空けること(フォント埋め込みでesbuildが
  メモリ不足で無言停止することがあるため)。
- サンドボックスの `/tmp` は不安定でファイルが消えることがある。生成した値(パスワード等)は
  同じコマンドブロック内で使い切ること。

## 現在の状態(このプロンプトを書いた時点)
- 本番URL: https://line-group-bbs.pages.dev
- 最新のgitコミット: `d40a134`(ギャラリーのダークテーマ化+管理者削除機能)
- ローカルgitは `origin/main` より進んでいる(未push、26+件)。GitHub連携が必要なら
  `setup_github_environment` から。
- 実装済み機能: メッセージ取り消し通知、誕生日通知、星座占い、週間ランキング、名言カード
  (satori+resvg-wasmでPNG生成)、ウェルカムメッセージ、タグ機能、称号システム、オセロ、
  BBS募集掲示板+オープンチャット(`/bbs`)、名言カードギャラリー(`/gallery`、ダークテーマ、
  管理者専用削除機能付き)。
- 除外機能(意図的): 危険人物リスト、ガチャ機能。
- ギャラリー管理者パスワード: `GALLERY_ADMIN_PASSWORD`(Cloudflare Pages secret)
  本番の値は `@Nano1212`(ユーザー確定済み)。ローカル`.dev.vars`は別のテスト値のまま
  (変更不要、ローカル開発用)。
- 詳細は `/home/user/happamochi-bot/README.md` を必ず読むこと(機能一覧・API一覧・
  アーキテクチャ上の重要な注意点が全て書いてある。特に「名言カードの画像生成」節の
  satoriバージョン固定・WASM静的import・D1 BLOB変換周りの注意点は再発しやすいので必読)。

## 次にやってほしいこと
(ここに今回の具体的な依頼内容を書く)
