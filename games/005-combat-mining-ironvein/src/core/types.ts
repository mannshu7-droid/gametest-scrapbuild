export const TILE = {
  FLOOR: 0,
  DIRT: 1,
  ROCK: 2,
  ORE_COPPER: 3,
  ORE_IRON: 4,
  ORE_GOLD: 5,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Dir = 'up' | 'down' | 'left' | 'right';

export type EnemyType = 'crawler' | 'brute';

export type Phase = 'mine' | 'shop' | 'gameover';

export type UpgradeId = 'drill' | 'capacity' | 'fuel' | 'atk' | 'hp' | 'atkspeed' | 'skill' | 'muffler';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'attack'; dir: Dir }
  | { type: 'skill' }
  | { type: 'dash' }
  | { type: 'buy'; item: UpgradeId }
  | { type: 'wait' };

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  atkCd: number;
  moveCd: number;
}

export interface Digging {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

export interface ShopItemState {
  id: UpgradeId;
  name: string;
  desc: string;
  level: number;
  maxLevel: number;
  nextCost: number | null;
}

export interface Metrics {
  oreMined: number;
  moneyEarned: number;
  maxDepth: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  upgradesBought: number;
  tripsToSurface: number;
  milestonesReached: number;
  skillUses: number;
  dashUses: number;
  fuelEmptyTicks: number;
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
    atk: number;
    attackCd: number;
    attackCdMax: number;
    hasSkill: boolean;
    skillCd: number;
    skillCdMax: number;
    skillDmg: number;
    /** 掘削音の蓄積値（0〜100）。高いほど周辺の敵湧き確率が上がる。移動すると減衰が速い */
    noise: number;
    /** 直近の移動直後、被ダメージ軽減が乗っている残りtick数（0なら未発動） */
    moveEvasion: number;
    /** 緊急離脱（dash）の残り無敵・すり抜けtick数。0なら未発動 */
    dashActive: number;
    /** dashの残りクールダウン。0なら発動可能 */
    dashCd: number;
    dashCdMax: number;
    digging: Digging | null;
    /** 現在地から既に掘った床だけを通って地上へ戻るのに必要な推定燃料（BFS距離×消費率） */
    estFuelToReturn: number | null;
  };
  map: {
    w: number;
    h: number;
    tiles: number[];
  };
  enemies: Enemy[];
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
      '指定方向へ1マス移動。既に掘った床(FLOOR)なら即移動、未採掘タイルなら採掘を開始/継続する（複数tick要する場合あり、要求採掘威力不足なら不発）。敵がいるマスへは移動できない',
  },
  {
    type: 'attack',
    params: { dir: 'up|down|left|right' },
    description: '指定方向に隣接する敵1体を攻撃（単体）。クールダウン中は不発',
  },
  { type: 'skill', params: {}, description: '範囲攻撃: 周囲8方向すべての隣接敵にダメージ。習得済み・クールダウン明けのみ発動' },
  {
    type: 'dash',
    params: {},
    description:
      '緊急離脱: 発動後は数tickの間、敵のいるマスへも無敵ですり抜け移動でき、被ダメージを受けない。固定HPコストを消費し、クールダウン中は不発。退路が敵に塞がれた詰みを構造的に回避する手段（購入不要・常時使用可）',
  },
  {
    type: 'buy',
    params: { item: 'drill|capacity|fuel|atk|hp|atkspeed|skill|muffler' },
    description: '地上フェーズ中のみ有効。指定カテゴリを1レベル購入する',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過（燃料は消費され、掘削音は減衰する）' },
];
