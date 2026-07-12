export type Material = 'wood' | 'stone' | 'steel' | 'brace' | 'stabilizer';

export type Dir = 'up' | 'down' | 'left' | 'right';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'place'; dir: Dir; material: Material }
  | { type: 'remove'; dir: Dir }
  | { type: 'buy'; material: Material }
  | { type: 'wait' };

export type ShakeState = 'idle' | 'warning' | 'active';

export interface BlockInfo {
  x: number;
  y: number;
  material: Material;
  /** 現在の負荷率（負荷÷耐荷重）。1.0超で崩落判定 */
  stressRatio: number;
  /** 地面から支持経路で繋がっているか */
  grounded: boolean;
}

export interface Metrics {
  maxHeight: number;
  blocksPlaced: number;
  blocksLost: number;
  collapseEvents: number;
  moneyEarned: number;
  fallDamageTaken: number;
  debrisDamageTaken: number;
  invalidActions: number;
  ticksSurvived: number;
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
    money: number;
    inventory: Record<Material, number>;
    fallStreak: number;
    grounded: boolean;
  };
  world: {
    w: number;
    h: number;
    goalHeight: number;
    blocks: BlockInfo[];
    /** 崩落したブロックが地面に積もったスクラップ（列xごとの回収可能額） */
    groundScrap: { x: number; value: number }[];
  };
  shake: {
    state: ShakeState;
    /** idle中: 次の予兆開始までのtick数。warning/active中: null */
    ticksUntilNext: number | null;
    /** warning/active中の残りtick数。idle中: null */
    ticksRemainingInPhase: number | null;
  };
  shop: {
    prices: Record<Material, number>;
    stabilizerRemaining: number;
  };
  /** 003のestFuelToReturn相当の「安全マージン数値公開」サマリ */
  structure: {
    maxStressRatio: number;
    criticalCount: number;
  };
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
    description: '指定方向の空きマスへ1マス移動する。支持を失うと自動的に落下する',
  },
  {
    type: 'place',
    params: { dir: 'up|down|left|right', material: 'wood|stone|steel|brace|stabilizer' },
    description:
      '指定方向の隣接空きマスに、所持している資材を1つ設置する。支持（地面 or 既存の接地ブロック）がない位置には設置できない',
  },
  {
    type: 'remove',
    params: { dir: 'up|down|left|right' },
    description: '指定方向の隣接ブロックを撤去し、コストの50%を所持金として回収する（brace/stabilizerは撤去不可）',
  },
  {
    type: 'buy',
    params: { material: 'wood|stone|steel|brace|stabilizer' },
    description: '地上（y=0）にいるときのみ有効。指定資材を1つ購入し所持資材に加える',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過する' },
];
