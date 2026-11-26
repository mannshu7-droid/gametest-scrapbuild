/** 040-building-braidring の型。GameState は JSON.stringify 可能（docs/ai-interface.md） */

export type Dir = 'up' | 'down' | 'left' | 'right';
/** 敵の来る向き: one=北だけ、two=北と南、ring=全周 */
export type AttackDir = 'one' | 'two' | 'ring';
/** 地盤: 単独で立てられる高さ（自由長の上限）が変わる */
export type Ground = 'rock' | 'soil' | 'marsh';

export type Action =
  | { type: 'wait' }
  | { type: 'move'; dir: Dir }
  /** 隣（チェビシェフ1以内）の台座の塔を1段積む */
  | { type: 'raise' }
  /** 隣の台座から、輪の隣（cw=時計回り / ccw=反時計回り）の台座へ梁を架ける（架け直しは今より高い時だけ） */
  | { type: 'beam'; side: 'cw' | 'ccw' };

export interface TowerState {
  id: number;
  x: number;
  y: number;
  h: number;
  /** この塔に架かる梁の最高の高さ */
  beamTop: number;
  /** 自由長 = h − beamTop */
  free: number;
  /** 自由長の上限（地盤で決まる）を超えた段数 */
  over: number;
  range: number;
  cooldown: number;
  /** 最後に撃った相手の方向（描画用） */
  aim: number;
}

export interface BeamState {
  /** 辺の番号: 台座 i と i+1（mod 8）を結ぶ */
  edge: number;
  a: number;
  b: number;
  /** 0 = 梁なし */
  h: number;
  hp: number;
  maxHp: number;
}

export interface EnemyState {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** walker=拠点へ歩く（梁に止められる）、archer=拠点から siegeR の所で止まって撃つ */
  kind: 'walker' | 'archer';
  /** archer が立ち止まって撃っている */
  siege: boolean;
  /** 梁に止められている時はその辺の番号、歩いている時は -1 */
  holdEdge: number;
  hitCd: number;
}

export interface PlayerState {
  x: number;
  y: number;
  /** 作業中の残りtick（0=自由） */
  busy: number;
  busyKind: '' | 'raise' | 'beam';
  busyTarget: number;
  moveCd: number;
  face: number;
}

export interface Metrics {
  score: number;
  gold: number;
  earned: number;
  income: number;
  bounty: number;
  spent: number;
  plunder: number;
  /** 射手に撃たれて拠点が失った額（plunder の内数） */
  arrowLoss: number;
  kills: number;
  leaks: number;
  fled: number;
  spawned: number;
  collapses: number;
  lostLevels: number;
  beamBreaks: number;
  beamsBuilt: number;
  raises: number;
  /** 梁に止められていた敵のtickの合計 */
  heldTicks: number;
  maxH: number;
  sumH: number;
}

export interface GameState {
  tick: number;
  maxTicks: number;
  seed: number;
  day: number;
  night: boolean;
  /** 今の昼/夜の残りtick */
  phaseLeft: number;
  dir: AttackDir;
  ground: Ground;
  /** 地盤による自由長の上限 */
  slender: number;
  gold: number;
  player: PlayerState;
  towers: TowerState[];
  beams: BeamState[];
  enemies: EnemyState[];
  /** 今夜の残りの出現数 */
  toSpawn: number;
  /** 今夜の突風の予定tick（夜の始まりから、-1=もう吹いた/昼） */
  gustIn: number;
  /** 直近の出来事（描画・ログ用、最大8件） */
  events: string[];
  over: boolean;
  metrics: Metrics;
  /** 盤面の大きさ */
  w: number;
  h: number;
  baseX: number;
  baseY: number;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params?: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  { type: 'wait', description: '何もしない（1tick）' },
  { type: 'move', params: { dir: 'up|down|left|right' }, description: '1マス移動（移動の後1tickは動けない）' },
  { type: 'raise', description: '隣の台座の塔を1段積む（費用 10+3×新しい高さ、2秒）' },
  {
    type: 'beam',
    params: { side: 'cw|ccw' },
    description: '隣の台座から輪の隣の台座へ梁を架ける（高さ=2塔の低い方、費用 8+2×高さ、3秒）。梁は敵を止める壁になり、両塔の自由長を梁の高さから数え直す',
  },
];
