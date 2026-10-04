import { mulberry32, type Rng } from './rng';
import {
  TILE,
  type Action,
  type CargoItem,
  type CaveInEvent,
  type Digging,
  type Dir,
  type GameState,
  type Metrics,
  type Phase,
  type ShopItemState,
  type TileId,
  type UpgradeId,
} from './types';

/**
 * 025-mining-tremorvein のコアロジック（描画から完全分離・決定論）。
 *
 * 主題は「リスクとリターンの連続的なカーブ」。017-forkshaftの燃料（帰れるか帰れないかが確定的に決まる）を捨て、
 * 1本のダイヤル「揺れ（tremor）」に長所と短所を両方結びつけた:
 * - 揺れは地下にいる間たまり続け、深いほど速くたまる（地上で0に戻る）
 * - 揺れが高いほど、その瞬間に掘った鉱石の売値が上がる（最大+60%）
 * - 揺れが高いほど、毎tick落盤しやすくなる。落盤は「HPダメージ＋積荷の1/3を落とす＋揺れが少し収まる」で、
 *   即死ではない。HPが0になると地上へ引き上げられ、積荷全損＋所持金の15%を救助費として失う（ゲームは続く）
 * - 送り籠（basket）で積荷を8割の値で途中換金でき、粘る前に一部を確定させられる（部分的な回収点）。
 *   v0.2.0: 籠を下ろす振動で揺れ+10（v1で籠が代償なしに強すぎた）
 * - v0.2.0: 足場（scaffold）を買って地下に据えると、その上で掘らずにいる間は揺れが毎tick下がる
 *   （途中の回収点。休むほど安全になるが、売値ボーナスも下がり、時間も使う）。強化を買い切った後のお金の行き先
 * - v0.3.0: 核石を抱えている間は揺れのたまる速さが3倍（核石が岩盤を鳴らす）。最終目標の帰り道を揺れのダイヤルの
 *   山場にし、核石に届く閾値で潜る攻める遊び方にも「深い足場で一度下ろす」意味を作る（v2重大#1・#2）
 */

export const WIDTH = 9;
export const DEPTH = 121; // y=0が地上、y=120が最深部
export const START_X = 4;
export const CORE_X = 4;
export const CORE_Y = DEPTH - 1;

export const TREMOR_CAP = 150;
export const TREMOR_BONUS_MAX = 0.6;
export const TREMOR_BONUS_FULL_AT = 100;
export const CAVEIN_THRESHOLD = 20;
export const CAVEIN_COEF = 0.00035;
export const CAVEIN_RELIEF = 20;
export const DIG_TREMOR_MULT = 1.5;
export const BRACE_REDUCTION = 0.12;
export const BASKET_RATE = 0.8;
/** 送り籠を下ろす振動で上がる揺れ */
export const BASKET_TREMOR = 10;
/** 足場の上で掘らずにいる間、1tickに下がる揺れ */
export const SCAFFOLD_RELIEF = 1.5;
/** 足場を据えられる最も浅い深さ */
export const SCAFFOLD_MIN_Y = 10;
/** 核石を抱えている間の揺れのたまる速さの倍率 */
export const CORE_TREMOR_MULT = 3;
export const RESCUE_FEE_RATE = 0.15;
export const BASE_HP = 60;
export const HP_PER_LEVEL = 20;
export const BASE_CAPACITY = 6;
export const CAPACITY_PER_LEVEL = 3;

export const ORE_VALUE: Record<number, number> = {
  [TILE.ORE_COPPER]: 4,
  [TILE.ORE_IRON]: 10,
  [TILE.ORE_GOLD]: 24,
  [TILE.ORE_CRYSTAL]: 55,
  [TILE.CORE]: 400,
};

export function isOre(t: number): boolean {
  return t === TILE.ORE_COPPER || t === TILE.ORE_IRON || t === TILE.ORE_GOLD || t === TILE.ORE_CRYSTAL || t === TILE.CORE;
}

/** 深さyで1tickあたりにたまる揺れ（支保Lv0） */
export function baseTremorRate(y: number): number {
  if (y <= 0) return 0;
  return 0.04 + 0.3 * (y / 40) * (y / 40);
}

export function tremorRate(y: number, braceLv: number): number {
  return baseTremorRate(y) * (1 - BRACE_REDUCTION * braceLv);
}

