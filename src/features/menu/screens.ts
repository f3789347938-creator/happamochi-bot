// ヘルプメニュー(hmhelp)の画面定義。
//
// 出典: flex-carousel-kit-v4 の flow-catalog.json (41画面)。
//   ・新規に作るのは32画面。
//   ・残り9つ(S01/S02/S07/S09/S12/G02/G03/G10/H02)は既存出力への接続点なので
//     ここでは作らず、既存のハンドラーへそのまま渡す(index.ts 側で処理)。
//
// 設計上の判断(仕様の禁止事項に従ったもの):
//   1. ボタンで状態を変えない。
//      「オセロ」「チェス」はコマンドを実行すると対局が始まってしまうので
//      (オセロ開始/チェスは実際にDBへ書き込む)、ボタンからは実行せず
//      「グループに◯◯と送ってね」という案内を出す。
//      仕様: navigation_must_not_trigger_mutation / LINK-04
//   2. 表示だけの既存コマンド(ステータス/着せ替え/共通称号一覧/称号一覧/
//      称号検索/チェス ヘルプ/お知らせ/ランキング/タグ一覧/めいく装飾)は
//      副作用が無いので、ボタンから既存ハンドラーへ渡して既存カードを出す。
//   3. 設定変更(取り消し通知/ウェルカム/誕生日解除)は確認をはさむ。
//      確認意図はサーバー(menu_confirmations)に保存し、押した本人・
//      グループ・期限を照合してから既存の処理を呼ぶ。
import type { Btn, Row } from './flex'
import { gameOpenUrl } from './gameLink'

/** 画面ID。既存接続点(S/G/H の一部)も遷移先として登場する。 */
export type ScreenId = string

export interface ScreenDef {
  id: ScreenId
  category: string
  title: string
  body: string
  rows?: Row[]
  /** ボタン定義。data は index.ts の postback トークン。 */
  buttons: Btn[]
  altText?: string
}

// === postbackトークン =====================================================
// 名前空間は仕様の hmhelp:v1 に合わせるが、LINEのpostbackは300文字までなので
// 短く保つ。既存の 'pf|' や チェス/オセロ のトークンとは衝突しない。
//   hm|n|<画面ID>            画面を開く(状態変更なし)
//   hm|x|<既存コマンド名>     副作用の無い既存コマンドを実行して既存カードを出す
//   hm|q|<装飾トークン>       名言の装飾を選んだ状態で Q01 を出し直す
//   hm|c|<操作>              設定変更の確認カードを出す(まだ変更しない)
//   hm|k|<確認ID>            確認を確定して既存処理を実行する
export const nav = (id: ScreenId) => `hm|n|${id}`
export const runExisting = (cmd: string) => `hm|x|${cmd}`
export const confirmOp = (op: string) => `hm|c|${op}`

// === 名言の装飾トークン ===================================================
export const STYLE_TOKENS = ['bold', 'rev', 'mono', 'whi', 'new'] as const
export const COLOR_TOKENS = [
  '虹', '赤', '橙', '黄', '緑', '青', '藍', '紫',
  '桃', '水', '白', '黒', '金', '銀', '春', '夏', '秋', '冬',
] as const
export const FONT_TOKENS = Array.from({ length: 12 }, (_, i) => String(i + 1))

const BACK = (id: ScreenId): Btn => ({ label: '戻る', data: nav(id), kind: 'sub' })

// === メインカルーセル M01〜M06 ===========================================
// 6枚を横スワイプ。`ヘルプ` でこれを出す。
export const MAIN_IDS = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06'] as const

