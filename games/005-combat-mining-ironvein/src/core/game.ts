import { mulberry32, type Rng } from './rng';
import {
  TILE,
  type Action,
  type Dir,
  type Digging,
  type Enemy,
  type EnemyType,
  type GameState,
  type Metrics,
  type ShopItemState,
  type TileId,
  type UpgradeId,
} from './types';

// ---- バランス定数（specs/005-combat-mining-ironvein/spec.md の表と一致させる） ----
export const W = 16;
export const H = 161; // y=0: 地上, y=1..160: 8バンド x 20
const BAND_SIZE = 20;
const SPAWN_X = Math.floor(W / 2);
const SAFE_ZONE_Y = 2; // y<=2 は敵の湧き・侵入を禁止（固定範囲の保護装置）

const PASSIVE_FUEL_DRAIN = 1;
const DIG_FUEL_COST = 1;
const FUEL_EMPTY_HP_DRAIN = 1.5;

const NOISE_MAX = 100;
const NOISE_DIG_GAIN = 6;
const NOISE_DECAY_IDLE = 3;
const NOISE_DECAY_MOVE = 10;
// v1実装中の調整: 初期値(0.004/0.0006, enemyCap 3+band/2 上限8)では常時2〜3体の同時接敵が
// 序盤（スキル未習得）から発生し、複数同時攻撃に対して単体攻撃しか持たないプレイヤーが
// 数千tickかけて確実に磨り減って全滅する（10シード中10死亡）ことをシミュレーションで検出したため引き下げた
const SPAWN_BASE = 0.003;
const SPAWN_NOISE_COEF = 0.0004;

const MOVE_EVASION_TICKS = 2;
const MOVE_EVASION_REDUCTION = 0.15;

const LABOR_INCOME_INTERVAL = 15;
const LABOR_INCOME_AMOUNT = 1;
const SURFACE_HP_REGEN = 1;
const MILESTONE_BONUS_PER_BAND = 30;

const SPAWN_RADIUS_MIN = 3;
const SPAWN_RADIUS_MAX = 7;

const DIGGABLE: TileId[] = [TILE.DIRT, TILE.ROCK, TILE.ORE_COPPER, TILE.ORE_IRON, TILE.ORE_GOLD];

/** タイルの硬さ階層（0=最も柔らかい）。要求採掘威力・掘削時間の基礎になる */
const TIER: Partial<Record<TileId, number>> = {
  [TILE.DIRT]: 0,
  [TILE.ORE_COPPER]: 0,
  [TILE.ROCK]: 0, // 003の教訓: 岩を土・銅鉱石と同格にしないと収入源が尽きる経済的詰みが起きる
  [TILE.ORE_IRON]: 2,
  [TILE.ORE_GOLD]: 3,
};
const BASE_TICKS: Partial<Record<TileId, number>> = {
  [TILE.DIRT]: 2,
  [TILE.ORE_COPPER]: 3,
  [TILE.ROCK]: 4,
  [TILE.ORE_IRON]: 5,
  [TILE.ORE_GOLD]: 6,
};
const BASE_VALUE: Partial<Record<TileId, number>> = {
  [TILE.ORE_COPPER]: 7,
  [TILE.ORE_IRON]: 22,
  [TILE.ORE_GOLD]: 54,
};

const ENEMY_STATS: Record<EnemyType, { hp: number; atk: number; atkCdMax: number; moveCdMax: number }> = {
  crawler: { hp: 18, atk: 6, atkCdMax: 6, moveCdMax: 5 },
  brute: { hp: 55, atk: 14, atkCdMax: 10, moveCdMax: 8 },
};

