import { mulberry32, type Rng } from './rng';
import { TILE, type Action, type Dir, type Digging, type GameState, type Metrics, type ShopItemState, type TileId, type UpgradeId } from './types';

// ---- バランス定数（specs/003-mining-deepvein/spec.md の表と一致させる） ----
export const W = 16;
export const H = 161; // y=0: 地上, y=1..160: 8バンド x 20
const BAND_SIZE = 20;
const SPAWN_X = Math.floor(W / 2);

const PASSIVE_FUEL_DRAIN = 1;
const DIG_FUEL_COST = 1;
// v1では34tick分（=102ダメージ）でほぼ確実に致死していたため緩和（reviews/003-mining-deepvein-v1.md #2）
const FUEL_EMPTY_HP_DRAIN = 1.5;
const GAS_FUEL_DRAIN = 15;
const HAZARD_BASE_DMG = 12;
const HAZARD_DMG_PER_BAND = 2;
const UNSTABLE_TRIGGER_CHANCE = 0.35;
const TELEPORT_FUEL_COST = 25;

const DIGGABLE: TileId[] = [TILE.DIRT, TILE.ROCK, TILE.ORE_COPPER, TILE.ORE_IRON, TILE.ORE_GOLD, TILE.GAS, TILE.UNSTABLE];

/** タイルの硬さ階層（0=最も柔らかい）。要求ドリル威力・掘削時間の基礎になる */
const TIER: Partial<Record<TileId, number>> = {
  [TILE.DIRT]: 0,
  [TILE.ORE_COPPER]: 0,
  [TILE.ROCK]: 1,
  [TILE.GAS]: 1,
  [TILE.ORE_IRON]: 2,
  [TILE.UNSTABLE]: 2,
  [TILE.ORE_GOLD]: 3,
};
const BASE_TICKS: Partial<Record<TileId, number>> = {
  [TILE.DIRT]: 2,
  [TILE.ORE_COPPER]: 3,
  [TILE.ROCK]: 4,
  [TILE.GAS]: 4,
  [TILE.ORE_IRON]: 5,
  [TILE.UNSTABLE]: 4,
  [TILE.ORE_GOLD]: 6,
};
const BASE_VALUE: Partial<Record<TileId, number>> = {
  [TILE.ORE_COPPER]: 6,
  [TILE.ORE_IRON]: 18,
  [TILE.ORE_GOLD]: 45,
};

function bandAt(y: number): number {
  return Math.floor((y - 1) / BAND_SIZE);
}
/**
 * 岩・ガス（TIER1）は土・銅鉱石（TIER0）と同じ要求ドリル威力にする。
 * v1で「初期ドリル威力のまま到達可能な範囲がTIER0タイルのみに限定され、それを掘り尽くすと
 * 次のドリル強化を買う収入源自体が尽きる」詰みが発生したため（reviews/003-mining-deepvein-v1.md #1）。
 */
function requiredDrillPower(type: TileId, band: number): number {
  const tier = type === TILE.ROCK || type === TILE.GAS ? 0 : (TIER[type] ?? 0);
  return 1 + tier + Math.floor(band / 2);
}
function digTicksFor(type: TileId, band: number, drillPower: number, digspeedLevel: number): number {
  const req = requiredDrillPower(type, band);
  const base = BASE_TICKS[type] ?? 2;
  const bonus = 0.2 * (drillPower - req) + 0.15 * digspeedLevel;
  return Math.max(1, Math.round(base / (1 + bonus)));
}
function oreValue(type: TileId, band: number): number {
  const base = BASE_VALUE[type] ?? 0;
  return Math.round(base * (1 + band * 0.12));
}

/** バンドごとの出現重み。深いほど土が減り、鉱石・危険タイルが増える */
function pickTileType(band: number, rng: Rng): TileId {
  const pHazard = Math.min(0.12, 0.02 + band * 0.015);
  const pGold = Math.min(0.05, band * 0.01);
  const pIron = Math.min(0.18, 0.02 + band * 0.025);
  const pCopper = Math.max(0.05, 0.2 - band * 0.01);
  const pStone = Math.min(0.5, 0.15 + band * 0.03);
  const pDirt = Math.max(0, 1 - (pHazard + pGold + pIron + pCopper + pStone));
  const entries: [TileId, number][] = [
    [TILE.DIRT, pDirt],
    [TILE.ROCK, pStone],
    [TILE.ORE_COPPER, pCopper],
    [TILE.ORE_IRON, pIron],
    [TILE.ORE_GOLD, pGold],
    [TILE.GAS, pHazard / 2],
    [TILE.UNSTABLE, pHazard / 2],
  ];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [type, w] of entries) {
    r -= w;
    if (r <= 0) return type;
  }
  return TILE.DIRT;
}