export function mainScreens(personalRankingUrl: string, siteUrl: string): ScreenDef[] {
  return [
    {
      id: 'M01',
      category: '名言',
      title: '名言カード',
      body: 'ひとことを、残したくなる一枚に。',
      rows: [{ label: 'できること', value: 'テキスト・返信・装飾' }],
      buttons: [
        { label: '文字を入れて作る', data: nav('Q01'), kind: 'primary' },
        { label: '装飾を選ぶ', data: nav('Q02'), kind: 'sub' },
        { label: '返信で作る', data: nav('Q06'), kind: 'sub' },
      ],
    },
    {
      id: 'M02',
      category: '個人',
      title: 'ステータス',
      body: '自分らしさを、少しずつ。',
      rows: [
        { label: 'ステータス', value: 'レベル・EXP・ポイント' },
        { label: 'カスタマイズ', value: '衣装・背景・テーマ・共通称号' },
      ],
      buttons: [
        // 表示のみ。既存のステータスカードをそのまま出す。
        { label: 'ステータスを見る', data: runExisting('ステータス'), kind: 'primary' },
        { label: '着せ替え', data: runExisting('着せ替え'), kind: 'sub' },
        { label: '称号を選ぶ', data: runExisting('共通称号一覧'), kind: 'sub' },
        { label: '設定', data: nav('P01'), kind: 'sub' },
      ],
    },
    {
      id: 'M03',
      category: 'ゲーム',
      title: 'ゲーム',
      body: 'グループのみんなと、ひと勝負。',
      rows: [
        { label: 'ひとりで', value: 'もち合体パズル（LINEの中で遊べる）' },
        { label: 'オセロ', value: '開始・参加・盤面・戦績' },
        { label: 'チェス', value: '2人募集・盤面・ヘルプ' },
      ],
      buttons: [
        // LINEの中でそのまま開くWebゲーム。ひとりで遊べる。
        { label: 'もち合体パズル', data: '', uri: gameOpenUrl(siteUrl), kind: 'primary' },
        // 押した人が対局したいと明示したボタンなので、既存コマンドをそのまま実行する。
        { label: 'オセロ', data: runExisting('オセロ開始'), kind: 'sub' },
        { label: 'チェス', data: runExisting('チェス'), kind: 'sub' },
        { label: '遊び方', data: nav('G01'), kind: 'sub' },
      ],
    },
    {
      id: 'M04',
      category: 'ランキング',
      title: 'ランキング',
      body: '今週の会話を、ランキングで。',
      rows: [
        { label: 'グループ', value: '今いるグループの今週の順位・発言数' },
        { label: '個人', value: '累計EXP順の個人ランキング' },
      ],
      buttons: [
        { label: '今週のグループ', data: runExisting('ランキング'), kind: 'primary' },
        { label: '個人ランキング', data: '', uri: personalRankingUrl, kind: 'sub' },
        { label: 'ランキングについて', data: nav('R01'), kind: 'sub' },
      ],
    },
    {
      id: 'M05',
      category: 'グループ',
      title: 'グループ設定',
      body: 'このグループに合った使い方へ。',
      rows: [
        { label: '設定', value: '取り消し通知・ウェルカム' },
        { label: '管理', value: 'ウェルカム本文・タグ' },
      ],
      buttons: [
        { label: '通知・ウェルカム', data: nav('C01'), kind: 'primary' },
        { label: 'タグを管理', data: nav('Q07'), kind: 'sub' },
        // 旧グループ称号は既存の「称号一覧」をそのまま出す(表示のみ)
        { label: 'グループ称号', data: runExisting('称号一覧'), kind: 'sub' },
      ],
    },
    {
      id: 'M06',
      category: 'ガイド',
      title: 'ガイド',
      body: '迷ったときは、ここから。',
      rows: [{ label: '案内', value: '使い方・コマンド・お知らせ' }],
      buttons: [
        { label: 'お知らせ', data: runExisting('お知らせ'), kind: 'primary' },
        { label: '全コマンド', data: nav('H03'), kind: 'sub' },
        { label: '使い方', data: nav('H01'), kind: 'sub' },
      ],
    },
  ]
}

