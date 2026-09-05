import { mulberry32, randInt, type Rng } from './rng';
import {
  TILE,
  type Action,
  type BandHint,
  type Dir,
  type Digging,
  type GameState,
  type LaneHint,
  type Metrics,
  type RiskEscalationBanner,
  type RiskLevel,
  type ShopItemState,
  type TileId,
  type UpgradeId,
} from './types';

// ---- バランス定数（specs/017-mining-forkshaft/spec.md の表と一致させる） ----
export const LANES = 3; // y: 0..2
export const NUM_BANDS = 6;
export const BAND_SIZE = 40;
export const LENGTH = NUM_BANDS * BAND_SIZE + 1; // x: 0(ホーム)..240
const SPAWN_Y = 1;

const PASSIVE_FUEL_DRAIN = 1;
const DIG_FUEL_COST = 1;
const FUEL_EMPTY_HP_DRAIN = 1.5;
const GAS_FUEL_DRAIN = 15;
const HAZARD_BASE_DMG = 12;
const HAZARD_DMG_PER_BAND = 2;
const UNSTABLE_TRIGGER_CHANCE = 0.35;
const RISK_DANGER_MARGIN = 15;
const RISK_CAUTION_MULT = 1.8;
const RISK_BANNER_TICKS = 90;

// --- 詰みからの脱出手段（003/011から継承）。ホーム滞在中、最安の未購入強化すら買えない間だけ
// ごく少額の収入が入るようにし、経済の恒久停止を防ぐ
const STUCK_INCOME_INTERVAL = 25;
const STUCK_INCOME_AMOUNT = 2;

const DIGGABLE: TileId[] = [
  TILE.DIRT,
  TILE.ROCK,
  TILE.ORE_COPPER,
  TILE.ORE_IRON,
  TILE.ORE_GOLD,
  TILE.ORE_PLATINUM,
  TILE.GAS,
  TILE.UNSTABLE,
];
const ORE_TILES: TileId[] = [TILE.ORE_COPPER, TILE.ORE_IRON, TILE.ORE_GOLD, TILE.ORE_PLATINUM];

/** タイルの硬さ階層（0=最も柔らかい）。要求ドリル威力・掘削時間の基礎になる */
const TIER: Partial<Record<TileId, number>> = {
  [TILE.DIRT]: 0,
  [TILE.ORE_COPPER]: 0,
  [TILE.ORE_IRON]: 2,
  [TILE.UNSTABLE]: 2,
  [TILE.ORE_GOLD]: 3,
  [TILE.ORE_PLATINUM]: 4,
};
const BASE_TICKS: Partial<Record<TileId, number>> = {
  [TILE.DIRT]: 2,
  [TILE.ORE_COPPER]: 3,
  [TILE.ROCK]: 4,
  [TILE.GAS]: 4,
  [TILE.ORE_IRON]: 5,
  [TILE.UNSTABLE]: 4,
  [TILE.ORE_GOLD]: 6,
  [TILE.ORE_PLATINUM]: 8,
};
const BASE_VALUE: Partial<Record<TileId, number>> = {
  [TILE.ORE_COPPER]: 7,
  [TILE.ORE_IRON]: 22,
  [TILE.ORE_GOLD]: 54,
  [TILE.ORE_PLATINUM]: 110,
};

/** 豊富さ0〜3 → 鉱石出現重みへの倍率 */
const RICHNESS_MULT = [0.5, 1.0, 1.6, 2.4];
/** 危険度0〜2 → GAS/UNSTABLE出現重みへの倍率 */
const HAZARD_MULT = [0.4, 1.0, 2.0];

/** x=0..LENGTH-1のうち、上下移動（レーン切替）ができる分岐点。最終タイル(LENGTH-1)は分岐ではない */
export function isForkPos(x: number): boolean {
  return x % BAND_SIZE === 0 && x < LENGTH - 1;
}

/** band = floor((x-1)/40)。x=0はホーム専用（バンド計算の対象外） */
export function bandAt(x: number): number {
  return Math.floor((x - 1) / BAND_SIZE);
}

export function requiredDrillPower(type: TileId, band: number): number {
  const tier = type === TILE.ROCK || type === TILE.GAS ? 0 : (TIER[type] ?? 0);
  return 1 + tier + Math.floor(band / 2);
}
export function digTicksFor(type: TileId, band: number, drillPower: number, digspeedLevel: number): number {
  const req = requiredDrillPower(type, band);
  const base = BASE_TICKS[type] ?? 2;
  const bonus = 0.2 * (drillPower - req) + 0.15 * digspeedLevel;
  return Math.max(1, Math.round(base / (1 + bonus)));
}
export function oreValue(type: TileId, band: number): number {
  const base = BASE_VALUE[type] ?? 0;
  return Math.round(base * (1 + band * 0.12));
}

