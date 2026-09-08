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
  blue: '#039BE5',
  onBlue: '#FFFFFF',
  bodyBg: '#E1F5FE',
  cardBg: '#FFFFFF',
  border: '#BFE3EF',
  name: '#333333',
  sub: '#6F858B',
  divider: '#E8F4FA',
}

const FOOTER_TEXT = '© 2026 HappaMochi Bot'

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
  { label: '共通称号一覧', desc: '手に入る称号を見る' },
  { label: '共通称号確認', desc: '今つけている称号を確認' },
  { label: '称号一覧', desc: 'グループの称号（旧方式）' },
  { label: '称号確認', desc: 'グループの称号を確認' },
  { label: '称号検索 文字', desc: '称号を名前で探す', noAction: true },
  { label: 'オセロ', desc: '対局を募集する', send: 'オセロ開始' },
  { label: 'オセロ参加', desc: '募集中の対局に入る' },
  { label: 'オセロ戦績', desc: '自分の勝敗数を見る' },
  { label: 'チェス', desc: '対局を募集する' },
  { label: '盤面', desc: 'チェスの盤面を出す' },
  { label: 'めいく装飾', desc: '使える装飾の一覧' },
  { label: 'めいく:本文', desc: '文字を入れて画像を作る', noAction: true },
  { label: '返信して めいく', desc: 'その発言の画像を作る', noAction: true },
  { label: 'めいくbold虹7:文', desc: '装飾つきの書き方', noAction: true },
  { label: 'タグ一覧', desc: 'グループのタグを見る' },
  { label: 'タグ追加 タグ名', desc: 'タグを足す', noAction: true },
  { label: 'ウェルカムオン', desc: '参加時のあいさつを出す' },
  { label: 'ウェルカムオフ', desc: 'あいさつを止める' },
  { label: '取り消し通知オン', desc: '送信取消を知らせる' },
  { label: '取り消し通知オフ', desc: '知らせない' },
  { label: '誕生日登録 9/7', desc: '誕生日を登録', noAction: true },
  { label: '誕生日登録解除', desc: '登録した誕生日を消す' },
  { label: 'テスト', desc: '生存確認（ok を返す）' },
]

/** 1枚のカードに入れる件数 */
const PER_CARD = 7

/** カテゴリで分けず、上から順に詰めたページ */
const PAGES: { title: string; items: Cmd[] }[] = (() => {
  const out: { title: string; items: Cmd[] }[] = []
  for (let i = 0; i < COMMANDS.length; i += PER_CARD) {
    out.push({ title: 'コマンド一覧', items: COMMANDS.slice(i, i + PER_CARD) })
  }
  return out
})()

/** 上下の青帯にはさまれた白いカード領域 */
function panel(contents: Record<string, any>[]): Record<string, any> {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: C.cardBg,
    cornerRadius: '5px',
    borderColor: C.border,
    borderWidth: '1px',
    paddingAll: '10px',
    spacing: 'none',
    contents,
  }
}

/** コマンド1行。青いボタン + 説明文。 */
function cmdRow(cmd: Cmd, isFirst: boolean): Record<string, any>[] {
  const out: Record<string, any>[] = []

  // 2行目以降は上に細い区切り線を入れる(見本と同じ)
  if (!isFirst) {
    out.push({ type: 'separator', color: C.divider, margin: 'sm' })
  }

  // 押せるものは message アクションを付ける。
  // 引数が必要なコマンドは押しても動かないので、
  // ボタンではなく色だけ同じの「見出し」として出す。
  const chip: Record<string, any> = {
    type: 'box',
    layout: 'vertical',
    width: '92px',
    flex: 0,
    backgroundColor: C.blue,
    cornerRadius: '5px',
    paddingTop: '7px',
    paddingBottom: '7px',
    paddingStart: '4px',
    paddingEnd: '4px',
    justifyContent: 'center',
    contents: [
      {
        type: 'text',
        text: cmd.label,
        size: 'xs',
        weight: 'bold',
        color: C.onBlue,
        align: 'center',
        // 長いコマンド名でも枠から出ないよう縮小して収める
        adjustMode: 'shrink-to-fit',
      },
    ],
  }
  if (!cmd.noAction) {
    chip.action = { type: 'message', label: cmd.label, text: cmd.send ?? cmd.label }
  }

  out.push({
    type: 'box',
    layout: 'horizontal',
    spacing: 'md',
    alignItems: 'center',
    paddingTop: isFirst ? '0px' : '7px',
    paddingBottom: '0px',
    contents: [
      chip,
      {
        type: 'text',
        text: cmd.desc,
        size: 'xs',
        color: C.sub,
        flex: 1,
        wrap: true,
        gravity: 'center',
      },
    ],
  })

  return out
}

/** カードの共通部分(上帯・下帯)を組む */
function bubble(title: string, body: Record<string, any>[]): Record<string, any> {
  return {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.blue,
      paddingAll: '0px',
      paddingTop: '10px',
      paddingBottom: '10px',
      paddingStart: '10px',
      paddingEnd: '10px',
      contents: [
        {
          type: 'text',
          text: title,
          color: C.onBlue,
          weight: 'bold',
          size: 'md',
          align: 'center',
          adjustMode: 'shrink-to-fit',
        },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.bodyBg,
      paddingAll: '8px',
      spacing: 'sm',
      contents: body,
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: C.blue,
      paddingAll: '0px',
      paddingTop: '6px',
      paddingBottom: '6px',
      contents: [
        {
          type: 'text',
          text: FOOTER_TEXT,
          size: 'xxs',
          weight: 'bold',
          color: C.onBlue,
          align: 'center',
        },
      ],
    },
    // styles は backgroundColor を各ブロックに直接指定しているので不要。
    // 1枚あたりのバイト数を減らすため付けない
    // (カード7枚だと上限30,000バイトに近づくため、無駄を削る)。
  }
}

/** 1枚目: ようこそカード */
function welcomeCard(siteUrl: string): Record<string, any> {
  return bubble('葉っぱもちのヘルプ', [
    panel([
      {
        type: 'image',
        // イラストは public/static/happamochi.png。
        // image に width は付けない(LINEに存在しないプロパティ。
        // 過去にチェスでこれを付けてHTTP 400になり実機が無反応になった)
        url: `${siteUrl}/static/happamochi.png`,
        size: 'full',
        aspectRatio: '1:1',
        aspectMode: 'fit',
        margin: 'none',
      },
      {
        type: 'text',
        text: '葉っぱもちへようこそ',
        size: 'md',
        weight: 'bold',
        color: C.name,
        align: 'center',
        margin: 'md',
        wrap: true,
      },
      { type: 'separator', color: C.divider, margin: 'md' },
      {
        type: 'text',
        text:
          'グループにも1対1にも入れる LINE Bot。レベルアップ、ゲーム、ランキング、名言カードまで、ぜんぶ入りだよ！',
        size: 'xs',
        color: C.sub,
        wrap: true,
        margin: 'md',
      },
    ]),
    {
      type: 'button',
      style: 'primary',
      color: C.blue,
      height: 'sm',
      margin: 'sm',
      action: { type: 'uri', label: '公式サイトを見る', uri: siteUrl },
    },
  ])
}

/** コマンド一覧カード */
function commandCard(page: { title: string; items: Cmd[] }): Record<string, any> {
  const rows: Record<string, any>[] = []
  page.items.forEach((cmd, i) => rows.push(...cmdRow(cmd, i === 0)))
  return bubble(page.title, [panel(rows)])
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
