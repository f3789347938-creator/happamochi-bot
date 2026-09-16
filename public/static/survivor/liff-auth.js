// LINEログインの窓口。
//
// 【重要なルール】
// このファイルは liff.getProfile() を呼ばない。
// ユーザーIDや名前をサーバーへ送ることも一切しない。
// 送るのは liff.getAccessToken() のアクセストークンだけで、
// 「誰なのか」はサーバーがLINEに問い合わせて決める。
//
// これは、もち合体パズル(static/game/ranking.mjs)と同じ方針。
// クライアントが userId を送る作りにすると、DevTools や curl から
// 他人のIDを送るだけでなりすませてしまうため。
//
// 元パックは 'oai-authenticated-user-id' というヘッダーを
// プレイヤーIDとして信用していた。これは別サービス専用の仕組みで、
// LINEではヘッダーを自分で付けるだけで偽装できる。だから使わない。

import { LINE_CONFIG } from './line-config.js';

let sdkReady = null;

/** LIFF SDKを読み込んで初期化する。設定が無ければ何もしない。 */
export function initLiff() {
  if (sdkReady) return sdkReady;
  if (!LINE_CONFIG.liffId) {
    sdkReady = Promise.resolve({ status: 'unconfigured' });
    return sdkReady;
  }
  sdkReady = (async () => {
    try {
      if (!window.liff) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
          s.async = true;
          s.onload = resolve;
          s.onerror = () => reject(new Error('LINE SDK unavailable'));
          document.head.appendChild(s);
        });
      }
      if (!window.liff) throw new Error('LINE SDK unavailable');
      // init が終わるまで現在URLを書き換えない(トークンが載っていることがある)
      await window.liff.init({ liffId: LINE_CONFIG.liffId, withLoginOnExternalBrowser: false });
      return { status: 'ready', inClient: window.liff.isInClient() };
    } catch {
      return { status: 'error' };
    }
  })();
  return sdkReady;
}

/**
 * 現在のアクセストークン。未ログインなら null。
 * これ以外の個人情報は取得も送信もしない。
 */
export function getAccessToken() {
  try {
    const liff = window.liff;
    if (!liff || typeof liff.getAccessToken !== 'function') return null;
    if (typeof liff.isLoggedIn === 'function' && !liff.isLoggedIn()) return null;
    return liff.getAccessToken() || null;
  } catch {
    return null;
  }
}

/** 記録機能が使える状態か */
export function canUseRecords() {
  return Boolean(LINE_CONFIG.liffId) && getAccessToken() !== null;
}

/** LINEアプリの中で開かれているか */
export function isInClient() {
  try {
    return Boolean(window.liff?.isInClient?.());
  } catch {
    return false;
  }
}

/** LIFFウィンドウを閉じる(LINE内でだけ意味がある) */
export function closeWindow() {
  try {
    if (isInClient()) window.liff.closeWindow();
  } catch { /* 端末差は無視 */ }
}
