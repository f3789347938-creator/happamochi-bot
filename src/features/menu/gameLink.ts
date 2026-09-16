// LINEの中で開くゲーム(もち合体パズル)のリンク。
//
// LINEの中でWebページを開く方法は2通りある:
//
//   1. LIFF(LINEミニアプリ)として登録する
//      → https://liff.line.me/<LIFF ID> を開くと、LINEアプリの中で
//        「✕ / タイトル / ドメイン」のヘッダー付きで表示される。
//        うぱるぱ ブロックパズルと同じ見た目になるのはこちら。
//        LIFF IDはLINE Developersで、このBotの持ち主が登録して取得する。
//
//   2. ただのHTTPS URLを開く
//      → LINEの内蔵ブラウザで開く。ゲームは同じように遊べるが、
//        LIFF特有のヘッダーは出ない。
//
// LIFF_ID が空のあいだは 2 で動く。値を入れると自動的に 1 に切り替わる。
// LIFF IDは公開して良い値(パスワードではない)なので、ここに直接書いてよい。
// チャネルシークレットやアクセストークンは絶対に書かない。
export const LIFF_ID = '2011492233-0cUBhY55'

/** ゲームの実体を配信しているURL。LIFFのエンドポイントにもこれを登録する。 */
export function gamePageUrl(siteUrl: string): string {
  return `${siteUrl}/static/game/`
}

/**
 * Flexのボタンに載せるURL。
 * LIFF IDが設定されていればLINEミニアプリとして開き、
 * 無ければ通常のHTTPS URL(LINEの内蔵ブラウザ)で開く。
 */
export function gameOpenUrl(siteUrl: string): string {
  return LIFF_ID ? `https://liff.line.me/${LIFF_ID}` : gamePageUrl(siteUrl)
}

/** LIFFとして登録済みかどうか。案内文の出し分けに使う。 */
export const isLiffConfigured = (): boolean => LIFF_ID.length > 0

// ─── もち軍団サバイバル ──────────────────────────────────────
//
// 2本目のゲーム。パズルと同じ要領で出す。
//
// 1つのLINEログインチャネルには LIFFアプリを30個まで追加できるので、
// ミニアプリ化も審査もせずに、同じチャネルへ2個目を足すだけでよい。
// (根拠: LINE Developers「LIFFアプリをチャネルに追加する」)
//
// ★ここが空のあいだは、通常のHTTPS URL(LINEの内蔵ブラウザ)で開く。
//   その状態でもゲームは遊べる。ランキングと記録だけログインが要るので
//   そこが無効になる。LIFF IDを入れると自動でLIFF起動に切り替わる。
//
//   LINE Developers で2個目のLIFFアプリを追加し、
//   エンドポイントURLに次を登録してからIDをここに貼る:
//     https://line-group-bbs.pages.dev/static/survivor/
export const SURVIVOR_LIFF_ID = ''

/** サバイバルの実体を配信しているURL。LIFFのエンドポイントにもこれを登録する。 */
export function survivorPageUrl(siteUrl: string): string {
  return `${siteUrl}/static/survivor/`
}

/** Flexのボタンに載せるURL。LIFF IDがあればLINEミニアプリとして開く。 */
export function survivorOpenUrl(siteUrl: string): string {
  return SURVIVOR_LIFF_ID
    ? `https://liff.line.me/${SURVIVOR_LIFF_ID}`
    : survivorPageUrl(siteUrl)
}

/** サバイバルがLIFF登録済みか */
export const isSurvivorLiffConfigured = (): boolean => SURVIVOR_LIFF_ID.length > 0
