import { mulberry32, type Rng } from './rng';
import type {
  Action,
  AppraisalPrecision,
  BlockInfo,
  Dir,
  GameState,
  Material,
  Metrics,
  ShakeState,
  StructMaterial,
  ShopItem,
} from './types';

export const W = 9;
export const H = 90;
export const CENTER_X = 4;
export const GOAL_HEIGHT = 40;
export const TIME_LIMIT = 3600;

/** 高度バンド（10高度刻み）ごとの風カンチレバー倍率（オフセット1マスあたり） */
export const WIND_TABLE = [0.05, 0.08, 0.12, 0.16, 0.2];
/** 高度バンドごとの揺れ強度 */
export const SHAKE_TABLE = [0.3, 0.5, 0.8, 1.1, 1.4];
/** brace単体（非連携）の効果半径（チェビシェフ距離）と荷重肩代わり率 */
export const BRACE_RADIUS = 2;
export const BRACE_FACTOR = 0.5;
/** brace連携時（別braceがチェビシェフ距離1以内）の強化された効果半径と肩代わり率 */
export const BRACE_RADIUS_LINKED = 3;
export const LINK_FACTOR = 0.3;
/** 直近に到達したマイルストーン高度（3の倍数）以下は、揺れ・自重による過負荷崩落から保護される */
export const MILESTONE_STEP = 3;
/** 地上(y=0)に滞在し続けた場合、この間隔(tick)ごとに最低限の労働収入が入る */
export const LABOR_INCOME_INTERVAL = 15;
export const LABOR_INCOME_AMOUNT = 1;

/** 構造材ロットの隠れた品質倍率の範囲（耐荷重にそのまま乗算される） */
export const QUALITY_MIN = 0.7;
export const QUALITY_MAX = 1.3;
/** 鑑定Lv0→1→2→3への各段階のコスト */
export const APPRAISAL_COSTS = [20, 35, 55];

export const MATERIAL_DEFS: Record<Material, { cost: number; weight: number; capacity: number }> = {
  wood: { cost: 4, weight: 3, capacity: 8 },
  stone: { cost: 9, weight: 6, capacity: 20 },
  steel: { cost: 18, weight: 4, capacity: 40 },
  brace: { cost: 6, weight: 0, capacity: 999999 },
  stabilizer: { cost: 30, weight: 0, capacity: 999999 },
};

export const STRUCT_MATERIALS: StructMaterial[] = ['wood', 'stone', 'steel'];

const DIR_VECT: Record<Dir, [number, number]> = {
  up: [0, 1],
  down: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};
