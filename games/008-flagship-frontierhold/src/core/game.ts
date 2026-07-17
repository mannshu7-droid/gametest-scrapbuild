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
  type OutpostState,
  type PropState,
  type ShopItemState,
  type TileId,
  type UpgradeId,
} from './types';

// ---- バランス定数（specs/006-combat-mining-building-ironkeep/spec.md の表と一致させる） ----
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
const SPAWN_BASE = 0.0042; // v1指摘#2: 0.003→0.0042。湧き頻度を上げチョークポイント遭遇を増やす
const SPAWN_NOISE_COEF = 0.0004;

const MOVE_EVASION_TICKS = 2;
const MOVE_EVASION_REDUCTION = 0.15;

const DASH_TICKS = 3;
const DASH_COOLDOWN = 50;
const DASH_HP_COST = 12;

const LABOR_INCOME_INTERVAL = 15;
const LABOR_INCOME_AMOUNT = 1;
const SURFACE_HP_REGEN = 2; // v1指摘#2: 3→2。死亡率0%の安全すぎるバランスを是正するため地上回復を鈍らせる
const MILESTONE_BONUS_PER_BAND = 30;

const SPAWN_RADIUS_MIN = 3;
const SPAWN_RADIUS_MAX = 7;

// ---- 006新規: 支保工（PROP）関連定数 ----
const PROP_BASE_HP = 30;
const PROP_HP_PER_LEVEL = 15;
const BUILD_COOLDOWN = 10;
const BRIDGE_BASE_COST = 12;
const BRIDGE_TIER_COST = 7;
const BRIDGE_BAND_COST = 4; // v1指摘#4: 2→4。連続する壁を迂回橋だけで踏破する戦略の総コストを引き上げ、drill投資との差をつける
const BARRICADE_BASE_COST = 14;
const BARRICADE_BAND_COST = 2;

// ---- 007新規: 前線基地（OUTPOST）関連定数 ----
const OUTPOST_MIN_GAP = 25; // 直前の基地からこのマス数以上深く進まないと次の基地を建てられない
// v1実測: 20000tick中の総稼得金(moneyEarned)は50〜100程度に留まる経済規模（006から不変）のため、
// 当初仮説値150は「実質建てられない」水準だった。単発の迂回橋(12)より明確に高い50へ引き下げたが、
// v1レビューの時点でなお「ブラウザ6000tickセッションではP01/P02とも1本も建てられない」という
// 重大指摘が残った。v2でさらに20へ引き下げ、band倍率も0.35→0.15へ緩め、深部でも加速度的に
// 高額化しすぎないようにした（band1で+15%、band4で+60%程度）
const OUTPOST_BASE_COST = 20;
const OUTPOST_BAND_COST_MULT = 0.15;
const OUTPOST_SAFE_RADIUS = 2; // チェビシェフ距離。地上のSAFE_ZONE_Yと同格の安全圏
const OUTPOST_SCORE_BONUS = 20;
// 008新規: 007final #3対応。hasForwardProgressBelow()は従来「迂回橋代を払える/払えない」の二値しか
// 見ておらず、「払えないが、そこに居座ってLABOR_INCOMEで稼げばいずれ払える」ケースを一律で「壁」と
// 誤認していたわけではなく、逆に一度払えると判定した後は無期限に居座って良いことになっていた。
// 007finalのブラウザ実測（P02がセッションの83%を壁際で足踏み）を踏まえ、「その場に居座った場合、
// 迂回橋代を稼ぐのに何tick待たされるか」を建設可否判定自体に組み込み、待ち時間が長すぎる配置では
// 前線基地の建設そのものを拒否する（無限に近い足踏みが発生する前に防ぐ）
const OUTPOST_MAX_WAIT_TICKS = 400;

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
  return 1 + band * 0.5; // v1指摘#2: 0.35→0.5。深部の湧き頻度を引き上げる
}
function depthMult(band: number): number {
  return 1 + band * 0.25; // v1指摘#2: 0.2→0.25。深部の敵HP/ATKを引き上げる
}
function enemyCap(band: number): number {
  return Math.min(2 + Math.floor(band / 2), 8); // v1指摘#2/#3: 深部で同時接敵数を増やしバリケードの必要性を作る
}

