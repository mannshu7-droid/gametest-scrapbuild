/**
 * 040-building-braidring のゲームロジック（純TS、描画なし）。
 *
 * 拠点を囲む8つの台座に塔を積み、隣の台座どうしを梁で結ぶ。
 * - 塔は高いほど射程が長い。ただし地盤で決まる「自由長の上限」を超えて積むと、夜の突風で上の段が折れうる
 * - 梁は2塔の低い方の高さに架かり、両塔の自由長をその高さから数え直す（さらに上へ積める）。
 *   梁は拠点を囲む輪の1辺でもあり、横切ろうとする敵を止める（敵は梁を叩いて壊す）
 * - 敵の来る向き（北だけ／北と南／全周）と地盤（岩／土／湿地）が条件。スコアは守りの稼ぎ（撃破報酬−荒らされた額）
 */
import { mulberry32, type Rng } from './rng';
import type { Action, AttackDir, BeamState, EnemyState, GameState, Ground, Metrics, TowerState } from './types';

export const TUNE = {
  dayTicks: 500,
  nightTicks: 500,
  days: 6,
  startGold: 50,
  incomePerTick: 0.1,
  bounty: 5,
  /** 撃破報酬の夜ごとの上乗せ（夜n の報酬 = bounty + bountyPerNight×(n−1)。0=毎夜同じ） */
  bountyPerNight: 0,
  /** 全周（ring）の夜の敵の数の倍率（8方向に散るので塔1本あたりは少ない。1=他の向きと同じ） */
  ringCountMul: 1.5,
  plunder: 15,
  enemyBase: 10,
  enemyPerNight: 4,
  enemyHp0: 3,
  enemyHpPerNight: 2,
  enemySpeed: 0.08,
  spawnWindow: 300,
  spawnR: 9.5,
  /** 射手の割合（出現ごとに抽選） */
  archerShare: 0.15,
  /** 夜ごとの射手の割合の振れ（奇数夜は −、偶数夜は ＋。0=毎夜同じ） */
  archerSwing: 0,
  /** 振れ方: 0=奇数夜は少なく偶数夜は多く、1=夜ごとにシードで抽選、2=ランごとに1回抽選（±archerSwing の一様。2は最初から見える） */
  archerMode: 0,
  /** 射手が止まる拠点からの距離 */
  siegeR: 7,
  /** 湿地での射手の止まる距離（足場が悪く近くに寄る。0=siegeR と同じ） */
  siegeRMarsh: 6,
  archerShotTicks: 20,
  /** 射手の1発で拠点が失う額 */
  archerPlunder: 1,
  /** 射手はこの距離以内に梁があれば梁を撃つ */
  archerBeamReach: 3,
  /** one/two の出現角の幅（ラジアン、片側） */
  spawnSpread: 0.6,
  fireTicks: 10,
  rangeBase: 1.5,
  rangePerH: 0.9,
  baseRange: 2.5,
  raiseBase: 10,
  raisePerH: 3,
  raiseTicks: 20,
  beamBase: 15,
  beamPerH: 3,
  beamTicks: 30,
  beamHpBase: 20,
  beamHpPerH: 5,
  beamHitTicks: 10,
  slenderRock: 5,
  slenderSoil: 4,
  slenderMarsh: 3,
  gustK: 1,
  /** 折れた段が隣の梁に落ちる: 失った1段あたり、両隣の梁の最大耐久のこの割合を削る（0=無し） */
  fallBeamDmg: 0,
  gustMin: 0.6,
  gustMax: 1.4,
  maxH: 12,
};
export type Tune = typeof TUNE;
const DEFAULT_TUNE: Tune = { ...TUNE };

export function setTune(patch: Partial<Tune>): void {
  Object.assign(TUNE, DEFAULT_TUNE, patch);
}

