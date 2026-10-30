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
  { type: 'move', params: { dir: "'left' | 'right'" }, description: '坑道を1マス動く（1tickに1マス）。x=0が拠点で、着くと積荷を換金し揺れ0・HP全快' },
  { type: 'wait', description: '何もしない。足場の上なら休み、揺れが下がる。一度休むとその遠征ではもう掘れない（休み＝帰還の宣言）' },
  { type: 'work', description: '今のマスで掘り出す。深いほど・揺れが高いほど稼げるが、揺れが速くたまる。支えのないマスの落盤は2倍' },
  { type: 'prop', description: '今のマスに支柱を建てる（費用は建てた数で上がる、15tick）。前後2マスの帰り道の揺れが1/3強になり、揺れの波と余震が0.35倍になる' },
  { type: 'scaffold', description: '今のマスに足場を建てる（費用40、25tick）。足場のマスでは揺れの波と余震が0.35倍。上でwaitすると揺れが下がる（休んだらその遠征は帰るだけ）。帰り道で足場のマスに入ると、その遠征で1回だけ揺れが6下がる（中継点）' },
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
  /** 揺れの波と余震に掛かる係数（支柱の下・足場で小さい） */
  damp: number;
  /** この遠征で中継点として使った足場か */
  relayUsed: boolean;
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
  /** 折れた支柱の位置（折れなければ -1） */
  brokenX: number;
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
  /** 中継点（帰り道の足場）を通った回数と下がった揺れの合計 */
  relays: number;
  relayRelief: number;
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
    /** この遠征で足場に休んだ（もう掘れない＝帰還の宣言） */
    committed: boolean;
  };
  tremor: {
    /** 今の揺れ（たまった分＋波＋余震、支えの下では波と余震が縮む） */
    value: number;
    base: number;
    wave: number;
    spike: number;
    /** 帰着線: 今すぐ帰った時に帰り道で一番高くなる揺れの見積もり（波と余震は今の値のまま。中継点が無ければ拠点に着く時） */
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
  /** 中継点（帰り道で足場に入る）で下がる揺れ */
  relayRelief: number;
  lastCaveIn: CaveInEvent | null;
  metrics: Metrics;
}
