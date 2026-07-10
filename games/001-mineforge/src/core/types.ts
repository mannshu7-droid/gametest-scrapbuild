export const TILE = {
  GRASS: 0,
  TREE: 1,
  ROCK: 2,
  IRON: 3,
  WATER: 4,
  WALL: 5,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Dir = 'up' | 'down' | 'left' | 'right';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'mine'; dir: Dir }
  | { type: 'attack'; dir: Dir }
  | { type: 'place'; dir: Dir }
  | { type: 'craft'; item: 'sword' }
  | { type: 'wait' };

export interface Zombie {
  id: number;
  x: number;
  y: number;
  hp: number;
  /** 攻撃クールダウン（残りティック） */
  atkCd: number;
  /** 移動クールダウン（残りティック） */
  moveCd: number;
}

export interface Metrics {
  kills: number;
  mined: number;
  placed: number;
  damageTaken: number;
  daysSurvived: number;
  score: number;
}

export interface GameState {
  tick: number;
  day: number;
  isNight: boolean;
  /** 現在の日の中での経過ティック（0..DAY_TICKS-1） */
  tickOfDay: number;
  over: boolean;
  player: {
    x: number;
    y: number;
    hp: number;
    facing: Dir;
    hasSword: boolean;
    inventory: { wood: number; stone: number; iron: number };
  };
  map: {
    w: number;
    h: number;
    /** 行優先の平坦配列。値は TILE の数値 */
    tiles: number[];
    /** 削れているタイルの残りHP（index → 残りHP）。壁のHPもここ */
    tileHp: Record<number, number>;
  };
  zombies: { id: number; x: number; y: number; hp: number }[];
  metrics: Metrics;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  { type: 'move', params: { dir: 'up|down|left|right' }, description: '1マス移動（向きも変わる）。移動先が塞がっていても向きだけ変わる' },
  { type: 'mine', params: { dir: 'up|down|left|right' }, description: '隣接タイルを1回叩く。木3回/岩4回/鉄6回で採掘完了。壁も回収可' },
  { type: 'attack', params: { dir: 'up|down|left|right' }, description: '隣接するゾンビを攻撃（素手10 / 剣25）' },
  { type: 'place', params: { dir: 'up|down|left|right' }, description: '隣接する草タイルに壁を設置（stone 2 消費、壁HP50）' },
  { type: 'craft', params: { item: 'sword' }, description: '剣をクラフト（iron 3 + wood 2）。攻撃力10→25' },
  { type: 'wait', params: {}, description: '何もせず1ティック経過' },
];
