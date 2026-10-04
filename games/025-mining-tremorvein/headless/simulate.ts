/**
 * ヘッドレスシミュレーション: ボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 30000 --sweep --verbose]
 *
 * 025の核心は「揺れ（tremor）をどこまで粘るか」が連続的なリスクとリターンのカーブになっているか。
 * 017の崖（安全マージン0なら死亡0/20、−1で18/20）と同じ測り方をするため、戦略の差は主に
 * 「帰還を始める揺れの閾値 tRet（今の揺れ＋帰り道の見積もり揺れがこれを超えたら帰る）」に置く:
 * - cautious: tRet=40（落盤がほぼ起きない範囲だけで掘る）
 * - standard: tRet=70
 * - pusher:   tRet=110（揺れボーナス上限の先まで粘る）
 * - banker:   tRet=90。送り籠を優先購入し、積荷が満杯になったら帰らず籠で送って掘り続ける
 * --sweep で tRet を 20〜150 まで10刻みで掃引する（standardの購入順のまま閾値だけ動かす）
 *
 * v0.2.0: 全戦略が強化の最後に足場（scaffold）を買い、深さ placeAt に着いたら据える。
 * 「今の揺れ＋帰り道の見積もり揺れ」が閾値を超えたとき、足場の方が近ければ（見積もり揺れが小さければ）
 * 地上ではなく足場へ戻って休み、揺れが下がったら掘りに戻る。--noScaffold で足場を買わない対照群になる
 * --seeds は 1,2,3 と 1..40 の両方の書き方を受け付ける
 */
import { Game, WIDTH, DEPTH, digTicks, tremorRate, ORE_VALUE, isOre, caveInDamageAt, tremorBonus, UPGRADES, upgradeCost } from '../src/core/game';
import { TILE, type Action, type Dir, type GameState, type UpgradeId } from '../src/core/types';

interface BotConfig {
  name: string;
  tRet: number;
  priority: UpgradeId[];
  useBasket: boolean;
  /** HPが「今の深さの落盤ダメージ×この倍率」以下なら帰る（0なら見ない） */
  hpGuard: number;
  /** 地上で掘りに行ける先が無い（閾値内に鉱石が無い）とき、閾値を5ずつ上げて粘るか。
   * 固定閾値のままだと強化を買い切った後に地上で待ち続ける（v1で確認）。人が実際に取る行動に合わせ、
   * 名前付き戦略は適応型にし、--sweepの掃引だけ固定閾値で測る */
  adaptive: boolean;
  /** 足場を据える深さ（買った順に、この深さ以上に着いたら据える） */
  placeAt: number[];
}

const BASE_PRIORITY: UpgradeId[] = ['drill', 'capacity', 'hp', 'brace', 'winch', 'basket', 'scaffold'];
const BANKER_PRIORITY: UpgradeId[] = ['basket', 'drill', 'capacity', 'hp', 'brace', 'winch', 'scaffold'];
const PLACE_AT = [40, 75, 100];

export const STRATEGIES: BotConfig[] = [
  { name: 'cautious', tRet: 40, priority: BASE_PRIORITY, useBasket: false, hpGuard: 1, adaptive: true, placeAt: PLACE_AT },
  { name: 'standard', tRet: 70, priority: BASE_PRIORITY, useBasket: false, hpGuard: 1, adaptive: true, placeAt: PLACE_AT },
  { name: 'pusher', tRet: 110, priority: BASE_PRIORITY, useBasket: false, hpGuard: 0, adaptive: true, placeAt: PLACE_AT },
  { name: 'banker', tRet: 90, priority: BANKER_PRIORITY, useBasket: true, hpGuard: 1, adaptive: true, placeAt: PLACE_AT },
];

