import { mulberry32, randInt, type Rng } from './rng';
import {
  TILE,
  type Action,
  type Barricade,
  type Base,
  type Digging,
  type Dir,
  type Enemy,
  type EnemyType,
  type GameState,
  type Metrics,
  type Phase,
  type RiskEscalationBanner,
  type RiskLevel,
  type ShopItemId,
  type ShopItemState,
  type TileId,
} from './types';

// ---- ワールド定数（009/010/011と同一の横方向帯状フィールド構造を踏襲） ----
export const FIELD_WIDTH = 320;
export const LANE_COUNT = 5;
export const LENGTH = FIELD_WIDTH + 1;
const BAND_SIZE = 40;
export const HOME_RADIUS = 3;
export const OUTPOST_RADIUS = 2;
export const OUTPOST_MIN_GAP = 50;
const SPAWN_Y = Math.floor(LANE_COUNT / 2);

// ---- 燃料・掘削（011を踏襲、数値も同一） ----
const PASSIVE_FUEL_DRAIN = 1;
const DIG_FUEL_COST = 1;
const FUEL_EMPTY_HP_DRAIN = 1.5;
const GAS_FUEL_DRAIN = 15;
const HAZARD_BASE_DMG = 12;
const HAZARD_DMG_PER_BAND = 2;
const UNSTABLE_TRIGGER_CHANCE = 0.35;
const TELEPORT_FUEL_COST = 25;

// ---- 危険度ヒント2種（008パターン#11。combat=HP/推奨HP、mining=燃料/帰還推定燃料） ----
const RISK_DANGER_MARGIN = 15;
const RISK_CAUTION_MULT = 1.8;
const RISK_BANNER_TICKS = 90;

// ---- 戦闘（010の数値をmaxHp基準100（011準拠）へ合わせて約3倍にスケール） ----
const PLAYER_INIT_ATK = 18;
const ATK_CD_MAX = 5;
const ATK_RANGE = 1;
const DASH_RANGE_INIT = 4;
const DASH_CD_MAX_INIT = 30;
const DASH_INVULN_TICKS = 3;
const BASE_REGEN_PER_TICK = 4;

// ---- 詰みからの脱出手段（money版、008パターン#4。010/011と同一パターン）:
// 拠点で最安の未購入強化すら買えない間、少額の哨戒報酬が入る ----
const STUCK_INCOME_INTERVAL = 20;
const STUCK_INCOME_AMOUNT = 3;

// ---- 詰みからの脱出手段（HP版、010 v2を踏襲）: 拠点圏外・非戦闘中はごく僅かに自然回復する ----
const FIELD_REGEN_INTERVAL = 15;
const FIELD_REGEN_AMOUNT = 3;
const FIELD_REGEN_SAFE_RANGE = 5;

// ---- 建築コスト ----
const BARRICADE_BASE_COST = 8;
const BARRICADE_BAND_MULT = 0.15;
const BARRICADE_HP = 78;
const OUTPOST_BASE_COST = 70;
const OUTPOST_BAND_COST_MULT = 0.2;

// ---- 昼夜サイクル・拠点HP（013新規。012の空間構造・成長・経済はすべて継承しこの節のみ追加） ----
export const DAY_LENGTH = 1200;
export const NIGHT_LENGTH = 500;
const NIGHT_WARNING_TICKS = 150;
const HOME_BASE_MAX_HP = 400;
const OUTPOST_BASE_MAX_HP = 200;
const OUTPOST_HP_BAND_MULT = 0.15;
const BASE_DAY_REGEN = 1.5;
/** 拠点からこの距離未満のタイルはレイダーのスポーン候補から除外する（拠点直下への湧きを防ぐ） */
const RAID_MIN_SPAWN_DIST = 10;
const RAID_BASE_COUNT = 3;
const RAID_PER_NIGHT_DIV = 2;
const RAID_MAX_COUNT = 12;
/** raidRiskLevelのcaution/danger境界（拠点からの距離） */
const RAID_CAUTION_DIST = 15;
const RAID_NIGHT_ATK_MULT = 0.08;

const DIGGABLE: TileId[] = [TILE.DIRT, TILE.ROCK, TILE.ORE_COPPER, TILE.ORE_IRON, TILE.ORE_GOLD, TILE.GAS, TILE.UNSTABLE];

/** タイルの硬さ階層（0=最も柔らかい）。003/011と同一 */
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

/** band = floor((x-1)/40)。009/010/011と同一式 */
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
function recommendedHpForBand(band: number): number {
  // v1では66+band*12で、初期maxHp(100)が常に大幅に上回りcombatRiskLevelが機能しなかった。
  // band0でmaxHp(100)とほぼ等しくなるよう起点を引き上げ、vitality未投資のまま奥へ進むと
  // caution/dangerへ確実に遷移するようにした（v2 FIX）
  return 100 + Math.max(0, band) * 20;
}

function pickTileType(band: number, rng: Rng): TileId {
  const b = Math.max(0, band);
  const pHazard = Math.min(0.12, 0.02 + b * 0.015);
  const pGold = Math.min(0.05, b * 0.01);
  const pIron = Math.min(0.18, 0.02 + b * 0.025);
  const pCopper = Math.max(0.05, 0.2 - b * 0.01);
  const pStone = Math.min(0.5, 0.15 + b * 0.03);
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

interface EnemyDef {
  hp: number;
  atk: number;
  range: number;
  atkCdMax: number;
  moveCdMax: number;
  value: number;
}
const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  skirmisher: { hp: 27, atk: 9, range: 1, atkCdMax: 14, moveCdMax: 1, value: 5 },
  archer: { hp: 21, atk: 9, range: 3, atkCdMax: 18, moveCdMax: 2, value: 7 },
  brute: { hp: 72, atk: 15, range: 1, atkCdMax: 16, moveCdMax: 2, value: 14 },
};
const SPAWN_WEIGHTS: [EnemyType, number][] = [
  ['skirmisher', 0.5],
  ['archer', 0.3],
  ['brute', 0.2],
];
function pickEnemyType(rng: Rng): EnemyType {
  const r = rng();
  let acc = 0;
  for (const [t, w] of SPAWN_WEIGHTS) {
    acc += w;
    if (r < acc) return t;
  }
  return 'skirmisher';
}