function bandAt(y: number): number {
  return Math.floor((y - 1) / BAND_SIZE);
}
function requiredDrillPower(type: TileId, band: number): number {
  const tier = TIER[type] ?? 0;
  return 1 + tier + Math.floor(band / 2);
}
function digTicksFor(type: TileId, band: number, drillPower: number): number {
  const req = requiredDrillPower(type, band);
  const base = BASE_TICKS[type] ?? 2;
  const bonus = 0.2 * (drillPower - req);
  return Math.max(1, Math.round(base / (1 + bonus)));
}
function oreValue(type: TileId, band: number): number {
  const base = BASE_VALUE[type] ?? 0;
  return Math.round(base * (1 + band * 0.12));
}
function bandMult(band: number): number {
  return 1 + band * 0.35;
}
function depthMult(band: number): number {
  return 1 + band * 0.2;
}
function enemyCap(band: number): number {
  return Math.min(2 + Math.floor(band / 3), 6);
}

/** バンドごとの出現重み。深いほど土が減り、鉱石が増える（003のロジックからガス・不安定タイルを除いたもの） */
function pickTileType(band: number, rng: Rng): TileId {
  const pGold = Math.min(0.05, band * 0.01);
  const pIron = Math.min(0.18, 0.02 + band * 0.025);
  const pCopper = Math.max(0.05, 0.2 - band * 0.01);
  const pStone = Math.min(0.5, 0.15 + band * 0.03);
  const pDirt = Math.max(0, 1 - (pGold + pIron + pCopper + pStone));
  const entries: [TileId, number][] = [
    [TILE.DIRT, pDirt],
    [TILE.ROCK, pStone],
    [TILE.ORE_COPPER, pCopper],
    [TILE.ORE_IRON, pIron],
    [TILE.ORE_GOLD, pGold],
  ];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [type, w] of entries) {
    r -= w;
    if (r <= 0) return type;
  }
  return TILE.DIRT;
}
function pickEnemyType(band: number, rng: Rng): EnemyType {
  const pBrute = Math.min(0.35, band * 0.05);
  return rng() < pBrute ? 'brute' : 'crawler';
}

