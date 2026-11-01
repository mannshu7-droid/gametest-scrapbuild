/**
 * 033-combat-spareglow のヘッドレスシミュレーション（027-emberstakeの篝火の型＋余熱）。
 * 使い方（games/033-combat-spareglow 内で）:
 *   npm run simulate                       全戦略×40シードの要約表＋JSON
 *   npm run simulate -- --seeds 80         シード数
 *   npm run simulate -- --pairs            全戦略の対比較（行が列に勝った数/同点）
 *   npm run simulate -- --sweep p01        固定閾値（奉納する熱）の掃引 20〜210と999（熱では戻らない）
 *   npm run simulate -- --sweepAll         全戦略の掃引の一覧と最良の閾値（前半/後半）。--Ts 60,80,100 で閾値を指定
 *   npm run simulate -- --bestPairs        前半シードで各ビルドの最良閾値を選び、後半シードで全組を対比較
 *   npm run simulate -- --delay 30         反応遅延: 奉納の条件が成り立ってから30回の判断は気付かずに戦い続ける
 *   npm run simulate -- --delay 30 --delayMode sum   sum=1出撃で迷うのは合計30回まで（条件が外れても数え直さない）、reset=条件が外れるたびに数え直す（既定）
 *   npm run simulate -- --grid             033の検証一式: 5条件（遅延0／3秒sum・reset／6秒sum・reset）×全戦略の要約・罰・総当たり・余熱なし対照
 *   npm run simulate -- --brief            1行JSON（スクリプト集計用）
 *   npm run simulate -- --bankAt 50        全戦略の奉納の熱を固定値で上書き
 *   npm run simulate -- --tune damageDiv=30,armorMult=0.85   core TUNE の上書き
 *   npm run simulate -- --only bare,p01    戦略を絞る
 */
import { Game, TUNE, ENEMY_DEFS, type Tune } from '../src/core/game';
import type { Action, Dir, GameState, ShopItemId } from '../src/core/types';

export interface Persona {
  name: string;
  /** 購入の優先順（この順で巡回し、買えるまで貯める）。空なら何も買わない */
  order: ShopItemId[];
  /** この出撃で熱がこの値以上「上がったら」奉納に戻る（033: 余熱で始まりの熱が0でないため、出撃の始まりからの増分で見る） */
  bankHeat: number;
  /** HPがこの割合を下回り、残り火を抱えていたら奉納に戻る */
  bankHpFrac: number;
  note: string;
}

export const PERSONAS: Persona[] = [
  { name: 'p01', order: ['blade', 'armor', 'blade', 'mend', 'armor', 'vitality'], bankHeat: 100, bankHpFrac: 0.35, note: 'P01: 攻防を交互、熱100まで攻める' },
  { name: 'p02', order: ['vitality', 'armor', 'mend', 'blade'], bankHeat: 40, bankHpFrac: 0.6, note: 'P02: 早めに引く。熱+40かHP6割で戻る' },
  { name: 'bare', order: ['blade'], bankHeat: 60, bankHpFrac: 0.3, note: '対照群: 生存に投資しない攻勢（刃だけ）' },
  { name: 'noshop', order: [], bankHeat: 50, bankHpFrac: 0.4, note: '対照群: 何も買わない' },
  { name: 'tank', order: ['armor', 'vitality'], bankHeat: 100, bankHpFrac: 0.25, note: '鎧と器の2種（刃なし）、熱100まで粘る' },
  { name: 'mender', order: ['mend', 'blade'], bankHeat: 60, bankHpFrac: 0.3, note: '癒しと刃の2種、撃破で回復しながら攻める' },
  { name: 'even', order: ['vitality', 'armor', 'mend', 'blade'], bankHeat: 80, bankHpFrac: 0.5, note: 'v1重大#1: 4種を均等に積みHP半分で戻る（熱80）' },
  { name: 'duel', order: ['blade', 'armor'], bankHeat: 80, bankHpFrac: 0.3, note: '刃と鎧の2種に特化' },
  { name: 'warden', order: ['armor', 'mend'], bankHeat: 100, bankHpFrac: 0.3, note: '鎧と癒しの2種に特化（刃なし）' },
  { name: 'banker', order: ['blade', 'armor', 'vitality', 'mend'], bankHeat: 20, bankHpFrac: 0.6, note: '熱20でこまめに奉納（慎重）' },
  { name: 'pusher', order: ['blade', 'armor', 'mend', 'vitality'], bankHeat: 9999, bankHpFrac: 0.2, note: '熱では戻らず、HP2割まで粘る' },
  { name: 'sprinter', order: ['vitality', 'armor', 'mend', 'blade'], bankHeat: 15, bankHpFrac: 0.85, note: '033: 単調な出入り（熱+15かHP85%で即帰る）。余熱を最大に保つ' },
];

