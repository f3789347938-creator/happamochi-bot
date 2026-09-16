/** Help content and visual coordinates. All measurements are at 1× (260 px wide). */
export interface HelpCommand {
  label: string
  desc: string
  send?: string
  noAction?: boolean
}

export const HELP_DESIGN = {
  colors: {
    accent: '#039BE5',
    cardBg: '#F1FAFE',
    itemBg: '#FFFFFF',
    head: '#123F58',
    desc: '#21445F',
    line: '#CFE7F3',
    onAccent: '#FFFFFF',
    arrow: '#83B5D8',
  },
  mascotFile: 'happamochi-e061df69.jpg',
  footerText: '© 2026 HappaMochi Bot',
  brandText: '葉っぱもち',
  coverTitle: 'ヘルプ',
  commandTitle: 'コマンド一覧',
  welcomeTitle: '葉っぱもちへようこそ',
  introLines: [
    'グループでも、1対1でも。',
    'ゲームやランキング、画像づくりを',
    'いつものトークで楽しもう。',
  ],
  ctaLabel: '公式サイトを見る',
  perCard: 5,
  width: 260,
  height: 462,
  scale: 2,
  headerHeight: 80,
  rowHeight: 70,
  footerHeight: 32,
  coverHeight: 348,
  ctaHeight: 82,
  tile: { x: 12, width: 236, height: 64, radius: 13, textX: 36, textWidth: 190 },
  type: { title: 30, brand: 13.5, welcome: 23, intro: 14, command: 18, description: 13.5, cta: 21 },
  commands: [
    { label: 'ヘルプ', desc: 'このメニューを開く' },
    { label: 'ステータス', desc: '自分のレベル・EXP・ポイント' },
    { label: 'ランキング', desc: '各種ランキングを表示' },
    { label: 'お知らせ', desc: '直近のお知らせを表示' },
    { label: '着せ替え', desc: 'カードの見た目を変える' },
    { label: 'パズル', desc: 'もち合体パズルで遊ぶ' },
    { label: 'サバイバル', desc: 'もち軍団サバイバルで遊ぶ' },
    { label: 'オセロ', desc: '対局を募集する', send: 'オセロ開始' },
    { label: 'オセロ参加', desc: '募集中の対局に入る' },
    { label: 'オセロ戦績', desc: '自分の勝敗数を見る' },
    { label: 'チェス', desc: '対局を募集する' },
    { label: '盤面', desc: 'チェスの盤面を出す' },
    { label: 'めいく 装飾', desc: '使える装飾の一覧', send: 'めいく装飾' },
    { label: 'めいく:本文', desc: '文字を入れて画像を作る', noAction: true },
    { label: '返信して めいく', desc: 'その発言の画像を作る', noAction: true },
    { label: 'めいく bold虹7:文', desc: '装飾つきの書き方', noAction: true },
    { label: 'ウェルカムオン', desc: '参加時のあいさつを出す' },
    { label: 'ウェルカムオフ', desc: 'あいさつを止める' },
    { label: '取り消し通知オン', desc: '送信取消を知らせる（初期はオフ）' },
    { label: '取り消し通知オフ', desc: '知らせない' },
  ] as HelpCommand[],
}