/** バンドごとの出現重み。深いほど土が減り、鉱石が増える */
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
  { id: 'skill', name: '範囲攻撃', desc: 'Lv1で周囲8方向への範囲攻撃を解禁。以降ダメージ+8・CD-2（下限8）', baseCost: 25, growth: 1.45, maxLevel: 5 },
  { id: 'muffler', name: '防音マフラー', desc: '掘削で発生する掘削音の蓄積量-15%（下限-45%）', baseCost: 20, growth: 1.3, maxLevel: 3 },
  {
    id: 'engineering',
    name: '工兵術',
    desc: '支保工の設置コスト-15%（下限-60%）、支保工の耐久値+15',
    baseCost: 20,
    growth: 1.4,
    maxLevel: 5,
  },
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
  dashActive: number;
  dashCd: number;
  buildCd: number;
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
  engineeringLevel: number;
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
  return level >= 1 ? 16 + 8 * (level - 1) : 0;
}
function skillCdMaxOf(level: number): number {
  return level >= 1 ? Math.max(6, 16 - 2 * (level - 1)) : 0;
}
function mufflerMultOf(level: number): number {
  return Math.max(0.55, 1 - 0.15 * level);
}
function propMaxHpOf(level: number): number {
  return PROP_BASE_HP + PROP_HP_PER_LEVEL * level;
}
function buildCostMultOf(level: number): number {
  return Math.max(0.4, 1 - 0.15 * level);
}
function bridgeCost(type: TileId, band: number, costMult: number): number {
  const tier = TIER[type] ?? 0;
  return Math.round((BRIDGE_BASE_COST + BRIDGE_TIER_COST * tier + BRIDGE_BAND_COST * band) * costMult);
}
function barricadeCost(band: number, costMult: number): number {
  return Math.round((BARRICADE_BASE_COST + BARRICADE_BAND_COST * band) * costMult);
}
function outpostCost(band: number): number {
  return Math.round(OUTPOST_BASE_COST * (1 + band * OUTPOST_BAND_COST_MULT));
}

