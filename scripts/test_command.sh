#!/bin/bash
# ★これがテストコマンドです★
#
# 使い方:
#   cd /home/user/happamochi-bot
#   bash scripts/test_command.sh "ヘルプ"
#   bash scripts/test_command.sh "称号一覧"
#   bash scripts/test_command.sh "運勢"
#
# 何をするか:
#   本番サイト (https://line-group-bbs.pages.dev) に「もしLINEでこのテキストを
#   送ったら、Botは何を返信しようとするか」を聞くだけ。LINEには何も送らない。
#   Botの中の分岐ロジック(routeCommand)をそのまま実行させて、結果のテキストを
#   その場で表示する。
#
# これで分かること:
#   - コマンドが正しく認識されているか
#   - 返信文の内容が正しいか
#   - サーバー側でエラーが起きていないか(500エラーなら壊れている)
#
# これで分からないこと:
#   - 実際にLINEアプリに届くかどうか(Reply APIは本物のreplyTokenが必要なため、
#     これはLINEアプリを開いて実際にメッセージを送ってもらうしかない)

if [ -z "$1" ]; then
  echo "使い方: bash scripts/test_command.sh \"送りたいテキスト\""
  echo "例:     bash scripts/test_command.sh \"ヘルプ\""
  exit 1
fi

TEXT="$1"
URL="https://line-group-bbs.pages.dev/debug/simulate"

echo "=== 送信テキスト: $TEXT ==="
curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{\"text\": $(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$TEXT")}" \
  | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), ensure_ascii=False, indent=2))" 2>/dev/null \
  || echo "(JSON整形に失敗。生の応答を確認してください)"
