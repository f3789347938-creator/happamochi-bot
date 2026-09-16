// もち軍団サバイバルのLINE設定。
//
// ここに書いてよいのは「公開して良い値」だけ。
// チャネルシークレットやアクセストークンは絶対に書かない。
//
// liffId:
//   LINEログインチャネル「葉っぱ」に追加した【2個目の】LIFFアプリのID。
//   1個目(2011492233-0cUBhY55)はもち合体パズルが使っている。
//   1つのチャネルにLIFFアプリは30個まで追加できるので、
//   ミニアプリ化も審査も不要で、パズルと同じ要領で増やせる。
//
//   エンドポイントURLには次を登録する:
//     https://line-group-bbs.pages.dev/static/survivor/
//
//   ★ここが空のあいだは、LINEログインなしで遊べる状態で動く。
//     ランキングと記録はログインが必要なので、その部分だけ無効になる。
//     IDを入れると自動的にログイン有効に切り替わる。
export const LINE_CONFIG = Object.freeze({
  liffId: '',
  // 結果をシェアした相手が遊べるURL。liffId を入れたら
  // 'https://liff.line.me/<そのID>' を入れる。
  publicAppUrl: '',
  // 公式LINEの紹介カード(復活機能で使う)。@から始まるID。
  officialAccountId: '',
  officialAccountName: '',
  officialAccountImageUrl: '',
});
