/**
 * 031-building-propway のヘッドレス自動プレイ。描画なしで core を回し、バランス指標を JSON で出す。
 *
 * 使い方（games/031-building-propway で）:
 *   npm run simulate                         … 全戦略×20シードの要約
 *   npm run simulate -- --strategy props --seeds 80 --seedFrom 1
 *   npm run simulate -- --delay 3 --delayFrom reset   … 反応遅延3秒（線が下がるたびに数え直す）
 *   npm run simulate -- --th 35 --depth 30   … 帰還線・深さを上書き（掃引用）
 *   npm run simulate -- --tune stepCost=0.5  … TUNE を上書き
 *   npm run simulate -- --runs               … 各ランの JSON 行も出す
 *
 * 反応遅延（030-finalの引き継ぎ。最初から2種で測る）:
 * - --delay N: 帰還条件（帰着線≥帰還線）が成り立ってから N 秒は気付かずに続ける
 * - --delayFrom sum（既定）: その遠征で条件が成り立っていた時間の合計で数える＝1回迷う人
 * - --delayFrom reset: 条件が切れるたびに0から数え直す＝線が下がるたびに迷い直す人
 */
import { Game, TUNE, setTune, type Tune } from '../src/core/game';
import type { Action, GameState } from '../src/core/types';

export interface Strategy {
  name: string;
  /** 掘り出す深さ */
  depth: number;
  /** 帰還線: 帰着線がこれ以上になったら帰る */
  th: number;
  /** 支柱の間隔（0=建てない）と最初の支柱の位置 */
  propEvery: number;
  propFrom: number;
  /** propFrom を depth−propSpan から数える（坑道の奥だけ支える） */
  propSpan?: number;
  /** 掘る場所に足場を建て、帰還条件で休む回数 */
  scaffold: boolean;
  maxRests: number;
  /** 休んだら帰着線が th−restMargin まで下がるのを待つ */
  restMargin: number;
  /** 建てる時に残しておくお金 */
  reserve: number;
}

const base: Omit<Strategy, 'name'> = {
  depth: 25,
  th: 35,
  propEvery: 0,
  propFrom: 3,
  scaffold: false,
  maxRests: 0,
  restMargin: 8,
  reserve: 0,
};

/** 戦略の一覧。帰還線 th は v1 の掃引の山に揃える（030の学び） */
export const STRATEGIES: Record<string, Strategy> = {
  /** 対照群: 何も建てない */
  bare: { ...base, name: 'bare', depth: 25, th: 50 },
  /** 坑道を全部支える */
  props: { ...base, name: 'props', depth: 35, th: 40, propEvery: 5 },
  /** 掘る場所の手前10マスだけ支える（安い） */
  propsFace: { ...base, name: 'propsFace', depth: 35, th: 50, propEvery: 5, propSpan: 10 },
  /** 足場だけ（掘る場所で休む） */
  scaffold: { ...base, name: 'scaffold', depth: 30, th: 50, scaffold: true, maxRests: 2 },
  /** 支柱＋足場 */
  mixed: { ...base, name: 'mixed', depth: 40, th: 40, propEvery: 5, scaffold: true, maxRests: 2 },
  /** P01（野望型）: 深く・全部建てて・高めの線まで粘る */
  p01: { ...base, name: 'p01', depth: 50, th: 45, propEvery: 5, scaffold: true, maxRests: 3 },
  /** P02（あき型）: 線ちょうど（注意線30）で帰る。支柱は建てる */
  p02: { ...base, name: 'p02', depth: 25, th: 30, propEvery: 5 },
};

let DELAY_TICKS = 0;
let DELAY_FROM: 'sum' | 'reset' = 'sum';
export function setDelay(sec: number, from: 'sum' | 'reset'): void {
  DELAY_TICKS = Math.round(sec * 10);
  DELAY_FROM = from;
}