export const W = 17;
export const H = 17;
export const BASE_X = 8;
export const BASE_Y = 8;
/** 台座（時計回り、左上から）。隣どうしは3マス離れ、8辺で拠点を囲む正方形になる */
export const PLOTS: ReadonlyArray<[number, number]> = [
  [5, 5],
  [8, 5],
  [11, 5],
  [11, 8],
  [11, 11],
  [8, 11],
  [5, 11],
  [5, 8],
];
/** 各向きで敵が来る側の台座と辺（ボットと表示用） */
export const FACING: Record<AttackDir, { plots: number[]; edges: number[] }> = {
  one: { plots: [0, 1, 2], edges: [0, 1] },
  two: { plots: [0, 1, 2, 4, 5, 6], edges: [0, 1, 4, 5] },
  ring: { plots: [0, 1, 2, 3, 4, 5, 6, 7], edges: [0, 1, 2, 3, 4, 5, 6, 7] },
};
export const DIRS: AttackDir[] = ['one', 'two', 'ring'];
export const GROUNDS: Ground[] = ['rock', 'soil', 'marsh'];

export interface GameOptions {
  dir?: AttackDir;
  ground?: Ground;
}

export function slenderOf(g: Ground): number {
  return g === 'rock' ? TUNE.slenderRock : g === 'soil' ? TUNE.slenderSoil : TUNE.slenderMarsh;
}
/** 夜n の撃破報酬 */
export function bountyOf(day: number): number {
  return TUNE.bounty + TUNE.bountyPerNight * (day - 1);
}
/** 射手が止まる拠点からの距離（地盤で変わる） */
export function siegeROf(g: Ground): number {
  return g === 'marsh' && TUNE.siegeRMarsh > 0 ? TUNE.siegeRMarsh : TUNE.siegeR;
}
export function rangeOf(h: number): number {
  return h <= 0 ? 0 : TUNE.rangeBase + TUNE.rangePerH * h;
}
export function raiseCost(newH: number): number {
  return TUNE.raiseBase + TUNE.raisePerH * newH;
}
export function beamCost(h: number): number {
  return TUNE.beamBase + TUNE.beamPerH * h;
}

function segCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0) || d1 === 0 || d2 === 0) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export class Game {
  readonly seed: number;
  over = false;
  private s: GameState;
  private spawnRng: Rng;
  private gustRng: Rng;
  private fallRng: Rng;
  private mixRng: Rng;
  private runMix = 0;
  private spawnQueue: Array<{ at: number; x: number; y: number; archer: boolean }> = [];
  private nextId = 1;
  private baseCd = 0;

  constructor(seed: number, opts: GameOptions = {}) {
    this.seed = seed;
    this.spawnRng = mulberry32(seed * 2654435761);
    this.gustRng = mulberry32(seed * 40503 + 17);
    this.fallRng = mulberry32(seed * 97 + 5);
    this.mixRng = mulberry32(seed * 7919 + 3);
    this.runMix = this.mixRng() * 2 - 1;
    // 条件を指定しなければシードで決める（人が遊ぶ時に毎回違う条件になる）
    const dir = opts.dir ?? DIRS[seed % 3];
    const ground = opts.ground ?? GROUNDS[Math.floor(seed / 3) % 3];
    const metrics: Metrics = {
      score: 0,
      gold: TUNE.startGold,
      earned: 0,
      income: 0,
      bounty: 0,
      spent: 0,
      plunder: 0,
      arrowLoss: 0,
      kills: 0,
      leaks: 0,
      fled: 0,
      spawned: 0,
      collapses: 0,
      lostLevels: 0,
      beamBreaks: 0,
      beamsBuilt: 0,
      raises: 0,
      heldTicks: 0,
      maxH: 0,
      sumH: 0,
    };
    const towers: TowerState[] = PLOTS.map(([x, y], id) => ({ id, x, y, h: 0, beamTop: 0, free: 0, over: 0, range: 0, cooldown: 0, aim: -Math.PI / 2 }));
    const beams: BeamState[] = PLOTS.map((_, edge) => ({ edge, a: edge, b: (edge + 1) % 8, h: 0, hp: 0, maxHp: 0 }));
    this.s = {
      tick: 0,
      maxTicks: (TUNE.dayTicks + TUNE.nightTicks) * TUNE.days,
      seed,
      day: 1,
      night: false,
      phaseLeft: TUNE.dayTicks,
      dir,
      ground,
      archerShare: TUNE.archerMode === 2 ? Math.max(0, Math.min(1, TUNE.archerShare + TUNE.archerSwing * this.runMix)) : TUNE.archerShare,
      slender: slenderOf(ground),
      gold: TUNE.startGold,
      player: { x: BASE_X, y: BASE_Y + 1, busy: 0, busyKind: '', busyTarget: -1, moveCd: 0, face: 1 },
      towers,
      beams,
      enemies: [],
      toSpawn: 0,
      gustIn: -1,
      events: [],
      over: false,
      metrics,
      w: W,
      h: H,
      baseX: BASE_X,
      baseY: BASE_Y,
    };
  }

  getState(): GameState {
    return JSON.parse(JSON.stringify(this.s)) as GameState;
  }

  /** ボット用: コピーせずに読む（書き換えないこと） */
  peek(): Readonly<GameState> {
    return this.s;
  }

  private log(msg: string): void {
    const ev = this.s.events;
    ev.push(`${(this.s.tick / 10).toFixed(0)}s ${msg}`);
    if (ev.length > 8) ev.shift();
  }

  /** プレイヤーの隣（チェビシェフ1以内）の台座 */
  adjacentPlot(): number {
    const p = this.s.player;
    for (let i = 0; i < PLOTS.length; i++) {
      const [x, y] = PLOTS[i];
      if (Math.abs(x - p.x) <= 1 && Math.abs(y - p.y) <= 1) return i;
    }
    return -1;
  }

  private refreshTowers(): void {
    const s = this.s;
    for (const t of s.towers) t.beamTop = 0;
    for (const b of s.beams) {
      if (b.h <= 0) continue;
      s.towers[b.a].beamTop = Math.max(s.towers[b.a].beamTop, b.h);
      s.towers[b.b].beamTop = Math.max(s.towers[b.b].beamTop, b.h);
    }
    let maxH = 0;
    let sumH = 0;
    for (const t of s.towers) {
      t.free = t.h - t.beamTop;
      t.over = Math.max(0, t.free - s.slender);
      t.range = rangeOf(t.h);
      maxH = Math.max(maxH, t.h);
      sumH += t.h;
    }
    s.metrics.maxH = Math.max(s.metrics.maxH, maxH);
    s.metrics.sumH = sumH;
  }

  /** 自由長の上限を超えた塔を、強さ k で折る判定 */
  private collapseCheck(t: TowerState, k: number, why: string): void {
    if (t.over <= 0) return;
    const p = Math.min(1, TUNE.gustK * t.over * k);
    if (this.fallRng() >= p) return;
    const keep = t.beamTop + this.s.slender;
    const lost = t.h - keep;
    t.h = keep;
    this.s.metrics.collapses++;
    this.s.metrics.lostLevels += lost;
    this.log(`${why}で塔${t.id + 1}が折れた（−${lost}段）`);
    this.refreshTowers();
    if (TUNE.fallBeamDmg > 0) {
      for (const e of [t.id, (t.id + 7) % 8]) {
        const b = this.s.beams[e];
        if (b.h <= 0) continue;
        b.hp -= Math.ceil(b.maxHp * TUNE.fallBeamDmg * lost);
        if (b.hp <= 0) this.breakBeam(b);
      }
    }
  }

  private pay(cost: number): void {
    this.s.gold -= cost;
    this.s.metrics.spent += cost;
  }

  private startNight(): void {
    const s = this.s;
    const n = s.day;
    const base = TUNE.enemyBase + TUNE.enemyPerNight * (n - 1);
    const count = s.dir === 'ring' ? Math.round(base * TUNE.ringCountMul) : base;
    const q: Array<{ at: number; x: number; y: number; archer: boolean }> = [];
    const u = TUNE.archerMode === 2 ? this.runMix : TUNE.archerMode === 1 ? this.mixRng() * 2 - 1 : n % 2 === 1 ? -1 : 1;
    const share = Math.max(0, Math.min(1, TUNE.archerShare + TUNE.archerSwing * u));
    s.archerShare = share;
    for (let i = 0; i < count; i++) {
      const at = Math.floor((TUNE.spawnWindow * i) / count + this.spawnRng() * (TUNE.spawnWindow / count));
      let ang: number;
      const off = (this.spawnRng() * 2 - 1) * TUNE.spawnSpread;
      const r = this.spawnRng();
      const archer = this.spawnRng() < share;
      if (s.dir === 'one') ang = -Math.PI / 2 + off;
      else if (s.dir === 'two') ang = (i % 2 === 0 ? -Math.PI / 2 : Math.PI / 2) + off;
      else ang = r * Math.PI * 2;
      q.push({ at, x: BASE_X + Math.cos(ang) * TUNE.spawnR, y: BASE_Y + Math.sin(ang) * TUNE.spawnR, archer });
    }
    this.spawnQueue = q;
    s.toSpawn = count;
    s.gustIn = 50 + Math.floor(this.gustRng() * (TUNE.nightTicks - 100));
    this.gustK = TUNE.gustMin + this.gustRng() * (TUNE.gustMax - TUNE.gustMin);
    this.log(`夜${n}: 敵${count}体（${s.dir === 'one' ? '北' : s.dir === 'two' ? '北と南' : '全周'}）`);
  }
  private gustK = 1;

  private endNight(): void {
    const s = this.s;
    if (s.enemies.length > 0) {
      s.metrics.fled += s.enemies.length;
      this.log(`夜明け: ${s.enemies.length}体が逃げた`);
    }
    s.enemies = [];
    this.spawnQueue = [];
    s.toSpawn = 0;
    s.gustIn = -1;
  }

  private doAction(a: Action): void {
    const s = this.s;
    const p = s.player;
    if (p.busy > 0) return;
    if (a.type === 'move') {
      if (p.moveCd > 0) return;
      const dx = a.dir === 'left' ? -1 : a.dir === 'right' ? 1 : 0;
      const dy = a.dir === 'up' ? -1 : a.dir === 'down' ? 1 : 0;
      p.x = Math.max(0, Math.min(W - 1, p.x + dx));
      p.y = Math.max(0, Math.min(H - 1, p.y + dy));
      if (dx !== 0) p.face = dx;
      p.moveCd = 1;
      return;
    }
    if (a.type === 'raise') {
      const i = this.adjacentPlot();
      if (i < 0) return;
      const t = s.towers[i];
      if (t.h >= TUNE.maxH) return;
      const cost = raiseCost(t.h + 1);
      if (s.gold < cost) return;
      this.pay(cost);
      p.busy = TUNE.raiseTicks;
      p.busyKind = 'raise';
      p.busyTarget = i;
      return;
    }
    if (a.type === 'beam') {
      const i = this.adjacentPlot();
      if (i < 0) return;
      const edge = a.side === 'cw' ? i : (i + 7) % 8;
      const b = s.beams[edge];
      const bh = Math.min(s.towers[b.a].h, s.towers[b.b].h);
      if (bh <= 0) return;
      if (!(bh > b.h || (bh === b.h && b.hp < b.maxHp))) return;
      const cost = beamCost(bh);
      if (s.gold < cost) return;
      this.pay(cost);
      p.busy = TUNE.beamTicks;
      p.busyKind = 'beam';
      p.busyTarget = edge;
    }
  }

  private finishWork(): void {
    const s = this.s;
    const p = s.player;
    if (p.busyKind === 'raise') {
      const t = s.towers[p.busyTarget];
      if (t.h < TUNE.maxH) {
        t.h++;
        s.metrics.raises++;
      }
    } else if (p.busyKind === 'beam') {
      const b = s.beams[p.busyTarget];
      const bh = Math.min(s.towers[b.a].h, s.towers[b.b].h);
      if (bh > 0 && bh >= b.h) {
        b.h = bh;
        b.maxHp = TUNE.beamHpBase + TUNE.beamHpPerH * bh;
        b.hp = b.maxHp;
        s.metrics.beamsBuilt++;
      }
    }
    p.busyKind = '';
    p.busyTarget = -1;
    this.refreshTowers();
  }

  private breakBeam(b: BeamState): void {
    const s = this.s;
    this.log(`梁${b.edge + 1}（高さ${b.h}）が壊された`);
    b.h = 0;
    b.hp = 0;
    b.maxHp = 0;
    s.metrics.beamBreaks++;
    for (const e of s.enemies) if (e.holdEdge === b.edge) e.holdEdge = -1;
    this.refreshTowers();
    // 梁が落ちると両塔の自由長が伸びる。上限を超えたらその場で折れうる（突風と同じ強さ1で判定）
    this.collapseCheck(s.towers[b.a], 1, '梁の落下');
    this.collapseCheck(s.towers[b.b], 1, '梁の落下');
  }

  /** 射手の1発: 近くに梁があれば梁を、無ければ拠点を撃つ */
  private archerShot(e: EnemyState): void {
    const s = this.s;
    let best: BeamState | null = null;
    let bestD = TUNE.archerBeamReach;
    for (const b of s.beams) {
      if (b.h <= 0) continue;
      const mx = (PLOTS[b.a][0] + PLOTS[b.b][0]) / 2;
      const my = (PLOTS[b.a][1] + PLOTS[b.b][1]) / 2;
      const d = Math.hypot(mx - e.x, my - e.y);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    e.shotAt = s.tick;
    e.shotEdge = best ? best.edge : -1;
    if (best) {
      best.hp -= 1;
      if (best.hp <= 0) this.breakBeam(best);
      return;
    }
    s.gold -= TUNE.archerPlunder;
    s.metrics.plunder += TUNE.archerPlunder;
    s.metrics.arrowLoss += TUNE.archerPlunder;
  }

  private kill(): void {
    const m = this.s.metrics;
    m.kills++;
    const v = bountyOf(this.s.day);
    m.bounty += v;
    m.earned += v;
    this.s.gold += v;
  }

  private shoot(x: number, y: number, range: number): EnemyState | null {
    let best: EnemyState | null = null;
    let bestD = Infinity;
    const r2 = range * range;
    for (const e of this.s.enemies) {
      if (e.hp <= 0) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      const db = (e.x - BASE_X) ** 2 + (e.y - BASE_Y) ** 2;
      if (db < bestD) {
        bestD = db;
        best = e;
      }
    }
    if (best) {
      best.hp -= 1;
      if (best.hp <= 0) this.kill();
    }
    return best;
  }

  step(action: Action = { type: 'wait' }): void {
    if (this.over) return;
    const s = this.s;
    const p = s.player;
    // 昼夜
    const cyc = TUNE.dayTicks + TUNE.nightTicks;
    const inCyc = s.tick % cyc;
    if (inCyc === 0) {
      s.day = Math.floor(s.tick / cyc) + 1;
      s.night = false;
    } else if (inCyc === TUNE.dayTicks) {
      s.night = true;
      this.startNight();
    }
    s.phaseLeft = s.night ? cyc - inCyc : TUNE.dayTicks - inCyc;

    // 入力と作業
    if (p.moveCd > 0) p.moveCd--;
    if (p.busy > 0) {
      p.busy--;
      if (p.busy === 0) this.finishWork();
    } else {
      this.doAction(action);
    }

    // 収入
    s.gold += TUNE.incomePerTick;
    s.metrics.income += TUNE.incomePerTick;
    s.metrics.earned += TUNE.incomePerTick;

    if (s.night) {
      const nt = inCyc - TUNE.dayTicks;
      // 出現
      while (this.spawnQueue.length && this.spawnQueue[0].at <= nt) {
        const q = this.spawnQueue.shift()!;
        const hp = TUNE.enemyHp0 + TUNE.enemyHpPerNight * (s.day - 1);
        s.enemies.push({ id: this.nextId++, kind: q.archer ? 'archer' : 'walker', siege: false, x: q.x, y: q.y, hp, maxHp: hp, holdEdge: -1, hitCd: q.archer ? TUNE.archerShotTicks : TUNE.beamHitTicks, shotAt: -1, shotEdge: -1 });
        s.metrics.spawned++;
        s.toSpawn--;
      }
      // 突風
      if (s.gustIn >= 0 && nt === s.gustIn) {
        this.log(`突風（強さ${this.gustK.toFixed(2)}）`);
        for (const t of s.towers) this.collapseCheck(t, this.gustK, '突風');
        s.gustIn = -1;
      }
      // 敵の移動と梁
      for (const e of s.enemies) {
        if (e.hp <= 0) continue;
        if (e.holdEdge >= 0) {
          s.metrics.heldTicks++;
          const b = s.beams[e.holdEdge];
          if (b.h <= 0) {
            e.holdEdge = -1;
            continue;
          }
          if (--e.hitCd <= 0) {
            e.hitCd = TUNE.beamHitTicks;
            b.hp -= 1;
            if (b.hp <= 0) this.breakBeam(b);
          }
          continue;
        }
        if (e.siege) {
          if (--e.hitCd <= 0) {
            e.hitCd = TUNE.archerShotTicks;
            this.archerShot(e);
          }
          continue;
        }
        const dx = BASE_X - e.x;
        const dy = BASE_Y - e.y;
        const d = Math.hypot(dx, dy);
        if (e.kind === 'archer' && d <= siegeROf(s.ground)) {
          e.siege = true;
          continue;
        }
        if (d < 0.6) {
          // 払えない分は借り（所持金がマイナスになる＝建てられない）
          const st = TUNE.plunder;
          s.gold -= st;
          s.metrics.plunder += st;
          s.metrics.leaks++;
          e.hp = 0;
          e.maxHp = -1; // 盗んで消えた印
          this.log('拠点が荒らされた');
          continue;
        }
        const nx = e.x + (dx / d) * TUNE.enemySpeed;
        const ny = e.y + (dy / d) * TUNE.enemySpeed;
        let blocked = -1;
        for (const b of s.beams) {
          if (b.h <= 0) continue;
          const [ax, ay] = PLOTS[b.a];
          const [bx, by] = PLOTS[b.b];
          if (segCross(e.x, e.y, nx, ny, ax, ay, bx, by)) {
            blocked = b.edge;
            break;
          }
        }
        if (blocked >= 0) {
          e.holdEdge = blocked;
          e.hitCd = TUNE.beamHitTicks;
        } else {
          e.x = nx;
          e.y = ny;
        }
      }
      // 射撃
      for (const t of s.towers) {
        if (t.h <= 0) continue;
        if (t.cooldown > 0) {
          t.cooldown--;
          continue;
        }
        const tg = this.shoot(t.x, t.y, t.range);
        if (tg) {
          t.cooldown = TUNE.fireTicks - 1;
          t.aim = Math.atan2(tg.y - t.y, tg.x - t.x);
        }
      }
      if (this.baseCd > 0) this.baseCd--;
      else if (this.shoot(BASE_X, BASE_Y, TUNE.baseRange)) this.baseCd = TUNE.fireTicks - 1;
      s.enemies = s.enemies.filter((e) => e.hp > 0);
      if (inCyc === cyc - 1) this.endNight();
    }

    s.tick++;
    s.metrics.gold = s.gold;
    // スコア = 守りの稼ぎ（撃破報酬 − 荒らされた額）。所持金の残りは数えない（お金は建てるためのもの）
    s.metrics.score = Math.round(s.metrics.bounty - s.metrics.plunder);
    if (s.tick >= s.maxTicks) {
      this.over = true;
      s.over = true;
    }
  }
}
