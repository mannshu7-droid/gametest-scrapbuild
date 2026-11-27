/**
 * 040-building-braidring のヘッドレス自動プレイ。描画なしで core を回し、バランス指標を出す。
 *
 * 使い方（games/040-building-braidring で）:
 *   npm run simulate                                  … 9戦略×9条件（向き3×地盤3）×20シードの要約
 *   npm run simulate -- --seeds 80 --seedFrom 81      … シード81〜160
 *   npm run simulate -- --dir ring --ground marsh     … 条件を絞る（カンマ区切りで複数可）
 *   npm run simulate -- --strat weave,spireAll        … 戦略を絞る
 *   npm run simulate -- --tune beamHpBase=30          … TUNE を上書き
 *   npm run simulate -- --runs                        … 各ランを JSON 行で出す
 *   npm run simulate -- --dupes                       … 計画が同じになる戦略も残す（既定は条件ごとに重複を除く）
 *   npm run simulate -- --json                        … 要約を JSON で出す
 *   npm run simulate -- --spireEnd 1                  … spire・spireAll の終わりに梁を架ける（v0.3.0 で試して不採用）
 *
 * 判定（仕様書「AI評価の観点」）: セルごとに総当たり（同じシードで scoreが上なら勝ち、過半数のシードで勝てば「勝ち越し」）。
 * 全勝 = 他の8戦略すべてに勝ち越し。bareが勝ち越す相手も数える。
 * v0.3.0: 1〜2位の差（平均の差÷絶対値の大きい方）と「大差の全勝」（全勝かつ差3%以上）、差3%以内のセル数も出す。
 */
import { FACING, Game, PLOTS, TUNE, setTune, DIRS, GROUNDS, slenderOf, type Tune } from '../src/core/game';
import type { Action, AttackDir, GameState, Ground } from '../src/core/types';

type Task = { k: 'raise'; plot: number; to: number } | { k: 'beam'; edge: number; h: number };

export interface Persona {
  name: string;
  /** 条件（向き・地盤）から建てる順番を作る */
  plan: (dir: AttackDir, L: number) => Task[];
  /** 梁の耐久がこの割合を下回ったら架け直す（修理） */
  repair: number;
}

const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const cap = (h: number) => Math.min(TUNE.maxH, h);
function rr(plots: number[], from: number, to: number): Task[] {
  const out: Task[] = [];
  for (let h = from + 1; h <= cap(to); h++) for (const p of plots) out.push({ k: 'raise', plot: p, to: h });
  return out;
}
function beams(edges: number[], h: number): Task[] {
  return edges.map((e) => ({ k: 'beam', edge: e, h: cap(h) }) as Task);
}

/** spire・spireAll の計画の終わりに梁を架けるか（v0.3.0 で追加、既定 false＝上限で止まる。--spireEnd 1 で終わりに梁。梁の型へ寄り「梁なし」が消えるので不採用） */
export let SPIRE_END = false;
export function setSpireEnd(v: boolean): void {
  SPIRE_END = v;
}
/** 計画の終わりの梁: 来る側の辺→残りの辺（上限の高さ。塔は上限で止めたまま＝自由長は0から数え直すだけ） */
function endBeams(d: AttackDir, L: number): Task[] {
  const E = FACING[d].edges;
  return [...beams(E, L), ...beams(ALL.filter((e) => !E.includes(e)), L)];
}

