import { mulberry32, type Rng } from './rng';
import type { Action, Busy, CaveInEvent, Cell, GameState, Metrics } from './types';

/**
 * 調整値。simulate の --tune key=value で上書きできる（setTune）。
 * 単位: 揺れは0〜100、時間はtick（10tick=1秒）
 */
export const TUNE = {
  timeLimit: 6000,
  length: 60,
  maxHp: 100,
  /** 拠点の外で揺れがたまる速さ（1tickあたり）= baseRate + depthRate×x */
  baseRate: 0.02,
  depthRate: 0.0015,
  /** 掘り出している間の上乗せ */
  workRate: 0.02,
  /** 帰り道で1マス動くごとに上がる揺れ（支えのないマス／支えられたマス） */
  stepCost: 0.45,
  stepCostSupported: 0.12,
  /** 揺れの波: 0〜waveAmp を wavePeriod tick で往復 */
  waveAmp: 14,
  wavePeriod: 160,
  /** 余震: 1tickに spikeChance で spikeMin〜spikeMax 上がり、1tickごとに×spikeDecay で引く */
  spikeChance: 0.008,
  spikeMin: 4,
  spikeMax: 10,
  spikeDecay: 0.99,
  /** 支えの下では波と余震が×supportDamp */
  supportDamp: 0.35,
  /** 支柱は前後 propReach マスを支える */
  propReach: 2,
  propCostBase: 20,
  propCostStep: 3,
  propTicks: 15,
  scaffoldCost: 40,
  scaffoldTicks: 25,
  /** 足場の上で休むと base が1tickに restRelief 下がり、余震が×restSpikeDecay で引く */
  restRelief: 0.35,
  restSpikeDecay: 0.95,
  /** 足場のマスでは波と余震が×scaffoldDamp（支柱の下と重なれば小さい方） */
  scaffoldDamp: 0.35,
  /** 1: 足場で休んだら、その遠征はもう掘れない（休み＝帰還の宣言） */
  restCommit: 1,
  /** 1: 足場の上では帰着線が危険線に届くと、掘る手が止まり休みになる */
  autoRest: 0,
  caution: 35,
  danger: 45,
  /** 落盤: 揺れ>caveFrom で 1tickに caveK×(揺れ−caveFrom)² */
  caveFrom: 25,
  caveK: 0.00002,
  /** 支えのないマスの落盤は×caveBareMul */
  caveBareMul: 2,
  caveDamage: 35,
  caveCargoLoss: 1 / 3,
  caveRelief: 8,
  /** 落盤のとき、そのマスを支える支柱が折れる確率 */
  propBreakChance: 0.5,
  rescueTicks: 100,
  /** 収入: (incomeBase + incomeDepth×x) × (1 + 揺れ/incomeTremor) */
  incomeBase: 0.3,
  incomeDepth: 0.02,
  incomeTremor: 60,
};
export type Tune = typeof TUNE;
const DEFAULT_TUNE: Tune = { ...TUNE };

export function setTune(over: Partial<Tune>): void {
  Object.assign(TUNE, DEFAULT_TUNE, over);
}