// === 名言 Q01〜Q09 ========================================================
/** 選択中の装飾から、実際に送るコマンド例を組み立てる。 */
export function decorExample(tokens: string[]): string {
  return tokens.length > 0 ? `めいく${tokens.join('')}:こんにちは` : 'めいく:こんにちは'
}

export function screenQ01(tokens: string[]): ScreenDef {
  const selected = tokens.length > 0 ? tokens.join(' / ') : '標準（装飾なし）'
  return {
    id: 'Q01',
    category: '名言',
    title: '名言をつくる',
    body: '下の例の「こんにちは」を、好きな文章に置き換えて送ってね。カードの中に入力欄はありません。',
    rows: [
      { label: '送る文', value: decorExample(tokens) },
      { label: '選択中', value: selected },
      { label: '装飾の例', value: 'めいくnewbold虹7:こんにちは' },
    ],
    buttons: [
      { label: '装飾を選ぶ', data: nav('Q02'), kind: 'primary' },
      { label: '返信からつくる', data: nav('Q06'), kind: 'sub' },
      ...(tokens.length > 0
        ? [{ label: '装飾をリセット', data: 'hm|q|-', kind: 'sub' as const }]
        : []),
      BACK('M01'),
    ],
  }
}

export function screenQ02(tokens: string[]): ScreenDef {
  return {
    id: 'Q02',
    category: '名言',
    title: '装飾を選ぶ',
    body: '選んだ組み合わせで、送信例をつくります。',
    rows: [
      { label: '選択中', value: tokens.length > 0 ? tokens.join('') : '標準' },
      { label: 'スタイル', value: 'bold / rev / mono / whi / new' },
      { label: 'カラー', value: '虹・単色・季節・#HEX' },
      { label: 'フォント', value: '1〜12' },
    ],
    buttons: [
      { label: 'スタイル', data: nav('Q03'), kind: 'primary' },
      { label: 'カラー', data: nav('Q04'), kind: 'sub' },
      { label: 'フォント', data: nav('Q05'), kind: 'sub' },
      // 既存の装飾ヘルプ(表示のみ)をそのまま出す
      { label: '既存の装飾ヘルプ', data: runExisting('めいく装飾'), kind: 'sub' },
      BACK('Q01'),
    ],
  }
}

/** 選択肢を1ページ分ずつ出す。tokens は現在の選択、page は1始まり。 */
export function screenSelection(
  id: 'Q03' | 'Q04' | 'Q05',
  page: number,
  perPage: number
): ScreenDef {
  const conf = {
    Q03: {
      title: 'スタイル',
      body: 'スタイルを選ぶと、名言づくりの案内に戻ります。',
      items: [...STYLE_TOKENS] as string[],
      rows: [
        { label: '選択肢', value: 'bold / rev / mono / whi / new' },
        { label: '組み合わせ', value: '既存の装飾の対応範囲に従います' },
      ],
    },
    Q04: {
      title: 'カラー',
      body: '色を選んで、名言カードの雰囲気を変えてみよう。',
      items: [...COLOR_TOKENS] as string[],
      rows: [
        { label: '自由指定', value: '#FF00AA のように色を直接指定できます' },
        { label: '例', value: 'めいく赤:こんにちは' },
      ],
    },
    Q05: {
      title: 'フォント',
      body: '数字でフォントを指定できます。',
      items: FONT_TOKENS,
      rows: [
        { label: '指定', value: '1〜12' },
        { label: '例', value: 'めいく7:こんにちは' },
      ],
    },
  }[id]

  const pageCount = Math.max(1, Math.ceil(conf.items.length / perPage))
  const p = Math.min(Math.max(1, page), pageCount)
  const slice = conf.items.slice((p - 1) * perPage, p * perPage)

  const buttons: Btn[] = slice.map((t, i) => ({
    label: id === 'Q05' ? `フォント ${t}` : t,
    data: `hm|q|${t}`,
    kind: i === 0 ? 'primary' : 'sub',
  }))

  if (pageCount > 1) {
    buttons.push({
      label: '前のページ',
      data: p > 1 ? `hm|n|${id}:${p - 1}` : '',
      kind: 'sub',
      disabled: p <= 1,
    })
    buttons.push({
      label: '次のページ',
      data: p < pageCount ? `hm|n|${id}:${p + 1}` : '',
      kind: 'sub',
      disabled: p >= pageCount,
    })
  }
  buttons.push(BACK('Q02'))

  return {
    id,
    category: '名言',
    title: conf.title,
    body: conf.body,
    rows: [...conf.rows, ...(pageCount > 1 ? [{ label: 'ページ', value: `${p} / ${pageCount}` }] : [])],
    buttons,
  }
}