const DELTA: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const DELTA8: [number, number][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

interface ShopDef {
  id: UpgradeId;
  name: string;
  desc: string;
  baseCost: number;
  growth: number;
  maxLevel: number;
}

const SHOP_DEFS: ShopDef[] = [
  { id: 'drill', name: '採掘威力', desc: '採掘威力+1（硬いタイル・深い鉱石を掘れるように）', baseCost: 30, growth: 1.6, maxLevel: 8 },
  { id: 'capacity', name: '積載拡張', desc: '最大積載+5', baseCost: 15, growth: 1.3, maxLevel: 8 },
  { id: 'fuel', name: '燃料タンク', desc: '最大燃料+30', baseCost: 20, growth: 1.4, maxLevel: 6 },
  { id: 'atk', name: '攻撃力強化', desc: '攻撃力+4', baseCost: 25, growth: 1.5, maxLevel: 8 },
  { id: 'hp', name: '体力強化', desc: '最大HP+20（即回復込み）', baseCost: 25, growth: 1.4, maxLevel: 6 },
  { id: 'atkspeed', name: '攻撃速度強化', desc: '攻撃クールダウン-1（下限1）', baseCost: 25, growth: 1.5, maxLevel: 2 },
  { id: 'skill', name: '範囲攻撃', desc: 'Lv1で周囲8方向への範囲攻撃を解禁。以降ダメージ+8・CD-2（下限8）', baseCost: 40, growth: 1.6, maxLevel: 5 },
  { id: 'muffler', name: '防音マフラー', desc: '掘削で発生する掘削音の蓄積量-15%（下限-45%）', baseCost: 20, growth: 1.3, maxLevel: 3 },
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
  noise: number;
  moveEvasion: number;
  attackCd: number;
  skillCd: number;
  drillLevel: number;
  capacityLevel: number;
  fuelLevel: number;
  atkLevel: number;
  hpLevel: number;
  atkspeedLevel: number;
  skillLevel: number;
  mufflerLevel: number;
}

function maxHpOf(level: number): number {
  return 100 + 20 * level;
}
function maxFuelOf(level: number): number {
  return 100 + 30 * level;
}
function maxCapacityOf(level: number): number {
  return 20 + 5 * level;
}
function drillPowerOf(level: number): number {
  return 1 + level;
}
function atkOf(level: number): number {
  return 14 + 4 * level;
}
function attackCdMaxOf(level: number): number {
  return Math.max(1, 3 - level);
}
function hasSkillOf(level: number): boolean {
  return level >= 1;
}
function skillDmgOf(level: number): number {
  return level >= 1 ? 12 + 8 * (level - 1) : 0;
}
function skillCdMaxOf(level: number): number {
  return level >= 1 ? Math.max(8, 20 - 2 * (level - 1)) : 0;
}
function mufflerMultOf(level: number): number {
  return Math.max(0.55, 1 - 0.15 * level);
}

export class Game {
  readonly seed: number;
  private rng: Rng;
  private tiles: number[];
  private tick = 0;
  private phase: 'mine' | 'shop' | 'gameover' = 'shop';
  private _over = false;
  private enemies: Enemy[] = [];
  private nextEnemyId = 1;
  private lastMilestoneBand = 0;
  private player: PlayerState = {
    x: SPAWN_X,
    y: 0,
    hp: maxHpOf(0),
    fuel: maxFuelOf(0),
    money: 0,
    cargoUnits: 0,
    cargoValue: 0,
    digging: null,
    noise: 0,
    moveEvasion: 0,
    attackCd: 0,
    skillCd: 0,
    drillLevel: 0,
    capacityLevel: 0,
    fuelLevel: 0,
    atkLevel: 0,
    hpLevel: 0,
    atkspeedLevel: 0,
    skillLevel: 0,
    mufflerLevel: 0,
  };
  private metrics: Metrics = {
    oreMined: 0,
    moneyEarned: 0,
    maxDepth: 0,
    kills: 0,
    damageDealt: 0,
    damageTaken: 0,
    upgradesBought: 0,
    tripsToSurface: 0,
    milestonesReached: 0,
    skillUses: 0,
    fuelEmptyTicks: 0,
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
  private tileAt(x: number, y: number): number {
    return this.tiles[y * W + x];
  }
  private enemyAt(x: number, y: number): Enemy | undefined {
    return this.enemies.find((e) => e.hp > 0 && e.x === x && e.y === y);
  }
  private isEnemyFloor(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y * W + x] === TILE.FLOOR && y > SAFE_ZONE_Y;
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
  private atk(): number {
    return atkOf(this.player.atkLevel);
  }
  private attackCdMax(): number {
    return attackCdMaxOf(this.player.atkspeedLevel);
  }
  private hasSkill(): boolean {
    return hasSkillOf(this.player.skillLevel);
  }
  private skillDmg(): number {
    return skillDmgOf(this.player.skillLevel);
  }
  private skillCdMax(): number {
    return skillCdMaxOf(this.player.skillLevel);
  }
  private mufflerMult(): number {
    return mufflerMultOf(this.player.mufflerLevel);
  }

  /** 既に掘った床だけを通って地上(y=0)へ戻るのに必要なマス数をBFSで求める */
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
    return Math.ceil(dist * PASSIVE_FUEL_DRAIN);
  }

  // ---- メインループ: 1ティック進める ----
  step(action: Action = { type: 'wait' }): void {
    if (this._over) return;
    this.tick++;

    // 詰みからの脱出手段: 地上滞在が一定tickに達するたび最低限の労働収入を得る（004のLABOR_INCOMEを踏襲）
    if (this.player.y === 0) {
      if (this.tick % LABOR_INCOME_INTERVAL === 0) this.player.money += LABOR_INCOME_AMOUNT;
      // 地上での休息によるHP回復。これがないと「HP危険域で無一文」の状態から抜け出す手段がなく、
      // 地上(y=0)と深度1の間を無限往復し続ける詰みループが発生する（実装中のシミュレーションで検出）
      this.player.hp = Math.min(this.maxHp(), this.player.hp + SURFACE_HP_REGEN);
    }

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
    if (this.player.attackCd > 0) this.player.attackCd--;
    if (this.player.skillCd > 0) this.player.skillCd--;
    if (this.player.moveEvasion > 0) this.player.moveEvasion--;

    if (this.player.fuel <= 0) {
      this.player.hp -= FUEL_EMPTY_HP_DRAIN;
      this.metrics.fuelEmptyTicks++;
    }
    this.player.fuel = Math.max(0, this.player.fuel - PASSIVE_FUEL_DRAIN);

    const { dug, moved } = this.applyPlayerAction(action);
    this.updateNoise(dug, moved);

    this.trySpawnByChance();
    this.updateEnemies();
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this._over = true;
      this.phase = 'gameover';
    }

    this.metrics.maxDepth = Math.max(this.metrics.maxDepth, this.player.y);
    this.checkMilestone();
    this.recomputeScore();
  }

  private updateNoise(dug: boolean, moved: boolean): void {
    if (dug) {
      this.player.noise = Math.min(NOISE_MAX, this.player.noise + NOISE_DIG_GAIN * this.mufflerMult());
    } else if (moved) {
      this.player.noise = Math.max(0, this.player.noise - NOISE_DECAY_MOVE);
    } else {
      this.player.noise = Math.max(0, this.player.noise - NOISE_DECAY_IDLE);
    }
  }

  private checkMilestone(): void {
    const band = Math.floor(this.metrics.maxDepth / BAND_SIZE);
    if (band > this.lastMilestoneBand) {
      this.player.money += MILESTONE_BONUS_PER_BAND * band;
      this.metrics.milestonesReached++;
      this.lastMilestoneBand = band;
    }
  }

  /** @returns dug=このtickに掘削したか, moved=既に掘った床へ実際に移動したか（採掘音の増減判定に使う） */
  private applyPlayerAction(action: Action): { dug: boolean; moved: boolean } {
    const p = this.player;
    switch (action.type) {
      case 'move':
        return this.applyMove(action.dir);
      case 'attack': {
        if (p.attackCd > 0) break;
        const [dx, dy] = DELTA[action.dir];
        const target = this.enemyAt(p.x + dx, p.y + dy);
        if (target) this.damageEnemy(target, this.atk());
        p.attackCd = this.attackCdMax();
        break;
      }
      case 'skill': {
        if (!this.hasSkill() || p.skillCd > 0) break;
        this.metrics.skillUses++;
        const dmg = this.skillDmg();
        for (const [dx, dy] of DELTA8) {
          const target = this.enemyAt(p.x + dx, p.y + dy);
          if (target) this.damageEnemy(target, dmg);
        }
        p.skillCd = this.skillCdMax();
        break;
      }
      case 'wait':
      case 'buy':
        break;
    }
    return { dug: false, moved: false };
  }

  private applyMove(dir: Dir): { dug: boolean; moved: boolean } {
    const p = this.player;
    const [dx, dy] = DELTA[dir];
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!this.inBounds(nx, ny)) return { dug: false, moved: false };
    if (this.enemyAt(nx, ny)) return { dug: false, moved: false }; // 敵のいるマスへは移動できない（攻撃で対応）
    const t = this.tileAt(nx, ny) as TileId;

    if (t === TILE.FLOOR) {
      p.digging = null;
      p.x = nx;
      p.y = ny;
      p.moveEvasion = MOVE_EVASION_TICKS;
      if (ny === 0) this.arriveAtSurface();
      return { dug: false, moved: true };
    }
    if (!DIGGABLE.includes(t)) return { dug: false, moved: false };

    const band = bandAt(ny);
    const req = requiredDrillPower(t, band);
    if (this.drillPower() < req) return { dug: false, moved: false }; // 採掘威力不足で不発

    if (!p.digging || p.digging.x !== nx || p.digging.y !== ny) {
      const total = digTicksFor(t, band, this.drillPower());
      p.digging = { x: nx, y: ny, remaining: total, total };
    }
    p.fuel = Math.max(0, p.fuel - DIG_FUEL_COST);
    p.digging.remaining--;
    if (p.digging.remaining <= 0) {
      this.completeDig(nx, ny, t, band);
      p.digging = null;
      p.x = nx;
      p.y = ny;
    }
    return { dug: true, moved: false };
  }

  private completeDig(x: number, y: number, type: TileId, band: number): void {
    this.tiles[y * W + x] = TILE.FLOOR;
    if (type === TILE.ORE_COPPER || type === TILE.ORE_IRON || type === TILE.ORE_GOLD) {
      if (this.player.cargoUnits < this.maxCapacity()) {
        this.player.cargoUnits++;
        this.player.cargoValue += oreValue(type, band);
        this.metrics.oreMined++;
      }
    }
    // DIRT / ROCK: 何も起きない
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

  private damageEnemy(e: Enemy, dmg: number): void {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    this.metrics.damageDealt += dmg;
    if (e.hp <= 0) this.metrics.kills++;
  }

  // ---- 敵の湧き ----
  private trySpawnByChance(): void {
    if (this.enemies.length >= enemyCap(bandAt(Math.max(1, this.player.y)))) return;
    const band = bandAt(Math.max(1, this.player.y));
    const chance = SPAWN_BASE * bandMult(band) + this.player.noise * SPAWN_NOISE_COEF;
    if (this.rng() < chance) this.trySpawnEnemy(band);
  }

  private trySpawnEnemy(band: number): void {
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = this.rng() * Math.PI * 2;
      const radius = SPAWN_RADIUS_MIN + Math.floor(this.rng() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN + 1));
      const x = Math.round(this.player.x + Math.cos(angle) * radius);
      const y = Math.round(this.player.y + Math.sin(angle) * radius);
      if (!this.isEnemyFloor(x, y) || this.enemyAt(x, y) || (x === this.player.x && y === this.player.y)) continue;
      const type = pickEnemyType(band, this.rng);
      const stats = ENEMY_STATS[type];
      const mult = depthMult(band);
      const hp = Math.round(stats.hp * mult);
      this.enemies.push({
        id: this.nextEnemyId++,
        type,
        x,
        y,
        hp,
        maxHp: hp,
        atk: Math.round(stats.atk * mult),
        atkCd: 0,
        moveCd: 0,
      });
      return;
    }
  }

  // ---- 敵AI（002の囲みスロット割当てを踏襲: 同一経路への渋滞を避ける） ----
  private updateEnemies(): void {
    const p = this.player;
    const slots: [number, number][] = [];
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const sx = p.x + dx;
      const sy = p.y + dy;
      if (this.isEnemyFloor(sx, sy)) slots.push([sx, sy]);
    }
    const takenSlots = new Set<string>();
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (Math.abs(p.x - e.x) + Math.abs(p.y - e.y) === 1) takenSlots.add(`${e.x},${e.y}`);
    }
    const nonAdjacent = this.enemies
      .filter((e) => e.hp > 0 && Math.abs(p.x - e.x) + Math.abs(p.y - e.y) !== 1)
      .sort((a, b) => {
        const da = Math.abs(p.x - a.x) + Math.abs(p.y - a.y);
        const db = Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
        return da !== db ? da - db : a.id - b.id;
      });
    const targets = new Map<number, [number, number]>();
    for (const e of nonAdjacent) {
      let best: [number, number] | null = null;
      let bestDist = Infinity;
      for (const [sx, sy] of slots) {
        const key = `${sx},${sy}`;
        if (takenSlots.has(key)) continue;
        const dist = Math.abs(sx - e.x) + Math.abs(sy - e.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = [sx, sy];
        }
      }
      if (best) {
        targets.set(e.id, best);
        takenSlots.add(`${best[0]},${best[1]}`);
      }
    }
    for (const e of this.enemies) this.updateEnemy(e, targets.get(e.id));
  }

  private updateEnemy(e: Enemy, moveTarget?: [number, number]): void {
    if (e.hp <= 0) return;
    const stats = ENEMY_STATS[e.type];
    if (e.atkCd > 0) e.atkCd--;
    if (e.moveCd > 0) e.moveCd--;

    const p = this.player;
    const dx = p.x - e.x;
    const dy = p.y - e.y;

    if (Math.abs(dx) + Math.abs(dy) === 1) {
      if (e.atkCd === 0) {
        const dmg = p.moveEvasion > 0 ? Math.round(e.atk * (1 - MOVE_EVASION_REDUCTION)) : e.atk;
        p.hp -= dmg;
        this.metrics.damageTaken += dmg;
        e.atkCd = stats.atkCdMax;
      }
      return;
    }

    if (e.moveCd > 0) return;

    const [tx, ty] = moveTarget ?? [p.x, p.y];
    const dir = this.bfsStepToward(e.x, e.y, tx, ty);
    if (dir) {
      const [mx, my] = DELTA[dir];
      const nx = e.x + mx;
      const ny = e.y + my;
      if (this.isEnemyFloor(nx, ny) && !this.enemyAt(nx, ny) && !(nx === p.x && ny === p.y)) {
        e.x = nx;
        e.y = ny;
        e.moveCd = stats.moveCdMax;
      }
    }
  }

  /** BFSで最短経路の最初の一手を返す（既に掘った床だけを通行可能とする） */
  private bfsStepToward(sx: number, sy: number, tx: number, ty: number): Dir | null {
    if (sx === tx && sy === ty) return null;
    const visited = new Uint8Array(W * H);
    visited[sy * W + sx] = 1;
    const queue: { x: number; y: number; root: Dir }[] = [];
    let head = 0;
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = sx + dx;
      const ny = sy + dy;
      if (!this.isEnemyFloor(nx, ny) && !(nx === tx && ny === ty)) continue;
      if (nx === tx && ny === ty) return d;
      visited[ny * W + nx] = 1;
      queue.push({ x: nx, y: ny, root: d });
    }
    while (head < queue.length) {
      const cur = queue[head++];
      for (const d of DIRS) {
        const [dx, dy] = DELTA[d];
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!this.inBounds(nx, ny) || visited[ny * W + nx]) continue;
        if (nx === tx && ny === ty) return cur.root;
        if (!this.isEnemyFloor(nx, ny)) continue;
        visited[ny * W + nx] = 1;
        queue.push({ x: nx, y: ny, root: cur.root });
      }
    }
    return null;
  }

  // ---- ショップ ----
  private levelOf(item: UpgradeId): number {
    switch (item) {
      case 'drill':
        return this.player.drillLevel;
      case 'capacity':
        return this.player.capacityLevel;
      case 'fuel':
        return this.player.fuelLevel;
      case 'atk':
        return this.player.atkLevel;
      case 'hp':
        return this.player.hpLevel;
      case 'atkspeed':
        return this.player.atkspeedLevel;
      case 'skill':
        return this.player.skillLevel;
      case 'muffler':
        return this.player.mufflerLevel;
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
      case 'capacity':
        this.player.capacityLevel++;
        break;
      case 'fuel':
        this.player.fuelLevel++;
        break;
      case 'atk':
        this.player.atkLevel++;
        break;
      case 'hp':
        this.player.hpLevel++;
        this.player.hp = Math.min(this.maxHp(), this.player.hp + 20);
        break;
      case 'atkspeed':
        this.player.atkspeedLevel++;
        break;
      case 'skill':
        this.player.skillLevel++;
        break;
      case 'muffler':
        this.player.mufflerLevel++;
        break;
    }
    this.metrics.upgradesBought++;
  }

  private recomputeScore(): void {
    this.metrics.score = Math.round(
      this.player.money +
        this.player.cargoValue +
        this.metrics.maxDepth * 3 +
        this.metrics.oreMined * 2 +
        this.metrics.kills * 5,
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
        atk: this.atk(),
        attackCd: this.player.attackCd,
        attackCdMax: this.attackCdMax(),
        hasSkill: this.hasSkill(),
        skillCd: this.player.skillCd,
        skillCdMax: this.skillCdMax(),
        skillDmg: this.skillDmg(),
        noise: this.player.noise,
        moveEvasion: this.player.moveEvasion,
        digging: this.player.digging ? { ...this.player.digging } : null,
        estFuelToReturn: this.estFuelToReturn(),
      },
      map: { w: W, h: H, tiles: [...this.tiles] },
      enemies: this.enemies.map((e) => ({ ...e })),
      shop,
      metrics: { ...this.metrics },
    };
  }
}

export { bandAt, requiredDrillPower, digTicksFor, oreValue };