function severityOf(level: RiskLevel): number {
  return level === 'safe' ? 0 : level === 'caution' ? 1 : 2;
}
function riskLevelForRatio(current: number, recommended: number): RiskLevel {
  const ratio = current / recommended;
  if (ratio >= 1) return 'safe';
  if (ratio >= 0.7) return 'caution';
  return 'danger';
}
function chebyshev(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}
function clampLane(y: number): number {
  return Math.max(0, Math.min(LANE_COUNT - 1, y));
}
function adjacentTile(x: number, y: number, dir: Dir): { nx: number; ny: number } {
  const [dx, dy] = DELTA[dir];
  return { nx: x + dx, ny: clampLane(y + dy) };
}

interface ShopDef {
  id: ShopItemId;
  name: string;
  desc: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
}
const SHOP_DEFS: ShopDef[] = [
  { id: 'offense', name: '攻撃力', desc: '攻撃力+2', baseCost: 15, growth: 1.5, maxLevel: 10 },
  { id: 'mobility', name: '機動力', desc: 'ダッシュ再使用短縮', baseCost: 12, growth: 1.45, maxLevel: 8 },
  { id: 'vitality', name: '耐久強化', desc: '最大HP+20（即回復込み）。戦闘・危険タイル両方の被弾に効く', baseCost: 20, growth: 1.4, maxLevel: 10 },
  { id: 'drill', name: 'ドリル威力', desc: 'ドリル威力+1（硬いタイルを掘れるように）', baseCost: 30, growth: 1.6, maxLevel: 8 },
  { id: 'fuel', name: '燃料タンク', desc: '最大燃料+40', baseCost: 20, growth: 1.4, maxLevel: 6 },
  { id: 'digspeed', name: '採掘速度', desc: '掘削が速くなる', baseCost: 25, growth: 1.5, maxLevel: 5 },
  { id: 'lantern', name: 'ランタン強化', desc: '受動燃料消費-5%（下限-20%）', baseCost: 20, growth: 1.3, maxLevel: 4 },
  { id: 'hazardresist', name: '危険耐性', desc: '危険タイルの被ダメージ-15%（下限-45%）', baseCost: 30, growth: 1.5, maxLevel: 3 },
  { id: 'capacity', name: '積載拡張', desc: '最大積載+5', baseCost: 15, growth: 1.3, maxLevel: 8 },
  { id: 'teleport', name: 'ホームテレポート', desc: '採掘中いつでも燃料25で即時帰還できるようになる（1回のみ）', baseCost: 150, growth: 1, maxLevel: 1 },
];

interface PlayerState {
  x: number;
  y: number;
  hp: number;
  fuel: number;
  atk: number;
  atkCd: number;
  dashCd: number;
  dashCdMax: number;
  dashRange: number;
  dashInvulnTicks: number;
  money: number;
  cargoUnits: number;
  cargoValue: number;
  digging: Digging | null;
  offenseLv: number;
  mobilityLv: number;
  vitalityLv: number;
  drillLv: number;
  fuelLv: number;
  digspeedLv: number;
  lanternLv: number;
  hazardresistLv: number;
  capacityLv: number;
  teleportLv: number;
}

function maxHpOf(vitalityLv: number): number {
  return 100 + 20 * vitalityLv;
}
function maxFuelOf(fuelLv: number): number {
  return 100 + 40 * fuelLv;
}
function maxCapacityOf(capacityLv: number): number {
  return 20 + 5 * capacityLv;
}
function drillPowerOf(drillLv: number): number {
  return 1 + drillLv;
}
function lanternMultOf(lanternLv: number): number {
  return Math.max(0.8, 1 - 0.05 * lanternLv);
}
function hazardMultOf(hazardresistLv: number): number {
  return Math.max(0.55, 1 - 0.15 * hazardresistLv);
}

export class Game {
  seed: number;
  tick = 0;
  over = false;
  won = false;
  loseReason: 'playerHp' | 'homeDestroyed' | null = null;
  private rng: Rng;
  private tiles: number[];
  private nextEnemyId = 1;
  private nextBarricadeId = 1;
  private player: PlayerState;
  private enemies: Enemy[] = [];
  private barricades: Barricade[] = [];
  private homeBase: Base = { x: 0, isHome: true, hp: HOME_BASE_MAX_HP, maxHp: HOME_BASE_MAX_HP };
  private outposts: Base[] = [];
  private wasInBase = true;
  private prevCombatSeverity = 0;
  private combatRiskBannerTicks = 0;
  private lastMiningRisk: RiskLevel = 'safe';
  private miningBanner: RiskEscalationBanner | null = null;
  private lastRaidRisk: RiskLevel = 'safe';
  private raidBanner: RiskEscalationBanner | null = null;
  private phase: Phase = 'day';
  private phaseTicksLeft = DAY_LENGTH;
  private stuckIncomeTimer = 0;
  private fieldRegenTimer = 0;
  private maxXReached = 0;
  /** タイルごとの掘削進捗の永続化（011の「詰みからの脱出手段」対策と同一パターン） */
  private digProgress = new Map<number, number>();
  private metrics: Metrics = {
    distanceReached: 0,
    kills: 0,
    died: false,
    moneyEarned: 0,
    oreMined: 0,
    oreWasted: 0,
    upgradesBought: 0,
    dashUses: 0,
    barricadesBuilt: 0,
    barricadesLost: 0,
    outpostsBuilt: 0,
    tripsToHome: 0,
    hazardHits: 0,
    hazardDamage: 0,
    fuelEmptyTicks: 0,
    combatRiskEscalations: 0,
    miningRiskEscalations: 0,
    raidRiskEscalations: 0,
    stuckIncomeEarned: 0,
    nightsSurvived: 0,
    outpostsLost: 0,
    raidersKilled: 0,
    baseDamageTaken: 0,
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.tiles = this.generateWorld();
    this.player = {
      x: 0,
      y: SPAWN_Y,
      hp: maxHpOf(0),
      fuel: maxFuelOf(0),
      atk: PLAYER_INIT_ATK,
      atkCd: 0,
      dashCd: 0,
      dashCdMax: DASH_CD_MAX_INIT,
      dashRange: DASH_RANGE_INIT,
      dashInvulnTicks: 0,
      money: 0,
      cargoUnits: 0,
      cargoValue: 0,
      digging: null,
      offenseLv: 0,
      mobilityLv: 0,
      vitalityLv: 0,
      drillLv: 0,
      fuelLv: 0,
      digspeedLv: 0,
      lanternLv: 0,
      hazardresistLv: 0,
      capacityLv: 0,
      teleportLv: 0,
    };
  }

