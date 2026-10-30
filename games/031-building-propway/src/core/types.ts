/** 031-building-propway: 坑道に支柱・足場を建てて帰り道の揺れを平らにする建築単体ゲーム */

export type Dir = 'left' | 'right';

export type Action =
  | { type: 'move'; dir: Dir }
  /** 何もしない（足場の上なら休む＝揺れが下がる） */
  | { type: 'wait' }
  /** 今のマスで掘り出す（収入。揺れが少し速くたまる） */
  | { type: 'work' }
  /** 今のマスに支柱を建てる（前後2マスを支える。お金と時間を使う） */
  | { type: 'prop' }
  /** 今のマスに足場を建てる（上で休むと揺れが下がる） */
  | { type: 'scaffold' };

export interface ActionSpecEntry {
  type: Action['type'];
  params?: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  { type: 'move', params: { dir: "'left' | 'right'" }, description: '坑道を1マス動く（2tickに1マス）。x=0が拠点で、着くと積荷を換金し揺れ0・HP全快' },
  { type: 'wait', description: '何もしない。足場の上なら休み、揺れが下がる' },
  { type: 'work', description: '今のマスで掘り出す。深いほど・揺れが高いほど稼げるが、揺れが速くたまる' },
  { type: 'prop', description: '今のマスに支柱を建てる（費用は建てた数で上がる、15tick）。前後2マスの帰り道の揺れが1/3強になり、揺れの波と余震が0.35倍になる' },
  { type: 'scaffold', description: '今のマスに足場を建てる（費用40、25tick）。上でwaitすると揺れが下がる' },
];

/** 坑道の1マス */
export interface Cell {
  x: number;
  /** 支柱が立っているか */
  prop: boolean;
  /** 足場があるか */
  scaffold: boolean;
  /** いずれかの支柱に支えられているか（前後2マス） */
  supported: boolean;
}

export interface Busy {
  kind: 'prop' | 'scaffold' | 'rescue';
  remaining: number;
  total: number;
}

export interface CaveInEvent {
  tick: number;
  x: number;
  damage: number;
  lostValue: number;
  propBroken: boolean;
  rescued: boolean;
}

export interface Metrics {
  moneyEarned: number;
  moneySpent: number;
  trips: number;
  workTicks: number;
  maxDepth: number;
  propsBuilt: number;
  propsBroken: number;
  scaffoldsBuilt: number;
  restTicks: number;
  restRelief: number;
  caveIns: number;
  caveInLost: number;
  rescues: number;
  rescueLost: number;
  /** 帰着線が注意線を越えていたtick数 */
  overLineTicks: number;
  /** 帰着線が注意線を下から越えた回数（上下した回数の目安） */
  lineCrossings: number;
  /** 帰りに支えられたマスを歩いた数／支えのないマスを歩いた数 */
  supportedSteps: number;
  bareSteps: number;
  /** 持ち帰った時の揺れの最大値 */
  peakTremorBanked: number;
  score: number;
}

export interface GameState {
  tick: number;
  timeLimit: number;
  over: boolean;
  seed: number;
  player: {
    x: number;
    hp: number;
    maxHp: number;
    money: number;
    cargo: number;
    busy: Busy | null;
  };
  tremor: {
    /** 今の揺れ（たまった分＋波＋余震、支えの下では波と余震が縮む） */
    value: number;
    base: number;
    wave: number;
    spike: number;
    /** 帰着線: 今すぐ帰った時に拠点へ着くまでの揺れの見積もり（波と余震は今の値のまま） */
    returnLine: number;
    /** 帰り道のコスト（帰着線−今の揺れ） */
    returnCost: number;
    caution: number;
    danger: number;
    /** 落盤の確率（1tickあたり） */
    caveChance: number;
  };
  tunnel: {
    length: number;
    cells: Cell[];
  };
  nextPropCost: number;
  scaffoldCost: number;
  lastCaveIn: CaveInEvent | null;
  metrics: Metrics;
}
