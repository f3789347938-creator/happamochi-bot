// 「ヘルプ」の返信カード(横スワイプのカルーセル)。
//
// 1枚目   … ようこそカード(イラスト + 説明 + 公式サイト)
// 2枚目以降 … コマンド一覧。1コマンドが「青いボタン + 説明文」の1行になる
// 最下端   … カード下端いっぱいの青帯に白文字の著作権表示
//
// ボタンは message アクション。押すとそのコマンドが実際に発言として送信され、
// 既存の routeCommand がそのまま処理する。トークに残るのでコマンド名が
// 周りの人にも伝わる(コマンドの存在を知らない人が多いため、これが目的)。
//
// 色・寸法はこのファイル内に閉じている。既存の menu/flex.ts の
// 案内画面(32種)やステータス・チェス等のFlexには一切影響しない。
import type { LineMessage } from '../../lib/line'

const C = {
  // ★この3か所は同じ色を使う(指定)★
  //   フッター背景 / 「公式サイトを見る」ボタン背景 / コマンド名の文字色
  accent: '#039BE5',

  cardBg: '#F1FAFE',   // カード背景(淡い水色)
  itemBg: '#FFFFFF',   // 各コマンドの項目背景
  head: '#123F58',     // 見出し
  desc: '#425C6E',     // 説明文
  line: '#CFE7F3',     // 細い枠線
  onAccent: '#FFFFFF', // 青地の上の文字
  arrow: '#9EC6DC',    // 右端の控えめな矢印
}

const FOOTER_TEXT = '© 2026 HappaMochi Bot'

/**
 * ヘルプの表紙に出すイラストのファイル名。
 * 末尾は画像の中身から作ったハッシュ。中身を変えたら必ずここも変える。
 * (LINEが同じURLの画像をキャッシュして古いまま表示するのを防ぐため)
 */
const MASCOT_FILE = 'happamochi-e061df69.jpg'

/** コマンド1行。左に青いボタン、右に説明文。 */
interface Cmd {
  /** ボタンに出す文字。押すとこの文字がそのまま送信される */
  label: string
  /** 右側の説明文 */
  desc: string
  /**
   * 実際に送信する文字。label と違う場合だけ指定する。
   * (例: ボタンは「オセロ」でも送るのは「オセロ開始」)
   */
  send?: string
  /**
   * 押しても動かない(引数が必要など)コマンドは説明だけにする。
   * 押して何も起きないボタンは出さない。
   */
  noAction?: boolean
}

// コマンドは1本の並びで持つ。カテゴリごとに分けず、
// 上から順に詰めて7件ずつのカードに切る(見本と同じく全部「コマンド一覧」)。
// 説明が短いものを詰めるほど1枚に入るので、説明は簡潔にしている。
const COMMANDS: Cmd[] = [
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
]

/** 1ページに載せるコマンド数(指定: 必ず5件) */
const PER_CARD = 5

/**
 * コマンド配列を5件ずつ自動でページに割る。
 * 項目を増減しても、ここを手で直す必要はない。
 * 見出しはすべて「コマンド一覧」(カテゴリ見出しは付けない)。
 */
const PAGES: { title: string; items: Cmd[] }[] = (() => {
  const out: { title: string; items: Cmd[] }[] = []
  for (let i = 0; i < COMMANDS.length; i += PER_CARD) {
    out.push({ title: 'コマンド一覧', items: COMMANDS.slice(i, i + PER_CARD) })
  }
  return out
})()

/** ページ上部のブランド行(小さな葉っぱマーク + 葉っぱもち) */
function brandRow(): Record<string, any> {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'xs',
    contents: [
      { type: 'text', text: '🌿', size: 'xs', flex: 0 },
      { type: 'text', text: '葉っぱもち', size: 'xs', color: C.desc, flex: 0 },
    ],
  }
}

/** ページ見出し(「ヘルプ」「コマンド一覧」) */
function pageTitle(title: string): Record<string, any> {
  return {
    type: 'text',
    text: title,
    size: 'xl',
    weight: 'bold',
    color: C.head,
    margin: 'xs',
    adjustMode: 'shrink-to-fit',
  }
}

/**
 * コマンド1件のカード。
 *   上段: 青・太字のコマンド名 / 下段: 小さい説明 / 右端: 控えめな矢印
 * 左に丸アイコンなどは置かない。名前と説明は同じ左端に揃える。
 */
function cmdRow(cmd: Cmd): Record<string, any> {
  const box: Record<string, any> = {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: C.itemBg,
    cornerRadius: '8px',
    borderColor: C.line,
    borderWidth: '1px',
    paddingAll: '9px',
    margin: 'sm',
    spacing: 'none',
    alignItems: 'center',
    contents: [
      {
        // 名前と説明。左端を揃えるため同じ縦積みに入れる。
        type: 'box',
        layout: 'vertical',
        flex: 1,
        spacing: 'none',
        contents: [
          {
            type: 'text',
            text: cmd.label,
            size: 'sm',
            weight: 'bold',
            color: C.accent,
            wrap: true,
          },
          {
            type: 'text',
            text: cmd.desc,
            size: 'xxs',
            color: C.desc,
            wrap: true,
            margin: 'xs',
          },
        ],
      },
      // 右端の控えめな矢印
      { type: 'text', text: '›', size: 'sm', color: C.arrow, flex: 0, align: 'end' },
    ],
  }
  // 押せるものは、カード全体をタップでコマンド送信にする
  if (!cmd.noAction) {
    box.action = { type: 'message', label: cmd.label, text: cmd.send ?? cmd.label }
  }
  return box
}

