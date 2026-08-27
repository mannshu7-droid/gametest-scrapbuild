export type Dir = 'up' | 'down' | 'left' | 'right';

export type EnemyType = 'skirmisher' | 'archer' | 'brute';

export type RouteDanger = 'safe' | 'risky';

export type RiskLevel = 'safe' | 'caution' | 'danger';

export type ShopCategory = 'offense' | 'defense' | 'mobility' | 'skill';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'attack' }
  | { type: 'dash'; dir: Dir }
  | { type: 'skill' }
  | { type: 'buy'; category: ShopCategory }
  | { type: 'chooseRoute'; route: RouteDanger }
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
}

export interface Metrics {
  distanceReached: number;
  kills: number;
  died: boolean;
  moneyEarned: number;
  upgradesBought: number;
  dashUses: number;
  skillUses: number;
  waystationsReached: number;
  riskyRoutesTaken: number;
  safeRoutesTaken: number;
  score: number;
}

export interface GameState {
  tick: number;
  over: boolean;
  won: boolean;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    atk: number;
    atkCd: number;
    atkCdMax: number;
    atkRange: number;
    dashCd: number;
    dashCdMax: number;
    dashRange: number;
    hasSkill: boolean;
    skillCd: number;
    skillCdMax: number;
    skillDmg: number;
    skillRadius: number;
    money: number;
    /** 各ショップカテゴリの次回購入コスト（常設・複数カテゴリショップ、008パターン#1） */
    shopPrices: { offense: number; defense: number; mobility: number; skill: number };
    /** このゲームの現在地点（またはルート選択待ちの場合は選択対象セグメント）で推奨されるmaxHp */
    recommendedHp: number;
    /** maxHpがrecommendedHpに対してどの水準か。'safe'=100%以上、'caution'=70%以上100%未満、'danger'=70%未満 */
    combatRiskLevel: RiskLevel;
    /** combatRiskLevelが2回目以降も悪化するたびに点灯するHUDハイライトの残り表示tick数（0なら非表示） */
    riskEscalationBanner: number;
  };
  map: {
    width: number;
    laneCount: number;
    goalDistance: number;
    /** ウェイステーションのx座標一覧（最後の要素はゴール） */
    waystations: number[];
    waystationRadius: number;
  };
  enemies: Enemy[];
  /** 各セグメント（ウェイステーション間の区間）の危険属性。index=floor(x/interval)。null=未選択（まだ到達していない） */
  segments: (RouteDanger | null)[];
  /** ウェイステーション滞在中かつ次セグメントが未選択で、chooseRouteアクション待ちならtrue */
  awaitingRouteChoice: boolean;
  /** awaitingRouteChoice中のみ有効。両ルートを選んだ場合の予測危険度 */
  routePreview: { safe: RiskLevel; risky: RiskLevel } | null;
  metrics: Metrics;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  { type: 'move', params: { dir: 'up|down|left|right' }, description: '1マス移動。ウェイステーションでルート選択待ちの間はx+方向（前進）のみ不発' },
  { type: 'attack', params: {}, description: '射程内で最も近い敵1体を攻撃（単体、方向指定不要）' },
  { type: 'dash', params: { dir: 'up|down|left|right' }, description: '指定方向へ最大dashRangeマス移動し、発動中は無敵。購入不要・常時使用可・クールダウンあり' },
  { type: 'skill', params: {}, description: '習得済みなら周囲skillRadius以内の敵全てにダメージ（範囲攻撃）' },
  { type: 'buy', params: { category: 'offense|defense|mobility|skill' }, description: 'ウェイステーション滞在中のみ有効。所持金が足りれば該当カテゴリを強化' },
  { type: 'chooseRoute', params: { route: 'safe|risky' }, description: 'awaitingRouteChoice中のみ有効。次セグメントの危険属性を選ぶ' },
  { type: 'wait', params: {}, description: '何もせず1ティック経過' },
];