interface LaneMeta {
  richness: number;
  hazardTier: number;
}

function pickTileType(band: number, meta: LaneMeta, rng: Rng): TileId {
  const richMult = RICHNESS_MULT[meta.richness];
  const hazMult = HAZARD_MULT[meta.hazardTier];
  const wHazard = Math.min(0.12, 0.02 + band * 0.015) * hazMult;
  const wGold = Math.min(0.05, band * 0.01) * richMult;
  const wPlatinum = band >= 3 ? Math.min(0.04, (band - 3) * 0.015) * richMult : 0;
  const wIron = Math.min(0.18, 0.02 + band * 0.025) * richMult;
  const wCopper = Math.max(0.05, 0.2 - band * 0.01) * (1 + (richMult - 1) * 0.4);
  const wStone = Math.min(0.5, 0.15 + band * 0.03);
  const wDirt = Math.max(0.05, 1 - band * 0.08);
  const entries: [TileId, number][] = [
    [TILE.DIRT, wDirt],
    [TILE.ROCK, wStone],
    [TILE.ORE_COPPER, wCopper],
    [TILE.ORE_IRON, wIron],
    [TILE.ORE_GOLD, wGold],
    [TILE.ORE_PLATINUM, wPlatinum],
    [TILE.GAS, wHazard / 2],
    [TILE.UNSTABLE, wHazard / 2],
  ];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [type, w] of entries) {
    r -= w;
    if (r <= 0) return type;
  }
  return TILE.DIRT;
}

interface ShopDef {
  id: UpgradeId;
  name: string;
  desc: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
}

const SHOP_DEFS: ShopDef[] = [
  { id: 'drill', name: 'ドリル威力', desc: 'ドリル威力+1（硬いタイルを掘れるように）', baseCost: 30, growth: 1.6, maxLevel: 8 },
  { id: 'fuel', name: '燃料タンク', desc: '最大燃料+40', baseCost: 20, growth: 1.4, maxLevel: 6 },
  { id: 'hp', name: '耐久強化', desc: '最大HP+25（即回復込み）', baseCost: 25, growth: 1.4, maxLevel: 6 },
  { id: 'capacity', name: '積載拡張', desc: '最大積載+5', baseCost: 15, growth: 1.3, maxLevel: 8 },
  { id: 'digspeed', name: '採掘速度', desc: '掘削が速くなる', baseCost: 25, growth: 1.5, maxLevel: 5 },
  { id: 'hazardresist', name: '危険耐性', desc: '危険タイルの被ダメージ-15%（下限-45%）', baseCost: 30, growth: 1.5, maxLevel: 3 },
  { id: 'scanner', name: '探査ドリル', desc: 'フォークで見える先のバンド数+1', baseCost: 18, growth: 1.6, maxLevel: 3 },
  { id: 'charge', name: '共鳴チャージ', desc: 'Lv1で解禁、以降チャージ上限+2', baseCost: 22, growth: 1.7, maxLevel: 3 },
];

function maxHpOf(hpLevel: number): number {
  return 100 + 25 * hpLevel;
}
function maxFuelOf(fuelLevel: number): number {
  return 100 + 40 * fuelLevel;
}
function maxCapacityOf(capacityLevel: number): number {
  return 20 + 5 * capacityLevel;
}
function drillPowerOf(drillLevel: number): number {
  return 1 + drillLevel;
}
function hazardMultOf(hazardresistLevel: number): number {
  return Math.max(0.55, 1 - 0.15 * hazardresistLevel);
}
function maxChargeOf(chargeLevel: number): number {
  return chargeLevel === 0 ? 0 : 4 + chargeLevel * 2;
}

interface PlayerState {
  x: number;
  y: number;
  hp: number;
  fuel: number;
  money: number;
  cargoUnits: number;
  cargoValue: number;
  digging: Digging | null;
  drillLevel: number;
  fuelLevel: number;
  hpLevel: number;
  capacityLevel: number;
  digspeedLevel: number;
  hazardresistLevel: number;
  scannerLevel: number;
  chargeLevel: number;
  charge: number;
}