export class Game {
  readonly seed: number;
  private rng: Rng;
  tick = 0;
  over = false;
  x = 0;
  hp: number;
  money = 0;
  cargo = 0;
  busy: Busy | null = null;
  moveCd = 0;
  base = 0;
  spike = 0;
  private wavePhase: number;
  props: boolean[];
  scaffolds: boolean[];
  propsStanding = 0;
  lastCaveIn: CaveInEvent | null = null;
  private wasOver = false;
  /** この遠征で足場に休んだか（restCommit のとき掘れない） */
  committed = false;
  private restedThisTick = false;
  metrics: Metrics = {
    moneyEarned: 0,
    moneySpent: 0,
    trips: 0,
    workTicks: 0,
    maxDepth: 0,
    propsBuilt: 0,
    propsBroken: 0,
    scaffoldsBuilt: 0,
    restTicks: 0,
    restRelief: 0,
    caveIns: 0,
    caveInLost: 0,
    rescues: 0,
    rescueLost: 0,
    overLineTicks: 0,
    lineCrossings: 0,
    supportedSteps: 0,
    bareSteps: 0,
    peakTremorBanked: 0,
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed * 2654435761);
    this.hp = TUNE.maxHp;
    this.wavePhase = this.rng() * Math.PI * 2;
    this.props = new Array(TUNE.length + 1).fill(false);
    this.scaffolds = new Array(TUNE.length + 1).fill(false);
  }

  supported(x: number): boolean {
    if (x <= 0) return false;
    for (let i = Math.max(1, x - TUNE.propReach); i <= Math.min(TUNE.length, x + TUNE.propReach); i++) {
      if (this.props[i]) return true;
    }
    return false;
  }

  wave(): number {
    return (TUNE.waveAmp * (1 + Math.sin((2 * Math.PI * this.tick) / TUNE.wavePeriod + this.wavePhase))) / 2;
  }

  /** 揺れの上下する成分（波＋余震）に掛ける係数 */
  damp(x: number): number {
    const s = this.supported(x) ? TUNE.supportDamp : 1;
    return this.scaffolds[x] ? Math.min(s, TUNE.scaffoldDamp) : s;
  }

  tremor(): number {
    if (this.x <= 0) return 0;
    return this.base + this.damp(this.x) * (this.wave() + this.spike);
  }

  rate(x: number): number {
    return TUNE.baseRate + TUNE.depthRate * x;
  }

  /** 帰り道のコスト: x から拠点まで、1マスごとの揺れ＋歩く2tickの間にたまる揺れ */
  returnCost(): number {
    let c = 0;
    for (let i = this.x; i >= 1; i--) {
      c += (this.supported(i) ? TUNE.stepCostSupported : TUNE.stepCost) + 2 * this.rate(i);
    }
    return c;
  }

  returnLine(): number {
    if (this.x <= 0) return 0;
    return this.tremor() + this.returnCost();
  }

  propCost(): number {
    return TUNE.propCostBase + TUNE.propCostStep * this.propsStanding;
  }

  caveChance(): number {
    const t = this.tremor();
    if (t <= TUNE.caveFrom) return 0;
    return TUNE.caveK * (this.supported(this.x) ? 1 : TUNE.caveBareMul) * (t - TUNE.caveFrom) ** 2;
  }

  step(action: Action): void {
    if (this.over) return;
    this.tick++;
    if (this.moveCd > 0) this.moveCd--;

    if (this.busy) {
      this.busy.remaining--;
      if (this.busy.remaining <= 0) {
        const kind = this.busy.kind;
        this.busy = null;
        if (kind === 'prop') {
          this.props[this.x] = true;
          this.propsStanding++;
          this.metrics.propsBuilt++;
        } else if (kind === 'scaffold') {
          this.scaffolds[this.x] = true;
          this.metrics.scaffoldsBuilt++;
        }
      }
    } else {
      this.act(action);
    }

    this.ambient();
    this.finishTick();
  }

  private act(action: Action): void {
    if (action.type === 'work' && TUNE.autoRest && this.x > 0 && this.scaffolds[this.x] && this.returnLine() >= TUNE.danger) {
      action = { type: 'wait' };
    }
    switch (action.type) {
      case 'move': {
        if (this.moveCd > 0) return;
        const nx = this.x + (action.dir === 'right' ? 1 : -1);
        if (nx < 0 || nx > TUNE.length) return;
        // 帰り道（拠点へ向かう1マス）だけ揺れが上がる。出発側のマスが支えられていれば小さい
        const sup = this.supported(this.x);
        if (action.dir === 'left' && this.x > 0) {
          this.base += sup ? TUNE.stepCostSupported : TUNE.stepCost;
          if (sup) this.metrics.supportedSteps++;
          else this.metrics.bareSteps++;
        }
        if (this.x === 0 && nx > 0) this.metrics.trips++;
        this.x = nx;
        this.moveCd = 1;
        if (this.x > this.metrics.maxDepth) this.metrics.maxDepth = this.x;
        if (this.x === 0) this.arriveHome();
        return;
      }
      case 'work': {
        if (this.x <= 0 || this.committed) return;
        const inc = (TUNE.incomeBase + TUNE.incomeDepth * this.x) * (1 + this.tremor() / TUNE.incomeTremor);
        this.cargo += inc;
        this.base += TUNE.workRate;
        this.metrics.workTicks++;
        return;
      }
      case 'prop': {
        if (this.x <= 0 || this.props[this.x]) return;
        const cost = this.propCost();
        if (this.money < cost) return;
        this.money -= cost;
        this.metrics.moneySpent += cost;
        this.busy = { kind: 'prop', remaining: TUNE.propTicks, total: TUNE.propTicks };
        return;
      }
      case 'scaffold': {
        if (this.x <= 0 || this.scaffolds[this.x]) return;
        if (this.money < TUNE.scaffoldCost) return;
        this.money -= TUNE.scaffoldCost;
        this.metrics.moneySpent += TUNE.scaffoldCost;
        this.busy = { kind: 'scaffold', remaining: TUNE.scaffoldTicks, total: TUNE.scaffoldTicks };
        return;
      }
      case 'wait': {
        if (this.x > 0 && this.scaffolds[this.x]) {
          const r = Math.min(this.base, TUNE.restRelief);
          this.base -= r;
          this.spike *= TUNE.restSpikeDecay;
          this.metrics.restTicks++;
          this.restedThisTick = true;
          this.metrics.restRelief += r;
          if (TUNE.restCommit) this.committed = true;
        }
        return;
      }
    }
  }

  /** 拠点の外で揺れがたまり、余震が起き、落盤を判定する */
  private ambient(): void {
    const resting = this.restedThisTick;
    this.restedThisTick = false;
    if (this.x <= 0 || this.busy?.kind === 'rescue') return;
    if (!resting) this.base += this.rate(this.x);
    this.spike *= TUNE.spikeDecay;
    if (this.rng() < TUNE.spikeChance) {
      this.spike += TUNE.spikeMin + this.rng() * (TUNE.spikeMax - TUNE.spikeMin);
    }
    if (this.rng() < this.caveChance()) this.caveIn();
  }

  private caveIn(): void {
    const lost = this.cargo * TUNE.caveCargoLoss;
    this.cargo -= lost;
    this.hp -= TUNE.caveDamage;
    this.base = Math.max(0, this.base - TUNE.caveRelief);
    this.spike = 0;
    this.metrics.caveIns++;
    this.metrics.caveInLost += lost;
    let propBroken = false;
    let brokenX = -1;
    if (this.supported(this.x)) {
      // 一番近い支柱が折れることがある
      let best = -1;
      for (let d = 0; d <= TUNE.propReach && best < 0; d++) {
        if (this.props[this.x - d]) best = this.x - d;
        else if (this.x + d <= TUNE.length && this.props[this.x + d]) best = this.x + d;
      }
      if (best > 0 && this.rng() < TUNE.propBreakChance) {
        this.props[best] = false;
        this.propsStanding--;
        this.metrics.propsBroken++;
        propBroken = true;
        brokenX = best;
      }
    }
    const rescued = this.hp <= 0;
    this.lastCaveIn = { tick: this.tick, x: this.x, damage: TUNE.caveDamage, lostValue: lost, propBroken, brokenX, rescued };
    if (rescued) {
      this.metrics.rescues++;
      this.metrics.rescueLost += this.cargo;
      this.cargo = 0;
      this.x = 0;
      this.arriveHome();
      this.busy = { kind: 'rescue', remaining: TUNE.rescueTicks, total: TUNE.rescueTicks };
    }
  }

  private arriveHome(): void {
    if (this.cargo > 0) {
      const v = Math.floor(this.cargo);
      this.money += v;
      this.metrics.moneyEarned += v;
      this.metrics.peakTremorBanked = Math.max(this.metrics.peakTremorBanked, this.base + this.spike);
    }
    this.cargo = 0;
    this.base = 0;
    this.spike = 0;
    this.hp = TUNE.maxHp;
    this.committed = false;
  }

  private finishTick(): void {
    const line = this.returnLine();
    const over = this.x > 0 && line >= TUNE.caution;
    if (over) this.metrics.overLineTicks++;
    if (over && !this.wasOver) this.metrics.lineCrossings++;
    this.wasOver = over;
    this.metrics.score = this.money;
    if (this.tick >= TUNE.timeLimit) this.over = true;
  }

  getState(): GameState {
    const cells: Cell[] = [];
    for (let i = 0; i <= TUNE.length; i++) {
      cells.push({ x: i, prop: this.props[i], scaffold: this.scaffolds[i], supported: this.supported(i), damp: i > 0 ? this.damp(i) : 0 });
    }
    const t = this.tremor();
    const d = this.x > 0 ? this.damp(this.x) : 0;
    return {
      tick: this.tick,
      timeLimit: TUNE.timeLimit,
      over: this.over,
      seed: this.seed,
      player: {
        x: this.x,
        hp: this.hp,
        maxHp: TUNE.maxHp,
        money: this.money,
        cargo: this.cargo,
        busy: this.busy ? { ...this.busy } : null,
        committed: this.committed,
      },
      tremor: {
        value: t,
        base: this.x > 0 ? this.base : 0,
        wave: d * this.wave(),
        spike: d * this.spike,
        returnLine: this.returnLine(),
        returnCost: this.x > 0 ? this.returnCost() : 0,
        caution: TUNE.caution,
        danger: TUNE.danger,
        caveChance: this.caveChance(),
      },
      tunnel: { length: TUNE.length, cells },
      nextPropCost: this.propCost(),
      scaffoldCost: TUNE.scaffoldCost,
      lastCaveIn: this.lastCaveIn ? { ...this.lastCaveIn } : null,
      metrics: { ...this.metrics },
    };
  }
}