/** 戦略の一覧（v0.1.0）。F=敵が来る側の台座、E=敵が来る側の辺、L=地盤の自由長の上限 */
export const PERSONAS: Persona[] = [
  /** P01（野望型）: 来る側の真ん中に1本の大塔。両隣を上限まで→梁→真ん中を上限の2倍→残りを上限→両隣も2倍→梁→真ん中を最高まで */
  {
    name: 'p01',
    repair: 0.5,
    plan: (d, L) => {
      const C = d === 'one' ? [1] : d === 'two' ? [1, 5] : [1, 3, 5, 7];
      const N = C.flatMap((c) => [(c + 7) % 8, (c + 1) % 8]).filter((v, i, a) => a.indexOf(v) === i);
      const E = C.flatMap((c) => [(c + 7) % 8, c]);
      return [...rr([...N, ...C], 0, L), ...beams(E, L), ...rr(C, L, 2 * L), ...rr(ALL, 0, L), ...rr(N, L, 2 * L), ...beams(E, 2 * L), ...rr(C, 2 * L, 12)];
    },
  },
  /** P02（あき型）: 上限の1段下（折れない）で全部→来る側に梁→来る側を少しずつ。修理は早め */
  {
    name: 'p02',
    repair: 0.7,
    plan: (d, L) => {
      const F = FACING[d].plots;
      const E = FACING[d].edges;
      const m = L - 1;
      return [...rr(ALL, 0, m), ...beams(E, m), ...rr(F, m, 2 * m), ...beams(E, 2 * m), ...rr(F, 2 * m, 3 * m), ...beams(E, 3 * m), ...beams(ALL, m)];
    },
  },
  /** 梁で編む（来る側だけ）: 上限まで→梁→上限の2倍→梁→最高まで */
  {
    name: 'weave',
    repair: 0.5,
    plan: (d, L) => {
      const F = FACING[d].plots;
      const E = FACING[d].edges;
      return [...rr(F, 0, L), ...beams(E, L), ...rr(F, L, 2 * L), ...beams(E, 2 * L), ...(F.length < 8 ? rr(ALL, 0, L) : []), ...rr(F, 2 * L, 12)];
    },
  },
  /** 全部を梁で編む: 全台座を上限→全周に梁→上限の2倍→梁→最高まで */
  {
    name: 'weaveAll',
    repair: 0.5,
    plan: (_d, L) => [...rr(ALL, 0, L), ...beams(ALL, L), ...rr(ALL, L, 2 * L), ...beams(ALL, 2 * L), ...rr(ALL, 2 * L, 12)],
  },
  /** 低い壁: 全台座を2段→全周に梁（安い輪）→全部を2+上限→梁→最高まで */
  {
    name: 'wall',
    repair: 0.5,
    plan: (_d, L) => [...rr(ALL, 0, 2), ...beams(ALL, 2), ...rr(ALL, 2, 2 + L), ...beams(ALL, 2 + L), ...rr(ALL, 2 + L, 12)],
  },
  /** 梁なしの全基: 全台座を上限まで（--spireEnd 1 なら積み終えたら余ったお金で来る側→全周に上限の高さの梁を架ける。上へは積まない） */
  { name: 'spireAll', repair: 0.5, plan: (d, L) => [...rr(ALL, 0, L), ...(SPIRE_END ? endBeams(d, L) : [])] },
  /** 梁なし・来る側から: 来る側を上限まで→残りを上限まで（--spireEnd 1 なら終わりは spireAll と同じく梁） */
  { name: 'spire', repair: 0.5, plan: (d, L) => [...rr(FACING[d].plots, 0, L), ...rr(ALL, 0, L), ...(SPIRE_END ? endBeams(d, L) : [])] },
  /** 梁なしで上限を超える: 全台座を上限+2（突風で折れうる、折れたら積み直す） */
  { name: 'tall', repair: 0.5, plan: (_d, L) => rr(ALL, 0, L + 2) },
  /** 対照群: 何も建てない */
  { name: 'bare', repair: 0.5, plan: () => [] },
];

/**
 * 計画の正規形: 前に同じタスクがある重複を除く（ボットは最初の未完了タスクを選ぶので、後ろの重複は決して先に選ばれない＝動きは同じ）。
 * v0.3.0: これで全周の spire（来る側＝全部→全部）と spireAll も同じ計画と分かる（v0.2.0 は別扱いで同点の2行が残っていた）
 */
