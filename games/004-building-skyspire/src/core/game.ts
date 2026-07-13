import { mulberry32, randInt, type Rng } from './rng';
import type { Action, BlockInfo, Dir, GameState, Material, Metrics, ShakeState } from './types';

export const W = 9;
export const H = 90;
export const CENTER_X = 4;
export const GOAL_HEIGHT = 40;
export const TIME_LIMIT = 3600;

/** 高度バンド（10高度刻み）ごとの風カンチレバー倍率（オフセット1マスあたり） */
export const WIND_TABLE = [0.05, 0.08, 0.12, 0.16, 0.2];
/** 高度バンドごとの揺れ強度 */
export const SHAKE_TABLE = [0.3, 0.5, 0.8, 1.1, 1.4];
/** brace近傍のブロックが下へ伝える荷重の残存率（1-この値が肩代わり分） */
export const BRACE_FACTOR = 0.5;
/** braceの効果が届く範囲（チェビシェフ距離）。1本のbraceで複数段をまとめて補強できる */
export const BRACE_RADIUS = 2;
/** 直近に到達したマイルストーン高度（3の倍数）以下は、揺れ・自重による過負荷崩落から保護される */
export const MILESTONE_STEP = 3;
/** 地上(y=0)に滞在し続けた場合、この間隔(tick)ごとに最低限の労働収入が入る */
export const LABOR_INCOME_INTERVAL = 15;
/** 労働収入1回分の金額。所持金・資材ともに0でスクラップも無い完全な経済的詰みからでも、
 *  時間をかければ必ずwood1個分は買えるようにするための最低限の救済（v3で追加） */
export const LABOR_INCOME_AMOUNT = 1;

export const MATERIAL_DEFS: Record<Material, { cost: number; weight: number; capacity: number }> = {
  wood: { cost: 4, weight: 3, capacity: 8 },
  stone: { cost: 9, weight: 6, capacity: 20 },
  steel: { cost: 18, weight: 4, capacity: 40 },
  brace: { cost: 6, weight: 0, capacity: 999999 },
  stabilizer: { cost: 30, weight: 0, capacity: 999999 },
};

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
}

interface StructNode {
  parent: string | null;
  rootX: number;
  children: string[];
}

function bandOf(y: number): number {
  return Math.min(4, Math.floor(y / 10));
}