const DIRS4: [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

interface Block {
  x: number;
  y: number;
  material: Material;
  /** brace/stabilizerは常に1。wood/stone/steelは設置時に消費したロットの隠れた品質がそのまま入る */
  qualityMult: number;
}

interface StructNode {
  parent: string | null;
  rootX: number;
  children: string[];
}

function bandOf(y: number): number {
  return Math.min(4, Math.floor(y / 10));
}

function precisionOf(level: number): AppraisalPrecision {
  if (level <= 0) return 'hidden';
  if (level === 1) return 'coarse';
  if (level === 2) return 'fine';
  return 'exact';
}

/** 鑑定レベルに応じて真の品質値を丸めて公開する。Lv0はnull（完全に不明） */
function revealQuality(trueValue: number, level: number): number | null {
  if (level <= 0) return null;
  if (level === 1) return Math.round(trueValue / 0.2) * 0.2;
  if (level === 2) return Math.round(trueValue / 0.1) * 0.1;
  return Math.round(trueValue * 100) / 100;
}

export class Game {
  readonly seed: number;
  private rng: Rng;

  tick = 0;
  over = false;
  won = false;

  player = {
    x: CENTER_X,
    y: 0,
    hp: 100,
    maxHp: 100,
    money: 90,
    fallStreak: 0,
  };

  private braceCount = 0;
  private stabilizerCount = 0;
  private appraisalLevel = 0;
  /** 構造材ごとの未設置ロットキュー（先頭=古い順）。各要素が1個ぶんの真の品質倍率 */
  private qualityQueues: Record<StructMaterial, number[]> = { wood: [], stone: [], steel: [] };

  private blocks = new Map<string, Block>();
  private groundScrap = new Map<number, number>();
  private stabilizerRemaining = 3;
  private maxHeightReached = 0;
  private foundationHeight = 0;

  private shakeState: ShakeState = 'idle';
  private shakeTimer: number;
  private phaseTimer = 0;

  private groundedSet = new Set<string>();
  private stressMap = new Map<string, number>();
  private laborTicks = 0;

  private debrisHitAppliedThisTick = false;

  private placedQualitySum = 0;
  private placedQualityCount = 0;

  metrics: Metrics = {
    maxHeight: 0,
    blocksPlaced: 0,
    blocksLost: 0,
    collapseEvents: 0,
    moneyEarned: 0,
    fallDamageTaken: 0,
    debrisDamageTaken: 0,
    invalidActions: 0,
    ticksSurvived: 0,
    blindPlacements: 0,
    avgPlacedQuality: 0,
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.shakeTimer = 120 + Math.floor(this.rng() * 61) - 30;
    this.recomputeStructure();
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  /** target自身を除き、チェビシェフ距離1以内に別のbraceがあれば連携中 */
  private braceLinked(target: Block): boolean {
    for (const b of this.blocks.values()) {
      if (b.material !== 'brace' || b === target) continue;
      if (Math.abs(b.x - target.x) <= 1 && Math.abs(b.y - target.y) <= 1) return true;
    }
    return false;
  }

  /** (x,y)に適用される最良のbrace肩代わり率を返す（周囲にbraceが無ければ1=軽減なし） */
  private braceFactorAt(x: number, y: number): number {
    let best = 1;
    for (const b of this.blocks.values()) {
      if (b.material !== 'brace') continue;
      const linked = this.braceLinked(b);
      const radius = linked ? BRACE_RADIUS_LINKED : BRACE_RADIUS;
      if (Math.abs(b.x - x) <= radius && Math.abs(b.y - y) <= radius) {
        const factor = linked ? LINK_FACTOR : BRACE_FACTOR;
        if (factor < best) best = factor;
      }
    }
    return best;
  }

  private hasNearbyStabilizer(x: number, y: number, radius: number): boolean {
    for (const b of this.blocks.values()) {
      if (b.material !== 'stabilizer') continue;
      if (Math.abs(b.x - x) <= radius && Math.abs(b.y - y) <= radius) return true;
    }
    return false;
  }

  private capacityOf(b: Block): number {
    if (b.material === 'brace' || b.material === 'stabilizer') return MATERIAL_DEFS[b.material].capacity;
    return MATERIAL_DEFS[b.material].capacity * b.qualityMult;
  }

  /** BFSで支持経路・負荷率を再計算する。戻り値は浮遊しているブロックのキー配列 */
  private recomputeStructure(): string[] {
    const info = new Map<string, StructNode>();
    const visited = new Set<string>();
    const queue: string[] = [];

    for (const [key, b] of this.blocks) {
      if (b.y === 1) {
        visited.add(key);
        info.set(key, { parent: null, rootX: b.x, children: [] });
        queue.push(key);
      }
    }

    let qi = 0;
    while (qi < queue.length) {
      const key = queue[qi++];
      const b = this.blocks.get(key)!;
      for (const [dx, dy] of DIRS4) {
        const nkey = this.key(b.x + dx, b.y + dy);
        if (this.blocks.has(nkey) && !visited.has(nkey)) {
          visited.add(nkey);
          const parentInfo = info.get(key)!;
          info.set(nkey, { parent: key, rootX: parentInfo.rootX, children: [] });
          parentInfo.children.push(nkey);
          queue.push(nkey);
        }
      }
    }

    const subtreeWeight = new Map<string, number>();
    for (let i = queue.length - 1; i >= 0; i--) {
      const key = queue[i];
      const b = this.blocks.get(key)!;
      const def = MATERIAL_DEFS[b.material];
      let sum = def.weight;
      for (const c of info.get(key)!.children) {
        const childBlock = this.blocks.get(c)!;
        const factor = this.braceFactorAt(childBlock.x, childBlock.y);
        sum += (subtreeWeight.get(c) ?? 0) * factor;
      }
      subtreeWeight.set(key, sum);
    }

    const stress = new Map<string, number>();
    for (const key of queue) {
      const b = this.blocks.get(key)!;
      const meta = info.get(key)!;
      const band = bandOf(b.y);
      const windFactor = WIND_TABLE[band];
      const offset = Math.abs(b.x - meta.rootX);
      const windMult = 1 + windFactor * offset;
      let shakeMult = 1;
      if (this.shakeState === 'active') {
        const shakeIntensity = SHAKE_TABLE[band];
        const near = this.hasNearbyStabilizer(b.x, b.y, 2);
        shakeMult = 1 + shakeIntensity * (near ? 0.5 : 1);
      }
      let loadAbove = 0;
      for (const c of info.get(key)!.children) {
        const childBlock = this.blocks.get(c)!;
        const factor = this.braceFactorAt(childBlock.x, childBlock.y);
        loadAbove += (subtreeWeight.get(c) ?? 0) * factor;
      }
      const load = loadAbove * windMult * shakeMult;
      stress.set(key, load / this.capacityOf(b));
    }

    this.groundedSet = visited;
    this.stressMap = stress;

    const floating: string[] = [];
    for (const key of this.blocks.keys()) if (!visited.has(key)) floating.push(key);
    return floating;
  }

  private resolveCollapses(): void {
    let iterations = 0;
    let anyCollapse = false;
    while (iterations++ < 60) {
      const floating = this.recomputeStructure();
      const overloaded: string[] = [];
      for (const [key, ratio] of this.stressMap) {
        if (ratio <= 1) continue;
        const b = this.blocks.get(key);
        if (b && b.y <= this.foundationHeight) continue;
        overloaded.push(key);
      }
      const toRemove = new Set([...floating, ...overloaded]);
      if (toRemove.size === 0) break;
      anyCollapse = true;
      for (const key of toRemove) {
        const b = this.blocks.get(key);
        if (!b) continue;
        this.blocks.delete(key);
        this.metrics.blocksLost++;
        const def = MATERIAL_DEFS[b.material];
        const value = Math.round(def.cost * 0.4);
        if (value > 0) {
          this.groundScrap.set(b.x, (this.groundScrap.get(b.x) ?? 0) + value);
        }
        if (
          !this.debrisHitAppliedThisTick &&
          b.x === this.player.x &&
          b.y > this.player.y &&
          b.y - this.player.y <= 4
        ) {
          this.player.hp -= 10;
          this.metrics.debrisDamageTaken += 10;
          this.debrisHitAppliedThisTick = true;
        }
      }
    }
    if (anyCollapse) this.metrics.collapseEvents++;
    this.recomputeStructure();
  }

  private advanceShake(): void {
    if (this.shakeState === 'idle') {
      this.shakeTimer--;
      if (this.shakeTimer <= 0) {
        this.shakeState = 'warning';
        this.phaseTimer = 30;
      }
    } else if (this.shakeState === 'warning') {
      this.phaseTimer--;
      if (this.phaseTimer <= 0) {
        this.shakeState = 'active';
        this.phaseTimer = 15;
      }
    } else {
      this.phaseTimer--;
      if (this.phaseTimer <= 0) {
        this.shakeState = 'idle';
        this.shakeTimer = 120 + Math.floor(this.rng() * 61) - 30;
      }
    }
  }

  private applyGravity(): void {
    const grounded = this.player.y === 0 || this.blocks.has(this.key(this.player.x, this.player.y));
    if (!grounded) {
      this.player.y -= 1;
      this.player.fallStreak++;
    } else {
      if (this.player.fallStreak > 3) {
        const dmg = (this.player.fallStreak - 3) * 4;
        this.player.hp -= dmg;
        this.metrics.fallDamageTaken += dmg;
      }
      this.player.fallStreak = 0;
    }
  }

  private collectScrap(): void {
    if (this.player.y !== 0) return;
    const v = this.groundScrap.get(this.player.x);
    if (v) {
      this.player.money += v;
      this.metrics.moneyEarned += v;
      this.groundScrap.delete(this.player.x);
    }
  }

  private applyLaborIncome(): void {
    if (this.player.y !== 0) return;
    this.laborTicks++;
    if (this.laborTicks >= LABOR_INCOME_INTERVAL) {
      this.laborTicks = 0;
      this.player.money += LABOR_INCOME_AMOUNT;
      this.metrics.moneyEarned += LABOR_INCOME_AMOUNT;
    }
  }

  private applyMilestones(prevMax: number, newMax: number): void {
    for (
      let m = Math.floor(prevMax / MILESTONE_STEP) * MILESTONE_STEP + MILESTONE_STEP;
      m <= newMax;
      m += MILESTONE_STEP
    ) {
      if (m <= prevMax) continue;
      const bonus = 15 + m * 3;
      this.player.money += bonus;
      this.metrics.moneyEarned += bonus;
    }
  }

  private isSupported(x: number, y: number): boolean {
    if (y === 1) return true;
    for (const [dx, dy] of DIRS4) {
      const sy = y + dy;
      if (sy === 0) return true;
      const skey = this.key(x + dx, sy);
      if (this.groundedSet.has(skey)) return true;
    }
    return false;
  }

  private applyAction(action: Action): void {
    switch (action.type) {
      case 'move': {
        const [dx, dy] = DIR_VECT[action.dir];
        const nx = this.player.x + dx;
        const ny = this.player.y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) {
          this.metrics.invalidActions++;
          break;
        }
        const horizontal = action.dir === 'left' || action.dir === 'right';
        if (horizontal && this.blocks.has(this.key(nx, ny))) {
          this.metrics.invalidActions++;
          break;
        }
        this.player.x = nx;
        this.player.y = ny;
        break;
      }
      case 'place': {
        const [dx, dy] = DIR_VECT[action.dir];
        const tx = this.player.x + dx;
        const ty = this.player.y + dy;
        const mat = action.material;
        const key = this.key(tx, ty);
        const inBounds = tx >= 0 && tx < W && ty >= 1 && ty < H;
        if (!inBounds || this.blocks.has(key) || !this.isSupported(tx, ty)) {
          this.metrics.invalidActions++;
          break;
        }
        if (mat === 'brace' || mat === 'stabilizer') {
          const count = mat === 'brace' ? this.braceCount : this.stabilizerCount;
          if (count < 1) {
            this.metrics.invalidActions++;
            break;
          }
          if (mat === 'brace') this.braceCount--;
          else this.stabilizerCount--;
          this.blocks.set(key, { x: tx, y: ty, material: mat, qualityMult: 1 });
        } else {
          const queueArr = this.qualityQueues[mat];
          const idx = action.lotIndex ?? 0;
          if (idx < 0 || idx >= queueArr.length) {
            this.metrics.invalidActions++;
            break;
          }
          if (action.lotIndex === undefined) this.metrics.blindPlacements++;
          const [q] = queueArr.splice(idx, 1);
          this.blocks.set(key, { x: tx, y: ty, material: mat, qualityMult: q });
          this.placedQualitySum += q;
          this.placedQualityCount++;
        }
        this.metrics.blocksPlaced++;
        this.recomputeStructure();
        break;
      }
      case 'remove': {
        const [dx, dy] = DIR_VECT[action.dir];
        const tx = this.player.x + dx;
        const ty = this.player.y + dy;
        const key = this.key(tx, ty);
        const b = this.blocks.get(key);
        if (!b || b.material === 'brace' || b.material === 'stabilizer') {
          this.metrics.invalidActions++;
          break;
        }
        const refund = Math.round(MATERIAL_DEFS[b.material].cost * 0.5);
        this.player.money += refund;
        this.blocks.delete(key);
        this.recomputeStructure();
        break;
      }
      case 'buy': {
        if (this.player.y !== 0) {
          this.metrics.invalidActions++;
          break;
        }
        this.applyBuy(action.item);
        break;
      }
      case 'wait':
        break;
    }
  }

  private applyBuy(item: ShopItem): void {
    if (item === 'appraiser') {
      if (this.appraisalLevel >= 3 || this.player.money < APPRAISAL_COSTS[this.appraisalLevel]) {
        this.metrics.invalidActions++;
        return;
      }
      this.player.money -= APPRAISAL_COSTS[this.appraisalLevel];
      this.appraisalLevel++;
      return;
    }
    const cost = MATERIAL_DEFS[item].cost;
    if (this.player.money < cost || (item === 'stabilizer' && this.stabilizerRemaining <= 0)) {
      this.metrics.invalidActions++;
      return;
    }
    this.player.money -= cost;
    if (item === 'brace') {
      this.braceCount++;
    } else if (item === 'stabilizer') {
      this.stabilizerCount++;
      this.stabilizerRemaining--;
    } else {
      const q = QUALITY_MIN + this.rng() * (QUALITY_MAX - QUALITY_MIN);
      this.qualityQueues[item].push(q);
    }
  }

  step(action: Action = { type: 'wait' }): GameState {
    if (this.over) return this.getState();

    this.debrisHitAppliedThisTick = false;
    this.applyAction(action);
    this.advanceShake();
    this.resolveCollapses();
    this.applyGravity();
    this.collectScrap();
    this.applyLaborIncome();

    const prevMax = this.maxHeightReached;
    const newMax = Math.max(prevMax, this.player.y);
    if (newMax > prevMax) this.applyMilestones(prevMax, newMax);
    this.maxHeightReached = newMax;
    this.metrics.maxHeight = newMax;
    if (this.maxHeightReached >= MILESTONE_STEP) this.foundationHeight = MILESTONE_STEP;
    if (this.maxHeightReached >= GOAL_HEIGHT) this.won = true;

    this.tick++;
    this.metrics.ticksSurvived = this.tick;

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.over = true;
    } else if (this.tick >= TIME_LIMIT) {
      this.over = true;
    }

    this.metrics.avgPlacedQuality = this.placedQualityCount > 0 ? this.placedQualitySum / this.placedQualityCount : 0;
    this.metrics.score =
      this.maxHeightReached * 10 +
      (this.won ? 200 : 0) +
      Math.round(this.metrics.moneyEarned * 0.3) -
      this.metrics.collapseEvents * 5 -
      Math.round(this.metrics.debrisDamageTaken * 0.5);

    return this.getState();
  }

  getState(): GameState {
    const blocks: BlockInfo[] = [];
    let maxStressRatio = 0;
    let criticalCount = 0;
    let linkedBraceCount = 0;
    for (const [key, b] of this.blocks) {
      const stressRatio = this.stressMap.get(key) ?? 0;
      const grounded = this.groundedSet.has(key);
      const isProtected = b.y <= this.foundationHeight;
      const linked = b.material === 'brace' ? this.braceLinked(b) : false;
      if (linked) linkedBraceCount++;
      blocks.push({
        x: b.x,
        y: b.y,
        material: b.material,
        stressRatio,
        grounded,
        protected: isProtected,
        qualityMult: b.qualityMult,
        linked,
      });
      if (grounded && !isProtected) {
        if (stressRatio > maxStressRatio) maxStressRatio = stressRatio;
        if (stressRatio >= 0.8) criticalCount++;
      }
    }

    const groundScrap = Array.from(this.groundScrap.entries()).map(([x, value]) => ({ x, value }));

    const prices: Record<Material, number> = {
      wood: MATERIAL_DEFS.wood.cost,
      stone: MATERIAL_DEFS.stone.cost,
      steel: MATERIAL_DEFS.steel.cost,
      brace: MATERIAL_DEFS.brace.cost,
      stabilizer: MATERIAL_DEFS.stabilizer.cost,
    };

    const qualityQueue: Record<StructMaterial, (number | null)[]> = {
      wood: this.qualityQueues.wood.map((q) => revealQuality(q, this.appraisalLevel)),
      stone: this.qualityQueues.stone.map((q) => revealQuality(q, this.appraisalLevel)),
      steel: this.qualityQueues.steel.map((q) => revealQuality(q, this.appraisalLevel)),
    };

    return {
      tick: this.tick,
      over: this.over,
      won: this.won,
      player: {
        x: this.player.x,
        y: this.player.y,
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        money: this.player.money,
        inventory: {
          wood: this.qualityQueues.wood.length,
          stone: this.qualityQueues.stone.length,
          steel: this.qualityQueues.steel.length,
          brace: this.braceCount,
          stabilizer: this.stabilizerCount,
        },
        fallStreak: this.player.fallStreak,
        grounded: this.player.y === 0 || this.blocks.has(this.key(this.player.x, this.player.y)),
      },
      qualityQueue,
      world: {
        w: W,
        h: H,
        goalHeight: GOAL_HEIGHT,
        blocks,
        groundScrap,
      },
      shake: {
        state: this.shakeState,
        ticksUntilNext: this.shakeState === 'idle' ? this.shakeTimer : null,
        ticksRemainingInPhase: this.shakeState === 'idle' ? null : this.phaseTimer,
      },
      shop: {
        prices,
        stabilizerRemaining: this.stabilizerRemaining,
        appraisalLevel: this.appraisalLevel,
        appraisalNextCost: this.appraisalLevel < 3 ? APPRAISAL_COSTS[this.appraisalLevel] : null,
        appraisalPrecision: precisionOf(this.appraisalLevel),
      },
      structure: {
        maxStressRatio,
        criticalCount,
        foundationHeight: this.foundationHeight,
        linkedBraceCount,
      },
      metrics: { ...this.metrics },
    };
  }
}