const DELTA: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

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
  { id: 'lantern', name: 'ランタン強化', desc: '受動燃料消費-5%（下限-20%）', baseCost: 20, growth: 1.3, maxLevel: 4 },
  { id: 'hazardresist', name: '危険耐性', desc: '危険タイルの被ダメージ-15%（下限-45%）', baseCost: 30, growth: 1.5, maxLevel: 3 },
  { id: 'teleport', name: '地上テレポート', desc: '潜行中いつでも燃料25で即時帰還できるようになる（1回のみ）', baseCost: 150, growth: 1, maxLevel: 1 },
];

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
  lanternLevel: number;
  hazardresistLevel: number;
  teleportLevel: number;
}

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
function lanternMultOf(lanternLevel: number): number {
  return Math.max(0.8, 1 - 0.05 * lanternLevel);
}
function hazardMultOf(hazardresistLevel: number): number {
  return Math.max(0.55, 1 - 0.15 * hazardresistLevel);
}

export class Game {
  readonly seed: number;
  private rng: Rng;
  private tiles: number[];
  private tick = 0;
  private phase: 'mine' | 'shop' | 'gameover' = 'shop';
  private _over = false;
  private player: PlayerState = {
    x: SPAWN_X,
    y: 0,
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
    lanternLevel: 0,
    hazardresistLevel: 0,
    teleportLevel: 0,
  };
  private metrics: Metrics = {
    oreMined: 0,
    oreWasted: 0,
    moneyEarned: 0,
    maxDepth: 0,
    upgradesBought: 0,
    hazardHits: 0,
    hazardDamage: 0,
    fuelEmptyTicks: 0,
    tripsToSurface: 0,
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
    const tiles = new Array<number>(W * H).fill(TILE.FLOOR);
    for (let y = 1; y < H; y++) {
      const band = bandAt(y);
      for (let x = 0; x < W; x++) {
        tiles[y * W + x] = pickTileType(band, this.rng);
      }
    }
    return tiles;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < W && y >= 0 && y < H;
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
  private lanternMult(): number {
    return lanternMultOf(this.player.lanternLevel);
  }
  private hazardMult(): number {
    return hazardMultOf(this.player.hazardresistLevel);
  }
  private teleportUnlocked(): boolean {
    return this.player.teleportLevel >= 1;
  }

  /** 既に掘った床だけを通って地上(y=0)へ戻るのに必要なマス数をBFSで求める（構造上、経路は必ず存在する） */
  private bfsDistanceToSurface(): number {
    if (this.player.y === 0) return 0;
    const visited = new Uint8Array(W * H);
    const startIdx = this.player.y * W + this.player.x;
    visited[startIdx] = 1;
    let queue: number[] = [startIdx];
    let qi = 0;
    let dist = 0;
    while (qi < queue.length) {
      const levelSize = queue.length - qi;
      dist++;
      for (let i = 0; i < levelSize; i++) {
        const idx = queue[qi++];
        const x = idx % W;
        const y = Math.floor(idx / W);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const nidx = ny * W + nx;
          if (visited[nidx]) continue;
          if (ny === 0) return dist;
          if (this.tiles[nidx] !== TILE.FLOOR) continue;
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
    }
    return Infinity;
  }

  private estFuelToReturn(): number | null {
    const dist = this.bfsDistanceToSurface();
    if (!Number.isFinite(dist)) return null;
    return Math.ceil(dist * PASSIVE_FUEL_DRAIN * this.lanternMult());
  }

  // ---- メインループ: 1ティック進める ----
  step(action: Action = { type: 'wait' }): void {
    if (this._over) return;
    this.tick++;

    if (this.phase === 'shop') {
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
      // fallthrough: このtickのうちに潜行を開始する
    }

    // ---- mine フェーズ ----
    if (this.player.fuel <= 0) {
      this.player.hp -= FUEL_EMPTY_HP_DRAIN;
      this.metrics.fuelEmptyTicks++;
    }
    this.player.fuel = Math.max(0, this.player.fuel - PASSIVE_FUEL_DRAIN * this.lanternMult());

    switch (action.type) {
      case 'move':
        this.applyMove(action.dir);
        break;
      case 'teleport':
        this.applyTeleport();
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

    this.metrics.maxDepth = Math.max(this.metrics.maxDepth, this.player.y);
    this.recomputeScore();
  }

  private applyMove(dir: Dir): void {
    const [dx, dy] = DELTA[dir];
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (!this.inBounds(nx, ny)) return;
    const t = this.tiles[ny * W + nx] as TileId;

    if (t === TILE.FLOOR) {
      this.player.digging = null;
      this.player.x = nx;
      this.player.y = ny;
      if (ny === 0) this.arriveAtSurface();
      return;
    }
    if (!DIGGABLE.includes(t)) return;

    const band = bandAt(ny);
    const req = requiredDrillPower(t, band);
    if (this.drillPower() < req) return; // ドリル威力不足で不発（後出しではなく式から予測可能）

    if (!this.player.digging || this.player.digging.x !== nx || this.player.digging.y !== ny) {
      const total = digTicksFor(t, band, this.drillPower(), this.player.digspeedLevel);
      this.player.digging = { x: nx, y: ny, remaining: total, total };
    }
    this.player.fuel = Math.max(0, this.player.fuel - DIG_FUEL_COST);
    this.player.digging.remaining--;
    if (this.player.digging.remaining <= 0) {
      this.completeDig(nx, ny, t, band);
      this.player.digging = null;
      this.player.x = nx;
      this.player.y = ny;
    }
  }

  private completeDig(x: number, y: number, type: TileId, band: number): void {
    this.tiles[y * W + x] = TILE.FLOOR;
    if (type === TILE.ORE_COPPER || type === TILE.ORE_IRON || type === TILE.ORE_GOLD) {
      if (this.player.cargoUnits < this.maxCapacity()) {
        this.player.cargoUnits++;
        this.player.cargoValue += oreValue(type, band);
        this.metrics.oreMined++;
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

  private applyTeleport(): void {
    if (!this.teleportUnlocked() || this.player.fuel < TELEPORT_FUEL_COST) return;
    this.player.fuel -= TELEPORT_FUEL_COST;
    this.player.digging = null;
    this.player.y = 0;
    this.arriveAtSurface();
  }

  private arriveAtSurface(): void {
    this.player.money += this.player.cargoValue;
    this.metrics.moneyEarned += this.player.cargoValue;
    this.player.cargoValue = 0;
    this.player.cargoUnits = 0;
    this.player.fuel = this.maxFuel();
    this.metrics.tripsToSurface++;
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
      case 'lantern':
        return this.player.lanternLevel;
      case 'hazardresist':
        return this.player.hazardresistLevel;
      case 'teleport':
        return this.player.teleportLevel;
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
      case 'lantern':
        this.player.lanternLevel++;
        break;
      case 'hazardresist':
        this.player.hazardresistLevel++;
        break;
      case 'teleport':
        this.player.teleportLevel++;
        break;
    }
    this.metrics.upgradesBought++;
  }

  private recomputeScore(): void {
    this.metrics.score = Math.round(
      this.player.money + this.player.cargoValue + this.metrics.maxDepth * 3 + this.metrics.oreMined * 2,
    );
  }

  // ---- 状態のスナップショット（JSONシリアライズ可能） ----
  getState(): GameState {
    const shop: ShopItemState[] = SHOP_DEFS.map((def) => {
      const level = this.levelOf(def.id);
      const nextCost = level >= def.maxLevel ? null : Math.round(def.baseCost * Math.pow(def.growth, level));
      return { id: def.id, name: def.name, desc: def.desc, level, maxLevel: def.maxLevel, nextCost };
    });
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
        teleportUnlocked: this.teleportUnlocked(),
        digging: this.player.digging ? { ...this.player.digging } : null,
        estFuelToReturn: this.estFuelToReturn(),
      },
      map: { w: W, h: H, tiles: [...this.tiles] },
      shop,
      metrics: { ...this.metrics },
    };
  }
}

export { bandAt, requiredDrillPower, digTicksFor, oreValue };