export class Game {
  readonly seed: number;
  private rng: Rng;
  private tiles: number[];
  private laneMeta: LaneMeta[][] = [];
  private tick = 0;
  private phase: 'mine' | 'shop' | 'gameover' = 'shop';
  private _over = false;
  private lastRiskLevel: RiskLevel = 'safe';
  private currentRiskLevel: RiskLevel = 'safe';
  private banner: RiskEscalationBanner | null = null;
  /** タイルごとの掘削進捗の永続化（008/011パターン）。詰み防止のため中断しても次回同じタイルから再開できる */
  private digProgress = new Map<number, number>();
  private stuckIncomeTimer = 0;
  private player: PlayerState = {
    x: 0,
    y: SPAWN_Y,
    hp: maxHpOf(0),
    fuel: maxFuelOf(0),
    money: 0,
    cargoUnits: 0,
    cargoValue: 0,
    digging: null,
    drillLevel: 0,
    fuelLevel: 0,
    hpLevel: 0,
    capacityLevel: 0,
    digspeedLevel: 0,
    hazardresistLevel: 0,
    scannerLevel: 0,
    chargeLevel: 0,
    charge: 0,
  };
  private metrics: Metrics = {
    oreMined: 0,
    oreWasted: 0,
    moneyEarned: 0,
    maxDistance: 0,
    upgradesBought: 0,
    hazardHits: 0,
    hazardDamage: 0,
    fuelEmptyTicks: 0,
    tripsToHome: 0,
    riskEscalations: 0,
    stuckIncomeEarned: 0,
    resonanceTriggers: 0,
    resonanceBonusOre: 0,
    forkSwitches: 0,
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.tiles = this.generateWorld();
  }

  get over(): boolean {
    return this._over;
  }

  private generateWorld(): number[] {
    this.laneMeta = [];
    for (let b = 0; b < NUM_BANDS; b++) {
      const lanes: LaneMeta[] = [];
      for (let l = 0; l < LANES; l++) {
        lanes.push({ richness: randInt(this.rng, 4), hazardTier: randInt(this.rng, 3) });
      }
      this.laneMeta.push(lanes);
    }
    const tiles = new Array<number>(LENGTH * LANES).fill(TILE.FLOOR);
    for (let x = 1; x < LENGTH; x++) {
      if (isForkPos(x)) continue; // フォークは常にFLOOR
      const band = bandAt(x);
      for (let y = 0; y < LANES; y++) {
        tiles[x * LANES + y] = pickTileType(band, this.laneMeta[band][y], this.rng);
      }
    }
    return tiles;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < LENGTH && y >= 0 && y < LANES;
  }

  private drillPower(): number {
    return drillPowerOf(this.player.drillLevel);
  }
  private maxHp(): number {
    return maxHpOf(this.player.hpLevel);
  }
  private maxFuel(): number {
    return maxFuelOf(this.player.fuelLevel);
  }
  private maxCapacity(): number {
    return maxCapacityOf(this.player.capacityLevel);
  }
  private hazardMult(): number {
    return hazardMultOf(this.player.hazardresistLevel);
  }
  private maxCharge(): number {
    return maxChargeOf(this.player.chargeLevel);
  }