export function screenQ06(tokens: string[]): ScreenDef {
  const decor = tokens.length > 0 ? `めいく${tokens.join('')}` : 'めいく'
  return {
    id: 'Q06',
    category: '名言',
    title: '返信からつくる',
    body: '名言にしたいメッセージに返信して、「めいく」と送ってね。',
    rows: [
      { label: '標準', value: '対象へ返信 → めいく' },
      { label: '装飾あり', value: `対象へ返信 → ${decor}` },
      { label: '対象が取れないとき', value: 'もう一度、対象に返信して送ってね' },
    ],
    buttons: [
      { label: '装飾を選ぶ', data: nav('Q02'), kind: 'primary' },
      { label: '文字を入れて作る', data: nav('Q01'), kind: 'sub' },
      BACK('M01'),
    ],
  }
}

export const screenQ07: ScreenDef = {
  id: 'Q07',
  category: 'グループ',
  title: 'タグ管理',
  body: 'タグの追加・削除・一覧をまとめて操作。',
  rows: [
    { label: '対象', value: '現在のグループ' },
    { label: '権限', value: '既存のタグ機能に従います' },
  ],
  buttons: [
    { label: 'タグ一覧', data: runExisting('タグ一覧'), kind: 'primary' },
    { label: '追加・削除の送り方', data: nav('Q08'), kind: 'sub' },
    BACK('C01'),
  ],
}

export const screenQ08: ScreenDef = {
  id: 'Q08',
  category: 'グループ',
  title: 'タグ名を送る',
  body: '操作に対応するコマンドとタグ名を、グループに送ってね。',
  rows: [
    { label: '追加', value: 'タグ追加 お知らせ' },
    { label: '削除', value: 'タグ削除 お知らせ' },
    { label: 'ふつうの会話', value: '入力待ちにはしないので、いつでも送れます' },
  ],
  buttons: [
    { label: 'タグ一覧を見る', data: runExisting('タグ一覧'), kind: 'primary' },
    BACK('Q07'),
  ],
}

// === ゲーム G01 / G20 / G21 ==============================================
// G20・G21 はカタログには無い追加画面。カタログの G02・G03 は「既存出力への
// 接続点」だが、オセロ・チェスの既存コマンドは実行すると対局を作ってしまう。
// ボタンから状態を変えるのは禁止(LINK-04)なので、代わりに送り方を案内する。
export function screenG01(siteUrl: string): ScreenDef {
  return {
    id: 'G01',
    category: 'ゲーム',
    title: 'ゲームの遊び方',
    body: '遊び方を確認したら、いつものゲーム画面へ。',
    rows: [
      { label: 'もち合体パズル', value: 'ひとり用。LINEの中でそのまま遊べる' },
      { label: 'オセロ', value: '2人用。石は盤面のマスをタップ' },
      { label: 'チェス', value: '2人用。募集カードから参加' },
    ],
    buttons: [
      { label: 'もち合体パズルで遊ぶ', data: '', uri: gameOpenUrl(siteUrl), kind: 'primary' },
      { label: 'オセロを始める', data: runExisting('オセロ開始'), kind: 'sub' },
      { label: 'チェスを募集する', data: runExisting('チェス'), kind: 'sub' },
      // チェス ヘルプは表示のみなので既存カードをそのまま出せる
      { label: 'チェスの操作方法', data: runExisting('チェス ヘルプ'), kind: 'sub' },
      { label: 'もち合体パズルの遊び方', data: nav('G22'), kind: 'sub' },
      BACK('M03'),
    ],
  }
}

