export const TILE = {
  FLOOR: 0,
  ROCK: 1,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Dir = 'up' | 'down' | 'left' | 'right';

export type EnemyType = 'grunt' | 'runner' | 'brute';

export type Phase = 'combat' | 'upgrade' | 'gameover';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'attack'; dir: Dir }
  | { type: 'dash'; dir: Dir }
  | { type: 'skill' }
  | { type: 'choose'; index: 0 | 1 | 2 }
  | { type: 'wait' };

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atkCd: number;
  moveCd: number;
}

export interface UpgradeOption {
  id: string;
  name: string;
  desc: string;
}

export interface Metrics {
  wavesCleared: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  upgradesChosen: number;
  score: number;
}

export interface GameState {
  tick: number;
  wave: number;
  phase: Phase;
  over: boolean;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    facing: Dir;
    atk: number;
    attackCd: number;
    attackCdMax: number;
    dashCd: number;
    dashCdMax: number;
    dashRange: number;
    hasSkill: boolean;
    skillCd: number;
    skillCdMax: number;
    skillDmg: number;
    lifesteal: number;
    thorns: number;
    regen: number;
  };
  map: {
    w: number;
    h: number;
    /** 行優先の平坦配列。値は TILE の数値 */
    tiles: number[];
  };
  enemies: Enemy[];
  /** phase === 'upgrade' のときだけ入っている、選択中の3択カード */
  upgradeOptions: UpgradeOption[];
  metrics: Metrics;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  { type: 'move', params: { dir: 'up|down|left|right' }, description: '1マス移動（向きも変わる）。岩・敵がいる場合は移動できない' },
  { type: 'attack', params: { dir: 'up|down|left|right' }, description: '向きを変えつつ、隣接する敵1体を攻撃（単体）' },
  { type: 'dash', params: { dir: 'up|down|left|right' }, description: '指定方向へ最大dashRangeマス移動。クールダウン中は不発' },
  { type: 'skill', params: {}, description: '旋風斬り: 8方向すべての隣接敵にダメージ。習得済み・クールダウン明けのみ発動' },
  { type: 'choose', params: { index: '0|1|2' }, description: '強化フェーズ中のみ有効。3択カードから1枚選ぶ' },
  { type: 'wait', params: {}, description: '何もせず1ティック経過' },
];