export function normPlan(tasks: Task[]): Task[] {
  const seen = new Set<string>();
  return tasks.filter((t) => {
    const k = JSON.stringify(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 条件で計画が同じになる戦略は先の1つだけ残す（全周では spire＝spireAll、weave＝weaveAll） */
export function distinct(personas: Persona[], dir: AttackDir, L: number): Persona[] {
  const seen = new Set<string>();
  return personas.filter((p) => {
    const k = JSON.stringify(normPlan(p.plan(dir, L))) + '|' + p.repair;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class Bot {
  private tasks: Task[] = [];
  private planned = false;
  constructor(readonly persona: Persona) {}

  private done(s: GameState, t: Task): boolean {
    if (t.k === 'raise') return s.towers[t.plot].h >= t.to;
    const b = s.beams[t.edge];
    const bh = Math.min(s.towers[b.a].h, s.towers[b.b].h);
    if (bh < t.h) return true; // 前提の塔が足りない（前のタスクが先に来る）
    return b.h >= t.h && b.hp >= this.persona.repair * b.maxHp;
  }

  decide(s: GameState): Action {
    if (!this.planned) {
      this.tasks = normPlan(this.persona.plan(s.dir, s.slender));
      this.planned = true;
    }
    const p = s.player;
    if (p.busy > 0) return { type: 'wait' };
    const t = this.tasks.find((x) => !this.done(s, x));
    if (!t) return { type: 'wait' };
    let plot: number;
    let cost: number;
    if (t.k === 'raise') {
      plot = t.plot;
      cost = TUNE.raiseBase + TUNE.raisePerH * (s.towers[t.plot].h + 1);
    } else {
      plot = s.beams[t.edge].a;
      const b = s.beams[t.edge];
      cost = TUNE.beamBase + TUNE.beamPerH * Math.min(s.towers[b.a].h, s.towers[b.b].h);
    }
    const [px, py] = PLOTS[plot];
    const dx = px - p.x;
    const dy = py - p.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      if (p.moveCd > 0) return { type: 'wait' };
      if (Math.abs(dx) > 1) return { type: 'move', dir: dx > 0 ? 'right' : 'left' };
      return { type: 'move', dir: dy > 0 ? 'down' : 'up' };
    }
    if (s.gold < cost) return { type: 'wait' };
    return t.k === 'raise' ? { type: 'raise' } : { type: 'beam', side: 'cw' };
  }
}

export interface RunResult {
  strat: string;
  seed: number;
  dir: AttackDir;
  ground: Ground;
  score: number;
  kills: number;
  leaks: number;
  fled: number;
  spent: number;
  plunder: number;
  arrowLoss: number;
  collapses: number;
  lostLevels: number;
  beamBreaks: number;
  beamsBuilt: number;
  heldTicks: number;
  maxH: number;
  sumH: number;
}

export function runOne(persona: Persona, seed: number, dir: AttackDir, ground: Ground): RunResult {
  const g = new Game(seed, { dir, ground });
  const bot = new Bot(persona);
  while (!g.over) g.step(bot.decide(g.peek() as GameState));
  const m = g.peek().metrics;
  return {
    strat: persona.name,
    seed,
    dir,
    ground,
    score: m.score,
    kills: m.kills,
    leaks: m.leaks,
    fled: m.fled,
    spent: Math.round(m.spent),
    plunder: Math.round(m.plunder),
    arrowLoss: Math.round(m.arrowLoss),
    collapses: m.collapses,
    lostLevels: m.lostLevels,
    beamBreaks: m.beamBreaks,
    beamsBuilt: m.beamsBuilt,
    heldTicks: m.heldTicks,
    maxH: m.maxH,
    sumH: m.sumH,
  };
}

export interface CellSummary {
  dir: AttackDir;
  ground: Ground;
  L: number;
  rows: Array<{ strat: string; mean: number; kills: number; leaks: number; spent: number; collapses: number; beamBreaks: number; wins: number; beatenBy: string[] }>;
  /** 他の全戦略に勝ち越した戦略（無ければ null） */
  sweep: string | null;
  /** bare が勝ち越した相手 */
  bareBeats: string[];
  /** 1〜2位の差（平均 score の差 ÷ 2つの絶対値の大きい方） */
  gap: number;
  /** 全勝で、かつ1〜2位の差が BIG_GAP 以上（「大差の全勝」） */
  bigSweep: string | null;
}

/** 「大差」と「接戦」の境（v2 改善点2: 3%） */
export const BIG_GAP = 0.03;

export function summarize(results: RunResult[], strats: string[], dir: AttackDir, ground: Ground): CellSummary {
  const by: Record<string, Map<number, RunResult>> = {};
  for (const n of strats) by[n] = new Map();
  for (const r of results) if (r.dir === dir && r.ground === ground && by[r.strat]) by[r.strat].set(r.seed, r);
  const mean = (n: string, f: (r: RunResult) => number) => {
    const v = [...by[n].values()];
    return v.length ? v.reduce((a, r) => a + f(r), 0) / v.length : 0;
  };
  const beats = (a: string, b: string) => {
    let w = 0;
    let n = 0;
    for (const [seed, ra] of by[a]) {
      const rb = by[b].get(seed);
      if (!rb) continue;
      n++;
      if (ra.score > rb.score) w++;
      else if (ra.score === rb.score) w += 0.5;
    }
    return n > 0 && w > n / 2;
  };
  const rows = strats.map((n) => {
    const others = strats.filter((o) => o !== n);
    return {
      strat: n,
      mean: mean(n, (r) => r.score),
      kills: mean(n, (r) => r.kills),
      leaks: mean(n, (r) => r.leaks),
      spent: mean(n, (r) => r.spent),
      collapses: mean(n, (r) => r.collapses),
      beamBreaks: mean(n, (r) => r.beamBreaks),
      wins: others.filter((o) => beats(n, o)).length,
      beatenBy: others.filter((o) => beats(o, n)),
    };
  });
  rows.sort((a, b) => b.mean - a.mean);
  const sweep = rows.find((r) => r.wins === strats.length - 1)?.strat ?? null;
  const bareBeats = strats.includes('bare') ? strats.filter((o) => o !== 'bare' && beats('bare', o)) : [];
  const m1 = rows[0]?.mean ?? 0;
  const m2 = rows[1]?.mean ?? m1;
  const gap = (m1 - m2) / Math.max(Math.abs(m1), Math.abs(m2), 1);
  const bigSweep = sweep && sweep === rows[0].strat && gap >= BIG_GAP ? sweep : null;
  return { dir, ground, L: slenderOf(ground), rows, sweep, bareBeats, gap, bigSweep };
}

function parseArgs(argv: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    o[k] = v;
  }
  return o;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.tune) {
    const patch: Partial<Tune> = {};
    for (const kv of args.tune.split(',')) {
      const [k, v] = kv.split('=');
      (patch as Record<string, number>)[k] = Number(v);
    }
    setTune(patch);
  }
  if (args.spireEnd !== undefined) setSpireEnd(args.spireEnd !== '0');
  const seeds = Number(args.seeds ?? 20);
  const from = Number(args.seedFrom ?? 1);
  const dirs = (args.dir ? args.dir.split(',') : DIRS) as AttackDir[];
  const grounds = (args.ground ? args.ground.split(',') : GROUNDS) as Ground[];
  const personas = args.strat ? PERSONAS.filter((p) => args.strat.split(',').includes(p.name)) : PERSONAS;
  const results: RunResult[] = [];
  const t0 = Date.now();
  const cellStrats: Record<string, string[]> = {};
  for (const d of dirs)
    for (const g of grounds) {
      const ps = args.dupes ? personas : distinct(personas, d, slenderOf(g));
      cellStrats[d + '/' + g] = ps.map((p) => p.name);
      for (const p of ps)
        for (let sd = from; sd < from + seeds; sd++) {
          const r = runOne(p, sd, d, g);
          results.push(r);
          if (args.runs) console.log(JSON.stringify(r));
        }
    }
  const cells = [];
  for (const d of dirs) for (const g of grounds) cells.push(summarize(results, cellStrats[d + '/' + g], d, g));
  if (args.json) {
    console.log(JSON.stringify({ seeds: [from, from + seeds - 1], cells }, null, 1));
    return;
  }
  if (args.runs) return;
  const dirJa: Record<string, string> = { one: '北だけ', two: '北と南', ring: '全周' };
  const gJa: Record<string, string> = { rock: '岩', soil: '土', marsh: '湿地' };
  console.log(`040-building-braidring simulate: シード${from}〜${from + seeds - 1}、${results.length}ラン、${((Date.now() - t0) / 1000).toFixed(1)}秒`);
  for (const c of cells) {
    console.log(`\n■ 向き=${dirJa[c.dir]}・地盤=${gJa[c.ground]}（自由長の上限${c.L}）  全勝=${c.sweep ?? 'なし'}${c.bigSweep ? '（大差）' : ''}  1〜2位の差=${(c.gap * 100).toFixed(1)}%  bareが勝ち越す相手=${c.bareBeats.length ? c.bareBeats.join(',') : '0'}`);
    console.log('  順位 戦略      score   撃破  荒らし  建築費  折れ  梁壊  勝ち越し');
    c.rows.forEach((r, i) =>
      console.log(
        `  ${String(i + 1).padStart(2)}  ${r.strat.padEnd(9)} ${r.mean.toFixed(0).padStart(6)} ${r.kills.toFixed(1).padStart(6)} ${r.leaks.toFixed(1).padStart(6)} ${r.spent.toFixed(0).padStart(7)} ${r.collapses.toFixed(2).padStart(5)} ${r.beamBreaks.toFixed(1).padStart(5)}   ${r.wins}/${c.rows.length - 1}`,
      ),
    );
  }
  const sweeps = cells.filter((c) => c.sweep);
  const firsts: Record<string, number> = {};
  for (const c of cells) firsts[c.rows[0].strat] = (firsts[c.rows[0].strat] ?? 0) + 1;
  console.log(`\n要約: 全勝の型がいるセル ${sweeps.length}/${cells.length}（${sweeps.map((c) => `${c.dir}/${c.ground}:${c.sweep}`).join(' ')}）`);
  const bigs = cells.filter((c) => c.bigSweep);
  const close = cells.filter((c) => c.gap < BIG_GAP);
  console.log(`      大差の全勝（2位より${BIG_GAP * 100}%以上上）がいるセル ${bigs.length}/${cells.length}（${bigs.map((c) => `${c.dir}/${c.ground}:${c.bigSweep}`).join(' ')}）`);
  console.log(`      1〜2位の差${BIG_GAP * 100}%以内のセル ${close.length}/${cells.length}（${close.map((c) => `${c.dir}/${c.ground}`).join(' ')}）`);
  console.log(`      1位の内訳 ${Object.entries(firsts).map(([k, v]) => `${k}×${v}`).join(' ')}`);
  console.log(`      bareが勝ち越す相手の合計 ${cells.reduce((a, c) => a + c.bareBeats.length, 0)}`);
}

if (typeof process !== 'undefined' && process.argv?.[1]?.includes('simulate')) main();
