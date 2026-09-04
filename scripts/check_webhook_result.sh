#!/bin/bash
# 使い方: LINEグループでBotに何かメッセージ(例: "ヘルプ")を送った直後に、これを実行するだけ。
#
#   cd /home/user/happamochi-bot && bash scripts/check_webhook_result.sh
#
# 何をするか:
#   1. 本番D1の webhook_debug_logs から直近のイベントを取得(受信できたか/署名OKか/エラーが出てないか)
#   2. 本番D1の group_messages から直近のメッセージを取得(Botがメッセージを認識してDBに保存できたか)
#   3. LINEのPush無料枠の残量を表示(参考情報)
#
# これで「Botに届いたか」「エラーで落ちてないか」が一目でわかる。
# ※ 実際にBotから返信が来たかどうかはLINE側の画面で目視確認する必要がある
#   (このスクリアプトはBotの受信側の動作しか確認できない。送信の成否はLINE側かpush_api_logsで見る)

set -e
cd "$(dirname "$0")/.."
source ~/.bashrc 2>/dev/null || true

echo "======================================"
echo " 1) 直近の webhook 受信ログ (production)"
echo "======================================"
npx wrangler d1 execute line-group-bbs-db --remote --command="SELECT id, timestamp, event_type, has_signature, error_message FROM webhook_debug_logs ORDER BY id DESC LIMIT 8" 2>&1 | grep -A2 '"id"' | grep -v "^--$"

echo ""
echo "======================================"
echo " 2) 直近の group_messages (Botが保存できたか)"
echo "======================================"
npx wrangler d1 execute line-group-bbs-db --remote --command="SELECT id, group_id, user_id, message_text, created_at FROM group_messages ORDER BY id DESC LIMIT 8" 2>&1 | grep -A4 '"id"' | grep -v "^--$"

echo ""
echo "======================================"
echo " 3) 未配信のまま残っている通知キュー (pending_broadcasts, delivered=0)"
echo "======================================"
npx wrangler d1 execute line-group-bbs-db --remote --command="SELECT id, group_id, kind, delivered, created_at FROM pending_broadcasts WHERE delivered = 0 ORDER BY id DESC LIMIT 10" 2>&1 | grep -A5 '"id"' | grep -v "^--$"

echo ""
echo "======================================"
echo " 4) LINE Push 無料枠残量 (参考情報。Reply APIには影響しない)"
echo "======================================"
ACCESS_TOKEN=$(grep LINE_CHANNEL_ACCESS_TOKEN .dev.vars | cut -d= -f2-)
curl -s -X GET "https://api.line.me/v2/bot/message/quota/consumption" -H "Authorization: Bearer $ACCESS_TOKEN"
echo ""
echo "======================================"
echo " 見方:"
echo "  - 1) に直近のタイムスタンプが出ていて error_message が null なら、Botはメッセージを正しく受信できている"
echo "  - 2) にあなたが送ったメッセージのテキストが出ていれば、DBへの保存も成功している"
echo "  - Botからの返信そのものはLINEの画面で見るしかない。返信が来ていないのに 1)2) が正常なら、"
echo "    replyMessage の呼び出しか、LINE側の配信に問題がある可能性がある(次の調査対象)"
echo "======================================"