// もち合体パズルの遊び方。ゲーム本体はLINEの中で開くWebページなので、
// ここでは操作とルールの説明だけを出す。
export function screenG22(siteUrl: string): ScreenDef {
  return {
    id: 'G22',
    category: 'ゲーム',
    title: 'もち合体パズル',
    body: '同じもちをくっつけて、大きくしていくひとり用のパズルです。',
    rows: [
      { label: '動かす', value: '指で左右にドラッグして、離すと落ちる' },
      { label: '合体', value: '同じもち2個がくっつくと次のもちになる' },
      { label: '進化', value: '白 → さくら → 葉っぱ → きなこ → こんがり' },
      { label: '点数', value: '10 / 30 / 70 / 150 / 500点' },
      { label: '連鎖', value: '続けて合体すると追加点（最大20点）' },
      { label: 'おわり', value: '点線を超えたままにすると終了' },
      { label: '記録', value: 'ベストスコアは自分の端末に保存されます' },
    ],
    buttons: [
      { label: 'あそぶ', data: '', uri: gameOpenUrl(siteUrl), kind: 'primary' },
      { label: 'ゲームの遊び方に戻る', data: nav('G01'), kind: 'sub' },
      BACK('M03'),
    ],
  }
}

export const screenG20: ScreenDef = {
  id: 'G20',
  category: 'ゲーム',
  title: 'オセロ',
  body: '2人で交互に石を置いて、多く取ったほうが勝ちです。',
  rows: [
    { label: 'はじめる', value: 'オセロ開始（送った人が黒番）' },
    { label: '参加する', value: 'オセロ参加（白番）' },
    { label: 'やめる', value: 'オセロ終了' },
    { label: '成績', value: 'オセロ戦績' },
    { label: '打ち方', value: '盤面のマスをタップ' },
  ],
  buttons: [
    { label: 'オセロを始める', data: runExisting('オセロ開始'), kind: 'primary' },
    { label: '白番で参加する', data: runExisting('オセロ参加'), kind: 'sub' },
    { label: '自分の戦績を見る', data: runExisting('オセロ戦績'), kind: 'sub' },
    { label: '遊び方に戻る', data: nav('G01'), kind: 'sub' },
    BACK('M03'),
  ],
}

export const screenG21: ScreenDef = {
  id: 'G21',
  category: 'ゲーム',
  title: 'チェス',
  body: 'グループ内の2人で対局します。募集すると、別の人が参加ボタンを押して始まります。',
  rows: [
    { label: '募集する', value: 'チェス（グループ内の2人で対局）' },
    { label: '盤面を出す', value: '盤面' },
    { label: '操作を見る', value: 'チェス ヘルプ' },
  ],
  buttons: [
    { label: 'チェスを募集する', data: runExisting('チェス'), kind: 'primary' },
    { label: '今の盤面を見る', data: runExisting('盤面'), kind: 'sub' },
    { label: 'チェスの操作方法', data: runExisting('チェス ヘルプ'), kind: 'sub' },
    { label: '遊び方に戻る', data: nav('G01'), kind: 'sub' },
    BACK('M03'),
  ],
}

