export type Dir = 'up' | 'down' | 'left' | 'right';

export type EnemyType = 'skirmisher' | 'archer' | 'brute';

export type RiskLevel = 'safe' | 'caution' | 'danger';

export type ShopCategory = 'offense' | 'defense' | 'mobility' | 'skill';

export type BuildTarget = 'barricade' | 'outpost';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'attack' }
  | { type: 'dash'; dir: Dir }
  | { type: 'skill' }
  | { type: 'buy'; category: ShopCategory }
  | { type: 'build'; target: 'barricade'; dir: Dir }
  | { type: 'build'; target: 'outpost' }
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

export interface Barricade {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface Metrics {
  distanceReached: number;
  kills: number;
  died: boolean;
  moneyEarned: number;
  upgradesBought: number;
  dashUses: number;
  skillUses: number;
  barricadesBuilt: number;
  barricadesLost: number;
  outpostsBuilt: number;
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
    /** バリケード/前線拠点の次回建設コスト（現在地のbandで算出） */
    buildCosts: { barricade: number; outpost: number };
    /** 前線拠点を建設可能か（距離・所持金の条件を両方満たすか） */
    canBuildOutpost: boolean;
    /** 現在地点で推奨されるmaxHp */
    recommendedHp: number;
    /** maxHpがrecommendedHpに対してどの水準か。'safe'=100%以上、'caution'=70%以上100%未満、'danger'=70%未満 */
    combatRiskLevel: RiskLevel;
    /** combatRiskLevelが2回目以降も悪化するたびに点灯するHUDハイライトの残り表示tick数（0なら非表示） */
    riskEscalationBanner: number;
    /** 最寄りの拠点（ホーム or 自分が建てた前線拠点）までのx距離（007のestBaseDistance相当） */
    baseDistance: number;
  };
  map: {
    width: number;
    laneCount: number;
    goalDistance: number;
    homeRadius: number;
    outpostRadius: number;
    outpostMinGap: number;
  };
  enemies: Enemy[];
  barricades: Barricade[];
  /** プレイヤーが建てた前線拠点のx座標一覧（ホームのx=0は含まない） */
  outposts: number[];
  metrics: Metrics;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  { type: 'move', params: { dir: 'up|down|left|right' }, description: '1マス移動' },
  { type: 'attack', params: {}, description: '射程内で最も近い敵1体を攻撃（単体、方向指定不要）' },
  { type: 'dash', params: { dir: 'up|down|left|right' }, description: '指定方向へ最大dashRangeマス移動し、発動中は無敵。購入不要・常時使用可・クールダウンあり' },
  { type: 'skill', params: {}, description: '習得済みなら周囲skillRadius以内の敵全てにダメージ（範囲攻撃）' },
  { type: 'buy', params: { category: 'offense|defense|mobility|skill' }, description: '拠点（ホームor前線拠点）保護半径内滞在中のみ有効。所持金が足りれば該当カテゴリを強化' },
  { type: 'build', params: { target: 'barricade', dir: 'up|down|left|right' }, description: '隣接マス(dir)にバリケードを設置。空きマスのみ・所持金消費。第三の選択肢（戦う/逃げる/凌ぐ）' },
  { type: 'build', params: { target: 'outpost' }, description: '現在地に前線拠点を建設。最寄り拠点からOUTPOST_MIN_GAP以上離れている必要あり。以後その場が恒久的な安全地帯になる' },
  { type: 'wait', params: {}, description: '何もせず1ティック経過' },
];
