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

export type EnemyType = 'skirmisher' | 'archer' | 'brute';

export type RiskLevel = 'safe' | 'caution' | 'danger';

export type Phase = 'day' | 'night';

export type ShopItemId =
  | 'offense'
  | 'mobility'
  | 'vitality'
  | 'drill'
  | 'fuel'
  | 'digspeed'
  | 'lantern'
  | 'hazardresist'
  | 'capacity'
  | 'teleport';

export type BuildTarget = 'barricade' | 'outpost';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'attack' }
  | { type: 'dash'; dir: Dir }
  | { type: 'buy'; item: ShopItemId }
  | { type: 'build'; target: 'barricade'; dir: Dir }
  | { type: 'build'; target: 'outpost' }
  | { type: 'teleport' }
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
  /** 遠距離型(archer)の射程。近接型は1 */
  range: number;
  /** 夜間レイダーか（true時のみ拠点圏内へ侵入し拠点HPを攻撃できる） */
  isRaider: boolean;
  /** isRaider時の目標拠点x座標（0=ホーム） */
  targetBaseX: number;
}

export interface Barricade {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface Base {
  /** 拠点のx座標（0=ホーム） */
  x: number;
  isHome: boolean;
  hp: number;
  maxHp: number;
}

export interface Digging {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

export interface RiskEscalationBanner {
  level: RiskLevel;
  ticksLeft: number;
}

export interface ShopItemState {
  id: ShopItemId;
  name: string;
  desc: string;
  level: number;
  maxLevel: number;
  nextCost: number | null;
}

export interface Metrics {
  distanceReached: number;
  kills: number;
  died: boolean;
  moneyEarned: number;
  oreMined: number;
  oreWasted: number;
  upgradesBought: number;
  dashUses: number;
  barricadesBuilt: number;
  barricadesLost: number;
  outpostsBuilt: number;
  tripsToHome: number;
  hazardHits: number;
  hazardDamage: number;
  fuelEmptyTicks: number;
  combatRiskEscalations: number;
  miningRiskEscalations: number;
  raidRiskEscalations: number;
  stuckIncomeEarned: number;
  nightsSurvived: number;
  outpostsLost: number;
  raidersKilled: number;
  baseDamageTaken: number;
  score: number;
}

export interface GameState {
  tick: number;
  over: boolean;
  won: boolean;
  loseReason: 'playerHp' | 'homeDestroyed' | null;
  phase: Phase;
  phaseTicksLeft: number;
  nightWarning: boolean;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    fuel: number;
    maxFuel: number;
    atk: number;
    atkCd: number;
    atkCdMax: number;
    atkRange: number;
    dashCd: number;
    dashCdMax: number;
    dashRange: number;
    money: number;
    drillPower: number;
    cargoUnits: number;
    maxCapacity: number;
    cargoValue: number;
    teleportUnlocked: boolean;
    digging: Digging | null;
    /** 現在地から既に掘った道(FLOOR)だけを通ってホーム(x=0)へ戻るのに必要な推定燃料 */
    estFuelToReturn: number | null;
    /** 現在地のbandに対するmaxHpの余裕度（009/010のcombatRiskLevel） */
    recommendedHp: number;
    combatRiskLevel: RiskLevel;
    combatRiskBanner: number;
    /** estFuelToReturnに対する現在燃料の余裕度（011のminingRiskLevel） */
    miningRiskLevel: RiskLevel;
    miningRiskBanner: RiskEscalationBanner | null;
    /** 夜フェーズかつどの拠点圏内にもいない時に発火する新規ヒント */
    raidRiskLevel: RiskLevel;
    raidRiskBanner: RiskEscalationBanner | null;
    shopPrices: Record<ShopItemId, number | null>;
    buildCosts: { barricade: number; outpost: number };
    canBuildOutpost: boolean;
    baseDistance: number;
  };
  map: {
    width: number;
    laneCount: number;
    goalDistance: number;
    homeRadius: number;
    outpostRadius: number;
    outpostMinGap: number;
    /** 列優先の平坦配列（index = x * laneCount + y）。値は TILE の数値 */
    tiles: number[];
  };
  enemies: Enemy[];
  barricades: Barricade[];
  /** プレイヤーが建てた前線拠点のx座標一覧（ホームのx=0は含まない、破壊された拠点は除去済み） */
  outposts: number[];
  /** ホーム+全前線拠点のHP状態（破壊された拠点は含まない） */
  bases: Base[];
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
      '1マス移動。既に掘った道(FLOOR)なら即移動、未採掘タイルなら掘削を開始/継続する（複数tick要する場合あり、ドリル威力不足なら不発）',
  },
  { type: 'attack', params: {}, description: '射程内で最も近い敵1体を攻撃（単体、方向指定不要）' },
  {
    type: 'dash',
    params: { dir: 'up|down|left|right' },
    description: '指定方向へ最大dashRangeマス移動し、発動中は無敵。購入不要・常時使用可・クールダウンあり',
  },
  {
    type: 'buy',
    params: { item: 'offense|mobility|vitality|drill|fuel|digspeed|lantern|hazardresist|capacity|teleport' },
    description: '拠点（ホームor前線拠点）保護半径内滞在中のみ有効。所持金が足りれば該当カテゴリを強化',
  },
  {
    type: 'build',
    params: { target: 'barricade', dir: 'up|down|left|right' },
    description:
      '隣接する既に掘った道(dir)にバリケードを設置。空きマスのみ・所持金消費。敵の移動を塞ぎ、射線上にあれば遠距離攻撃の身代わりにもなる',
  },
  {
    type: 'build',
    params: { target: 'outpost' },
    description: '現在地（既に掘った道）に前線拠点を建設。最寄り拠点からoutpostMinGap以上離れている必要あり',
  },
  { type: 'teleport', params: {}, description: '解禁済みなら燃料を消費して即座にホームへ帰還する' },
  { type: 'wait', params: {}, description: '何もせず1ティック経過（燃料は消費される）' },
];