const DIRS: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function towards(dx: number, dy: number): Dir {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export class Bot {
  readonly persona: Persona;
  private delay: number;
  private delayMode: 'sum' | 'reset';
  private pendingDelay = -1;
  private banking = false;
  private purchases = 0;
  constructor(persona: Persona, delay = 0, delayMode: 'sum' | 'reset' = 'reset') {
    this.persona = persona;
    this.delay = delay;
    this.delayMode = delayMode;
  }

  decide(s: GameState): Action {
    const p = s.player;
    const per = this.persona;
    const atkR = TUNE.attackRadius;

    // 篝火の上で奉納直後（残り火なし・熱0）なら買い物
    if (s.onBrazier && p.pool === 0 && per.order.length > 0) {
      const item = per.order[this.purchases % per.order.length];
      const cost = s.shopCosts[item];
      if (cost > 0 && p.embers >= cost) {
        this.purchases++;
        return { type: 'buy', item };
      }
    }

    // 奉納に戻る判断（反応遅延あり）
    const want = p.pool > 0 && (p.heat - p.sortieHeat >= per.bankHeat || p.hp < p.maxHp * per.bankHpFrac);
    if (!this.banking) {
      if (want) {
        if (this.pendingDelay < 0) this.pendingDelay = this.delay;
        if (this.pendingDelay === 0) {
          this.banking = true;
          this.pendingDelay = -1;
        } else this.pendingDelay--;
      } else if (this.delayMode === 'reset') this.pendingDelay = -1;
    }
    if (p.pool === 0) {
      if (this.banking) this.banking = false; // 奉納完了または救助
      if (this.pendingDelay >= 0 && !want) this.pendingDelay = -1; // 出撃の終わりで迷いの数えを戻す（sumでも出撃ごと）
    }

    let nearest: { dx: number; dy: number; d: number } | null = null;
    let inRange = 0;
    for (const e of s.enemies) {
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= atkR) inRange++;
      if (!nearest || d < nearest.d) nearest = { dx, dy, d };
    }

    // 危ないときはダッシュで篝火の方へ（無敵4tick）
    if (nearest && nearest.d < 1 && p.hp < p.maxHp * 0.25 && p.dashCd === 0 && !s.onBrazier) {
      return { type: 'dash', dir: towards(-p.x, -p.y) };
    }

    if (this.banking) {
      if (inRange > 0 && p.attackCd === 0 && !s.onBrazier) return { type: 'attack' };
      // 火の輪の縁は敵の手が届くので、中心まで入ってから詠唱する
      if (s.onBrazier && Math.hypot(p.x, p.y) < 0.4) return { type: 'bank' };
      return { type: 'move', dir: towards(-p.x, -p.y) };
    }

    if (!nearest) {
      // 敵がいない: 篝火の近くで待つ
      if (Math.hypot(p.x, p.y) > 2) return { type: 'move', dir: towards(-p.x, -p.y) };
      return { type: 'wait' };
    }
    // 篝火の上では斬れない（v2）ので、敵の方へ出ていく
    if (inRange > 0 && !s.onBrazier) return p.attackCd === 0 ? { type: 'attack' } : { type: 'wait' };
    return { type: 'move', dir: towards(nearest.dx, nearest.dy) };
  }
}

export interface RunResult {
  name: string;
  seed: number;
  score: number;
  kills: number;
  banks: number;
  downs: number;
  low: number;
  mid: number;
  high: number;
  banking: number;
  lostEmbers: number;
  unbanked: number;
  avgBankHeat: number;
  peakHeat: number;
  highHeatSec: number;
  channelBreaks: number;
  graces: number;
  levels: Record<ShopItemId, number>;
  /** 033: 余熱 */
  carryBanked: number;
  avgCarry: number;
  avgBankHp: number;
  sorties: number;
  /** 出撃の長さ（秒）の中央値と、10秒以下の出撃の割合 */
  medSortieSec: number;
  shortShare: number;
}

