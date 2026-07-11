export const TILE = {
  FLOOR: 0,
  DIRT: 1,
  ROCK: 2,
  ORE_COPPER: 3,
  ORE_IRON: 4,
  ORE_GOLD: 5,
  GAS: 6,
  UNSTABLE: 7,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Dir = 'up' | 'down' | 'left' | 'right';

export type Phase = 'mine' | 'shop' | 'gameover';

export type UpgradeId =
  | 'drill'
  | 'fuel'
  | 'hp'
  | 'capacity'
  | 'digspeed'
  | 'lantern'
  | 'hazardresist'
  | 'teleport';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'wait' }
  | { type: 'buy'; item: UpgradeId }
  | { type: 'teleport' };

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

export interface Metrics {
  oreMined: number;
  oreWasted: number;
  moneyEarned: number;
  maxDepth: number;
  upgradesBought: number;
  hazardHits: number;
  hazardDamage: number;
  fuelEmptyTicks: number;
  tripsToSurface: number;
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
    teleportUnlocked: boolean;
    digging: Digging | null;
  };
  map: {
    w: number;
    h: number;
    /** 行優先の平坦配列。値は TILE の数値 */
    tiles: number[];
  };
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
      '指定方向へ1マス移動。既に掘った床(FLOOR)なら即移動、未採掘タイルなら採掘を開始/継続する（複数tick要する場合あり、要求ドリル威力不足なら不発）',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過（燃料は消費される）' },
  {
    type: 'buy',
    params: { item: 'drill|fuel|hp|capacity|digspeed|lantern|hazardresist|teleport' },
    description: 'ショップフェーズ中のみ有効。指定カテゴリを1レベル購入する',
  },
  {
    type: 'teleport',
    params: {},
    description: '採掘フェーズ中、テレポート解禁済みなら燃料25を消費して即座に地上へ帰還する',
  },
];
