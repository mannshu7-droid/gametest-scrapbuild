export const TILE = {
  FLOOR: 0,
  DIRT: 1,
  ROCK: 2,
  ORE_COPPER: 3,
  ORE_IRON: 4,
  ORE_GOLD: 5,
  ORE_CRYSTAL: 6,
  /** 最深部の核石。持ち帰るとクリア */
  CORE: 7,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Dir = 'up' | 'down' | 'left' | 'right';

/** shop=地上（y=0）に居る。mine=地下。cleared=核石を持ち帰った */
export type Phase = 'shop' | 'mine' | 'cleared';

export type UpgradeId = 'drill' | 'hp' | 'brace' | 'capacity' | 'winch' | 'basket' | 'scaffold';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'wait' }
  | { type: 'buy'; item: UpgradeId }
  /** 送り籠: 今の積荷を8割の値で地上へ送る（籠を下ろす振動で揺れ+10） */
  | { type: 'send' }
  /** 足場を今いるマスに据える（地下のみ。買って持っている足場が要る） */
  | { type: 'place' }
  /** 巻き上げ: 真上へ続く掘った縦穴を1tickで(1+巻き上げ機Lv)マス上る */
  | { type: 'hoist' };

export interface ShopItemState {
  id: UpgradeId;
  name: string;
  desc: string;
  level: number;
  maxLevel: number;
  nextCost: number | null;
}

export interface Digging {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

export interface CargoItem {
  tile: TileId;
  /** 掘った瞬間の揺れボーナス込みの売値 */
  value: number;
}

/** 落盤が起きた直後の表示用 */
export interface CaveInEvent {
  tick: number;
  damage: number;
  spilledUnits: number;
  spilledValue: number;
  rescued: boolean;
}

export interface Metrics {
  oreMined: number;
  moneyEarned: number;
  /** 揺れボーナスで上乗せされた売値の合計（実際に換金・送り籠で現金化できた分のみ） */
  tremorBonusEarned: number;
  maxDepth: number;
  upgradesBought: number;
  trips: number;
  caveIns: number;
  caveInDamage: number;
  spilledValue: number;
  /** HP0で地上へ引き上げられた回数（積荷全損＋救助費） */
  rescues: number;
  rescueFeesPaid: number;
  rescueLostValue: number;
  basketsSent: number;
  basketValue: number;
  /** 送り籠の振動で上がった揺れの合計 */
  basketTremor: number;
  /** 据えた足場の数と、足場の上で揺れが収まっていったtick数 */
  scaffoldsPlaced: number;
  restTicks: number;
  /** 足場の上で収まった揺れの合計 */
  restRelief: number;
  /** 持ち帰った（または送った）揺れの最大値。どこまで粘ったかの指標 */
  peakTremorBanked: number;
  /** v0.3.0: 核石を抱えて過ごしたtick・その間の落盤・核石を落とした（救助で失った）回数 */
  coreCarryTicks: number;
  coreCaveIns: number;
  coreLost: number;
  clearedTick: number | null;
  score: number;
}

export interface GameState {
  tick: number;
  phase: Phase;
  over: boolean;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    money: number;
    drillPower: number;
    cargo: CargoItem[];
    cargoUnits: number;
    maxCapacity: number;
    cargoValue: number;
    hasCore: boolean;
    digging: Digging | null;
    /** 揺れ（0〜150）。地下にいる間たまり続け、地上で0に戻る。高いほど掘った鉱石の売値が上がり、落盤しやすい */
    tremor: number;
    /** 今の深さで1tickあたりにたまる揺れ（支保Lv・核石を抱えているときの×3込み） */
    tremorRate: number;
    /** 今の揺れで掘った鉱石に付く売値ボーナス（0.6=+60%） */
    tremorBonus: number;
    /** 今の揺れのまま100tick過ごしたときに1回以上落盤する確率（0〜1） */
    caveInChance100: number;
    /** 今この場で落盤したときのダメージ */
    caveInDamage: number;
    /** 掘った床を通って地上まで戻る間に追加でたまる揺れの見積もり（核石を抱えていれば×3込み。地上ならnull） */
    estReturnTremor: number | null;
    /** 帰り道の見積もりtick数 */
    estReturnTicks: number | null;
    basketsLeft: number;
    basketsMax: number;
    /** 買ってまだ据えていない足場の数 */
    scaffoldsHeld: number;
    /** 今いるマスが足場か（足場の上で掘っていなければ、揺れが毎tick下がる） */
    onScaffold: boolean;
    /** 掘った床を通って一番近い足場へ着くまでにたまる揺れの見積もり（足場が無い・届かないならnull、足場の上なら0） */
    estScaffoldTremor: number | null;
    /** 一番近い足場の深さ（無ければnull） */
    nearestScaffoldY: number | null;
  };
  map: {
    width: number;
    depth: number;
    /** 行優先の平坦配列（index = y * width + x）。y=0が地上 */
    tiles: number[];
    /** 据えた足場の位置（タイルは床のまま） */
    scaffolds: { x: number; y: number }[];
  };
  lastCaveIn: CaveInEvent | null;
  shop: ShopItemState[];
  metrics: Metrics;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  {
    type: 'move',
    params: { dir: 'up|down|left|right' },
    description:
      '隣のマスへ移動する。掘った床なら1tickで1マス移動、土・岩・鉱石なら採掘を開始/継続する（深いほど硬く複数tick）。' +
      '地上（y=0）に着くと積荷が自動で換金され、揺れが0に戻り、HPが全快する',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過（地下では揺れがたまる）' },
  {
    type: 'buy',
    params: { item: 'drill|hp|brace|capacity|winch|basket|scaffold' },
    description: '地上（y=0）でのみ有効。指定カテゴリを1レベル購入する（scaffoldは足場を1つ買って持つ）',
  },
  {
    type: 'send',
    params: {},
    description: '地下でのみ有効。送り籠を1つ使い、今の積荷を売値の8割で即換金する（籠を下ろす振動で揺れ+10）。籠は地上で補充',
  },
  {
    type: 'place',
    params: {},
    description:
      '地下（深さ10以上）でのみ有効。持っている足場を今いるマスに据える（据えたら動かせない）。' +
      '足場の上にいて掘っていない間は、揺れがたまらず毎tick 1.5ずつ下がる（その間は売値ボーナスも下がる）',
  },
  {
    type: 'hoist',
    params: {},
    description: '巻き上げ: 真上が掘った床なら1tickで最大(1+巻き上げ機Lv)マス上る。地上に着くか真上が床でなくなると止まる',
  },
];