  private generateWorld(): number[] {
    const tiles = new Array<number>(LENGTH * LANE_COUNT).fill(TILE.FLOOR);
    for (let x = HOME_RADIUS + 1; x < LENGTH; x++) {
      const band = bandAt(x);
      for (let y = 0; y < LANE_COUNT; y++) {
        tiles[x * LANE_COUNT + y] = pickTileType(band, this.rng);
      }
    }
    return tiles;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < LENGTH && y >= 0 && y < LANE_COUNT;
  }
  private tileAt(x: number, y: number): TileId {
    return this.tiles[x * LANE_COUNT + y] as TileId;
  }

  private drillPower(): number {
    return drillPowerOf(this.player.drillLv);
  }
  private maxHp(): number {
    return maxHpOf(this.player.vitalityLv);
  }
  private maxFuel(): number {
    return maxFuelOf(this.player.fuelLv);
  }
  private maxCapacity(): number {
    return maxCapacityOf(this.player.capacityLv);
  }
  private lanternMult(): number {
    return lanternMultOf(this.player.lanternLv);
  }
  private hazardMult(): number {
    return hazardMultOf(this.player.hazardresistLv);
  }
  private teleportUnlocked(): boolean {
    return this.player.teleportLv >= 1;
  }

  private allBases(): Base[] {
    return [this.homeBase, ...this.outposts];
  }
  private radiusFor(base: Base): number {
    return base.isHome ? HOME_RADIUS : OUTPOST_RADIUS;
  }
  private findBaseByX(x: number): Base | undefined {
    return this.allBases().find((b) => b.x === x);
  }
  private nearestBaseDistance(x: number): number {
    let best = Infinity;
    for (const b of this.allBases()) best = Math.min(best, Math.abs(x - b.x));
    return best;
  }
  /** 拠点（ホーム or 前線拠点）の保護範囲内か（008パターン#3） */
  private inBaseRadius(x: number): boolean {
    for (const b of this.allBases()) {
      if (Math.abs(x - b.x) <= this.radiusFor(b)) return true;
    }
    return false;
  }
  /** 拠点HPが0以下になった時の処理。ホームなら敗北、前線拠点なら破壊して除去する */
  private destroyBase(base: Base): void {
    if (base.isHome) {
      this.over = true;
      this.won = false;
      this.loseReason = 'homeDestroyed';
      this.metrics.died = true;
      return;
    }
    this.outposts = this.outposts.filter((o) => o.x !== base.x);
    this.metrics.outpostsLost++;
    // 破壊された拠点を狙っていたレイダーは、残存する最寄りの拠点へ再ターゲットする
    const remaining = this.allBases();
    for (const e of this.enemies) {
      if (!e.isRaider || e.targetBaseX !== base.x) continue;
      let best = remaining[0];
      let bestDist = Infinity;
      for (const b of remaining) {
        const d = Math.abs(e.x - b.x);
        if (d < bestDist) {
          bestDist = d;
          best = b;
        }
      }
      e.targetBaseX = best.x;
    }
  }
  /** 昼フェーズ中、レイダーに脅かされていない拠点はゆっくり自己修復する */
  private regenBasesForDay(): void {
    if (this.phase !== 'day') return;
    for (const base of this.allBases()) {
      if (base.hp >= base.maxHp) continue;
      const threatened = this.enemies.some((e) => e.isRaider && Math.abs(e.x - base.x) <= this.radiusFor(base));
      if (threatened) continue;
      base.hp = Math.min(base.maxHp, base.hp + BASE_DAY_REGEN);
    }
  }
  private barricadeAt(x: number, y: number): Barricade | undefined {
    return this.barricades.find((b) => b.x === x && b.y === y);
  }

  /**
   * 射線上（始点・終点を除く中間マス）にバリケードがあれば、それを返す（v2 FIX）。
   * v1では「移動」しか塞げなかったため、距離を維持したまま撃ち続けるarcher(range>1)に対しては
   * バリケードが無意味だった。Bresenhamで射線上の中間マスを辿り、最初に見つかったバリケードを返す
   */
  private lineOfSightBarricade(x1: number, y1: number, x2: number, y2: number): Barricade | undefined {
    let x = x1;
    let y = y1;
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;
    while (x !== x2 || y !== y2) {
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if (x === x2 && y === y2) break;
      const b = this.barricadeAt(x, y);
      if (b) return b;
    }
    return undefined;
  }