/** 揺れTのときの1tickあたりの落盤確率 */
export function caveInProb(t: number): number {
  if (t < CAVEIN_THRESHOLD) return 0;
  const k = (t - CAVEIN_THRESHOLD) / 10;
  return CAVEIN_COEF * k * k;
}

export function caveInChanceOver(t: number, ticks: number): number {
  return 1 - Math.pow(1 - caveInProb(t), ticks);
}

export function caveInDamageAt(y: number): number {
  return Math.round(12 + y * 0.3);
}

export function tremorBonus(t: number): number {
  return (Math.min(t, TREMOR_BONUS_FULL_AT) / TREMOR_BONUS_FULL_AT) * TREMOR_BONUS_MAX;
}

/** タイルの硬さ（深いほど硬い）。採掘tick = ceil(硬さ / ドリル威力) */
export function hardness(t: number, y: number): number {
  if (t === TILE.DIRT) return 1 + y / 30;
  return 2 + y / 14;
}

export function digTicks(t: number, y: number, drillPower: number): number {
  return Math.max(1, Math.ceil(hardness(t, y) / drillPower));
}

interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  growth: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'drill', name: 'ドリル', desc: '威力+1（深い岩を速く掘れる＝揺れの中にいる時間が減る）', maxLevel: 7, baseCost: 15, growth: 1.6 },
  { id: 'hp', name: '防護服', desc: '最大HP+20（落盤に何回耐えられるか）', maxLevel: 6, baseCost: 12, growth: 1.55 },
  { id: 'brace', name: '支保', desc: '揺れのたまる速さ-12%（同じ揺れでより深く・長く）', maxLevel: 5, baseCost: 20, growth: 1.7 },
  { id: 'capacity', name: '背負子', desc: '積荷+3', maxLevel: 6, baseCost: 10, growth: 1.5 },
  { id: 'winch', name: '巻き上げ機', desc: '巻き上げ（H）で掘った縦穴を1tickに+1マス多く上れる（帰り道の揺れが減る）', maxLevel: 3, baseCost: 30, growth: 1.8 },
  { id: 'basket', name: '送り籠', desc: '潜行ごとの籠+1（8割で途中換金、揺れ+10）', maxLevel: 3, baseCost: 25, growth: 1.8 },
  { id: 'scaffold', name: '足場', desc: '地下に据える（P）。上で休むと揺れが下がる', maxLevel: 3, baseCost: 260, growth: 1.85 },
];

export function upgradeCost(def: UpgradeDef, level: number): number | null {
  if (level >= def.maxLevel) return null;
  return Math.round(def.baseCost * Math.pow(def.growth, level));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function generateMap(rng: Rng): number[] {
  const tiles: number[] = new Array(WIDTH * DEPTH).fill(TILE.FLOOR);
  for (let y = 1; y < DEPTH; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const r = rng();
      const oreProb = 0.12 + y * 0.0012;
      let t: number;
      if (r < oreProb) {
        // 深さに応じて連続的に鉱石の質が上がる（バンドの段差を作らない）
        const w = [
          Math.max(0.15, 1 - y / 80),
          clamp01((y - 8) / 25),
          clamp01((y - 30) / 35) * 0.8,
          clamp01((y - 60) / 40) * 0.6,
        ];
        const sum = w[0] + w[1] + w[2] + w[3];
        let pick = rng() * sum;
        const ores = [TILE.ORE_COPPER, TILE.ORE_IRON, TILE.ORE_GOLD, TILE.ORE_CRYSTAL];
        t = ores[3];
        for (let i = 0; i < 4; i++) {
          if (pick < w[i]) {
            t = ores[i];
            break;
          }
          pick -= w[i];
        }
      } else {
        const rockProb = 0.2 + y * 0.005;
        t = rng() < rockProb ? TILE.ROCK : TILE.DIRT;
      }
      tiles[y * WIDTH + x] = t;
    }
  }
  tiles[CORE_Y * WIDTH + CORE_X] = TILE.CORE;
  return tiles;
}

