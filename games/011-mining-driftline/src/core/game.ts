import { mulberry32, type Rng } from './rng';
import {
  TILE,
  type Action,
  type Dir,
  type Digging,
  type GameState,
  type Metrics,
  type RiskEscalationBanner,
  type RiskLevel,
  type ShopItemState,
  type TileId,
  type UpgradeId,
} from './types';

// ---- バランス定数（specs/011-mining-driftline/spec.md の表と一致させる） ----
// 003-mining-deepvein（縦シャフト、幅16×深さ160）を横方向帯状フィールド（幅5レーン×長さ320）へ
// 移植する。band計算の入力をy(深さ)からx(進行距離)に差し替える以外、式は003と完全同一にする。
export const LANES = 5; // y: 0..4
export const LENGTH = 321; // x: 0(ホーム)..320
const BAND_SIZE = 40;
const SPAWN_Y = Math.floor(LANES / 2);

const PASSIVE_FUEL_DRAIN = 1;
const DIG_FUEL_COST = 1;
const FUEL_EMPTY_HP_DRAIN = 1.5;
const GAS_FUEL_DRAIN = 15;
const HAZARD_BASE_DMG = 12;
const HAZARD_DMG_PER_BAND = 2;
const UNSTABLE_TRIGGER_CHANCE = 0.35;
const TELEPORT_FUEL_COST = 25;
const RISK_DANGER_MARGIN = 15;
const RISK_CAUTION_MULT = 1.8;
const RISK_BANNER_TICKS = 90;

// --- 詰みからの脱出手段（008パターン#4、010 v2「拠点で無一文の間、少額の収入が入る」を移植）:
// estFuelToReturnベースの安全マージンは、進むほど帰還コストも同じ速度で増える構造上、初期装備の
// まま到達できる範囲より先には（境界タイルの掘削進捗を`digProgress`で永続化しても）実質届かない。
// その範囲内の鉱脈を掘り尽くすと収入が完全に止まり、燃料タンク等を強化する原資も稼げなくなる
// 恒久停止（reviews/011-mining-driftline-v1.md 致命バグ#1）が起きる。ホーム滞在中、最安の
// 未購入強化すら買えない資金しかない間だけ、ごく少額の収入が入るようにし、いずれ燃料タンクを
// 1段階買えるだけの資金は必ず貯まるようにする（燃料タンク+40は境界を一気に押し広げる）
const STUCK_INCOME_INTERVAL = 25;
const STUCK_INCOME_AMOUNT = 2;

const DIGGABLE: TileId[] = [TILE.DIRT, TILE.ROCK, TILE.ORE_COPPER, TILE.ORE_IRON, TILE.ORE_GOLD, TILE.GAS, TILE.UNSTABLE];

/** タイルの硬さ階層（0=最も柔らかい）。要求ドリル威力・掘削時間の基礎になる（003と同一） */
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
  [TILE.ORE_COPPER]: 7,
  [TILE.ORE_IRON]: 22,
  [TILE.ORE_GOLD]: 54,
};

/** band = floor((x-1)/40)。x=0はホーム専用（バンド計算の対象外）。009/010のfloor(x/40)をオフセット1で踏襲 */
function bandAt(x: number): number {
  return Math.floor((x - 1) / BAND_SIZE);
}
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

/** バンドごとの出現重み（003と同一の式、入力のみx由来のbandに差し替え） */
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