export class Game {
  readonly seed: number;
  private rng: Rng;
  private tiles: number[];
  private propHp: number[];
  private tick = 0;
  private phase: 'mine' | 'shop' | 'gameover' = 'shop';
  private _over = false;
  private enemies: Enemy[] = [];
  private nextEnemyId = 1;
  private lastMilestoneBand = 0;
  private outposts: OutpostState[] = [];
  /** 直前に確立した基地（地上 or 最も新しい前線基地）の深さ。地上は0 */
  private lastBaseY = 0;
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
    dashActive: 0,
    dashCd: 0,
    buildCd: 0,
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
    engineeringLevel: 0,
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
    dashUses: 0,
    fuelEmptyTicks: 0,
    bridgesBuilt: 0,
    barricadesBuilt: 0,
    propsDestroyedByEnemy: 0,
    outpostsBuilt: 0,
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.tiles = this.generateWorld();
    this.propHp = new Array<number>(W * H).fill(0);
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
    if (!this.inBounds(x, y) || this.tiles[y * W + x] !== TILE.FLOOR || y <= SAFE_ZONE_Y) return false;
    return !this.nearOutpost(x, y);
  }
  private isPlayerPassable(x: number, y: number): boolean {
    const t = this.tiles[y * W + x];
    return t === TILE.FLOOR || t === TILE.PROP || t === TILE.OUTPOST;
  }
  /** 007新規: 前線基地から半径OUTPOST_SAFE_RADIUS（チェビシェフ距離）以内は敵の湧き・侵入禁止の安全圏 */
  private nearOutpost(x: number, y: number): boolean {
    for (const o of this.outposts) {
      if (Math.max(Math.abs(x - o.x), Math.abs(y - o.y)) <= OUTPOST_SAFE_RADIUS) return true;
    }
    return false;
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
  private propMaxHp(): number {
    return propMaxHpOf(this.player.engineeringLevel);
  }
  private buildCostMult(): number {
    return buildCostMultOf(this.player.engineeringLevel);
  }

  /** 既に掘った床・支保工・前線基地だけを通って最寄りの基地（地上 or 前線基地）へ戻るのに必要なマス数をBFSで求める */
  private bfsDistanceToNearestBase(): number {
    if (this.player.y === 0 || this.tileAt(this.player.x, this.player.y) === TILE.OUTPOST) return 0;
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
          if (ny === 0 || this.tiles[nidx] === TILE.OUTPOST) return dist;
          if (!this.isPlayerPassable(nx, ny)) continue;
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
    }
    return Infinity;
  }
  private estFuelToReturn(): number | null {
    const dist = this.bfsDistanceToNearestBase();
    if (!Number.isFinite(dist)) return null;
    return Math.ceil(dist * PASSIVE_FUEL_DRAIN);
  }
  private depthSinceLastBase(): number {
    return Math.max(0, this.player.y - this.lastBaseY);
  }
  private nextOutpostCostValue(): number {
    const band = bandAt(Math.max(1, this.player.y));
    return outpostCost(band);
  }
  /**
   * v2追加（バグ#3対応）: 建設地点のすぐ先(y+1の行)全16列が、建設費用を払った「後」の所持金でも
   * 一切突破できない完全な壁になっていないかを確認する。実測で「drillPower不足の壁の直前に前線基地を
   * 建て、以後は基地と壁の間を無限に往復するだけで進行が完全停止する」個体を検出した。原因は、
   * 建設直後にshopフェーズで所持金をほぼ使い切るボットの挙動と、壁の手前だけを見る建設可否判定が
   * 「理論上は迂回橋で抜けられるが、建設費用を払った時点でもう迂回橋代が残っていない」ケースを
   * 見逃していたこと。建設費用支払い後に残る所持金で判定することで、「安全圏は確保できたが
   * 一歩も進めない」という無意味な停滞の固定化を未然に防ぐ
   */
  private hasForwardProgressBelow(y: number, moneyAfterCost: number): boolean {
    const ny = y + 1;
    if (ny >= H) return true; // 最深部到達済みなら壁の心配自体が無意味
    const band = bandAt(ny);
    const costMult = this.buildCostMult();
    let minBridgeCost = Infinity;
    for (let x = 0; x < W; x++) {
      const t = this.tiles[ny * W + x] as TileId;
      if (t === TILE.FLOOR || t === TILE.PROP || t === TILE.OUTPOST) return true;
      if (requiredDrillPower(t, band) <= this.drillPower()) return true;
      const cost = bridgeCost(t, band, costMult);
      if (moneyAfterCost >= cost) return true;
      if (cost < minBridgeCost) minBridgeCost = cost;
    }
    if (!Number.isFinite(minBridgeCost)) return false;
    // 即座には迂回橋代が払えなくても、前線基地に居座りLABOR_INCOMEで稼げば
    // OUTPOST_MAX_WAIT_TICKS以内に届くなら「妥当な待機」として建設を許可する
    const shortfall = minBridgeCost - moneyAfterCost;
    const waitTicks = Math.ceil(shortfall / LABOR_INCOME_AMOUNT) * LABOR_INCOME_INTERVAL;
    return waitTicks <= OUTPOST_MAX_WAIT_TICKS;
  }
  private canBuildOutpost(): boolean {
    if (this.player.y === 0) return false;
    if (this.tileAt(this.player.x, this.player.y) !== TILE.FLOOR) return false;
    if (this.depthSinceLastBase() < OUTPOST_MIN_GAP) return false;
    const cost = this.nextOutpostCostValue();
    if (this.player.money < cost) return false;
    return this.hasForwardProgressBelow(this.player.y, this.player.money - cost);
  }

  // ---- メインループ: 1ティック進める ----
  step(action: Action = { type: 'wait' }): void {
    if (this._over) return;
    this.tick++;

    if (this.player.y === 0 || this.tileAt(this.player.x, this.player.y) === TILE.OUTPOST) {
      if (this.tick % LABOR_INCOME_INTERVAL === 0) this.player.money += LABOR_INCOME_AMOUNT;
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
    if (this.player.dashActive > 0) this.player.dashActive--;
    if (this.player.dashCd > 0) this.player.dashCd--;
    if (this.player.buildCd > 0) this.player.buildCd--;

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

  /** @returns dug=このtickに掘削したか, moved=既に掘った床/支保工へ実際に移動したか（採掘音の増減判定に使う） */
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
      case 'dash': {
        if (p.dashCd > 0) break;
        p.dashActive = DASH_TICKS;
        p.dashCd = DASH_COOLDOWN;
        p.hp = Math.max(1, p.hp - Math.min(DASH_HP_COST, p.hp - 1));
        this.metrics.dashUses++;
        break;
      }
      case 'build':
        this.applyBuild(action.dir);
        break;
      case 'outpost':
        this.applyOutpost();
        break;
      case 'wait':
      case 'buy':
        break;
    }
    return { dug: false, moved: false };
  }

  /** 007新規: 現在地に前線基地(OUTPOST)を建てる。直前の基地から一定深さ以上・所持金が足りる場合のみ成功する */
  private applyOutpost(): void {
    if (!this.canBuildOutpost()) return;
    const p = this.player;
    const cost = this.nextOutpostCostValue();
    p.money -= cost;
    this.tiles[p.y * W + p.x] = TILE.OUTPOST;
    this.outposts.push({ x: p.x, y: p.y });
    this.lastBaseY = p.y;
    this.metrics.outpostsBuilt++;
    this.arriveAtBase();
  }

  /** 支保工の設置: 対象が未採掘タイルなら迂回橋、既に掘った床なら敵の経路を塞ぐバリケードになる */
  private applyBuild(dir: Dir): void {
    if (this.player.buildCd > 0) return;
    const p = this.player;
    const [dx, dy] = DELTA[dir];
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!this.inBounds(nx, ny) || ny === 0) return;
    if (this.enemyAt(nx, ny)) return;
    const t = this.tileAt(nx, ny) as TileId;
    if (t === TILE.PROP) return;

    const band = bandAt(Math.max(1, ny));
    const costMult = this.buildCostMult();
    let cost: number;
    let isBridge: boolean;
    if (t === TILE.FLOOR) {
      cost = barricadeCost(band, costMult);
      isBridge = false;
    } else if (DIGGABLE.includes(t)) {
      cost = bridgeCost(t, band, costMult);
      isBridge = true;
    } else {
      return;
    }
    if (p.money < cost) return;
    p.money -= cost;
    this.tiles[ny * W + nx] = TILE.PROP;
    this.propHp[ny * W + nx] = this.propMaxHp();
    if (p.digging && p.digging.x === nx && p.digging.y === ny) p.digging = null;
    p.buildCd = BUILD_COOLDOWN;
    if (isBridge) this.metrics.bridgesBuilt++;
    else this.metrics.barricadesBuilt++;
  }

  private applyMove(dir: Dir): { dug: boolean; moved: boolean } {
    const p = this.player;
    const [dx, dy] = DELTA[dir];
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!this.inBounds(nx, ny)) return { dug: false, moved: false };
    if (this.enemyAt(nx, ny)) {
      // dash中は退路上の敵を無視してすり抜けられる
      if (p.dashActive <= 0 || !this.isPlayerPassable(nx, ny)) return { dug: false, moved: false };
      p.digging = null;
      p.x = nx;
      p.y = ny;
      if (ny === 0) this.arriveAtBase();
      return { dug: false, moved: true };
    }
    const t = this.tileAt(nx, ny) as TileId;

    if (t === TILE.FLOOR || t === TILE.PROP || t === TILE.OUTPOST) {
      p.digging = null;
      p.x = nx;
      p.y = ny;
      p.moveEvasion = MOVE_EVASION_TICKS;
      if (ny === 0 || t === TILE.OUTPOST) this.arriveAtBase();
      return { dug: false, moved: true };
    }
    if (!DIGGABLE.includes(t)) return { dug: false, moved: false };

    const band = bandAt(ny);
    const req = requiredDrillPower(t, band);
    if (this.drillPower() < req) return { dug: false, moved: false }; // 採掘威力不足で不発（build で迂回可能）

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

  /** 地上(y=0)または前線基地(OUTPOST)へ到達したときの共通処理: 鉱石売却・燃料全回復・shopフェーズへ移行 */
  private arriveAtBase(): void {
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

  // ---- 敵AI（囲みスロット割当てで同一経路への渋滞を回避） ----
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
        if (p.dashActive > 0) {
          e.atkCd = stats.atkCdMax;
          return;
        }
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
      return;
    }

    // 006新規: FLOORだけの経路が存在しない（＝支保工に塞がれている）場合、隣接する支保工を攻撃して壊す
    if (e.atkCd > 0) return;
    let bestProp: [number, number] | null = null;
    let bestDist = Infinity;
    for (const d of DIRS) {
      const [ddx, ddy] = DELTA[d];
      const nx = e.x + ddx;
      const ny = e.y + ddy;
      if (!this.inBounds(nx, ny) || this.tiles[ny * W + nx] !== TILE.PROP) continue;
      const propDist = Math.abs(nx - tx) + Math.abs(ny - ty);
      if (propDist < bestDist) {
        bestDist = propDist;
        bestProp = [nx, ny];
      }
    }
    if (bestProp) {
      const [px, py] = bestProp;
      const idx = py * W + px;
      this.propHp[idx] -= e.atk;
      this.metrics.damageDealt += e.atk; // 支保工への攻撃もダメージとして計上（プレイヤーは無傷）
      e.atkCd = stats.atkCdMax;
      if (this.propHp[idx] <= 0) {
        this.tiles[idx] = TILE.FLOOR;
        this.propHp[idx] = 0;
        this.metrics.propsDestroyedByEnemy++;
      }
    }
  }

  /** BFSで最短経路の最初の一手を返す（既に掘った床だけを通行可能とする。PROPは通行不可） */
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
      case 'engineering':
        return this.player.engineeringLevel;
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
      case 'engineering':
        this.player.engineeringLevel++;
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
        this.metrics.kills * 5 +
        this.metrics.outpostsBuilt * OUTPOST_SCORE_BONUS,
    );
  }

  // ---- 状態のスナップショット（JSONシリアライズ可能） ----
  getState(): GameState {
    const shop: ShopItemState[] = SHOP_DEFS.map((def) => {
      const level = this.levelOf(def.id);
      const nextCost = level >= def.maxLevel ? null : Math.round(def.baseCost * Math.pow(def.growth, level));
      return { id: def.id, name: def.name, desc: def.desc, level, maxLevel: def.maxLevel, nextCost };
    });
    const props: PropState[] = [];
    for (let idx = 0; idx < this.tiles.length; idx++) {
      if (this.tiles[idx] !== TILE.PROP) continue;
      props.push({ x: idx % W, y: Math.floor(idx / W), hp: this.propHp[idx], maxHp: this.propMaxHp() });
    }
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
        dashActive: this.player.dashActive,
        dashCd: this.player.dashCd,
        dashCdMax: DASH_COOLDOWN,
        buildCd: this.player.buildCd,
        buildCdMax: BUILD_COOLDOWN,
        propMaxHp: this.propMaxHp(),
        digging: this.player.digging ? { ...this.player.digging } : null,
        estFuelToReturn: this.estFuelToReturn(),
        depthSinceLastBase: this.depthSinceLastBase(),
        nextOutpostCost: this.nextOutpostCostValue(),
        canBuildOutpost: this.canBuildOutpost(),
      },
      map: { w: W, h: H, tiles: [...this.tiles] },
      enemies: this.enemies.map((e) => ({ ...e })),
      props,
      outposts: this.outposts.map((o) => ({ ...o })),
      shop,
      metrics: { ...this.metrics },
    };
  }
}

export {
  bandAt,
  requiredDrillPower,
  digTicksFor,
  oreValue,
  bridgeCost,
  barricadeCost,
  buildCostMultOf,
  outpostCost,
  OUTPOST_MIN_GAP,
};
