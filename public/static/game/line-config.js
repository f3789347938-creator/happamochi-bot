// Public LIFF ID only. Never put a channel secret or access token in client code.
// Set shareUrl only after a public game / LIFF URL is ready for friends to open.
// Empty means share the result without a game link. Do not use a private trial URL.
//
// liffId  : LINEログインチャネル「葉っぱ」に追加したLIFFアプリのID。
//           公開して良い値。これがある時だけLIFF SDKを読み込み liff.init() する。
// shareUrl: 結果をシェアした相手が遊べるURL。LIFF URL を使う。
export const LINE_CONFIG = Object.freeze({
  liffId: '2011492233-0cUBhY55',
  shareUrl: 'https://liff.line.me/2011492233-0cUBhY55',
});
