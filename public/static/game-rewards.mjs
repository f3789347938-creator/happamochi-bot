// Display only the server's receipt. Game scores and local coins are not a balance.
const number = value => value.toLocaleString('ja-JP');

export function gameRewardText(reward) {
  if (!reward) return 'ガチャ用ポイントの結果を確認できませんでした。';
  const reasons = {
    too_short: '30秒未満のプレイはポイント対象外です。',
    no_score: '100スコアからポイントが貯まります。',
    daily_limit: '今日のゲーム獲得上限に達しました。',
    expired: 'このプレイのポイント受付期限が過ぎています。',
    superseded: '新しいプレイが始まったため、この記録はポイント対象外です。',
    legacy: '開始記録がないため、今回はポイント対象外です。',
    guest: 'LINEログインして遊ぶとガチャ用ポイントが貯まります。',
    start_error: '開始を記録できなかったため、今回はポイント対象外です。',
    offline: '記録なしの出撃はガチャ用ポイント対象外です。',
  };
  const points = Number.isSafeInteger(reward.points) && reward.points >= 0 ? reward.points : null;
  const balance = Number.isSafeInteger(reward.balance) && reward.balance >= 0 ? reward.balance : null;
  const earned = Number.isSafeInteger(reward.dailyEarned) && reward.dailyEarned >= 0 ? reward.dailyEarned : null;
  const limit = Number.isSafeInteger(reward.dailyLimit) && reward.dailyLimit > 0 ? reward.dailyLimit : null;
  let text = points > 0 ? `ガチャ用ポイント ＋${number(points)} P` : (reasons[reward.status] || 'ガチャ用ポイントの結果を確認できませんでした。');
  if (balance !== null) text += `　保有 ${number(balance)} P`;
  if (earned !== null && limit !== null) text += `（今日 ${number(earned)} / ${number(limit)} P）`;
  return text;
}