/** ペルソナの方針（レビューのP01/P02実プレイ。ブラウザではこのBotをバンドルして__AIP__越しに動かす） */
export const PERSONAS: BotConfig[] = [
  // P01（野望型）: 効率型。ドリル→巻き上げ機→背負子→支保→防護服→送り籠→足場。ボーナス上限の手前（85）まで粘る
  { name: 'P01', tRet: 85, priority: ['drill', 'winch', 'capacity', 'brace', 'hp', 'basket', 'scaffold'], useBasket: true, hpGuard: 1, adaptive: true, placeAt: [60, 95, 105] },
  // P02（あき型）: 安全型。防護服→支保→ドリル→背負子→巻き上げ機→足場（送り籠は買わない）。閾値55＝100tickで落盤35%
  { name: 'P02', tRet: 55, priority: ['hp', 'brace', 'drill', 'capacity', 'winch', 'scaffold'], useBasket: false, hpGuard: 1.5, adaptive: true, placeAt: [40, 75, 100] },
];

function tileAt(s: GameState, x: number, y: number): number {
  if (x < 0 || x >= s.map.width || y < 0 || y >= s.map.depth) return -1;
  return s.map.tiles[y * s.map.width + x];
}

/** まっすぐな縦穴を深さtoまで戻る場合の見積もり揺れ（計画用の近似。toに着いたtickの分は数えない） */
function approxReturnTremor(y: number, braceLv: number, winchLv: number, to = 0): number {
  let sum = 0;
  for (let k = y - (1 + winchLv); k > to; k -= 1 + winchLv) sum += tremorRate(k, braceLv);
  return sum;
}

class MinHeap {
  private a: number[] = [];
  private p: number[] = [];
  push(item: number, pri: number) {
    this.a.push(item);
    this.p.push(pri);
    let i = this.a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (this.p[par] <= this.p[i]) break;
      [this.a[par], this.a[i]] = [this.a[i], this.a[par]];
      [this.p[par], this.p[i]] = [this.p[i], this.p[par]];
      i = par;
    }
  }
  pop(): [number, number] | null {
    if (this.a.length === 0) return null;
    const top: [number, number] = [this.a[0], this.p[0]];
    const la = this.a.pop()!;
    const lp = this.p.pop()!;
    if (this.a.length > 0) {
      this.a[0] = la;
      this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.a.length && this.p[l] < this.p[m]) m = l;
        if (r < this.a.length && this.p[r] < this.p[m]) m = r;
        if (m === i) break;
        [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
        [this.p[m], this.p[i]] = [this.p[i], this.p[m]];
        i = m;
      }
    }
    return top;
  }
}

export class Bot {
  private plan: { x: number; y: number }[] = [];
  private lastCaveInTick = -1;
  /** 実際に使う帰還閾値（adaptiveなら停滞のたびに上がる） */
  tRet: number;
  /** 閾値を上げた回数（条件が実際に行動を変えたかの確認用） */
  raises = 0;
  /** 地上で行き先が無く待った連続tick数（地上では何も変化しないので、続けば永久の停滞） */
  surfaceWaits = 0;
  /** 収穫ゼロで帰ってきた潜行の連続回数（固定閾値のボットが閾値内の行き先を失った＝停滞） */
  zeroTrips = 0;
  constructor(private cfg: BotConfig) {
    this.tRet = cfg.tRet;
  }

  private braceLv(s: GameState): number {
    return s.shop.find((i) => i.id === 'brace')!.level;
  }