function emptyMetrics(): Metrics {
  return {
    oreMined: 0,
    moneyEarned: 0,
    tremorBonusEarned: 0,
    maxDepth: 0,
    upgradesBought: 0,
    trips: 0,
    caveIns: 0,
    caveInDamage: 0,
    spilledValue: 0,
    rescues: 0,
    rescueFeesPaid: 0,
    rescueLostValue: 0,
    basketsSent: 0,
    basketValue: 0,
    basketTremor: 0,
    scaffoldsPlaced: 0,
    restTicks: 0,
    restRelief: 0,
    peakTremorBanked: 0,
    coreCarryTicks: 0,
    coreCaveIns: 0,
    coreLost: 0,
    clearedTick: null,
    score: 0,
  };
}

interface CargoEntry extends CargoItem {
  /** 揺れボーナスで上乗せされた分 */
  bonus: number;
}

/**
 * 帰り道の経路を、巻き上げ（真上へ続く縦穴は1tickで(1+Lv)マス）を使う前提でtickに区切り、
 * 各tickの終わりにいる深さの列を返す（揺れはtickの終わりの深さで加算されるため）
 */
export function returnTicksAlong(
  sx: number,
  sy: number,
  path: { x: number; y: number }[],
  winchLv: number,
  /** 巻き上げが止まるマス（足場） */
  stopAt: (x: number, y: number) => boolean = () => false,
): number[] {
  const out: number[] = [];
  let px = sx;
  let py = sy;
  let i = 0;
  while (i < path.length) {
    let n = 1;
    if (path[i].y === py - 1 && path[i].x === px) {
      while (
        n < 1 + winchLv &&
        i + n < path.length &&
        path[i + n].x === px &&
        path[i + n].y === path[i + n - 1].y - 1 &&
        path[i + n - 1].y > 0 &&
        !stopAt(path[i + n - 1].x, path[i + n - 1].y)
      )
        n++;
    }
    const last = path[i + n - 1];
    px = last.x;
    py = last.y;
    i += n;
    out.push(py);
  }
  return out;
}