export class Bot {
  s: Strategy;
  private acc = 0;
  private returning = false;
  private resting = false;
  private rests = 0;
  /** 遅延のせいで帰らずにいたtick数 */
  delayedTicks = 0;

  constructor(s: Strategy) {
    this.s = s;
  }

  private wantProp(st: GameState): boolean {
    const s = this.s;
    if (s.propEvery <= 0) return false;
    const x = st.player.x;
    const from = s.propSpan ? Math.max(s.propFrom, s.depth - s.propSpan) : s.propFrom;
    if (x < from || x > s.depth) return false;
    if ((x - s.propFrom) % s.propEvery !== 0) return false;
    if (st.tunnel.cells[x].prop) return false;
    return st.player.money >= st.nextPropCost + s.reserve;
  }

  decide(st: GameState): Action {
    const s = this.s;
    const p = st.player;
    if (p.busy) return { type: 'wait' };
    if (p.x === 0) {
      this.acc = 0;
      this.returning = false;
      this.resting = false;
      this.rests = 0;
      // 往復できる時間が残っていなければ出ない
      if (st.tick + 4 * s.depth + 60 >= st.timeLimit) return { type: 'wait' };
      return { type: 'move', dir: 'right' };
    }
    if (this.returning) return { type: 'move', dir: 'left' };
    // 時間切れ前に必ず帰る
    if (st.tick + 2 * p.x + 10 >= st.timeLimit) {
      this.returning = true;
      return { type: 'move', dir: 'left' };
    }

    const cell = st.tunnel.cells[p.x];
    if (this.resting) {
      if (st.tremor.returnLine <= s.th - s.restMargin) {
        this.resting = false;
        this.rests++;
        this.acc = 0;
      } else return { type: 'wait' };
    }

    const cond = st.tremor.returnLine >= s.th;
    if (DELAY_FROM === 'sum') {
      if (cond) this.acc++;
    } else {
      this.acc = cond ? this.acc + 1 : 0;
    }
    if (this.acc > 0 && this.acc > DELAY_TICKS) {
      if (s.scaffold && cell.scaffold && this.rests < s.maxRests) {
        this.resting = true;
        return { type: 'wait' };
      }
      this.returning = true;
      return { type: 'move', dir: 'left' };
    }
    if (this.acc > 0) this.delayedTicks++;

    if (this.wantProp(st)) return { type: 'prop' };
    if (p.x < s.depth) return { type: 'move', dir: 'right' };
    if (s.scaffold && !cell.scaffold && p.money >= st.scaffoldCost + s.reserve) return { type: 'scaffold' };
    return { type: 'work' };
  }
}

export interface RunResult {
  strategy: string;
  seed: number;
  score: number;
  earned: number;
  spent: number;
  trips: number;
  workTicks: number;
  propsBuilt: number;
  propsBroken: number;
  scaffolds: number;
  restSec: number;
  caveIns: number;
  rescues: number;
  lostValue: number;
  overLineSec: number;
  crossings: number;
  delayedSec: number;
  peakBanked: number;
}