function emptyInventory(): Record<Material, number> {
  return { wood: 0, stone: 0, steel: 0, brace: 0, stabilizer: 0 };
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
    inventory: emptyInventory(),
    fallStreak: 0,
  };

  private blocks = new Map<string, Block>();
  private groundScrap = new Map<number, number>();
  private stabilizerRemaining = 3;
  private maxHeightReached = 0;
  /** 直近に到達したマイルストーン高度（3の倍数）。この高さ以下のブロックは過負荷崩落から保護される */
  private foundationHeight = 0;

  private shakeState: ShakeState = 'idle';
  private shakeTimer: number;
  private phaseTimer = 0;

  private groundedSet = new Set<string>();
  private stressMap = new Map<string, number>();
  /** 地上滞在tickのカウンタ（LABOR_INCOME_INTERVALに達するたび最低限の収入を得る） */
  private laborTicks = 0;

  private debrisHitAppliedThisTick = false;

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
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.shakeTimer = 120 + randInt(this.rng, 61) - 30;
    this.recomputeStructure();
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  /** (x,y)からチェビシェフ距離BRACE_RADIUS以内にbraceがあるか。1本のbraceで周囲複数段を補強する */
  private hasNearbyBrace(x: number, y: number): boolean {
    for (const b of this.blocks.values()) {
      if (b.material !== 'brace') continue;
      if (Math.abs(b.x - x) <= BRACE_RADIUS && Math.abs(b.y - y) <= BRACE_RADIUS) return true;
    }
    return false;
  }

  private hasNearbyStabilizer(x: number, y: number, radius: number): boolean {
    for (const b of this.blocks.values()) {
      if (b.material !== 'stabilizer') continue;
      if (Math.abs(b.x - x) <= radius && Math.abs(b.y - y) <= radius) return true;
    }
    return false;
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

    // subtreeWeight(node) = 自重 + 自分の上に乗る全ブロックの荷重合計（自分自身を含む）。
    // BRACE_RADIUS以内にbraceがあるブロックは、自分が支えている荷重を下の支持ブロックへ伝える際に
    // BRACE_FACTOR分だけ肩代わりして減衰させる（brace1本で周囲複数段をまとめて補強できるため、
    // 毎段設置しなくても等比級数的に頭打ちになり高層化できる）
    const subtreeWeight = new Map<string, number>();
    for (let i = queue.length - 1; i >= 0; i--) {
      const key = queue[i];
      const b = this.blocks.get(key)!;
      const def = MATERIAL_DEFS[b.material];
      let sum = def.weight;
      for (const c of info.get(key)!.children) {
        const childBlock = this.blocks.get(c)!;
        const factor = this.hasNearbyBrace(childBlock.x, childBlock.y) ? BRACE_FACTOR : 1;
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
      // このブロック自身の重さは支えている下のブロックの負荷であってこのブロックの負荷ではないため、
      // 子（真上に乗る側）のsubtreeWeight合計（brace減衰込み）だけを「このブロックが支えている荷重」とする
      let loadAbove = 0;
      for (const c of info.get(key)!.children) {
        const childBlock = this.blocks.get(c)!;
        const factor = this.hasNearbyBrace(childBlock.x, childBlock.y) ? BRACE_FACTOR : 1;
        loadAbove += (subtreeWeight.get(c) ?? 0) * factor;
      }
      const load = loadAbove * windMult * shakeMult;
      const def = MATERIAL_DEFS[b.material];
      stress.set(key, load / def.capacity);
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
        // 直近マイルストーン以下の土台は過負荷崩落から保護する（1回の事故で積み上げ実績ごと失わないため）。
        // floatingによる強制撤去（連結が切れた場合）は保護対象外
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
        this.shakeTimer = 120 + randInt(this.rng, 61) - 30;
      }
    }
  }

  private applyGravity(): void {
    // 「y-1にブロックがあれば接地」を条件に含めると、崩落で自分の足元のブロックだけ残り
    // 自分のいたブロックが消えた場合に「生き残った最上段のすぐ上の空きマス」で静止してしまい、
    // 通常の登はんモデル（常にブロックの中に立つ）と矛盾して以降 place up の着地先がズレ続ける
    // （安全マージンぶんの空白ができてしまう）。同じセルにブロックがあるかどうかだけで接地判定する
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

  /** 所持金・資材・回収可能なスクラップが全て尽きても、地上に留まっていれば必ず再起できるようにする
   *  最低限の救済。崩落を繰り返した末の完全な経済的詰み（v2 bug#1）を防ぐ */
  private applyLaborIncome(): void {
    // 地上に「連続で」滞在した場合だけでなく、行き来を繰り返しつつ地上を経由するだけの
    // プレイでも詰みから脱出できるよう、非連続でも地上に居た回数を積算する（離れてもリセットしない）
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
        // 左右移動はブロックを通り抜けられない。上下移動は自分の建てた構造を「登る/降りる」ため
        // ブロックが詰まっているマスにも進入できる（登はん）
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
        const valid =
          tx >= 0 &&
          tx < W &&
          ty >= 1 &&
          ty < H &&
          !this.blocks.has(key) &&
          this.player.inventory[mat] >= 1 &&
          this.isSupported(tx, ty);
        if (!valid) {
          this.metrics.invalidActions++;
          break;
        }
        this.player.inventory[mat]--;
        this.blocks.set(key, { x: tx, y: ty, material: mat });
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
        const mat = action.material;
        const cost = MATERIAL_DEFS[mat].cost;
        if (this.player.money < cost || (mat === 'stabilizer' && this.stabilizerRemaining <= 0)) {
          this.metrics.invalidActions++;
          break;
        }
        this.player.money -= cost;
        this.player.inventory[mat]++;
        if (mat === 'stabilizer') this.stabilizerRemaining--;
        break;
      }
      case 'wait':
        break;
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
    // 保護対象は最初のマイルストーン（高さMILESTONE_STEP）だけに固定する。移動フロンティアを
    // 保護すると積み上げた分すべてが崩落免除になり構造リスクが消えてしまうため、
    // 「ゼロから作り直しにはならない」最低限の足場だけを恒久的に保護する
    if (this.maxHeightReached >= MILESTONE_STEP) this.foundationHeight = MILESTONE_STEP;

    this.tick++;
    this.metrics.ticksSurvived = this.tick;

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this.over = true;
      this.won = false;
    } else if (this.maxHeightReached >= GOAL_HEIGHT) {
      this.over = true;
      this.won = true;
    } else if (this.tick >= TIME_LIMIT) {
      this.over = true;
      this.won = this.maxHeightReached >= GOAL_HEIGHT;
    }

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
    for (const [key, b] of this.blocks) {
      const stressRatio = this.stressMap.get(key) ?? 0;
      const grounded = this.groundedSet.has(key);
      const isProtected = b.y <= this.foundationHeight;
      blocks.push({ x: b.x, y: b.y, material: b.material, stressRatio, grounded, protected: isProtected });
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
        inventory: { ...this.player.inventory },
        fallStreak: this.player.fallStreak,
        grounded: this.player.y === 0 || this.blocks.has(this.key(this.player.x, this.player.y)),
      },
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
      },
      structure: {
        maxStressRatio,
        criticalCount,
        foundationHeight: this.foundationHeight,
      },
      metrics: { ...this.metrics },
    };
  }
}