  /** プレイヤー位置からのダイクストラ（コスト=tick数）で、価値/コストが最大の鉱石への経路を作る */
  private makePlan(s: GameState): { x: number; y: number }[] {
    const p = s.player;
    const n = WIDTH * DEPTH;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const start = p.y * WIDTH + p.x;
    dist[start] = 0;
    // 経路に沿ってたまる揺れの見積もり（掘る区間は×1.5）。足場を通るなら、そこで休んで0に戻す前提
    const tr = new Float64Array(n).fill(0);
    tr[start] = p.tremor;
    const isSc = new Uint8Array(n);
    for (const sc of s.map.scaffolds) isSc[sc.y * WIDTH + sc.x] = 1;
    const heap = new MinHeap();
    heap.push(start, 0);
    const brace = this.braceLv(s);
    const winch = s.shop.find((i) => i.id === 'winch')!.level;
    const full = p.cargoUnits >= p.maxCapacity;
    let best = -1;
    let bestScore = 0;
    for (;;) {
      const top = heap.pop();
      if (!top) break;
      const [cur, d] = top;
      if (d > dist[cur]) continue;
      const cx = cur % WIDTH;
      const cy = Math.floor(cur / WIDTH);
      const t = s.map.tiles[cur];
      if (cur !== start && isOre(t) && (!full || t === TILE.CORE)) {
        // 着くまでにたまる揺れ（掘削中は1.5倍で近似）＋そこから帰る揺れが閾値内か
        const projT = tr[cur];
        // 帰り道は地上か、鉱石より浅い足場（そこで休めば揺れが下がる）の近い方
        let ret = approxReturnTremor(cy, brace, winch);
        for (const sc of s.map.scaffolds) if (sc.y <= cy) ret = Math.min(ret, approxReturnTremor(cy, brace, winch, sc.y));
        if (projT + ret < this.tRet) {
          const value = ORE_VALUE[t] * (1 + tremorBonus(projT));
          const score = value / (d + 4 + (cy - p.y > 0 ? 0 : 0));
          if (score > bestScore) {
            bestScore = score;
            best = cur;
          }
        }
      }
      const ns = [
        [cx, cy - 1],
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy + 1],
      ];
      for (const [nx, ny] of ns) {
        if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= DEPTH) continue;
        const ni = ny * WIDTH + nx;
        const nt = s.map.tiles[ni];
        const c = nt === TILE.FLOOR ? 1 : digTicks(nt, ny, p.drillPower);
        const nd = d + c;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          tr[ni] = isSc[ni] ? 0 : tr[cur] + tremorRate(ny, brace) * (nt === TILE.FLOOR ? 1 : c * 1.5);
          prev[ni] = cur;
          heap.push(ni, nd);
        }
      }
    }
    if (best < 0) return [];
    this.lastPlanTremor = tr[best];
    const path: { x: number; y: number }[] = [];
    for (let c = best; c !== start; c = prev[c]) path.push({ x: c % WIDTH, y: Math.floor(c / WIDTH) });
    return path.reverse();
  }

  private stepToward(s: GameState, target: { x: number; y: number }): Action {
    const p = s.player;
    const dir: Dir = target.x > p.x ? 'right' : target.x < p.x ? 'left' : target.y > p.y ? 'down' : 'up';
    return { type: 'move', dir };
  }

  /** 一番近い足場へ向かう。着いていれば休む */
  private scaffoldAction(s: GameState): Action {
    this.plan = [];
    const p = s.player;
    if (p.onScaffold) {
      // 休みきっても帰り道の揺れが閾値を超える（足場が深すぎる）なら、地上へ帰るしかない
      if (p.tremor <= 1) return this.returnAction(s);
      return this.startRest(s);
    }
    const step = new GameView(s).firstStepTo((x, y) => s.map.scaffolds.some((sc) => sc.x === x && sc.y === y));
    if (step && step.y < p.y) return { type: 'hoist' };
    if (step) return this.stepToward(s, step);
    return this.returnAction(s);
  }

  /** 足場で休み始める。前回休んでから1つも掘れずにまた戻ってきた＝計画した鉱石に閾値内で届かないなら、
   * 粘りを上げる（adaptive）か地上へ帰る（固定閾値） */
  private startRest(s: GameState): Action {
    if (s.metrics.oreMined === this.oreAtLastRest) {
      if (this.cfg.adaptive && this.tRet < 150) {
        this.tRet += 5;
        this.raises++;
      } else {
        this.oreAtLastRest = -1;
        return this.returnAction(s);
      }
    }
    this.oreAtLastRest = s.metrics.oreMined;
    this.restCount++;
    this.restTarget = 5;
    return { type: 'wait' };
  }

  private returnAction(s: GameState): Action {
    this.plan = [];
    const step = s.player.y > 0 ? new GameView(s).firstStepTo((_x, y) => y === 0) : null;
    if (step && step.y < s.player.y) return { type: 'hoist' };
    if (step) return this.stepToward(s, step);
    return { type: 'move', dir: 'up' };
  }

  /** 計画の先頭から真上へ続く歩数が巻き上げ1回分以上あるなら巻き上げを使う */
  private planStep(s: GameState): Action {
    const p = s.player;
    const winch = s.shop.find((i) => i.id === 'winch')!.level;
    if (winch > 0) {
      let n = 0;
      let cy = p.y;
      while (n < this.plan.length && this.plan[n].x === p.x && this.plan[n].y === cy - 1 && s.map.tiles[this.plan[n].y * WIDTH + p.x] === TILE.FLOOR) {
        n++;
        cy--;
      }
      if (n >= 1 + winch) return { type: 'hoist' };
    }
    return this.stepToward(s, this.plan[0]);
  }

  private oreAtDepart = 0;
  private wasHome = true;
  /** 足場で休んでいるなら、揺れをいくつまで下げるか（休んでいなければnull） */
  private restTarget: number | null = null;
  private oreAtLastRest = -1;
  /** 直近の計画で、目標の鉱石に着いたときの揺れの見積もり（デバッグ用） */
  lastPlanTremor = 0;
  /** 足場で休み始めた回数 */
  restCount = 0;

  decide(s: GameState): Action {
    const a = this.decideInner(s);
    if (a.type !== 'wait') this.surfaceWaits = 0;
    return a;
  }

  private decideInner(s: GameState): Action {
    const p = s.player;
    const home = s.phase === 'shop';
    if (home && !this.wasHome) {
      // 収穫ゼロで帰ってきた潜行は停滞とみなし、adaptiveなら閾値を上げる
      // 買える物が尽きた（お金の使い道が無い）ときも、核石を狙って粘りを上げる（人が実際に取る行動）
      const maxed = this.cfg.priority.every((id) => (!this.cfg.useBasket && id === 'basket') || s.shop.find((i) => i.id === id)!.nextCost === null);
      this.zeroTrips = s.metrics.oreMined === this.oreAtDepart ? this.zeroTrips + 1 : 0;
      if ((s.metrics.oreMined === this.oreAtDepart || maxed) && this.cfg.adaptive && this.tRet < 150) {
        this.tRet += 5;
        this.raises++;
      }
    }
    if (!home && this.wasHome) this.oreAtDepart = s.metrics.oreMined;
    this.wasHome = home;
    if (s.lastCaveIn && s.lastCaveIn.tick !== this.lastCaveInTick) {
      this.lastCaveInTick = s.lastCaveIn.tick;
      this.plan = [];
    }
    if (s.phase === 'shop') {
      this.plan.length = 0;
      // 優先度リストのうち買えるものを最も安い順に買う（偏りすぎないように）
      const affordable = this.cfg.priority
        .map((id) => s.shop.find((i) => i.id === id)!)
        .filter((i) => i.nextCost !== null && p.money >= i.nextCost && (this.cfg.useBasket || i.id !== 'basket'));
      if (affordable.length > 0) {
        const pick = affordable.reduce((a, b) => (b.nextCost! < a.nextCost! * 0.8 ? b : a));
        return { type: 'buy', item: pick.id };
      }
    } else {
      const full = p.cargoUnits >= p.maxCapacity;
      const est = p.estReturnTremor ?? 0;
      // 足場で休んでいる: 帰り道の揺れ込みで閾値の半分を切るまで（または揺れがほぼ0まで）待つ
      if (this.restTarget !== null) {
        if (p.onScaffold && p.tremor > this.restTarget) return { type: 'wait' };
        this.restTarget = null;
      }
      // 足場を持っていて、据える深さに着いたら据える
      const placed = s.map.scaffolds.length;
      if (p.scaffoldsHeld > 0 && placed < this.cfg.placeAt.length && p.y >= this.cfg.placeAt[placed] && !p.onScaffold) {
        return { type: 'place' };
      }
      // 掘りに行く途中で足場を通るなら、揺れを下げてから先へ進む（計画は足場で0に戻る前提で立てている）
      if (p.onScaffold && !full && !p.hasCore && p.tremor > 5) return this.startRest(s);
      if (full && this.cfg.useBasket && p.basketsLeft > 0) return { type: 'send' };
      const hpLow = this.cfg.hpGuard > 0 && p.hp <= caveInDamageAt(p.y) * this.cfg.hpGuard;
      // 安全な場所（地上か足場の近い方）へ着くまでの揺れで閾値を判定する
      const danger = p.tremor + Math.min(est, p.estScaffoldTremor ?? Infinity) >= this.tRet;
      if (danger && !hpLow && p.estScaffoldTremor !== null && p.estScaffoldTremor < est - 1) {
        return this.scaffoldAction(s);
      }
      if (p.hasCore || full || danger || hpLow) {
        // 帰る直前、籠が余っていて揺れが高いなら、落盤で落とす前に送っておく（bankerのみ）
        if (this.cfg.useBasket && p.basketsLeft > 0 && p.cargoValue > 0 && !p.hasCore && p.estReturnTicks! > 15 && p.caveInChance100 > 0.3) {
          return { type: 'send' };
        }
        return this.returnAction(s);
      }
    }
    // 計画の先頭が今いる場所なら捨てる（移動完了）
    // 計画上の今いる場所までを捨てる（巻き上げ機で複数マス進むことがある）
    const here = this.plan.findIndex((c) => c.x === p.x && c.y === p.y);
    if (here >= 0) this.plan.splice(0, here + 1);
    if (this.plan.length === 0) this.plan = this.makePlan(s);
    if (this.plan.length === 0 && s.phase === 'shop' && this.cfg.adaptive && this.tRet < 150) {
      this.tRet += 5;
      this.raises++;
      return { type: 'wait' };
    }
    if (this.plan.length === 0) {
      if (s.phase === 'shop') {
        this.surfaceWaits++;
        return { type: 'wait' };
      }
      return this.returnAction(s);
    }
    const next = this.plan[0];
    if (Math.abs(next.x - p.x) + Math.abs(next.y - p.y) !== 1) {
      this.plan = this.makePlan(s);
      if (this.plan.length === 0) return s.phase === 'shop' ? { type: 'wait' } : this.returnAction(s);
    }
    return this.planStep(s);
  }
}