export function runOne(
  persona: Persona,
  seed: number,
  tune: Partial<Tune> = {},
  delay = 0,
  delayMode: 'sum' | 'reset' = 'reset',
): RunResult {
  const g = new Game(seed, tune);
  const bot = new Bot(persona, delay, delayMode);
  while (!g.over) g.step(bot.decide(g.getState()));
  const m = g.metrics;
  return {
    name: persona.name,
    seed,
    score: m.score,
    kills: m.kills,
    banks: m.banks,
    downs: m.downs,
    low: m.downsByPhase.low,
    mid: m.downsByPhase.mid,
    high: m.downsByPhase.high,
    banking: m.downsByPhase.banking,
    lostEmbers: m.lostEmbers,
    unbanked: m.unbankedAtEnd,
    avgBankHeat: m.banks ? m.sumBankHeat / m.banks : 0,
    peakHeat: m.peakHeat,
    highHeatSec: m.ticksHighHeat / 10,
    channelBreaks: m.channelBreaks,
    graces: m.graces,
    levels: { ...g.player.levels },
    carryBanked: Math.round(m.carryBanked),
    avgCarry: m.banks ? m.sumCarry / m.banks : 0,
    avgBankHp: m.banks ? m.sumBankHpFrac / m.banks : 0,
    sorties: g.sortieLens.length,
    medSortieSec: median(g.sortieLens) / 10,
    shortShare: g.sortieLens.length ? g.sortieLens.filter((l) => l <= 100).length / g.sortieLens.length : 0,
  };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function summarize(rs: RunResult[]) {
  const lv = (k: ShopItemId) => +mean(rs.map((r) => r.levels[k])).toFixed(1);
  return {
    name: rs[0].name,
    score: +mean(rs.map((r) => r.score)).toFixed(1),
    minScore: Math.min(...rs.map((r) => r.score)),
    maxScore: Math.max(...rs.map((r) => r.score)),
    kills: +mean(rs.map((r) => r.kills)).toFixed(1),
    banks: +mean(rs.map((r) => r.banks)).toFixed(1),
    downs: +mean(rs.map((r) => r.downs)).toFixed(2),
    downPhase: {
      low: +mean(rs.map((r) => r.low)).toFixed(2),
      mid: +mean(rs.map((r) => r.mid)).toFixed(2),
      high: +mean(rs.map((r) => r.high)).toFixed(2),
      banking: +mean(rs.map((r) => r.banking)).toFixed(2),
    },
    lostEmbers: +mean(rs.map((r) => r.lostEmbers)).toFixed(1),
    lostShare: +(mean(rs.map((r) => r.lostEmbers)) / Math.max(1, mean(rs.map((r) => r.lostEmbers + r.score)))).toFixed(3),
    unbanked: +mean(rs.map((r) => r.unbanked)).toFixed(1),
    avgBankHeat: +mean(rs.map((r) => r.avgBankHeat)).toFixed(1),
    highHeatSec: +mean(rs.map((r) => r.highHeatSec)).toFixed(1),
    channelBreaks: +mean(rs.map((r) => r.channelBreaks)).toFixed(1),
    graces: +mean(rs.map((r) => r.graces)).toFixed(2),
    levels: { blade: lv('blade'), armor: lv('armor'), mend: lv('mend'), vitality: lv('vitality') },
    carryBanked: +mean(rs.map((r) => r.carryBanked)).toFixed(1),
    avgCarry: +mean(rs.map((r) => r.avgCarry)).toFixed(1),
    avgBankHp: +mean(rs.map((r) => r.avgBankHp)).toFixed(2),
    sorties: +mean(rs.map((r) => r.sorties)).toFixed(1),
    medSortieSec: +mean(rs.map((r) => r.medSortieSec)).toFixed(1),
    shortShare: +mean(rs.map((r) => r.shortShare)).toFixed(3),
  };
}

/** 過半数のシードで勝つか。wins[a] = aが過半数で勝つ相手の数、beatenBy[a] = aに過半数で勝つ相手 */
function roundRobin(all: Record<string, RunResult[]>, names: string[]) {
  const n = all[names[0]].length;
  const beat = (a: string, b: string) => all[a].filter((r, i) => r.score > all[b][i].score).length > n / 2;
  const wins: Record<string, number> = {};
  const beatenBy: Record<string, string[]> = {};
  for (const a of names) {
    wins[a] = names.filter((b) => b !== a && beat(a, b)).length;
    beatenBy[a] = names.filter((b) => b !== a && beat(b, a));
  }
  return { wins, beatenBy };
}

const CONDS: { label: string; delay: number; mode: 'sum' | 'reset' }[] = [
  { label: 'd0', delay: 0, mode: 'reset' },
  { label: '3s-sum', delay: 30, mode: 'sum' },
  { label: '3s-reset', delay: 30, mode: 'reset' },
  { label: '6s-sum', delay: 60, mode: 'sum' },
  { label: '6s-reset', delay: 60, mode: 'reset' },
];

const isMain =
  typeof process !== 'undefined' && !!process.argv?.[1] && process.argv[1].replace(/\\/g, '/').endsWith('headless/simulate.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k: string): string | undefined => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const seeds = Number(opt('--seeds') ?? 40);
  const start = Number(opt('--start') ?? 1);
  const delay = Number(opt('--delay') ?? 0);
  const delayMode = (opt('--delayMode') ?? 'reset') as 'sum' | 'reset';
  const bankAt = opt('--bankAt');
  const tune: Partial<Tune> = {};
  for (const kv of (opt('--tune') ?? '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!(k in TUNE)) throw new Error(`unknown tune key: ${k}`);
    (tune as Record<string, number>)[k] = Number(v);
  }
  const only = opt('--only')?.split(',');
  let personas = PERSONAS.filter((p) => !only || only.includes(p.name));
  if (bankAt) personas = personas.map((p) => ({ ...p, bankHeat: Number(bankAt) }));
  const seedList = Array.from({ length: seeds }, (_, i) => start + i);

  const sweep = opt('--sweep');
  if (args.includes('--grid')) {
    // 033の検証一式。各条件で全戦略を回し、要約・遅延0比の罰・総当たり（過半数で勝つ相手の数）を出す。
    // 余熱なし（carryFrac=0）も遅延0で回し、「score − 余熱の上乗せ」と比べて行動が変わったかを見る
    const names = personas.map((p) => p.name);
    const out: Record<string, unknown> = { seeds, start, tune };
    const base: Record<string, number> = {};
    const d0: Record<string, RunResult[]> = {};
    for (const c of CONDS) {
      const all: Record<string, RunResult[]> = {};
      for (const p of personas) all[p.name] = seedList.map((sd) => runOne(p, sd, tune, c.delay, c.mode));
      if (c.label === 'd0') Object.assign(d0, all);
      const rr = roundRobin(all, names);
      const rows = personas.map((p) => {
        const sm = summarize(all[p.name]);
        if (c.label === 'd0') base[p.name] = sm.score;
        return {
          name: p.name,
          score: Math.round(sm.score),
          pen: c.label === 'd0' ? '' : `${(((sm.score - base[p.name]) / base[p.name]) * 100).toFixed(1)}%`,
          wins: rr.wins[p.name],
          downs: sm.downs,
          carry: sm.avgCarry,
          bankHp: sm.avgBankHp,
          carryBanked: Math.round(sm.carryBanked),
          sorties: sm.sorties,
          medSec: sm.medSortieSec,
          short: sm.shortShare,
          lv: `${sm.levels.blade}/${sm.levels.armor}/${sm.levels.mend}/${sm.levels.vitality}`,
        };
      });
      const bareBeats = names.filter((b) => b !== 'bare' && rr.beatenBy[b].includes('bare'));
      console.log(`== ${c.label}（シード${start}〜${start + seeds - 1}） bareが過半数で勝つ相手: ${bareBeats.join(',') || '0'}`);
      console.table(rows);
      out[c.label] = { rows, bareBeats };
    }
    // 余熱なし対照（遅延0）
    const no: Record<string, RunResult[]> = {};
    for (const p of personas) no[p.name] = seedList.map((sd) => runOne(p, sd, { ...tune, carryFrac: 0 }, 0));
    const rrNo = roundRobin(no, names);
    const ctrl = personas.map((p) => {
      const a = d0[p.name];
      const b = no[p.name];
      const same = a.filter((r, i) => r.score - r.carryBanked === b[i].score).length;
      return {
        name: p.name,
        score: Math.round(mean(a.map((r) => r.score))),
        minusCarry: Math.round(mean(a.map((r) => r.score - r.carryBanked))),
        noCarry: Math.round(mean(b.map((r) => r.score))),
        sameRuns: `${same}/${a.length}`,
        winsNo: rrNo.wins[p.name],
        sortiesNo: +mean(b.map((r) => r.sorties)).toFixed(1),
        medSecNo: +mean(b.map((r) => r.medSortieSec)).toFixed(1),
        downsNo: +mean(b.map((r) => r.downs)).toFixed(2),
      };
    });
    console.log('== 余熱なし対照（carryFrac=0、遅延0）: score − 余熱の上乗せ = 余熱なし が一致したラン数（一致＝行動が変わっていない）');
    console.table(ctrl);
    out.noCarry = ctrl;
    if (args.includes('--json')) console.log(JSON.stringify(out));
  } else if (args.includes('--sweepHp')) {
    // 033: 帰るHPの線（bankHpFrac）の掃引。遅延0と3秒resetで、戦略ごとの平均scoreを1行JSONで出す（最良線の罰はスクリプトで集計）
    const Hs = (opt('--Hs') ?? '0.2,0.3,0.4,0.5,0.6,0.7').split(',').map(Number);
    const conds = CONDS.filter((c) => (opt('--conds') ?? 'd0,3s-reset').split(',').includes(c.label));
    const rows = [];
    for (const c of conds)
      for (const base of personas)
        for (const H of Hs) {
          const rs = seedList.map((sd) => runOne({ ...base, bankHpFrac: H }, sd, tune, c.delay, c.mode));
          rows.push({ cond: c.label, name: base.name, H, score: Math.round(mean(rs.map((r) => r.score))), downs: +mean(rs.map((r) => r.downs)).toFixed(2) });
        }
    console.log(JSON.stringify({ sweepHp: true, seeds, start, tune, rows }));
  } else if (args.includes('--bestPairs')) {
    // v2: ビルドごとに前半シードで最良の閾値を選び、後半シード（ホールドアウト）で全組を対比較する
    const Ts = (opt('--Ts') ?? '40,60,80,100,120,150,180,210').split(',').map(Number);
    const half = Math.floor(seedList.length / 2);
    const train = seedList.slice(0, half);
    const test = seedList.slice(half);
    const chosen: Record<string, RunResult[]> = {};
    const rows = [];
    for (const base of personas) {
      let best = { T: 0, v: -1 };
      for (const T of Ts) {
        const v = mean(train.map((sd) => runOne({ ...base, bankHeat: T }, sd, tune, delay, delayMode).score));
        if (v > best.v) best = { T, v };
      }
      chosen[base.name] = test.map((sd) => runOne({ ...base, bankHeat: best.T }, sd, tune, delay, delayMode));
      rows.push({ name: base.name, bestT: best.T, train: Math.round(best.v), test: Math.round(mean(chosen[base.name].map((r) => r.score))) });
    }
    console.table(rows);
    const names = personas.map((p) => p.name);
    const table: Record<string, Record<string, number | string>> = {};
    for (const a of names) {
      table[a] = {};
      for (const b of names) table[a][b] = a === b ? '-' : chosen[a].filter((r, i) => r.score > chosen[b][i].score).length;
    }
    console.log(`最良閾値どうしの対比較（後半${test.length}シード、行が列に勝った数）`);
    console.table(table);
    console.table(
      names.map((a) => ({ name: a, beatenBy: names.filter((b) => b !== a && Number(table[b][a]) > test.length / 2).join(',') || '（なし）' })),
    );
  } else if (args.includes('--sweepAll')) {
    // v2: 全戦略の閾値掃引を一覧にし、最良の閾値（全体・前半・後半）と「熱では戻らない(999=HPだけで戻る)が最良か」を出す
    const Ts = (opt('--Ts') ?? '40,60,80,100,120,150,180,210,999').split(',').map(Number);
    const half = Math.floor(seedList.length / 2);
    const rows = [];
    for (const base of personas) {
      const row: Record<string, number | string> = { name: base.name };
      let best = { T: 0, v: -1 };
      let bestA = { T: 0, v: -1 };
      let bestB = { T: 0, v: -1 };
      for (const T of Ts) {
        const rs = seedList.map((sd) => runOne({ ...base, bankHeat: T }, sd, tune, delay, delayMode));
        const v = mean(rs.map((r) => r.score));
        const a = mean(rs.slice(0, half).map((r) => r.score));
        const b = mean(rs.slice(half).map((r) => r.score));
        row[`T${T}`] = Math.round(v);
        if (v > best.v) best = { T, v };
        if (a > bestA.v) bestA = { T, v: a };
        if (b > bestB.v) bestB = { T, v: b };
      }
      row.best = `${best.T}(${bestA.T}/${bestB.T})`;
      rows.push(row);
    }
    console.log(JSON.stringify({ sweepAll: true, seeds, delay, tune, rows }));
    console.table(rows);
  } else if (sweep) {
    const base = PERSONAS.find((p) => p.name === sweep);
    if (!base) throw new Error(`unknown persona: ${sweep}`);
    const rows = [];
    for (const T of [20, 40, 60, 80, 100, 120, 150, 180, 210, 999]) {
      const rs = seedList.map((sd) => runOne({ ...base, bankHeat: T }, sd, tune, delay, delayMode));
      const sm = summarize(rs);
      const half = Math.floor(rs.length / 2);
      rows.push({
        T,
        score: sm.score,
        scoreA: +mean(rs.slice(0, half).map((r) => r.score)).toFixed(1),
        scoreB: +mean(rs.slice(half).map((r) => r.score)).toFixed(1),
        downs: sm.downs,
        high: sm.downPhase.high,
        lostShare: sm.lostShare,
        avgBankHeat: sm.avgBankHeat,
      });
    }
    console.log(JSON.stringify({ sweep, seeds, delay, tune, rows }, null, 1));
    console.table(rows);
  } else {
    const all: Record<string, RunResult[]> = {};
    for (const p of personas) all[p.name] = seedList.map((sd) => runOne(p, sd, tune, delay, delayMode));
    const summary = personas.map((p) => summarize(all[p.name]));
    if (args.includes('--brief')) {
      const scores = Object.fromEntries(personas.map((p) => [p.name, all[p.name].map((r) => r.score)]));
      console.log(JSON.stringify({ seeds, start, delay, delayMode, tune, summary, scores }));
      process.exit(0);
    }
    if (args.includes('--json')) console.log(JSON.stringify({ seeds, start, delay, tune, summary }, null, 1));
    console.table(
      summary.map((s) => ({
        name: s.name,
        score: s.score,
        min: s.minScore,
        max: s.maxScore,
        kills: s.kills,
        banks: s.banks,
        downs: s.downs,
        'L/M/H/B': `${s.downPhase.low}/${s.downPhase.mid}/${s.downPhase.high}/${s.downPhase.banking}`,
        lost: s.lostShare,
        bankHeat: s.avgBankHeat,
        hiSec: s.highHeatSec,
        grace: s.graces,
        carry: s.avgCarry,
        bankHp: s.avgBankHp,
        sorties: s.sorties,
        medSec: s.medSortieSec,
        short: s.shortShare,
        lv: `${s.levels.blade}/${s.levels.armor}/${s.levels.mend}/${s.levels.vitality}`,
      })),
    );
    if (args.includes('--pairs')) {
      const names = personas.map((p) => p.name);
      const table: Record<string, Record<string, string>> = {};
      for (const a of names) {
        table[a] = {};
        for (const b of names) {
          if (a === b) {
            table[a][b] = '-';
            continue;
          }
          let w = 0;
          let t = 0;
          all[a].forEach((r, i) => {
            const o = all[b][i].score;
            if (r.score > o) w++;
            else if (r.score === o) t++;
          });
          table[a][b] = t ? `${w}(${t})` : `${w}`;
        }
      }
      console.log(`対比較: 行が列に勝ったシード数（括弧は同点）/ ${seeds}シード`);
      console.table(table);
      // v2: 「どの戦略も少なくとも1つに負ける」の確認（過半数のシードで負ける相手の数）
      const beatenBy = names.map((a) => ({
        name: a,
        beatenBy: names.filter((b) => b !== a && Number(table[b][a].split('(')[0]) > seeds / 2).join(',') || '（なし）',
      }));
      console.table(beatenBy);
    }
    // 決定論チェック: 同じシードを2回回して一致するか
    const chk = runOne(personas[0], start, tune, delay, delayMode);
    console.log(`determinism: ${chk.score === all[personas[0].name][0].score ? 'OK' : 'NG'}`);
    void ENEMY_DEFS;
    void DIRS;
  }
}
