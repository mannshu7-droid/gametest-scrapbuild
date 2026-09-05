export const TILE = {
  FLOOR: 0,
  DIRT: 1,
  ROCK: 2,
  ORE_COPPER: 3,
  ORE_IRON: 4,
  ORE_GOLD: 5,
  ORE_PLATINUM: 6,
  GAS: 7,
  UNSTABLE: 8,
  /** 視界外（まだ発見していないタイル）。実際の種別はcore内部でのみ保持し、getState()ではこの値に差し替える */
  UNKNOWN: 9,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Dir = 'up' | 'down' | 'left' | 'right';

export type Phase = 'mine' | 'shop' | 'gameover';

export type UpgradeId = 'drill' | 'fuel' | 'hp' | 'capacity' | 'digspeed' | 'hazardresist' | 'scanner' | 'charge';

export type Action = { type: 'move'; dir: Dir } | { type: 'wait' } | { type: 'buy'; item: UpgradeId };

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

export type RiskLevel = 'safe' | 'caution' | 'danger';

export interface RiskEscalationBanner {
  level: RiskLevel;
  ticksLeft: number;
}

/** バンド×レーンごとの豊富さ・危険度ヒント。探査Lvが足りない項目はnull（未開示） */
export interface LaneHint {
  lane: number;
  hazardTier: number | null;
  richness: number | null;
}
export interface BandHint {
  band: number;
  lanes: LaneHint[];
}

export interface Metrics {
  oreMined: number;
  oreWasted: number;
  moneyEarned: number;
  maxDistance: number;
  upgradesBought: number;
  hazardHits: number;
  hazardDamage: number;
  fuelEmptyTicks: number;
  tripsToHome: number;
  riskEscalations: number;
  /** 詰みからの脱出手段で入った少額収入の累計 */
  stuckIncomeEarned: number;
  /** 共鳴掘削の発動回数 */
  resonanceTriggers: number;
  /** 共鳴掘削で巻き込み採掘できた鉱石数（本来の1手では採れなかった分） */
  resonanceBonusOre: number;
  /** フォークでのレーン切替回数（分岐の悩ましさが実際に使われたかの指標） */
  forkSwitches: number;
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
    fuel: number;
    maxFuel: number;
    money: number;
    drillPower: number;
    cargoUnits: number;
    maxCapacity: number;
    cargoValue: number;
    digging: Digging | null;
    estFuelToReturn: number | null;
    miningRiskLevel: RiskLevel;
    riskEscalationBanner: RiskEscalationBanner | null;
    /** 共鳴チャージ現在値（chargeLevel=0なら常に0） */
    charge: number;
    maxCharge: number;
    chargeReady: boolean;
    /** 現在地がフォーク（上下移動可能な分岐点）かどうか */
    atFork: boolean;
  };
  map: {
    lanes: number;
    length: number;
    bandSize: number;
    /** 列優先の平坦配列（index = x * lanes + y）。未発見マスはTILE.UNKNOWN */
    tiles: number[];
  };
  /** フォークで参照する、これから進む先のバンド×レーンヒント一覧（探査Lvにより一部null） */
  bandHints: BandHint[];
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
      'left/right=現在レーンを前進/後退（未採掘タイルなら採掘を開始/継続、複数tick要する場合あり）。' +
      'up/down=フォーク（x%40===0）に居るときのみレーンを切り替える。フォーク以外での上下移動は無効',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過（燃料は消費される）' },
  {
    type: 'buy',
    params: { item: 'drill|fuel|hp|capacity|digspeed|hazardresist|scanner|charge' },
    description: 'ショップフェーズ中（x=0のホーム滞在中）のみ有効。指定カテゴリを1レベル購入する',
  },
];