/** GameStateだけから帰り道（掘った床のBFS）の最初の一歩を求める */
class GameView {
  constructor(private s: GameState) {}
  firstStepTo(isGoal: (x: number, y: number) => boolean): { x: number; y: number } | null {
    const s = this.s;
    const p = s.player;
    const start = p.y * WIDTH + p.x;
    const prev = new Int32Array(WIDTH * DEPTH).fill(-2);
    prev[start] = -1;
    const q = [start];
    let h = 0;
    while (h < q.length) {
      const cur = q[h++];
      const cx = cur % WIDTH;
      const cy = Math.floor(cur / WIDTH);
      if (cur !== start && isGoal(cx, cy)) {
        let c = cur;
        while (prev[c] !== start) c = prev[c];
        return { x: c % WIDTH, y: Math.floor(c / WIDTH) };
      }
      for (const [nx, ny] of [
        [cx, cy - 1],
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy + 1],
      ]) {
        if (tileAt(s, nx, ny) !== TILE.FLOOR) continue;
        const ni = ny * WIDTH + nx;
        if (prev[ni] !== -2) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    return null;
  }
}

function spentOn(id: UpgradeId, level: number): number {
  const def = UPGRADES.find((u) => u.id === id)!;
  let sum = 0;
  for (let l = 0; l < level; l++) sum += upgradeCost(def, l)!;
  return sum;
}

export interface RunResult {
  seed: number;
  strategy: string;
  tRet: number;
  ticks: number;
  cleared: boolean;
  clearedTick: number | null;
  moneyEarned: number;
  moneyAt10k: number;
  maxDepth: number;
  oreMined: number;
  upgradesBought: number;
  trips: number;
  caveIns: number;
  rescues: number;
  spilledValue: number;
  rescueLoss: number;
  tremorBonusEarned: number;
  basketsSent: number;
  basketTremor: number;
  scaffoldsPlaced: number;
  scaffoldSpend: number;
  restTicks: number;
  restRelief: number;
  restCount: number;
  peakTremorBanked: number;
  /** クリアした時点の所持金（使い道が尽きたかの指標） */
  moneyLeft: number;
  finalTRet: number;
  raises: number;
  /** 地上で行き先が無くなり永久に待つ状態に入ったtick（無ければnull） */
  stalledTick: number | null;
  score: number;
}

export function runOne(seed: number, cfg: BotConfig, maxTicks: number): RunResult {
  const game = new Game(seed);
  const bot = new Bot(cfg);
  let ticks = 0;
  let moneyAt10k = -1;
  let stalledTick: number | null = null;
  while (!game.over && ticks < maxTicks) {
    game.step(bot.decide(game.getState()));
    ticks++;
    if (ticks === 10000) moneyAt10k = game.getState().metrics.moneyEarned;
    if (bot.surfaceWaits >= 20 || (!cfg.adaptive && bot.zeroTrips >= 3)) {
      stalledTick = ticks;
      break;
    }
  }
  const s = game.getState();
  const m = s.metrics;
  return {
    seed,
    strategy: cfg.name,
    tRet: cfg.tRet,
    ticks,
    cleared: s.over,
    clearedTick: m.clearedTick,
    moneyEarned: m.moneyEarned,
    moneyAt10k: moneyAt10k < 0 ? m.moneyEarned : moneyAt10k,
    maxDepth: m.maxDepth,
    oreMined: m.oreMined,
    upgradesBought: m.upgradesBought,
    trips: m.trips,
    caveIns: m.caveIns,
    rescues: m.rescues,
    spilledValue: m.spilledValue,
    rescueLoss: m.rescueLostValue + m.rescueFeesPaid,
    tremorBonusEarned: m.tremorBonusEarned,
    basketsSent: m.basketsSent,
    basketTremor: m.basketTremor,
    scaffoldsPlaced: m.scaffoldsPlaced,
    scaffoldSpend: spentOn('scaffold', s.shop.find((i) => i.id === 'scaffold')!.level),
    restTicks: m.restTicks,
    restRelief: m.restRelief,
    restCount: bot.restCount,
    moneyLeft: s.player.money,
    peakTremorBanked: m.peakTremorBanked,
    finalTRet: bot.tRet,
    raises: bot.raises,
    stalledTick,
    score: m.score,
  };
}

export function summarize(label: string, results: RunResult[]): string {
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  const cleared = results.filter((r) => r.cleared);
  const avgClear = cleared.length ? (cleared.reduce((a, r) => a + r.clearedTick!, 0) / cleared.length).toFixed(0) : '-';
  const withRescue = results.filter((r) => r.rescues > 0).length;
  const stalled = results.filter((r) => r.stalledTick !== null).length;
  return (
    `# ${label} summary: cleared=${cleared.length}/${results.length} stalled=${stalled}/${results.length} avgClearTick=${avgClear} avgMoneyAt10k=${avg((r) => r.moneyAt10k)} ` +
    `avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDepth=${avg((r) => r.maxDepth)} avgOre=${avg((r) => r.oreMined)} ` +
    `avgUpgrades=${avg((r) => r.upgradesBought)} avgTrips=${avg((r) => r.trips)} avgCaveIns=${avg((r) => r.caveIns)} ` +
    `avgRescues=${avg((r) => r.rescues)} seedsWithRescue=${withRescue}/${results.length} avgSpilled=${avg((r) => r.spilledValue)} ` +
    `avgRescueLoss=${avg((r) => r.rescueLoss)} avgTremorBonus=${avg((r) => r.tremorBonusEarned)} avgBaskets=${avg((r) => r.basketsSent)} ` +
    `avgPeakTremor=${avg((r) => r.peakTremorBanked)} avgFinalTRet=${avg((r) => r.finalTRet)} seedsRaised=${results.filter((r) => r.raises > 0).length}/${results.length} ` +
    `avgBasketTremor=${avg((r) => r.basketTremor)} avgScaffolds=${avg((r) => r.scaffoldsPlaced)} avgScaffoldSpend=${avg((r) => r.scaffoldSpend)} ` +
    `seedsRested=${results.filter((r) => r.restCount > 0).length}/${results.length} avgRests=${avg((r) => r.restCount)} avgRestTicks=${avg((r) => r.restTicks)} ` +
    `avgRestRelief=${avg((r) => r.restRelief)} avgMoneyLeft=${avg((r) => r.moneyLeft)}`
  );
}

/** 対比較（024-finalの学び: 同点＝同一のランを分けて数える）。クリア速度（未クリアは最遅扱い）と稼ぎ */
export function pairCompare(a: RunResult[], b: RunResult[]): string {
  let fast = 0, tieT = 0, slow = 0, more = 0, tieM = 0, less = 0;
  for (let i = 0; i < a.length; i++) {
    const ta = a[i].clearedTick ?? Infinity;
    const tb = b[i].clearedTick ?? Infinity;
    if (ta < tb) fast++;
    else if (ta === tb) tieT++;
    else slow++;
    if (a[i].moneyEarned > b[i].moneyEarned) more++;
    else if (a[i].moneyEarned === b[i].moneyEarned) tieM++;
    else less++;
  }
  return `# pair ${a[0].strategy} vs ${b[0].strategy}: clear faster/tie/slower=${fast}/${tieT}/${slow} earned more/tie/less=${more}/${tieM}/${less}`;
}

function parseSeeds(v: string): number[] {
  const m = v.match(/^(\d+)\.\.(\d+)$/);
  if (m) {
    const out: number[] = [];
    for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    return out;
  }
  return v.split(',').map(Number);
}

// ---- CLI ----
const isMain = typeof process !== 'undefined' && process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('headless/simulate.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const argVal = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const seeds = parseSeeds(argVal('seeds') ?? '1..10');
  const noScaffold = args.includes('--noScaffold');
  const strip = (cfg: BotConfig): BotConfig =>
    noScaffold ? { ...cfg, name: `${cfg.name}-noScaffold`, priority: cfg.priority.filter((id) => id !== 'scaffold') } : cfg;
  const maxTicks = Number(argVal('maxTicks') ?? 30000);
  const verbose = args.includes('--verbose');
  console.log(`# Tremorvein headless simulation (shaft ${WIDTH}x${DEPTH - 1}, maxTicks=${maxTicks}, seeds=${seeds.length})`);
  if (args.includes('--sweep')) {
    const std = STRATEGIES.find((s) => s.name === 'standard')!;
    for (let tRet = 20; tRet <= 150; tRet += 10) {
      const cfg = strip({ ...std, name: `sweep-tRet${tRet}`, tRet, hpGuard: 0, adaptive: false });
      const results = seeds.map((seed) => runOne(seed, cfg, maxTicks));
      console.log(summarize(cfg.name, results));
    }
  } else {
    const all = new Map<string, RunResult[]>();
    for (const base of args.includes('--personas') ? PERSONAS : STRATEGIES) {
      const cfg = strip(base);
      const results = seeds.map((seed) => runOne(seed, cfg, maxTicks));
      all.set(base.name, results);
      if (verbose) for (const r of results) console.log(JSON.stringify(r));
      console.log(summarize(cfg.name, results));
    }
    if (!args.includes('--personas')) for (const [x, y] of [
      ['cautious', 'standard'],
      ['standard', 'pusher'],
      ['pusher', 'banker'],
      ['standard', 'banker'],
    ]) {
      console.log(pairCompare(all.get(x)!, all.get(y)!));
    }
  }
}