// === ランキング R01 ======================================================
export function screenR01(personalRankingUrl: string): ScreenDef {
  return {
    id: 'R01',
    category: 'ランキング',
    title: 'ランキング',
    body: '見たいランキングを選んでね。',
    rows: [
      { label: 'このグループ', value: '今週の順位と発言数' },
      { label: '個人ランキング', value: '累計EXP順。Webページで表示' },
      { label: '同じEXP', value: '同じ順位になります（1位・2位・2位・4位…）' },
    ],
    buttons: [
      { label: 'グループの今週', data: runExisting('ランキング'), kind: 'primary' },
      { label: '個人ランキングを開く', data: '', uri: personalRankingUrl, kind: 'sub' },
      BACK('M04'),
    ],
  }
}

export const screenP01: ScreenDef = {
  id: 'P01',
  category: '個人',
  title: '設定',
  body: 'ランキングのアイコンや、もちの見た目を変更できます。',
  rows: [{ label: 'ランキングアイコン', value: '初期設定はLINEプロフィール画像。ガチャで獲得した衣装にも変更できます。' }],
  buttons: [
    { label: 'ランキングアイコン', data: runExisting('ランキングアイコン'), kind: 'primary' },
    { label: '着せ替え・ガチャ', data: runExisting('着せ替え'), kind: 'sub' },
    { label: '称号を選ぶ', data: runExisting('共通称号一覧'), kind: 'sub' },
    { label: 'グループ設定', data: nav('C01'), kind: 'sub' },
    BACK('M02'),
  ],
}

// === グループ設定 C01〜C05 ===============================================
export function screenC01(unsend: string, welcome: string): ScreenDef {
  return {
    id: 'C01',
    category: 'グループ',
    title: 'グループ設定',
    body: 'このグループの設定を確認・変更できます。',
    rows: [
      { label: '取り消し通知', value: unsend },
      { label: 'ウェルカム', value: welcome },
      { label: '変更できる人', value: '今のBotの決まりのまま（グループの参加者）' },
    ],
    buttons: [
      { label: 'ランキングアイコン', data: runExisting('ランキングアイコン'), kind: 'sub' },
      { label: '取り消し通知', data: nav('C03'), kind: 'primary' },
      { label: 'ウェルカム', data: nav('C04'), kind: 'sub' },
      { label: 'タグ管理', data: nav('Q07'), kind: 'sub' },
      { label: '旧グループ称号', data: runExisting('称号一覧'), kind: 'sub' },
      { label: '誕生日', data: nav('C02'), kind: 'sub' },
      BACK('M05'),
    ],
  }
}

export const screenC02: ScreenDef = {
  id: 'C02',
  category: '個人',
  title: '誕生日',
  body: '誕生日を登録するときは、月/日を入れて送ってね。',
  rows: [
    { label: '登録', value: '誕生日登録 9/7' },
    { label: '解除', value: '誕生日登録解除' },
    { label: '公開', value: '日付はWebには出しません' },
  ],
  buttons: [
    { label: '登録を解除する', data: confirmOp('birthday_off'), kind: 'sub' },
    BACK('C01'),
  ],
}

export function screenC03(current: string): ScreenDef {
  return {
    id: 'C03',
    category: 'グループ',
    title: '取り消し通知',
    body: 'メッセージが取り消されたときの通知を切り替えます。初期はオフです。',
    rows: [{ label: '現在', value: current }],
    buttons: [
      { label: '通知をオンにする', data: confirmOp('unsend_on'), kind: 'primary' },
      { label: '通知をオフにする', data: confirmOp('unsend_off'), kind: 'sub' },
      BACK('C01'),
    ],
  }
}

export function screenC04(current: string, message: string): ScreenDef {
  return {
    id: 'C04',
    category: 'グループ',
    title: 'ウェルカム',
    body: '新しく入った人への歓迎メッセージの設定です。',
    rows: [
      { label: '現在', value: current },
      { label: '本文', value: message },
    ],
    buttons: [
      { label: 'ウェルカムをオン', data: confirmOp('welcome_on'), kind: 'primary' },
      { label: 'ウェルカムをオフ', data: confirmOp('welcome_off'), kind: 'sub' },
      { label: 'メッセージを設定', data: nav('C05'), kind: 'sub' },
      { label: '設定した本文を解除', data: confirmOp('welcome_msg_clear'), kind: 'sub' },
      BACK('C01'),
    ],
  }
}