/** left/right=進行方向(x)、up/down=レーン変更(y) */
const DELTA: Record<Dir, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
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
  { id: 'teleport', name: 'ホームテレポート', desc: '採掘中いつでも燃料25で即時帰還できるようになる（1回のみ）', baseCost: 150, growth: 1, maxLevel: 1 },
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
  private lastRiskLevel: RiskLevel = 'safe';
  private currentRiskLevel: RiskLevel = 'safe';
  private banner: RiskEscalationBanner | null = null;
  /**
   * 詰みからの脱出手段（v2追加、reviews/011-mining-driftline-v1.md 致命バグ#1対応）:
   * タイルごとの掘削進捗を永続化する。危険域到達で強制撤退しても、次回同じタイルへ
   * 戻れば残りtickから再開できる——1トリップで完掘できなくても複数トリップの合計で
   * 必ず前進する（v1では`digging=null`で進捗を完全破棄していたため、境界タイルの
   * 手前で永久に足踏みする無限ループが発生していた）
   */
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
    lanternLevel: 0,
    hazardresistLevel: 0,
    teleportLevel: 0,
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
    const tiles = new Array<number>(LENGTH * LANES).fill(TILE.FLOOR);
    for (let x = 1; x < LENGTH; x++) {
      const band = bandAt(x);
      for (let y = 0; y < LANES; y++) {
        tiles[x * LANES + y] = pickTileType(band, this.rng);
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
  private lanternMult(): number {
    return lanternMultOf(this.player.lanternLevel);
  }
  private hazardMult(): number {
    return hazardMultOf(this.player.hazardresistLevel);
  }
  private teleportUnlocked(): boolean {
    return this.player.teleportLevel >= 1;
  }

  /** 既に掘った床だけを通ってホーム(x=0)へ戻るのに必要なマス数をBFSで求める（構造上、経路は必ず存在する） */
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
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
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
    return Math.ceil(dist * PASSIVE_FUEL_DRAIN * this.lanternMult());
  }

  private computeRiskLevel(fuel: number, estReturn: number | null): RiskLevel {
    if (estReturn === null) return 'safe';
    if (fuel <= estReturn + RISK_DANGER_MARGIN) return 'danger';
    if (fuel <= estReturn * RISK_CAUTION_MULT) return 'caution';
    return 'safe';
  }

  private static readonly RISK_ORDER: Record<RiskLevel, number> = { safe: 0, caution: 1, danger: 2 };

  /**
   * miningRiskLevelを再計算し、悪化イベントなら90tickのHUDハイライトを立てる（008パターン#11）。
   * getState()はJSONスナップショットを返すだけの純粋な読み取りであるべきなので、この副作用のある
   * 更新はstep()から1tickにつき1回だけ呼び出し、getState()側は結果（フィールド）を読むだけにする
   * （AIPのstep()がgetState()を複数回呼んでも結果が変わらないようにするため）。
   */
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
      // fallthrough: このtickのうちに採掘を開始する
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

    this.metrics.maxDistance = Math.max(this.metrics.maxDistance, this.player.x);
    this.updateRiskTracking(this.player.fuel, this.estFuelToReturn());
    this.recomputeScore();
  }

  /** 現在の掘削中タイルの残りtickを、中断される前にdigProgressへ退避する */
  private stashDigging(): void {
    if (this.player.digging) {
      const idx = this.player.digging.x * LANES + this.player.digging.y;
      this.digProgress.set(idx, this.player.digging.remaining);
    }
  }

  private applyMove(dir: Dir): void {
    const [dx, dy] = DELTA[dir];
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (!this.inBounds(nx, ny)) return;
    const t = this.tiles[nx * LANES + ny] as TileId;

    if (t === TILE.FLOOR) {
      this.stashDigging();
      this.player.digging = null;
      this.player.x = nx;
      this.player.y = ny;
      if (nx === 0) this.arriveAtHome();
      return;
    }
    if (!DIGGABLE.includes(t)) return;

    const band = bandAt(nx);
    const req = requiredDrillPower(t, band);
    if (this.drillPower() < req) return; // ドリル威力不足で不発（後出しではなく式から予測可能）

    if (!this.player.digging || this.player.digging.x !== nx || this.player.digging.y !== ny) {
      this.stashDigging();
      const idx = nx * LANES + ny;
      const total = digTicksFor(t, band, this.drillPower(), this.player.digspeedLevel);
      const saved = this.digProgress.get(idx);
      const remaining = saved !== undefined ? Math.min(saved, total) : total;
      this.player.digging = { x: nx, y: ny, remaining, total };
    }
    this.player.fuel = Math.max(0, this.player.fuel - DIG_FUEL_COST);
    this.player.digging.remaining--;
    if (this.player.digging.remaining <= 0) {
      this.digProgress.delete(nx * LANES + ny);
      this.completeDig(nx, ny, t, band);
      this.player.digging = null;
      this.player.x = nx;
      this.player.y = ny;
    }
  }

  private completeDig(x: number, y: number, type: TileId, band: number): void {
    this.tiles[x * LANES + y] = TILE.FLOOR;
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
    this.stashDigging();
    this.player.digging = null;
    this.player.x = 0;
    this.arriveAtHome();
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
      case 'lantern':
        return this.player.lanternLevel;
      case 'hazardresist':
        return this.player.hazardresistLevel;
      case 'teleport':
        return this.player.teleportLevel;
    }
  }

  /** 詰みからの脱出手段: ホーム滞在中、最安の未購入強化すら買えない間だけ少額の収入を積む */
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
      this.player.money + this.player.cargoValue + this.metrics.maxDistance * 3 + this.metrics.oreMined * 2,
    );
  }

  // ---- 状態のスナップショット（JSONシリアライズ可能） ----
  getState(): GameState {
    const shop: ShopItemState[] = SHOP_DEFS.map((def) => {
      const level = this.levelOf(def.id);
      const nextCost = level >= def.maxLevel ? null : Math.round(def.baseCost * Math.pow(def.growth, level));
      return { id: def.id, name: def.name, desc: def.desc, level, maxLevel: def.maxLevel, nextCost };
    });
    const estFuelToReturn = this.estFuelToReturn();
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
        estFuelToReturn,
        miningRiskLevel: this.currentRiskLevel,
        riskEscalationBanner: this.banner ? { ...this.banner } : null,
      },
      map: { lanes: LANES, length: LENGTH, tiles: [...this.tiles] },
      shop,
      metrics: { ...this.metrics },
    };
  }
}

export { bandAt, requiredDrillPower, digTicksFor, oreValue };
