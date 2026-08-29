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

export type RiskLevel = 'safe' | 'caution' | 'danger';

export interface RiskEscalationBanner {
  level: RiskLevel;
  ticksLeft: number;
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
  /** 詰みからの脱出手段（v2追加）で入った少額収入の累計。恒久的に0のままなら経済が自走できている証拠 */
  stuckIncomeEarned: number;
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
    /** 現在地から既に掘った床だけを通ってホーム(x=0)へ戻るのに必要な推定燃料（BFS距離×消費率）。0=ホーム、null=経路不明（理論上発生しない） */
    estFuelToReturn: number | null;
    /** estFuelToReturnに対する現在燃料の余裕度を3段階で示すヒント（009/010のcombatRiskLevel相当、本ゲーム新規） */
    miningRiskLevel: RiskLevel;
    /** miningRiskLevelが一度改善した後に再び悪化するたびに90tick立つHUDハイライト（008パターン#11） */
    riskEscalationBanner: RiskEscalationBanner | null;
  };
  map: {
    /** レーン数（y方向、5） */
    lanes: number;
    /** 進行距離（x方向、0〜320） */
    length: number;
    /** 列優先の平坦配列（index = x * lanes + y）。値は TILE の数値 */
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
      'left/right=進行方向(x)、up/down=レーン変更(y)。既に掘った床(FLOOR)なら即移動、未採掘タイルなら採掘を開始/継続する（複数tick要する場合あり、要求ドリル威力不足なら不発）',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過（燃料は消費される）' },
  {
    type: 'buy',
    params: { item: 'drill|fuel|hp|capacity|digspeed|lantern|hazardresist|teleport' },
    description: 'ショップフェーズ中（x=0のホーム滞在中）のみ有効。指定カテゴリを1レベル購入する',
  },
  {
    type: 'teleport',
    params: {},
    description: '採掘フェーズ中、テレポート解禁済みなら燃料25を消費して即座にホームへ帰還する',
  },
];