export function runOne(s: Strategy, seed: number): RunResult {
  const g = new Game(seed);
  const bot = new Bot(s);
  while (!g.over) g.step(bot.decide(g.getState()));
  const m = g.getState().metrics;
  return {
    strategy: s.name,
    seed,
    score: m.score,
    earned: m.moneyEarned,
    spent: m.moneySpent,
    trips: m.trips,
    workTicks: m.workTicks,
    propsBuilt: m.propsBuilt,
    propsBroken: m.propsBroken,
    scaffolds: m.scaffoldsBuilt,
    restSec: m.restTicks / 10,
    caveIns: m.caveIns,
    rescues: m.rescues,
    lostValue: Math.round(m.caveInLost + m.rescueLost),
    overLineSec: m.overLineTicks / 10,
    crossings: m.lineCrossings,
    delayedSec: bot.delayedTicks / 10,
    peakBanked: Math.round(m.peakTremorBanked * 10) / 10,
  };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function summarize(results: RunResult[]) {
  const names = [...new Set(results.map((r) => r.strategy))];
  const by = (n: string) => results.filter((r) => r.strategy === n);
  const rows = names.map((n) => {
    const rs = by(n);
    return {
      strategy: n,
      score: Math.round(avg(rs.map((r) => r.score))),
      earned: Math.round(avg(rs.map((r) => r.earned))),
      spent: Math.round(avg(rs.map((r) => r.spent))),
      trips: r1(avg(rs.map((r) => r.trips))),
      props: r1(avg(rs.map((r) => r.propsBuilt))),
      broken: r1(avg(rs.map((r) => r.propsBroken))),
      caveIns: r1(avg(rs.map((r) => r.caveIns))),
      rescues: r1(avg(rs.map((r) => r.rescues))),
      lost: Math.round(avg(rs.map((r) => r.lostValue))),
      overLineSec: r1(avg(rs.map((r) => r.overLineSec))),
      crossings: r1(avg(rs.map((r) => r.crossings))),
      restSec: r1(avg(rs.map((r) => r.restSec))),
    };
  });
  // 総当たり: 同じシードで score が上回った数（過半数で勝つ相手の数）
  const seeds = [...new Set(results.map((r) => r.seed))];
  const score = new Map(results.map((r) => [`${r.strategy}:${r.seed}`, r.score]));
  const wins: Record<string, Record<string, number>> = {};
  const beats: Record<string, number> = {};
  for (const a of names) {
    wins[a] = {};
    beats[a] = 0;
    for (const b of names) {
      if (a === b) continue;
      let w = 0;
      for (const sd of seeds) if ((score.get(`${a}:${sd}`) ?? 0) > (score.get(`${b}:${sd}`) ?? 0)) w++;
      wins[a][b] = w;
      if (w * 2 > seeds.length) beats[a]++;
    }
  }
  return { rows, wins, beats, seeds: seeds.length };
}

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.includes('simulate')) {
  const over: Partial<Tune> = {};
  process.argv.forEach((a, i) => {
    if (a === '--tune') {
      for (const kv of process.argv[i + 1].split(',')) {
        const [k, v] = kv.split('=');
        if (!(k in TUNE)) throw new Error(`unknown tune key: ${k}`);
        (over as Record<string, number>)[k] = Number(v);
      }
    }
  });
  setTune(over);
  const from = argVal('delayFrom') === 'reset' ? 'reset' : 'sum';
  setDelay(Number(argVal('delay') ?? 0), from);
  const seeds = Number(argVal('seeds') ?? 20);
  const seedFrom = Number(argVal('seedFrom') ?? 1);
  const sel = argVal('strategy') ?? 'all';
  const names = sel === 'all' ? Object.keys(STRATEGIES) : sel.split(',');
  const th = argVal('th');
  const depth = argVal('depth');
  const results: RunResult[] = [];
  for (const n of names) {
    const s0 = STRATEGIES[n];
    if (!s0) throw new Error(`unknown strategy: ${n}`);
    const s: Strategy = { ...s0, ...(th ? { th: Number(th) } : {}), ...(depth ? { depth: Number(depth) } : {}) };
    for (let sd = seedFrom; sd < seedFrom + seeds; sd++) {
      const r = runOne(s, sd);
      results.push(r);
      if (process.argv.includes('--runs')) console.log(JSON.stringify({ run: r, delay: DELAY_TICKS / 10, delayFrom: DELAY_FROM, th: s.th, depth: s.depth }));
    }
  }
  const sum = summarize(results);
  console.log(
    JSON.stringify(
      { config: { seeds, seedFrom, delay: DELAY_TICKS / 10, delayFrom: DELAY_FROM, tune: over, th, depth }, ...sum },
      null,
      process.argv.includes('--runs') ? 0 : 1,
    ),
  );
}