  /** 既に掘った床だけを通ってホーム(x=0)へ戻るのに必要なマス数をBFSで求める（上下移動はフォークでのみ有効） */
  private bfsDistanceToHome(): number {
    if (this.player.x === 0) return 0;
    const visited = new Uint8Array(LENGTH * LANES);
    const startIdx = this.player.x * LANES + this.player.y;
    visited[startIdx] = 1;
    let queue: number[] = [startIdx];
    let qi = 0;
    let dist = 0;
    while (qi < queue.length) {
      const levelSize = queue.length - qi;
      dist++;
      for (let i = 0; i < levelSize; i++) {
        const idx = queue[qi++];
        const x = Math.floor(idx / LANES);
        const y = idx % LANES;
        const neighbors: [number, number][] = [
          [x - 1, y],
          [x + 1, y],
        ];
        if (isForkPos(x)) {
          neighbors.push([x, y - 1], [x, y + 1]);
        }
        for (const [nx, ny] of neighbors) {
          if (!this.inBounds(nx, ny)) continue;
          const nidx = nx * LANES + ny;
          if (visited[nidx]) continue;
          if (nx === 0) return dist;
          if (this.tiles[nidx] !== TILE.FLOOR) continue;
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
    }
    return Infinity;
  }

  private estFuelToReturn(): number | null {
    const dist = this.bfsDistanceToHome();
    if (!Number.isFinite(dist)) return null;
    return Math.ceil(dist * PASSIVE_FUEL_DRAIN);
  }

  private computeRiskLevel(fuel: number, estReturn: number | null): RiskLevel {
    if (estReturn === null) return 'safe';
    if (fuel <= estReturn + RISK_DANGER_MARGIN) return 'danger';
    if (fuel <= estReturn * RISK_CAUTION_MULT) return 'caution';
    return 'safe';
  }

  private static readonly RISK_ORDER: Record<RiskLevel, number> = { safe: 0, caution: 1, danger: 2 };

  private updateRiskTracking(fuel: number, estReturn: number | null): void {
    const level = this.computeRiskLevel(fuel, estReturn);
    if (Game.RISK_ORDER[level] > Game.RISK_ORDER[this.lastRiskLevel]) {
      this.banner = { level, ticksLeft: RISK_BANNER_TICKS };
      this.metrics.riskEscalations++;
    }
    this.lastRiskLevel = level;
    if (this.banner) {
      this.banner.ticksLeft--;
      if (this.banner.ticksLeft <= 0) this.banner = null;
    }
    this.currentRiskLevel = level;
  }

  /** 次にレーン選択が発生するバンド番号（フォーク上ならそのバンド、バンド内ならその次のバンド） */
  private nextChoiceBand(): number {
    const x = this.player.x;
    if (x % BAND_SIZE === 0) return x / BAND_SIZE;
    return bandAt(x) + 1;
  }

  // ---- メインループ: 1ティック進める ----
  step(action: Action = { type: 'wait' }): void {
    if (this._over) return;
    this.tick++;

    if (this.phase === 'shop') {
      this.tickStuckIncome();
      if (action.type === 'buy') {
        this.applyBuy(action.item);
        this.recomputeScore();
        return;
      }
      if (action.type !== 'move') {
        this.recomputeScore();
        return;
      }
      this.phase = 'mine';
      // fallthrough: このtickのうちに移動/採掘を開始する
    }

    // ---- mine フェーズ ----
    if (this.player.fuel <= 0) {
      this.player.hp -= FUEL_EMPTY_HP_DRAIN;
      this.metrics.fuelEmptyTicks++;
    }
    this.player.fuel = Math.max(0, this.player.fuel - PASSIVE_FUEL_DRAIN);

    switch (action.type) {
      case 'move':
        this.applyMove(action.dir);
        break;
      case 'wait':
      case 'buy':
        break;
    }

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this._over = true;
      this.phase = 'gameover';
    }

    this.metrics.maxDistance = Math.max(this.metrics.maxDistance, this.player.x);
    this.updateRiskTracking(this.player.fuel, this.estFuelToReturn());
    this.recomputeScore();
  }

  private stashDigging(): void {
    if (this.player.digging) {
      const idx = this.player.digging.x * LANES + this.player.digging.y;
      this.digProgress.set(idx, this.player.digging.remaining);
    }
  }

  private applyMove(dir: Dir): void {
    if (dir === 'up' || dir === 'down') {
      if (!isForkPos(this.player.x)) return; // フォーク以外での上下移動は無効
      const ny = this.player.y + (dir === 'up' ? -1 : 1);
      if (ny < 0 || ny >= LANES) return;
      this.stashDigging();
      this.player.digging = null;
      this.player.y = ny;
      this.metrics.forkSwitches++;
      return;
    }

    const nx = this.player.x + (dir === 'right' ? 1 : -1);
    if (!this.inBounds(nx, this.player.y)) return;
    const t = this.tiles[nx * LANES + this.player.y] as TileId;

    if (t === TILE.FLOOR) {
      this.stashDigging();
      this.player.digging = null;
      this.player.x = nx;
      if (nx === 0) this.arriveAtHome();
      return;
    }
    if (!DIGGABLE.includes(t)) return;

    const band = bandAt(nx);
    const req = requiredDrillPower(t, band);
    if (this.drillPower() < req) return; // ドリル威力不足で不発

    const resonanceReady = this.player.chargeLevel >= 1 && this.player.charge >= this.maxCharge();
    if (resonanceReady) {
      this.digProgress.delete(nx * LANES + this.player.y);
      this.player.fuel = Math.max(0, this.player.fuel - DIG_FUEL_COST);
      this.player.digging = null;
      this.completeDig(nx, this.player.y, t, band);
      this.player.x = nx;
      this.triggerResonance(nx, band);
      return;
    }

    if (!this.player.digging || this.player.digging.x !== nx || this.player.digging.y !== this.player.y) {
      this.stashDigging();
      const idx = nx * LANES + this.player.y;
      const total = digTicksFor(t, band, this.drillPower(), this.player.digspeedLevel);
      const saved = this.digProgress.get(idx);
      const remaining = saved !== undefined ? Math.min(saved, total) : total;
      this.player.digging = { x: nx, y: this.player.y, remaining, total };
    }
    this.player.fuel = Math.max(0, this.player.fuel - DIG_FUEL_COST);
    this.player.digging.remaining--;
    if (this.player.digging.remaining <= 0) {
      this.digProgress.delete(nx * LANES + this.player.y);
      this.completeDig(nx, this.player.y, t, band);
      this.player.digging = null;
      this.player.x = nx;
    }
  }

  /** 共鳴掘削: チャージ消費と引き換えに、同じxの他レーンも要求ドリル威力を満たしていれば即時採掘する */
  private triggerResonance(x: number, band: number): void {
    this.metrics.resonanceTriggers++;
    this.player.charge = 0;
    for (let oy = 0; oy < LANES; oy++) {
      if (oy === this.player.y) continue;
      const idx = x * LANES + oy;
      const ot = this.tiles[idx] as TileId;
      if (ot === TILE.FLOOR || !DIGGABLE.includes(ot)) continue;
      if (this.drillPower() < requiredDrillPower(ot, band)) continue; // 届かないタイルは素通り
      const wasOre = ORE_TILES.includes(ot);
      this.digProgress.delete(idx);
      this.completeDig(x, oy, ot, band);
      if (wasOre) this.metrics.resonanceBonusOre++;
    }
  }

  private completeDig(x: number, y: number, type: TileId, band: number): void {
    this.tiles[x * LANES + y] = TILE.FLOOR;
    if (ORE_TILES.includes(type)) {
      if (this.player.cargoUnits < this.maxCapacity()) {
        this.player.cargoUnits++;
        this.player.cargoValue += oreValue(type, band);
        this.metrics.oreMined++;
        this.player.charge = Math.min(this.maxCharge(), this.player.charge + 1);
      } else {
        this.metrics.oreWasted++;
      }
      return;
    }
    if (type === TILE.GAS) {
      const dmg = Math.round((HAZARD_BASE_DMG + band * HAZARD_DMG_PER_BAND) * this.hazardMult());
      this.player.hp -= dmg;
      this.player.fuel = Math.max(0, this.player.fuel - GAS_FUEL_DRAIN);
      this.metrics.hazardHits++;
      this.metrics.hazardDamage += dmg;
      return;
    }
    if (type === TILE.UNSTABLE) {
      if (this.rng() < UNSTABLE_TRIGGER_CHANCE) {
        const dmg = Math.round((HAZARD_BASE_DMG + band * HAZARD_DMG_PER_BAND) * this.hazardMult());
        this.player.hp -= dmg;
        this.metrics.hazardHits++;
        this.metrics.hazardDamage += dmg;
      }
      return;
    }
    // DIRT / ROCK: 何も起きない
  }

  private arriveAtHome(): void {
    this.player.money += this.player.cargoValue;
    this.metrics.moneyEarned += this.player.cargoValue;
    this.player.cargoValue = 0;
    this.player.cargoUnits = 0;
    this.player.fuel = this.maxFuel();
    this.metrics.tripsToHome++;
    this.phase = 'shop';
  }

  private levelOf(item: UpgradeId): number {
    switch (item) {
      case 'drill':
        return this.player.drillLevel;
      case 'fuel':
        return this.player.fuelLevel;
      case 'hp':
        return this.player.hpLevel;
      case 'capacity':
        return this.player.capacityLevel;
      case 'digspeed':
        return this.player.digspeedLevel;
      case 'hazardresist':
        return this.player.hazardresistLevel;
      case 'scanner':
        return this.player.scannerLevel;
      case 'charge':
        return this.player.chargeLevel;
    }
  }

  private tickStuckIncome(): void {
    let minCost: number | null = null;
    for (const def of SHOP_DEFS) {
      const level = this.levelOf(def.id);
      if (level >= def.maxLevel) continue;
      const cost = Math.round(def.baseCost * Math.pow(def.growth, level));
      if (minCost === null || cost < minCost) minCost = cost;
    }
    if (minCost === null || this.player.money >= minCost) {
      this.stuckIncomeTimer = 0;
      return;
    }
    this.stuckIncomeTimer++;
    if (this.stuckIncomeTimer >= STUCK_INCOME_INTERVAL) {
      this.stuckIncomeTimer = 0;
      this.player.money += STUCK_INCOME_AMOUNT;
      this.metrics.stuckIncomeEarned += STUCK_INCOME_AMOUNT;
    }
  }

  private applyBuy(item: UpgradeId): void {
    const def = SHOP_DEFS.find((d) => d.id === item);
    if (!def) return;
    const level = this.levelOf(item);
    if (level >= def.maxLevel) return;
    const cost = Math.round(def.baseCost * Math.pow(def.growth, level));
    if (this.player.money < cost) return;
    this.player.money -= cost;
    switch (item) {
      case 'drill':
        this.player.drillLevel++;
        break;
      case 'fuel':
        this.player.fuelLevel++;
        break;
      case 'hp':
        this.player.hpLevel++;
        this.player.hp = Math.min(this.maxHp(), this.player.hp + 25);
        break;
      case 'capacity':
        this.player.capacityLevel++;
        break;
      case 'digspeed':
        this.player.digspeedLevel++;
        break;
      case 'hazardresist':
        this.player.hazardresistLevel++;
        break;
      case 'scanner':
        this.player.scannerLevel++;
        break;
      case 'charge':
        this.player.chargeLevel++;
        break;
    }
    this.metrics.upgradesBought++;
  }

  private recomputeScore(): void {
    this.metrics.score = Math.round(
      this.player.money + this.player.cargoValue + this.metrics.maxDistance * 3 + this.metrics.oreMined * 2,
    );
  }

  private computeBandHints(): BandHint[] {
    const nextBand = this.nextChoiceBand();
    const scannerLv = this.player.scannerLevel;
    const hints: BandHint[] = [];
    for (let b = 0; b < NUM_BANDS; b++) {
      const offset = b - nextBand + 1;
      const lanes: LaneHint[] = this.laneMeta[b].map((m, l) => {
        let hazardTier: number | null = null;
        let richness: number | null = null;
        if (offset <= 0) {
          hazardTier = m.hazardTier;
          richness = m.richness;
        } else {
          if (offset === 1 || scannerLv >= offset) hazardTier = m.hazardTier;
          if (scannerLv >= offset) richness = m.richness;
        }
        return { lane: l, hazardTier, richness };
      });
      hints.push({ band: b, lanes });
    }
    return hints;
  }

  private visibleTiles(): number[] {
    const out = new Array<number>(LENGTH * LANES);
    for (let x = 0; x < LENGTH; x++) {
      for (let y = 0; y < LANES; y++) {
        const idx = x * LANES + y;
        const real = this.tiles[idx];
        const revealed = real === TILE.FLOOR || (y === this.player.y && Math.abs(x - this.player.x) <= 1);
        out[idx] = revealed ? real : TILE.UNKNOWN;
      }
    }
    return out;
  }

  // ---- 状態のスナップショット（JSONシリアライズ可能） ----
  getState(): GameState {
    const shop: ShopItemState[] = SHOP_DEFS.map((def) => {
      const level = this.levelOf(def.id);
      const nextCost = level >= def.maxLevel ? null : Math.round(def.baseCost * Math.pow(def.growth, level));
      return { id: def.id, name: def.name, desc: def.desc, level, maxLevel: def.maxLevel, nextCost };
    });
    const estFuelToReturn = this.estFuelToReturn();
    const maxCharge = this.maxCharge();
    return {
      tick: this.tick,
      phase: this.phase,
      over: this._over,
      player: {
        x: this.player.x,
        y: this.player.y,
        hp: this.player.hp,
        maxHp: this.maxHp(),
        fuel: this.player.fuel,
        maxFuel: this.maxFuel(),
        money: this.player.money,
        drillPower: this.drillPower(),
        cargoUnits: this.player.cargoUnits,
        maxCapacity: this.maxCapacity(),
        cargoValue: this.player.cargoValue,
        digging: this.player.digging ? { ...this.player.digging } : null,
        estFuelToReturn,
        miningRiskLevel: this.currentRiskLevel,
        riskEscalationBanner: this.banner ? { ...this.banner } : null,
        charge: this.player.charge,
        maxCharge,
        chargeReady: this.player.chargeLevel >= 1 && this.player.charge >= maxCharge,
        atFork: isForkPos(this.player.x),
      },
      map: { lanes: LANES, length: LENGTH, bandSize: BAND_SIZE, tiles: this.visibleTiles() },
      bandHints: this.computeBandHints(),
      shop,
      metrics: { ...this.metrics },
    };
  }
}