/** カードの共通部分(本体 + 下端の青帯) */
function bubble(title: string, body: Record<string, any>[]): Record<string, any> {
  return {
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.cardBg,
      paddingAll: '12px',
      spacing: 'none',
      contents: [brandRow(), pageTitle(title), ...body],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.accent,
      paddingTop: '7px',
      paddingBottom: '7px',
      paddingStart: '0px',
      paddingEnd: '0px',
      contents: [
        {
          type: 'text',
          text: FOOTER_TEXT,
          size: 'xxs',
          color: C.onAccent,
          align: 'center',
        },
      ],
    },
  }
}

/**
 * 1枚目: 表紙。
 * 上から ブランド行 → 見出し「ヘルプ」 → もち画像 → 「葉っぱもちへようこそ」
 *        → 紹介文3行 → 公式サイトボタン → 共通フッター。
 */
function welcomeCard(siteUrl: string): Record<string, any> {
  return bubble('ヘルプ', [
    {
      type: 'image',
      // ★正式素材★ public/static/<MASCOT_FILE>
      // キャラクター本体は一切加工していない(背景のみ透過処理し、
      // カード背景 #F1FAFE に合成)。描き直しや顔・葉・足の変更はしない。
      //
      // ファイル名にハッシュを入れているのは、LINEが画像をURL単位で
      // キャッシュするため。中身を変えたらURLも変わるようにして、
      // 古い画像が出続けるのを防ぐ。
      //
      // image に width は付けない(LINEに存在しないプロパティ。
      // 過去にチェスでこれを付けてHTTP 400になり実機が無反応になった)
      url: `${siteUrl}/static/${MASCOT_FILE}`,
      size: 'full',
      // 縦横比を保ったまま収める。1:1 + fit なので葉や足が切れない。
      // 高さは下の一覧ページに合わせて調整している。
      aspectRatio: '1:1',
      aspectMode: 'fit',
      margin: 'md',
    },
    {
      type: 'text',
      text: '葉っぱもちへようこそ',
      size: 'md',
      weight: 'bold',
      color: C.head,
      margin: 'md',
      wrap: true,
    },
    {
      type: 'text',
      text: 'グループでも、1対1でも。\nゲームやランキング、画像づくりを\nいつものトークで楽しもう。',
      size: 'xxs',
      color: C.desc,
      wrap: true,
      margin: 'sm',
    },
    // 余った高さはここが吸収する(ボタンを最下部に寄せる)
    { type: 'filler', flex: 1 },
    {
      type: 'button',
      style: 'primary',
      color: C.accent,
      height: 'sm',
      margin: 'md',
      action: { type: 'uri', label: '公式サイトを見る', uri: siteUrl },
    },
  ])
}

/** コマンド一覧カード(1ページ5件) */
function commandCard(page: { title: string; items: Cmd[] }): Record<string, any> {
  return bubble(page.title, [
    ...page.items.map(cmdRow),
    // 最後の項目とフッターの間に、接触しない程度の小さな余白。
    // 5件未満のページでは、ここが余りを受け取って高さが揃う
    // (項目そのものは引き伸ばさない)。
    { type: 'filler', flex: 1 },
  ])
}

// Flexの上限は30,000バイト。1枚あたり約4.8KBなので、
// カードを増やすと上限に当たる。超えたままLINEに送ると400が返り、
// 「ヘルプが一切表示されない」状態になるため、必ず収まるまで削る。
const FLEX_LIMIT = 30000
const FLEX_SAFE = 28500 // 余裕を持たせた実質上限
const CAROUSEL_MAX = 12 // LINEのカルーセルの上限枚数

const bytesOf = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

/**
 * 「ヘルプ」の返信。
 * ようこそカード + コマンド一覧のカルーセル。
 *
 * 枚数を増やしても壊れないよう、上限を超える場合は
 * 後ろのカードから落とす(ようこそカードと先頭のコマンド一覧は必ず残る)。
 */
export function buildHelpCarousel(siteUrl: string): LineMessage {
  const all = [welcomeCard(siteUrl), ...PAGES.map(commandCard)].slice(0, CAROUSEL_MAX)

  // 収まる枚数まで後ろから削る。最低2枚(ようこそ + コマンド一覧1枚)は残す。
  let bubbles = all
  while (bubbles.length > 2 && bytesOf({ type: 'carousel', contents: bubbles }) > FLEX_SAFE) {
    bubbles = bubbles.slice(0, -1)
  }

  return {
    type: 'flex',
    altText: 'ヘルプ（横にスワイプできます）',
    contents: { type: 'carousel', contents: bubbles },
  }
}

/** テストから参照する: 上限の値 */
export const HELP_FLEX_LIMIT = FLEX_LIMIT

/** テストから参照する: ボタンが送るコマンド文字列の一覧 */
export function helpCommandTexts(): string[] {
  return PAGES.flatMap((p) => p.items.filter((c) => !c.noAction).map((c) => c.send ?? c.label))
}