  /** 既に掘った道(FLOOR)だけを通ってホーム(x=0)へ戻るのに必要なマス数をBFSで求める */
  private bfsDistanceToHome(): number {
    if (this.player.x === 0) return 0;
    const visited = new Uint8Array(LENGTH * LANE_COUNT);
    const startIdx = this.player.x * LANE_COUNT + this.player.y;
    visited[startIdx] = 1;
    let queue: number[] = [startIdx];
    let qi = 0;
    let dist = 0;
    while (qi < queue.length) {
      const levelSize = queue.length - qi;
      dist++;
      for (let i = 0; i < levelSize; i++) {
        const idx = queue[qi++];
        const x = Math.floor(idx / LANE_COUNT);
        const y = idx % LANE_COUNT;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const nidx = nx * LANE_COUNT + ny;
          if (visited[nidx]) continue;
          if (nx === 0) return dist;
          if (this.tileAt(nx, ny) !== TILE.FLOOR) continue;
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

  private recommendedHp(): number {
    return recommendedHpForBand(bandAt(this.player.x));
  }
  private combatRiskLevel(): RiskLevel {
    return riskLevelForRatio(this.maxHp(), this.recommendedHp());
  }
  private computeMiningRisk(fuel: number, estReturn: number | null): RiskLevel {
    if (estReturn === null) return 'safe';
    if (fuel <= estReturn + RISK_DANGER_MARGIN) return 'danger';
    if (fuel <= estReturn * RISK_CAUTION_MULT) return 'caution';
    return 'safe';
  }
  private static readonly RISK_ORDER: Record<RiskLevel, number> = { safe: 0, caution: 1, danger: 2 };

  /** 夜フェーズかつどの拠点圏内にもいない場合に発火する新規ヒント（013新規） */
  private computeRaidRisk(): RiskLevel {
    if (this.phase !== 'night') return 'safe';
    if (this.inBaseRadius(this.player.x)) return 'safe';
    const dist = this.nearestBaseDistance(this.player.x);
    if (dist <= RAID_CAUTION_DIST) return 'caution';
    return 'danger';
  }

  /** 危険度3種のヒント（combat/mining/raid）を毎tick1回だけ更新する（008パターン#11の拡張） */
  private updateRiskTracking(): void {
    const combatLevel = this.combatRiskLevel();
    const combatSeverity = severityOf(combatLevel);
    if (combatSeverity > this.prevCombatSeverity) {
      this.combatRiskBannerTicks = RISK_BANNER_TICKS;
      this.metrics.combatRiskEscalations++;
    }
    this.prevCombatSeverity = combatSeverity;
    if (this.combatRiskBannerTicks > 0) this.combatRiskBannerTicks--;

    const miningLevel = this.computeMiningRisk(this.player.fuel, this.estFuelToReturn());
    if (Game.RISK_ORDER[miningLevel] > Game.RISK_ORDER[this.lastMiningRisk]) {
      this.miningBanner = { level: miningLevel, ticksLeft: RISK_BANNER_TICKS };
      this.metrics.miningRiskEscalations++;
    }
    this.lastMiningRisk = miningLevel;
    if (this.miningBanner) {
      this.miningBanner.ticksLeft--;
      if (this.miningBanner.ticksLeft <= 0) this.miningBanner = null;
    }

    const raidLevel = this.computeRaidRisk();
    if (Game.RISK_ORDER[raidLevel] > Game.RISK_ORDER[this.lastRaidRisk]) {
      this.raidBanner = { level: raidLevel, ticksLeft: RISK_BANNER_TICKS };
      this.metrics.raidRiskEscalations++;
    }
    this.lastRaidRisk = raidLevel;
    if (this.raidBanner) {
      this.raidBanner.ticksLeft--;
      if (this.raidBanner.ticksLeft <= 0) this.raidBanner = null;
    }
  }

  // ---- 敵のスポーン: 既にFLOOR化された(=掘った)道の上、プレイヤーの前方にのみ出現する ----
  // 「掘り進めた道が敵の侵入経路になる」というコアファン仮説の直接実装
  private spawnEnemies(): void {
    const band = Math.max(0, bandAt(this.player.x));
    const cap = Math.min(3 + Math.floor(band / 2), 8);
    if (this.enemies.length >= cap) return;
    const interval = Math.max(4, 7 - Math.floor(band / 2));
    const chance = Math.min(0.55, 0.3 + band * 0.02);
    if (this.tick % interval !== 0) return;
    if (this.rng() >= chance) return;

    const candidates: { x: number; y: number }[] = [];
    const spaced: { x: number; y: number }[] = [];
    for (let dx = 3; dx <= 14; dx++) {
      const x = this.player.x + dx;
      if (x > FIELD_WIDTH) break;
      if (this.inBaseRadius(x)) continue;
      for (let y = 0; y < LANE_COUNT; y++) {
        // 既に敵がいるマスは候補から除外する（v2 FIX）。プレイヤーが同じ場所に留まって
        // 停滞すると、掘削済みの候補マスが少ないまま同じ位置が繰り返し抽選され、複数の敵が
        // 完全に重なって出現しがちだった。重なった敵は同時に射撃/攻撃してくるため、
        // 停滞するほど戦闘が急激に理不尽化し、さらに停滞が悪化する悪循環を生んでいた
        if (this.tileAt(x, y) !== TILE.FLOOR || this.enemies.some((e) => e.x === x && e.y === y)) continue;
        candidates.push({ x, y });
        // v3 FIX（残課題#3）: 完全スタックは解消済みだが、隣接マスへの「準スタック」
        // （複数の敵がほぼ同じ位置に集中し、実質同時攻撃になる）は起こりうる。
        // 既存の敵から2マス以上離れた候補を優先することで準スタックの発生頻度を下げる
        if (!this.enemies.some((e) => Math.max(Math.abs(e.x - x), Math.abs(e.y - y)) <= 1)) {
          spaced.push({ x, y });
        }
      }
    }
    const pool = spaced.length > 0 ? spaced : candidates;
    if (pool.length === 0) return;
    const { x: spawnX, y: spawnY } = pool[randInt(this.rng, pool.length)];
    const type = pickEnemyType(this.rng);
    const def = ENEMY_DEFS[type];
    const mul = 1 + band * 0.1;
    this.enemies.push({
      id: this.nextEnemyId++,
      type,
      x: spawnX,
      y: spawnY,
      hp: Math.round(def.hp * mul),
      maxHp: Math.round(def.hp * mul),
      atk: Math.round(def.atk * mul),
      atkCd: 0,
      moveCd: def.moveCdMax,
      range: def.range,
      isRaider: false,
      targetBaseX: -1,
    });
  }

  /**
   * 夜フェーズ開始時に1回だけ呼ばれる。既に掘削済み(FLOOR)のタイル網全体（プレイヤー近傍に限らない）
   * から拠点圏外の候補を抽出し、奥(band高)ほど選ばれやすい重み付けでレイダーを一括スポーンさせる。
   * 「昼に掘り広げたトンネル網が夜には拠点への侵攻路になる」というコアファン仮説の直接実装
   */
  private spawnRaidWave(): void {
    const bases = this.allBases();
    const count = Math.min(RAID_MAX_COUNT, RAID_BASE_COUNT + Math.floor(this.metrics.nightsSurvived / RAID_PER_NIGHT_DIV));
    if (count <= 0) return;

    const candidates: { x: number; y: number; w: number }[] = [];
    for (let x = 0; x <= FIELD_WIDTH; x++) {
      if (bases.some((b) => Math.abs(x - b.x) < RAID_MIN_SPAWN_DIST)) continue;
      const w = 1 + Math.max(0, bandAt(x)) * 2;
      for (let y = 0; y < LANE_COUNT; y++) {
        if (this.tileAt(x, y) !== TILE.FLOOR) continue;
        candidates.push({ x, y, w });
      }
    }
    if (candidates.length === 0) return;

    const spawned: { x: number; y: number }[] = [];
    for (let i = 0; i < count; i++) {
      // 012 v3の分散ロジック（重複除外→距離優先）をレイダーの一括スポーンにも適用し、
      // 集中砲火バグが最初から起きないようにする
      let pool = candidates.filter((c) => !spawned.some((s) => Math.max(Math.abs(s.x - c.x), Math.abs(s.y - c.y)) <= 1));
      if (pool.length === 0) pool = candidates;
      const totalW = pool.reduce((a, c) => a + c.w, 0);
      let r = this.rng() * totalW;
      let picked = pool[pool.length - 1];
      for (const c of pool) {
        r -= c.w;
        if (r <= 0) {
          picked = c;
          break;
        }
      }
      spawned.push({ x: picked.x, y: picked.y });

      let target = bases[0];
      let bestDist = Infinity;
      for (const b of bases) {
        const d = Math.abs(picked.x - b.x);
        if (d < bestDist) {
          bestDist = d;
          target = b;
        }
      }

      const type = pickEnemyType(this.rng);
      const def = ENEMY_DEFS[type];
      const mul = 1 + Math.max(0, bandAt(picked.x)) * 0.1 + this.metrics.nightsSurvived * RAID_NIGHT_ATK_MULT;
      this.enemies.push({
        id: this.nextEnemyId++,
        type,
        x: picked.x,
        y: picked.y,
        hp: Math.round(def.hp * mul),
        maxHp: Math.round(def.hp * mul),
        atk: Math.round(def.atk * mul),
        atkCd: 0,
        moveCd: def.moveCdMax,
        range: def.range,
        isRaider: true,
        targetBaseX: target.x,
      });
    }
  }

  private killEnemy(e: Enemy): void {
    this.metrics.kills++;
    if (e.isRaider) this.metrics.raidersKilled++;
    const reward = ENEMY_DEFS[e.type].value;
    this.player.money += reward;
    this.metrics.moneyEarned += reward;
  }

  /** 敵の1マス移動: 既にFLOORの道しか通れない。バリケードに阻まれたらそれを返す */
  private stepTowardBlocked(e: Enemy, tx: number, ty: number): Barricade | null {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const candidates: { nx: number; ny: number }[] = [];
    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
      candidates.push({ nx: e.x + Math.sign(dx), ny: e.y });
      if (dy !== 0) candidates.push({ nx: e.x, ny: clampLane(e.y + Math.sign(dy)) });
    } else if (dy !== 0) {
      candidates.push({ nx: e.x, ny: clampLane(e.y + Math.sign(dy)) });
      if (dx !== 0) candidates.push({ nx: e.x + Math.sign(dx), ny: e.y });
    }
    let blocker: Barricade | undefined;
    for (const { nx, ny } of candidates) {
      if (nx < 0 || nx > FIELD_WIDTH || ny < 0 || ny >= LANE_COUNT) continue;
      if (this.tileAt(nx, ny) !== TILE.FLOOR) continue; // 未採掘の壁は敵も通れない
      const b = this.barricadeAt(nx, ny);
      if (!b) {
        e.x = nx;
        e.y = ny;
        return null;
      }
      blocker = b;
    }
    return blocker ?? null;
  }

  /**
   * 夜間レイダー専用の1マス移動: 目標拠点のx座標だけを目指す（yは気にしない）。
   * 主レーンが掘削されていない/バリケードで塞がれている場合は隣接レーンへの迂回を試みる。
   * 完全なBFS経路探索はしない（012のstepTowardBlockedと同系の軽量ヒューリスティック）ため、
   * 迷路状に掘られたトンネルでは詰まる可能性がある——この挙動はv1レビューで検証する対象
   */
  private stepRaiderTowardBlocked(e: Enemy, targetX: number): Barricade | null {
    const dx = targetX - e.x;
    const candidates: { nx: number; ny: number }[] = [];
    if (dx !== 0) candidates.push({ nx: e.x + Math.sign(dx), ny: e.y });
    for (const dy of [1, -1]) {
      const ny = clampLane(e.y + dy);
      if (ny !== e.y) candidates.push({ nx: e.x, ny });
    }
    let blocker: Barricade | undefined;
    for (const { nx, ny } of candidates) {
      if (nx < 0 || nx > FIELD_WIDTH || ny < 0 || ny >= LANE_COUNT) continue;
      if (this.tileAt(nx, ny) !== TILE.FLOOR) continue;
      const b = this.barricadeAt(nx, ny);
      if (!b) {
        e.x = nx;
        e.y = ny;
        return null;
      }
      if (nx !== e.x) blocker = blocker ?? b;
    }
    return blocker ?? null;
  }

  private stepAway(e: Enemy, tx: number, ty: number): void {
    const dx = tx - e.x;
    const dy = ty - e.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const nx = e.x - Math.sign(dx);
      if (nx >= 0 && nx <= FIELD_WIDTH && this.tileAt(nx, e.y) === TILE.FLOOR) e.x = nx;
    } else {
      const ny = clampLane(e.y - Math.sign(dy));
      if (this.tileAt(e.x, ny) === TILE.FLOOR) e.y = ny;
    }
  }

  private stepEnemies(): void {
    for (const e of [...this.enemies]) {
      if (!this.enemies.includes(e)) continue;

      let blockedBy: Barricade | null = null;

      if (e.isRaider) {
        // 夜間レイダー: 目標拠点のx座標だけを目指す。拠点圏内は昼間敵と違い保護対象外（侵入できる）
        const distToTarget = Math.abs(e.x - e.targetBaseX);
        if (e.moveCd > 0) e.moveCd--;
        else {
          e.moveCd = ENEMY_DEFS[e.type].moveCdMax;
          if (distToTarget > 0) blockedBy = this.stepRaiderTowardBlocked(e, e.targetBaseX);
        }
      } else {
        if (this.inBaseRadius(e.x)) continue; // 固定範囲の保護装置（008パターン#3、昼間の通常敵のみ）
        const dist = chebyshev(e.x, e.y, this.player.x, this.player.y);
        if (e.moveCd > 0) e.moveCd--;
        else {
          e.moveCd = ENEMY_DEFS[e.type].moveCdMax;
          const desiredDist = e.type === 'archer' ? Math.max(1, e.range - 1) : 0;
          if (dist > desiredDist) {
            blockedBy = this.stepTowardBlocked(e, this.player.x, this.player.y);
          } else if (e.type === 'archer' && dist < desiredDist) {
            this.stepAway(e, this.player.x, this.player.y);
          }
        }
      }

      if (e.atkCd > 0) e.atkCd--;
      if (blockedBy) {
        if (e.atkCd <= 0) {
          e.atkCd = ENEMY_DEFS[e.type].atkCdMax;
          blockedBy.hp -= e.atk;
          if (blockedBy.hp <= 0) {
            this.barricades = this.barricades.filter((b) => b.id !== blockedBy!.id);
            this.metrics.barricadesLost++;
          }
        }
        continue;
      }

      const distToPlayer = chebyshev(e.x, e.y, this.player.x, this.player.y);
      if (distToPlayer <= e.range && e.atkCd <= 0) {
        // 射線上にバリケードがあれば、プレイヤーの代わりにそれを攻撃する（012 v2 FIX継承）
        const losBlocker = distToPlayer > 1 ? this.lineOfSightBarricade(e.x, e.y, this.player.x, this.player.y) : undefined;
        if (losBlocker) {
          e.atkCd = ENEMY_DEFS[e.type].atkCdMax;
          losBlocker.hp -= e.atk;
          if (losBlocker.hp <= 0) {
            this.barricades = this.barricades.filter((b) => b.id !== losBlocker.id);
            this.metrics.barricadesLost++;
          }
        } else {
          e.atkCd = ENEMY_DEFS[e.type].atkCdMax;
          if (this.player.dashInvulnTicks <= 0) this.player.hp -= e.atk;
        }
        continue;
      }

      // 夜間レイダーが目標拠点の防衛半径内に到達し、かつプレイヤーが射程内にいない場合は拠点HPを削る
      if (e.isRaider && e.atkCd <= 0) {
        const base = this.findBaseByX(e.targetBaseX);
        if (base && Math.abs(e.x - base.x) <= this.radiusFor(base)) {
          e.atkCd = ENEMY_DEFS[e.type].atkCdMax;
          base.hp -= e.atk;
          this.metrics.baseDamageTaken += e.atk;
          if (base.hp <= 0) this.destroyBase(base);
        }
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0 && (e.isRaider || e.x >= this.player.x - 15));
  }

  /** 現在の掘削中タイルの残りtickを、中断される前にdigProgressへ退避する */
  private stashDigging(): void {
    if (this.player.digging) {
      const idx = this.player.digging.x * LANE_COUNT + this.player.digging.y;
      this.digProgress.set(idx, this.player.digging.remaining);
    }
  }

  private applyMove(dir: Dir): void {
    const { nx, ny } = adjacentTile(this.player.x, this.player.y, dir);
    const clampedX = Math.max(0, Math.min(FIELD_WIDTH, nx));
    const targetX = dir === 'left' || dir === 'right' ? clampedX : this.player.x;
    const targetY = dir === 'up' || dir === 'down' ? ny : this.player.y;
    if (!this.inBounds(targetX, targetY)) return;
    const t = this.tileAt(targetX, targetY);

    if (t === TILE.FLOOR) {
      this.stashDigging();
      this.player.digging = null;
      this.player.x = targetX;
      this.player.y = targetY;
      return;
    }
    if (!DIGGABLE.includes(t)) return;

    const band = Math.max(0, bandAt(targetX));
    const req = requiredDrillPower(t, band);
    if (this.drillPower() < req) return; // ドリル威力不足で不発（式から予測可能、後出しではない）

    if (!this.player.digging || this.player.digging.x !== targetX || this.player.digging.y !== targetY) {
      this.stashDigging();
      const idx = targetX * LANE_COUNT + targetY;
      const total = digTicksFor(t, band, this.drillPower(), this.player.digspeedLv);
      const saved = this.digProgress.get(idx);
      const remaining = saved !== undefined ? Math.min(saved, total) : total;
      this.player.digging = { x: targetX, y: targetY, remaining, total };
    }
    this.player.fuel = Math.max(0, this.player.fuel - DIG_FUEL_COST);
    this.player.digging.remaining--;
    if (this.player.digging.remaining <= 0) {
      this.digProgress.delete(targetX * LANE_COUNT + targetY);
      this.completeDig(targetX, targetY, t, band);
      this.player.digging = null;
      this.player.x = targetX;
      this.player.y = targetY;
    }
  }

  private completeDig(x: number, y: number, type: TileId, band: number): void {
    this.tiles[x * LANE_COUNT + y] = TILE.FLOOR;
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

  private applyAttack(): void {
    if (this.player.atkCd > 0) return;
    let target: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      const d = chebyshev(e.x, e.y, this.player.x, this.player.y);
      if (d <= ATK_RANGE && d < bestDist) {
        bestDist = d;
        target = e;
      }
    }
    if (!target) return;
    this.player.atkCd = ATK_CD_MAX;
    target.hp -= this.player.atk;
    if (target.hp <= 0) this.killEnemy(target);
  }

  /** ダッシュ: 既に掘った道(FLOOR)しか通れない。壁に当たったらそこで止まる */
  private applyDash(dir: Dir): void {
    if (this.player.dashCd > 0) return;
    this.player.dashCd = this.player.dashCdMax;
    this.player.dashInvulnTicks = DASH_INVULN_TICKS;
    this.metrics.dashUses++;
    const [dx, dy] = DELTA[dir];
    let { x, y } = this.player;
    for (let i = 0; i < this.player.dashRange; i++) {
      const nx = Math.max(0, Math.min(FIELD_WIDTH, x + dx));
      const ny = clampLane(y + dy);
      if (nx === x && ny === y) break;
      if (this.tileAt(nx, ny) !== TILE.FLOOR) break;
      x = nx;
      y = ny;
    }
    this.player.x = x;
    this.player.y = y;
  }

  private shopLevelOf(item: ShopItemId): number {
    const p = this.player;
    switch (item) {
      case 'offense':
        return p.offenseLv;
      case 'mobility':
        return p.mobilityLv;
      case 'vitality':
        return p.vitalityLv;
      case 'drill':
        return p.drillLv;
      case 'fuel':
        return p.fuelLv;
      case 'digspeed':
        return p.digspeedLv;
      case 'lantern':
        return p.lanternLv;
      case 'hazardresist':
        return p.hazardresistLv;
      case 'capacity':
        return p.capacityLv;
      case 'teleport':
        return p.teleportLv;
    }
  }
  private shopCostOf(item: ShopItemId): number | null {
    const def = SHOP_DEFS.find((d) => d.id === item)!;
    const level = this.shopLevelOf(item);
    if (level >= def.maxLevel) return null;
    return Math.round(def.baseCost * Math.pow(def.growth, level));
  }

  private applyBuy(item: ShopItemId): void {
    if (!this.inBaseRadius(this.player.x)) return;
    const cost = this.shopCostOf(item);
    if (cost === null || this.player.money < cost) return;
    this.player.money -= cost;
    const p = this.player;
    switch (item) {
      case 'offense':
        p.offenseLv++;
        p.atk += 2;
        break;
      case 'mobility':
        p.mobilityLv++;
        p.dashCdMax = Math.max(12, p.dashCdMax - 3);
        break;
      case 'vitality':
        p.vitalityLv++;
        p.hp = Math.min(this.maxHp(), p.hp + 20);
        break;
      case 'drill':
        p.drillLv++;
        break;
      case 'fuel':
        p.fuelLv++;
        break;
      case 'digspeed':
        p.digspeedLv++;
        break;
      case 'lantern':
        p.lanternLv++;
        break;
      case 'hazardresist':
        p.hazardresistLv++;
        break;
      case 'capacity':
        p.capacityLv++;
        break;
      case 'teleport':
        p.teleportLv++;
        break;
    }
    this.metrics.upgradesBought++;
  }

  /** バリケード設置（008パターン#6「建築を第三の選択肢にする」） */
  private applyBuildBarricade(dir: Dir): void {
    const { nx, ny } = adjacentTile(this.player.x, this.player.y, dir);
    const targetX = dir === 'left' || dir === 'right' ? Math.max(0, Math.min(FIELD_WIDTH, nx)) : this.player.x;
    const targetY = dir === 'up' || dir === 'down' ? ny : this.player.y;
    if (!this.inBounds(targetX, targetY)) return;
    if (this.tileAt(targetX, targetY) !== TILE.FLOOR) return; // 既に掘った道にしか置けない
    if (this.barricadeAt(targetX, targetY)) return;
    const cost = Math.round(BARRICADE_BASE_COST * (1 + Math.max(0, bandAt(this.player.x)) * BARRICADE_BAND_MULT));
    if (this.player.money < cost) return;
    this.player.money -= cost;
    this.barricades.push({ id: this.nextBarricadeId++, x: targetX, y: targetY, hp: BARRICADE_HP, maxHp: BARRICADE_HP });
    this.metrics.barricadesBuilt++;
  }

  /**
   * 前線拠点の建設（008パターン#7「目標を生む建築」）。013では拠点HPも新規付与し、
   * 「建てるほど往復コストが下がる」メリットと「建てるほど夜に守るものが増える」リスクを両立させる
   */
  private applyBuildOutpost(): void {
    const x = this.player.x;
    if (this.tileAt(x, this.player.y) !== TILE.FLOOR) return;
    if (this.nearestBaseDistance(x) < OUTPOST_MIN_GAP) return;
    const band = Math.max(0, bandAt(x));
    const cost = Math.round(OUTPOST_BASE_COST * (1 + band * OUTPOST_BAND_COST_MULT));
    if (this.player.money < cost) return;
    this.player.money -= cost;
    const maxHp = Math.round(OUTPOST_BASE_MAX_HP * (1 + band * OUTPOST_HP_BAND_MULT));
    this.outposts.push({ x, isHome: false, hp: maxHp, maxHp });
    this.metrics.outpostsBuilt++;
  }

  private applyTeleport(): void {
    if (!this.teleportUnlocked() || this.player.fuel < TELEPORT_FUEL_COST) return;
    this.player.fuel -= TELEPORT_FUEL_COST;
    this.stashDigging();
    this.player.digging = null;
    this.player.x = 0;
    this.player.y = SPAWN_Y;
  }

  /** 詰みからの脱出手段（money版）: 拠点滞在中、最安の未購入強化すら買えない間だけ少額の収入を積む */
  private tickStuckIncome(): void {
    let minCost: number | null = null;
    for (const def of SHOP_DEFS) {
      const cost = this.shopCostOf(def.id);
      if (cost !== null && (minCost === null || cost < minCost)) minCost = cost;
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

  private recomputeScore(): void {
    this.metrics.score = Math.round(
      this.player.money +
        this.player.cargoValue +
        this.metrics.distanceReached * 3 +
        this.metrics.oreMined * 2 +
        this.metrics.kills * 5 +
        this.metrics.outpostsBuilt * 60 +
        this.metrics.barricadesBuilt * 2 +
        this.metrics.nightsSurvived * 80 -
        this.metrics.outpostsLost * 40 +
        (this.won ? 300 : 0),
    );
  }

  step(action: Action = { type: 'wait' }): void {
    if (this.over) return;
    this.tick++;

    // ---- 昼夜フェーズの進行（013新規）: 夜へ切り替わる瞬間にレイダーを一括スポーンさせる ----
    this.phaseTicksLeft--;
    if (this.phaseTicksLeft <= 0) {
      if (this.phase === 'day') {
        this.phase = 'night';
        this.phaseTicksLeft = NIGHT_LENGTH;
        this.spawnRaidWave();
      } else {
        this.phase = 'day';
        this.phaseTicksLeft = DAY_LENGTH;
        this.metrics.nightsSurvived++;
        // v2 FIX（v1バグ#1）: 夜が明けても倒し損ねたレイダーが消滅せず拠点に張り付き続け、
        // 複数夜にまたがる累積ダメージでホームが陥落していた。「昼=安全」という設計意図を
        // 成立させるため、日の出とともに残存レイダーは撤退（消滅）させる
        this.enemies = this.enemies.filter((e) => !e.isRaider);
      }
    }
    this.regenBasesForDay();

    // ---- 拠点処理: 換金・燃料全回復・HP自然回復・詰みからの脱出手段(money版) ----
    const inBase = this.inBaseRadius(this.player.x);
    if (inBase) {
      if (!this.wasInBase && this.player.cargoUnits > 0) this.metrics.tripsToHome++;
      if (this.player.cargoUnits > 0) {
        this.player.money += this.player.cargoValue;
        this.metrics.moneyEarned += this.player.cargoValue;
        this.player.cargoValue = 0;
        this.player.cargoUnits = 0;
      }
      this.player.fuel = this.maxFuel();
      this.player.hp = Math.min(this.maxHp(), this.player.hp + BASE_REGEN_PER_TICK);
      this.tickStuckIncome();
      this.fieldRegenTimer = 0;
    } else {
      this.stuckIncomeTimer = 0;
      // 詰みからの脱出手段(HP版): 拠点圏外・非戦闘中はごく僅かに自然回復する
      const inCombat = this.enemies.some((e) => chebyshev(e.x, e.y, this.player.x, this.player.y) <= FIELD_REGEN_SAFE_RANGE);
      if (this.player.hp < this.maxHp() && !inCombat) {
        this.fieldRegenTimer++;
        if (this.fieldRegenTimer >= FIELD_REGEN_INTERVAL) {
          this.fieldRegenTimer = 0;
          this.player.hp = Math.min(this.maxHp(), this.player.hp + FIELD_REGEN_AMOUNT);
        }
      } else {
        this.fieldRegenTimer = 0;
      }
    }
    this.wasInBase = inBase;

    // ---- 燃料の受動消費・燃料切れダメージ ----
    if (this.player.fuel <= 0) {
      this.player.hp -= FUEL_EMPTY_HP_DRAIN;
      this.metrics.fuelEmptyTicks++;
    }
    this.player.fuel = Math.max(0, this.player.fuel - PASSIVE_FUEL_DRAIN * this.lanternMult());

    switch (action.type) {
      case 'move':
        this.applyMove(action.dir);
        break;
      case 'attack':
        this.applyAttack();
        break;
      case 'dash':
        this.applyDash(action.dir);
        break;
      case 'buy':
        this.applyBuy(action.item);
        break;
      case 'build':
        if (action.target === 'barricade') this.applyBuildBarricade(action.dir);
        else this.applyBuildOutpost();
        break;
      case 'teleport':
        this.applyTeleport();
        break;
      case 'wait':
        break;
    }

    if (this.player.atkCd > 0) this.player.atkCd--;
    if (this.player.dashCd > 0) this.player.dashCd--;
    if (this.player.dashInvulnTicks > 0) this.player.dashInvulnTicks--;

    this.maxXReached = Math.max(this.maxXReached, this.player.x);

    if (!this.over && this.player.x >= FIELD_WIDTH) {
      this.over = true;
      this.won = true;
    }

    if (!this.over) {
      if (this.phase === 'day') this.spawnEnemies();
      this.stepEnemies();
      this.updateRiskTracking();
      if (!this.over && this.player.hp <= 0) {
        this.over = true;
        this.won = false;
        this.loseReason = 'playerHp';
        this.metrics.died = true;
      }
    }

    this.metrics.distanceReached = this.maxXReached;
    this.recomputeScore();
  }

  getState(): GameState {
    const p = this.player;
    const baseDist = this.nearestBaseDistance(p.x);
    const shopPrices = {} as Record<ShopItemId, number | null>;
    const shop: ShopItemState[] = SHOP_DEFS.map((def) => {
      const level = this.shopLevelOf(def.id);
      const nextCost = this.shopCostOf(def.id);
      shopPrices[def.id] = nextCost;
      return { id: def.id, name: def.name, desc: def.desc, level, maxLevel: def.maxLevel, nextCost };
    });
    return {
      tick: this.tick,
      over: this.over,
      won: this.won,
      loseReason: this.loseReason,
      phase: this.phase,
      phaseTicksLeft: this.phaseTicksLeft,
      nightWarning: this.phase === 'day' && this.phaseTicksLeft <= NIGHT_WARNING_TICKS,
      player: {
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: this.maxHp(),
        fuel: p.fuel,
        maxFuel: this.maxFuel(),
        atk: p.atk,
        atkCd: p.atkCd,
        atkCdMax: ATK_CD_MAX,
        atkRange: ATK_RANGE,
        dashCd: p.dashCd,
        dashCdMax: p.dashCdMax,
        dashRange: p.dashRange,
        money: p.money,
        drillPower: this.drillPower(),
        cargoUnits: p.cargoUnits,
        maxCapacity: this.maxCapacity(),
        cargoValue: p.cargoValue,
        teleportUnlocked: this.teleportUnlocked(),
        digging: p.digging ? { ...p.digging } : null,
        estFuelToReturn: this.estFuelToReturn(),
        recommendedHp: this.recommendedHp(),
        combatRiskLevel: this.combatRiskLevel(),
        combatRiskBanner: this.combatRiskBannerTicks,
        miningRiskLevel: this.lastMiningRisk,
        miningRiskBanner: this.miningBanner ? { ...this.miningBanner } : null,
        raidRiskLevel: this.lastRaidRisk,
        raidRiskBanner: this.raidBanner ? { ...this.raidBanner } : null,
        shopPrices,
        buildCosts: {
          barricade: Math.round(BARRICADE_BASE_COST * (1 + Math.max(0, bandAt(p.x)) * BARRICADE_BAND_MULT)),
          outpost: Math.round(OUTPOST_BASE_COST * (1 + Math.max(0, bandAt(p.x)) * OUTPOST_BAND_COST_MULT)),
        },
        canBuildOutpost: baseDist >= OUTPOST_MIN_GAP && this.tileAt(p.x, p.y) === TILE.FLOOR,
        baseDistance: baseDist,
      },
      map: {
        width: FIELD_WIDTH,
        laneCount: LANE_COUNT,
        goalDistance: FIELD_WIDTH,
        homeRadius: HOME_RADIUS,
        outpostRadius: OUTPOST_RADIUS,
        outpostMinGap: OUTPOST_MIN_GAP,
        tiles: [...this.tiles],
      },
      enemies: this.enemies.map((e) => ({ ...e })),
      barricades: this.barricades.map((b) => ({ ...b })),
      outposts: this.outposts.map((o) => o.x),
      bases: this.allBases().map((b) => ({ ...b })),
      shop,
      metrics: { ...this.metrics },
    };
  }
}