export const screenC05: ScreenDef = {
  id: 'C05',
  category: 'グループ',
  title: 'ウェルカム本文の入力',
  body: 'コマンドの後ろに本文を入れて、グループに送ってね。',
  rows: [
    { label: '入力例', value: 'ウェルカムメッセージ設定 ようこそ！よろしくね' },
    { label: '解除', value: 'ウェルカムメッセージ解除' },
    { label: 'ふつうの会話', value: '本文として勝手に取り込みません' },
  ],
  buttons: [
    { label: 'ウェルカム設定に戻る', data: nav('C04'), kind: 'primary' },
    BACK('C01'),
  ],
}

// === ガイド H01 / H03 ====================================================
export const screenH01: ScreenDef = {
  id: 'H01',
  category: 'ガイド',
  title: '使い方ガイド',
  body: 'ボタンから機能を選べます。コマンドを直接送る使い方も、これまでどおり使えます。',
  rows: [
    { label: '名言', value: 'めいく・装飾・返信' },
    { label: '個人', value: 'ステータス・着せ替え・共通称号・誕生日' },
    { label: 'ゲーム', value: 'オセロ・チェス' },
    { label: 'グループ', value: 'ランキング・通知・ウェルカム・タグ・旧称号' },
    { label: 'EXP・ポイント', value: '1通ごとに 1EXP・1P。上限や参加登録はありません' },
  ],
  buttons: [
    { label: '全コマンド', data: nav('H03'), kind: 'primary' },
    { label: '名言の作り方', data: nav('Q01'), kind: 'sub' },
    { label: 'ステータスを見る', data: runExisting('ステータス'), kind: 'sub' },
    { label: 'ゲームの遊び方', data: nav('G01'), kind: 'sub' },
    { label: 'グループ設定', data: nav('C01'), kind: 'sub' },
    { label: 'ランキング', data: nav('R01'), kind: 'sub' },
    BACK('M06'),
  ],
}

// 全コマンド。ページ送りできるよう塊に分けている。
// 既存の別名(順位 / チェスヘルプ)も消さずに載せる。
const H03_PAGES: Row[][] = [
  [
    { label: '案内', value: 'ヘルプ / お知らせ' },
    { label: 'グループ順位', value: 'ランキング（別名: 順位）' },
    { label: '個人', value: 'ステータス / 着せ替え' },
    { label: '共通称号', value: '共通称号一覧 / 共通称号装備 称号名 / 共通称号確認' },
    { label: '称号検索', value: '称号検索 文字（共通称号のみ）' },
    { label: '旧グループ称号', value: '称号一覧 / 称号装備 称号名 / 称号確認' },
  ],
  [
    { label: '名言', value: 'めいく:本文 / 対象に返信して めいく' },
    { label: '装飾つき', value: 'めいく装飾:本文 / 返信して めいく装飾' },
    { label: '入力例', value: 'めいくnewbold虹7:こんにちは' },
    { label: 'スタイル', value: 'bold / rev / mono / whi / new' },
    { label: 'カラー', value: '虹 赤 橙 黄 緑 青 藍 紫 桃 水 白 黒 金 銀 春 夏 秋 冬 / #FF00AA' },
    { label: 'フォント', value: '1〜12' },
    { label: '装飾ヘルプ', value: 'めいく装飾' },
  ],
  [
    { label: 'オセロ', value: 'オセロ開始 / オセロ参加 / オセロ終了 / オセロ戦績' },
    { label: 'オセロの打ち方', value: '盤面のマスをタップ' },
    { label: 'チェス', value: 'チェス / 盤面 / チェス ヘルプ（別名: チェスヘルプ）' },
  ],
  [
    { label: '誕生日', value: '誕生日登録 9/7 / 誕生日登録解除' },
    { label: '取り消し通知', value: '取り消し通知オン / 取り消し通知オフ' },
    { label: 'ウェルカム', value: 'ウェルカムオン / ウェルカムオフ' },
    { label: 'ウェルカム本文', value: 'ウェルカムメッセージ設定 本文 / ウェルカムメッセージ解除' },
    { label: 'タグ', value: 'タグ追加 タグ名 / タグ削除 タグ名 / タグ一覧' },
    { label: '動作確認', value: 'テスト' },
    { label: 'EXP・ポイント', value: '1通ごとに 1EXP・1P。全グループ共通。上限なし' },
  ],
]

