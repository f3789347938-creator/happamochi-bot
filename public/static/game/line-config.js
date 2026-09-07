// Public LIFF ID only. Never put a channel secret or access token in client code.
// LIFF ID は公開して良い値。チャネルシークレットやアクセストークンは書かない。
// これが設定されているときだけ LINE公式のLIFF SDKを読み込み、liff.init() を実行する。
// ゲームは liff.getProfile() を呼ばないので、名前やアイコンは取得しない。
export const LINE_CONFIG = Object.freeze({ liffId: '2011492233-0cUBhY55' });