export class Game {
  readonly seed: number;
  private rng: Rng;
  tick = 0;
  over = false;
  private tiles: number[];
  private x = START_X;
  private y = 0;
  private hp = BASE_HP;
  private money = 0;
  private cargo: CargoEntry[] = [];
  private hasCore = false;
  private digging: Digging | null = null;
  private tremor = 0;
  private basketsLeft = 0;
  private levels: Record<UpgradeId, number> = { drill: 0, hp: 0, brace: 0, capacity: 0, winch: 0, basket: 0, scaffold: 0 };
  private scaffoldsHeld = 0;
  private scaffolds: { x: number; y: number }[] = [];
  private lastCaveIn: CaveInEvent | null = null;
  private metrics: Metrics = emptyMetrics();

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.tiles = generateMap(this.rng);
  }

  get phase(): Phase {
    if (this.over) return 'cleared';
    return this.y === 0 ? 'shop' : 'mine';
  }

  private get maxHp(): number {
    return BASE_HP + HP_PER_LEVEL * this.levels.hp;
  }
  private get drillPower(): number {
    return 1 + this.levels.drill;
  }
  private get maxCapacity(): number {
    return BASE_CAPACITY + CAPACITY_PER_LEVEL * this.levels.capacity;
  }
  /** 深さyで今1tickにたまる揺れ（支保Lv・核石の倍率込み、掘削の倍率は含まない） */
  private rateAt(y: number): number {
    return tremorRate(y, this.levels.brace) * (this.hasCore ? CORE_TREMOR_MULT : 1);
  }
  private get cargoValue(): number {
    return this.cargo.reduce((a, c) => a + c.value, 0);
  }

  tileAt(x: number, y: number): number {
    if (x < 0 || x >= WIDTH || y < 0 || y >= DEPTH) return -1;
    return this.tiles[y * WIDTH + x];
  }

  step(action: Action): void {
    if (this.over) return;
    this.tick++;

    switch (action.type) {
      case 'move':
        this.handleMove(action.dir);
        break;
      case 'buy':
        this.handleBuy(action.item);
        break;
      case 'send':
        this.handleSend();
        break;
      case 'hoist':
        this.handleHoist();
        break;
      case 'place':
        this.handlePlace();
        break;
      case 'wait':
        this.digging = null;
        break;
    }
    if (this.over) return;

    if (this.y > 0) {
      if (this.onScaffold() && !this.digging) {
        // 足場の上で掘らずにいる間は、揺れがたまらず下がっていく（途中の回収点）
        const before = this.tremor;
        this.tremor = Math.max(0, this.tremor - SCAFFOLD_RELIEF);
        if (before > this.tremor) {
          this.metrics.restTicks++;
          this.metrics.restRelief += before - this.tremor;
        }
      } else {
        const rate = this.rateAt(this.y) * (this.digging ? DIG_TREMOR_MULT : 1);
        this.tremor = Math.min(TREMOR_CAP, this.tremor + rate);
      }
      if (this.hasCore) this.metrics.coreCarryTicks++;
      // 乱数は地下にいる毎tick必ず1回引く（揺れに関わらず消費量を一定にして決定論の見通しを良くする）
      const roll = this.rng();
      if (roll < caveInProb(this.tremor)) this.caveIn();
    }
    this.updateScore();
  }

  private handleMove(dir: Dir): void {
    const [dx, dy] = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
    const nx = this.x + dx;
    const ny = this.y + dy;
    const t = this.tileAt(nx, ny);
    if (t < 0) {
      this.digging = null;
      return;
    }
    if (t === TILE.FLOOR) {
      this.digging = null;
      this.moveTo(nx, ny);
      return;
    }
    if (!this.digging || this.digging.x !== nx || this.digging.y !== ny) {
      const total = digTicks(t, ny, this.drillPower);
      this.digging = { x: nx, y: ny, remaining: total, total };
    }
    this.digging.remaining--;
    if (this.digging.remaining <= 0) {
      this.digging = null;
      this.finishDig(nx, ny, t);
      this.moveTo(nx, ny);
    }
  }

  /**
   * 巻き上げ機: 真上が掘った床なら、1tickで最大(1+Lv)マス上る（地上に着くか、真上が床でなくなったら止まる）。
   * v1初版は「縦の移動が自動で複数マス進む」方式だったが、縦穴の途中で横の鉱石へ曲がれず通り過ぎる
   * （人の操作でもボットでも同じ）問題があったため、明示的なアクションに分けた
   */
  private handleHoist(): void {
    this.digging = null;
    const steps = 1 + this.levels.winch;
    for (let i = 0; i < steps && this.y > 0; i++) {
      if (this.tileAt(this.x, this.y - 1) !== TILE.FLOOR) break;
      this.moveTo(this.x, this.y - 1);
      if (this.onScaffold()) break; // 足場は踊り場: 巻き上げはそこで止まる
    }
  }

  isScaffold(x: number, y: number): boolean {
    return this.scaffolds.some((sc) => sc.x === x && sc.y === y);
  }

  private onScaffold(): boolean {
    return this.y > 0 && this.isScaffold(this.x, this.y);
  }

  private handlePlace(): void {
    this.digging = null;
    if (this.y < SCAFFOLD_MIN_Y || this.scaffoldsHeld <= 0 || this.onScaffold()) return;
    this.scaffolds.push({ x: this.x, y: this.y });
    this.scaffoldsHeld--;
    this.metrics.scaffoldsPlaced++;
  }

  private finishDig(x: number, y: number, t: number): void {
    this.tiles[y * WIDTH + x] = TILE.FLOOR;
    if (!isOre(t)) return;
    if (t === TILE.CORE) {
      this.hasCore = true;
      this.metrics.oreMined++;
      return;
    }
    if (this.cargo.length >= this.maxCapacity) return; // 背負えない鉱石は砕けて失われる
    const base = ORE_VALUE[t];
    const bonus = Math.round(base * tremorBonus(this.tremor));
    this.cargo.push({ tile: t as TileId, value: base + bonus, bonus });
    this.metrics.oreMined++;
  }

  private moveTo(x: number, y: number): void {
    const wasUnder = this.y > 0;
    this.x = x;
    this.y = y;
    if (y > this.metrics.maxDepth) this.metrics.maxDepth = y;
    if (wasUnder && y === 0) this.arriveHome();
    if (!wasUnder && y > 0) this.basketsLeft = this.levels.basket;
  }

  private bank(entries: CargoEntry[], rate: number): number {
    let total = 0;
    let bonus = 0;
    for (const c of entries) {
      total += Math.floor(c.value * rate);
      bonus += Math.floor(c.bonus * rate);
    }
    this.money += total;
    this.metrics.moneyEarned += total;
    this.metrics.tremorBonusEarned += bonus;
    return total;
  }

  private arriveHome(): void {
    this.metrics.trips++;
    if (this.cargo.length > 0) {
      this.bank(this.cargo, 1);
      this.metrics.peakTremorBanked = Math.max(this.metrics.peakTremorBanked, Math.round(this.tremor));
    }
    this.cargo = [];
    this.tremor = 0;
    this.hp = this.maxHp;
    if (this.hasCore) {
      this.hasCore = false;
      this.money += ORE_VALUE[TILE.CORE];
      this.metrics.moneyEarned += ORE_VALUE[TILE.CORE];
      this.metrics.clearedTick = this.tick;
      this.over = true;
    }
  }

  private handleBuy(item: UpgradeId): void {
    this.digging = null;
    if (this.y !== 0) return;
    const def = UPGRADES.find((u) => u.id === item);
    if (!def) return;
    const cost = upgradeCost(def, this.levels[item]);
    if (cost === null || this.money < cost) return;
    this.money -= cost;
    this.levels[item]++;
    this.metrics.upgradesBought++;
    if (item === 'scaffold') this.scaffoldsHeld++;
    if (item === 'hp') this.hp = this.maxHp;
  }

  private handleSend(): void {
    this.digging = null;
    if (this.y === 0 || this.basketsLeft <= 0 || this.cargo.length === 0) return;
    const got = this.bank(this.cargo, BASKET_RATE);
    this.metrics.basketsSent++;
    this.metrics.basketValue += got;
    this.metrics.peakTremorBanked = Math.max(this.metrics.peakTremorBanked, Math.round(this.tremor));
    this.cargo = [];
    this.basketsLeft--;
    // 籠を下ろす振動（v1で籠が代償なしに強すぎたため、揺れのダイヤルに代償を結びつけた）
    const before = this.tremor;
    this.tremor = Math.min(TREMOR_CAP, this.tremor + BASKET_TREMOR);
    this.metrics.basketTremor += this.tremor - before;
  }

  private caveIn(): void {
    const damage = caveInDamageAt(this.y);
    const spillUnits = Math.floor(this.cargo.length / 3);
    const spilled = spillUnits > 0 ? this.cargo.splice(this.cargo.length - spillUnits, spillUnits) : [];
    const spilledValue = spilled.reduce((a, c) => a + c.value, 0);
    this.hp -= damage;
    this.tremor = Math.max(0, this.tremor - CAVEIN_RELIEF);
    this.digging = null;
    this.metrics.caveIns++;
    if (this.hasCore) this.metrics.coreCaveIns++;
    this.metrics.caveInDamage += damage;
    this.metrics.spilledValue += spilledValue;
    let rescued = false;
    if (this.hp <= 0) {
      rescued = true;
      this.rescue();
    }
    this.lastCaveIn = { tick: this.tick, damage, spilledUnits: spillUnits, spilledValue, rescued };
  }

  /** HP0: 地上へ引き上げられる。積荷（核石含む）は全損、所持金の15%を救助費として失う */
  private rescue(): void {
    this.metrics.rescues++;
    this.metrics.rescueLostValue += this.cargoValue;
    const fee = Math.floor(this.money * RESCUE_FEE_RATE);
    this.money -= fee;
    this.metrics.rescueFeesPaid += fee;
    this.cargo = [];
    if (this.hasCore) {
      this.metrics.coreLost++;
      this.hasCore = false;
      this.tiles[CORE_Y * WIDTH + CORE_X] = TILE.CORE; // 核石は元の場所へ落ちていく
    }
    this.x = START_X;
    this.y = 0;
    this.tremor = 0;
    this.hp = this.maxHp;
    this.metrics.trips++;
  }

  /** 掘った床だけを通って地上へ戻る最短経路（BFS） */
  returnPath(): { x: number; y: number }[] | null {
    if (this.y === 0) return [];
    return this.floorPath((_x, y) => y === 0);
  }

  /** 掘った床だけを通って一番近い足場へ行く最短経路（足場の上なら空配列、足場が無い・届かないならnull） */
  scaffoldPath(): { x: number; y: number }[] | null {
    if (this.scaffolds.length === 0) return null;
    if (this.onScaffold()) return [];
    return this.floorPath((x, y) => y > 0 && this.isScaffold(x, y));
  }

  private floorPath(isGoal: (x: number, y: number) => boolean): { x: number; y: number }[] | null {
    const start = this.y * WIDTH + this.x;
    const prev = new Int32Array(WIDTH * DEPTH).fill(-2);
    prev[start] = -1;
    const queue = [start];
    let head = 0;
    let goal = -1;
    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % WIDTH;
      const cy = Math.floor(cur / WIDTH);
      if (cur !== start && isGoal(cx, cy)) {
        goal = cur;
        break;
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
        if (prev[ni] !== -2 || this.tiles[ni] !== TILE.FLOOR) continue;
        prev[ni] = cur;
        queue.push(ni);
      }
    }
    if (goal < 0) return null;
    const path: { x: number; y: number }[] = [];
    for (let c = goal; c !== start; c = prev[c]) path.push({ x: c % WIDTH, y: Math.floor(c / WIDTH) });
    return path.reverse();
  }

  private updateScore(): void {
    const m = this.metrics;
    m.score = m.moneyEarned + (m.clearedTick !== null ? 2000 : 0);
  }

  getState(): GameState {
    const path = this.returnPath();
    const stop = (x: number, y: number) => this.isScaffold(x, y);
    let estReturnTremor: number | null = null;
    let estReturnTicks: number | null = null;
    if (this.y > 0 && path) {
      // 1歩ごとに「今いるマスの深さ」の速さで揺れがたまる
      const ticks = returnTicksAlong(this.x, this.y, path, this.levels.winch, stop);
      let sum = 0;
      for (const y of ticks) sum += this.rateAt(y);
      estReturnTremor = Math.round(sum * 10) / 10;
      estReturnTicks = ticks.length;
    }
    let estScaffoldTremor: number | null = null;
    let nearestScaffoldY: number | null = null;
    const spath = this.y > 0 ? this.scaffoldPath() : null;
    if (spath) {
      const ticks = returnTicksAlong(this.x, this.y, spath, this.levels.winch, stop);
      let sum = 0;
      for (const y of ticks) sum += this.rateAt(y);
      estScaffoldTremor = Math.round(sum * 10) / 10;
      nearestScaffoldY = spath.length > 0 ? spath[spath.length - 1].y : this.y;
    }
    const shop: ShopItemState[] = UPGRADES.map((def) => ({
      id: def.id,
      name: def.name,
      desc: def.desc,
      level: this.levels[def.id],
      maxLevel: def.maxLevel,
      nextCost: upgradeCost(def, this.levels[def.id]),
    }));
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      tick: this.tick,
      phase: this.phase,
      over: this.over,
      player: {
        x: this.x,
        y: this.y,
        hp: this.hp,
        maxHp: this.maxHp,
        money: this.money,
        drillPower: this.drillPower,
        cargo: this.cargo.map((c) => ({ tile: c.tile, value: c.value })),
        cargoUnits: this.cargo.length,
        maxCapacity: this.maxCapacity,
        cargoValue: this.cargoValue,
        hasCore: this.hasCore,
        digging: this.digging ? { ...this.digging } : null,
        tremor: r2(this.tremor),
        tremorRate: r2(this.rateAt(this.y)),
        tremorBonus: r2(tremorBonus(this.tremor)),
        caveInChance100: r2(caveInChanceOver(this.tremor, 100)),
        caveInDamage: this.y > 0 ? caveInDamageAt(this.y) : 0,
        estReturnTremor,
        estReturnTicks,
        basketsLeft: this.y > 0 ? this.basketsLeft : this.levels.basket,
        basketsMax: this.levels.basket,
        scaffoldsHeld: this.scaffoldsHeld,
        onScaffold: this.onScaffold(),
        estScaffoldTremor,
        nearestScaffoldY,
      },
      map: { width: WIDTH, depth: DEPTH, tiles: this.tiles.slice(), scaffolds: this.scaffolds.map((sc) => ({ ...sc })) },
      lastCaveIn: this.lastCaveIn ? { ...this.lastCaveIn } : null,
      shop,
      metrics: { ...this.metrics },
    };
  }
}