export const H03_PAGE_COUNT = H03_PAGES.length

export function screenH03(page: number): ScreenDef {
  const p = Math.min(Math.max(1, page), H03_PAGE_COUNT)
  const buttons: Btn[] = [
    {
      label: '前のページ',
      data: p > 1 ? `hm|n|H03:${p - 1}` : '',
      kind: 'sub',
      disabled: p <= 1,
    },
    {
      label: '次のページ',
      data: p < H03_PAGE_COUNT ? `hm|n|H03:${p + 1}` : '',
      kind: 'sub',
      disabled: p >= H03_PAGE_COUNT,
    },
    { label: '使い方へ', data: nav('H01'), kind: 'sub' },
    BACK('M06'),
  ]
  return {
    id: 'H03',
    category: 'ガイド',
    title: '全コマンド',
    body: 'コマンドは、このグループのメッセージとして送れます。太字部分は自分の言葉に置き換えてね。',
    rows: [{ label: 'ページ', value: `${p} / ${H03_PAGE_COUNT}` }, ...H03_PAGES[p - 1]],
    buttons,
  }
}

// === 案内・エラー X01〜X04 ===============================================
export function screenX(
  id: 'X01' | 'X02' | 'X03' | 'X04',
  reason: string
): ScreenDef {
  const conf = {
    X01: {
      category: '案内',
      title: 'まだデータがありません',
      rows: [{ label: 'できること', value: '下のボタンから登録・確認できます' }],
      buttons: [
        { label: 'ガイドへ', data: nav('H01'), kind: 'primary' as const },
        { label: 'グループ設定へ', data: nav('C01'), kind: 'sub' as const },
      ],
    },
    X02: {
      category: '案内',
      title: 'この操作は実行できません',
      rows: [
        { label: '本人の操作', value: '自分で開いた案内から操作してください' },
        { label: '変更', value: '何も変更していません' },
      ],
      buttons: [
        { label: '自分のメニューを開く', data: nav('M'), kind: 'primary' as const },
        { label: 'ガイドへ', data: nav('H01'), kind: 'sub' as const },
      ],
    },
    X03: {
      category: '案内',
      title: 'このボタンは古くなりました',
      rows: [
        { label: '確認', value: '古い確認では変更しません' },
        { label: 'やり直し', value: '最新の案内から選び直してください' },
      ],
      buttons: [
        { label: '最新のメニューを開く', data: nav('M'), kind: 'primary' as const },
        { label: '設定を開き直す', data: nav('C01'), kind: 'sub' as const },
      ],
    },
    X04: {
      category: '案内',
      title: 'もう一度確認してください',
      rows: [{ label: 'やり直し', value: '同じ操作を勝手にやり直すことはしません' }],
      buttons: [
        { label: 'ガイドへ', data: nav('H01'), kind: 'primary' as const },
        { label: 'メニューを開く', data: nav('M'), kind: 'sub' as const },
      ],
    },
  }[id]

  return {
    id,
    category: conf.category,
    title: conf.title,
    body: reason,
    rows: conf.rows,
    buttons: conf.buttons,
  }
}
