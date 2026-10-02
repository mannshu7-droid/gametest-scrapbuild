import { mulberry32, type Rng } from './rng';
import type {
  Action,
  AppraisalPrecision,
  BlockInfo,
  Dir,
  GameState,
  LegId,
  LegSummary,
  Material,
  Metrics,
  ShakeState,
  StructMaterial,
  ShopItem,
} from './types';

export const W = 13;
export const H = 90;
export const GOAL_HEIGHT = 40;
export const TIME_LIMIT = 3600;

export const LEG_X: Record<LegId, number> = { left: 1, center: 6, right: 11 };
export const LEG_WIND_OFFSET: Record<LegId, number> = { left: 1, center: 0, right: 1 };
const LEG_IDS: LegId[] = ['left', 'center', 'right'];
const SIDE_LEGS: ('left' | 'right')[] = ['left', 'right'];

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
export const QUALITY_MIN = 0.5;
export const QUALITY_MAX = 1.5;
/** 鑑定Lv0→1→2→3への各段階のコスト */
export const APPRAISAL_COSTS = [6, 10, 16];
/** 地上で回復するHP */
export const HP_REGEN_INTERVAL = 10;
export const HP_REGEN_AMOUNT = 1;
/** マイルストーン報酬の逓増が緩やかになり始める高度 */
export const MILESTONE_TAPER_HEIGHT = 60;
/** lotIndexを明示指定して構造材を設置するたびに得られる少額のスコアボーナス（019から継承） */
export const INFORMED_PLACEMENT_SCORE_BONUS = 1.5;

/** 左右の脚を中央トランクへ接続する一回あたりのコスト */
export const BEAM_COST = 25;
/** 脚と中央の距離1マスあたり、分担荷重に追加でかかる風トルク係数 */
export const BRIDGE_DISTANCE_WIND_FACTOR = 0.03;

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

interface Block {
  x: number;
  y: number;
  leg: LegId;
  material: Material;
  /** brace/stabilizerは常に1。wood/stone/steelは設置時に消費したロットの隠れた品質がそのまま入る */
  qualityMult: number;
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

function nearestLeg(x: number): LegId {
  let best: LegId = 'center';
  let bestDist = Infinity;
  for (const id of LEG_IDS) {
    const d = Math.abs(LEG_X[id] - x);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}

interface StressResult {
  /** 脚ごとの高さ→負荷率 */
  stress: Record<LegId, Map<number, number>>;
  /** 左右の脚ごとの現在有効な接続（null=未接続/切断） */
  aliveConn: Record<'left' | 'right', number | null>;
}

export class Game {
  readonly seed: number;
  private rng: Rng;

  tick = 0;
  over = false;
  won = false;

  player = {
    x: LEG_X.center,
    y: 0,
    hp: 100,
    maxHp: 100,
    money: 90,
    fallStreak: 0,
  };

  private braceCount = 0;
  private stabilizerCount = 0;
  private appraisalLevel = 0;
  private qualityQueues: Record<StructMaterial, number[]> = { wood: [], stone: [], steel: [] };

  /** 脚ごとの構造材の列（高さ→ブロック）。常に1から連続する前提を維持する */
  private legColumns: Record<LegId, Map<number, Block>> = {
    left: new Map(),
    center: new Map(),
    right: new Map(),
  };
  /** 補強材・安定化装置（脚に隣接するマスに設置）。key="x,y" */
  private decor = new Map<string, Block>();

  private connHeight: Record<'left' | 'right', number | null> = { left: null, right: null };

  private groundScrap = new Map<number, number>();
  private stabilizerRemaining = 3;
  private maxHeightReached = 0;
  private foundationHeight = 0;
  private maxLegsConnectedSoFar = 0;

  private shakeState: ShakeState = 'idle';
  private shakeTimer: number;
  private phaseTimer = 0;

  private laborTicks = 0;
  private hpRegenTicks = 0;

  private debrisHitAppliedThisTick = false;

  private placedQualitySum = 0;
  private placedQualityCount = 0;

  private lastStress: Record<LegId, Map<number, number>> = { left: new Map(), center: new Map(), right: new Map() };
  private lastLinked = new Set<string>();

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
    informedPlacements: 0,
    avgPlacedQuality: 0,
    connectEvents: 0,
    maxLegsConnected: 0,
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.shakeTimer = 120 + Math.floor(this.rng() * 61) - 30;
    this.recompute();
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  private legIdAt(x: number): LegId | null {
    for (const id of LEG_IDS) if (LEG_X[id] === x) return id;
    return null;
  }

  private blockAt(x: number, y: number): Block | undefined {
    const leg = this.legIdAt(x);
    if (leg) {
      const b = this.legColumns[leg].get(y);
      if (b) return b;
    }
    return this.decor.get(this.key(x, y));
  }

  private capacityOf(b: Block): number {
    if (b.material === 'brace' || b.material === 'stabilizer') return MATERIAL_DEFS[b.material].capacity;
    return MATERIAL_DEFS[b.material].capacity * b.qualityMult;
  }

  private qualityWeightFactor(b: Block): number {
    if (b.material === 'brace' || b.material === 'stabilizer') return 1;
    return 2 - b.qualityMult;
  }

  /** 全braceの連携状態を1回だけ計算し、(x,y)→肩代わり率を返す関数を作る（019と同じロジック） */
  private buildBraceFactorLookup(): (x: number, y: number) => number {
    const braces: { x: number; y: number; linked: boolean }[] = [];
    for (const b of this.decor.values()) {
      if (b.material === 'brace') braces.push({ x: b.x, y: b.y, linked: false });
    }
    for (let i = 0; i < braces.length; i++) {
      for (let j = i + 1; j < braces.length; j++) {
        if (braces[i].linked && braces[j].linked) continue;
        if (Math.abs(braces[i].x - braces[j].x) <= 1 && Math.abs(braces[i].y - braces[j].y) <= 1) {
          braces[i].linked = true;
          braces[j].linked = true;
        }
      }
    }
    this.lastLinked = new Set(
      braces.filter((b) => b.linked).map((b) => this.key(b.x, b.y)),
    );
    const cache = new Map<string, number>();
    return (x: number, y: number) => {
      const k = this.key(x, y);
      const cached = cache.get(k);
      if (cached !== undefined) return cached;
      let best = 1;
      for (const br of braces) {
        const radius = br.linked ? BRACE_RADIUS_LINKED : BRACE_RADIUS;
        if (Math.abs(br.x - x) <= radius && Math.abs(br.y - y) <= radius) {
          const factor = br.linked ? LINK_FACTOR : BRACE_FACTOR;
          if (factor < best) best = factor;
        }
      }
      cache.set(k, best);
      return best;
    };
  }

  private hasNearbyStabilizer(x: number, y: number, radius: number): boolean {
    for (const b of this.decor.values()) {
      if (b.material !== 'stabilizer') continue;
      if (Math.abs(b.x - x) <= radius && Math.abs(b.y - y) <= radius) return true;
    }
    return false;
  }

  /** 脚の列からギャップ以上の浮遊ブロックを切り落とす（撤去・崩落で下が抜けた直後の整合性維持） */
  private truncateGaps(leg: LegId): boolean {
    const col = this.legColumns[leg];
    let y = 1;
    while (col.has(y)) y++;
    // yが最初の空白。これより上に何か残っていれば浮遊として全部崩落させる
    let changed = false;
    let maxY = y;
    for (const key of col.keys()) if (key > maxY) maxY = key;
    for (let yy = y; yy <= maxY; yy++) {
      const b = col.get(yy);
      if (!b) continue;
      col.delete(yy);
      this.onBlockLost(b);
      changed = true;
    }
    return changed;
  }

  private onBlockLost(b: Block): void {
    this.metrics.blocksLost++;
    const def = MATERIAL_DEFS[b.material];
    const value = Math.round(def.cost * 0.4);
    if (value > 0) this.groundScrap.set(b.x, (this.groundScrap.get(b.x) ?? 0) + value);
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

  /** 接続がまだ物理的に有効か（両端のブロックが現存するか）を確認し、無効なら切断する */
  private pruneDeadConnections(): void {
    for (const leg of SIDE_LEGS) {
      const h = this.connHeight[leg];
      if (h === null) continue;
      if (!this.legColumns[leg].has(h) || !this.legColumns.center.has(h)) {
        this.connHeight[leg] = null;
      }
    }
  }

  /** 中央トランク＋左右の脚、1本ずつの負荷率を計算する（分散された共有荷重も反映） */
  private computeStress(): StressResult {
    this.pruneDeadConnections();
    const braceFactorOf = this.buildBraceFactorLookup();
    const stress: Record<LegId, Map<number, number>> = { left: new Map(), center: new Map(), right: new Map() };

    // 1. 中央トランクをtopから下へたどり、接続点で共有荷重を分配する
    const centerCol = this.legColumns.center;
    let centerTop = 0;
    for (const y of centerCol.keys()) if (y > centerTop) centerTop = y;

    const injection: Record<'left' | 'right', { height: number; amount: number } | null> = {
      left: null,
      right: null,
    };

    let carried = 0;
    let prevBraceFactor = 1;
    let activeLegCount = 1;
    for (let y = centerTop; y >= 1; y--) {
      const b = centerCol.get(y);
      if (!b) break;
      let loadAboveRaw = carried * prevBraceFactor;

      const connsHere = SIDE_LEGS.filter((leg) => this.connHeight[leg] === y);
      if (connsHere.length > 0) {
        const newLegCount = activeLegCount + connsHere.length;
        const share = loadAboveRaw / newLegCount;
        for (const leg of connsHere) {
          const dist = Math.abs(LEG_X[leg] - LEG_X.center);
          injection[leg] = { height: y, amount: share * (1 + BRIDGE_DISTANCE_WIND_FACTOR * dist) };
        }
        loadAboveRaw = share;
        activeLegCount = newLegCount;
      }

      const band = bandOf(y);
      const windMult = 1 + WIND_TABLE[band] * LEG_WIND_OFFSET.center;
      const shakeMult =
        this.shakeState === 'active' ? 1 + SHAKE_TABLE[band] * (this.hasNearbyStabilizer(LEG_X.center, y, 2) ? 0.5 : 1) : 1;
      stress.center.set(y, (loadAboveRaw * windMult * shakeMult) / this.capacityOf(b));

      const selfW = MATERIAL_DEFS[b.material].weight * this.qualityWeightFactor(b);
      carried = selfW + loadAboveRaw;
      prevBraceFactor = braceFactorOf(LEG_X.center, y);
    }

    // 2. 左右の脚を同じ要領でたどり、接続点があれば共有荷重を注入する
    for (const leg of SIDE_LEGS) {
      const col = this.legColumns[leg];
      let top = 0;
      for (const y of col.keys()) if (y > top) top = y;
      let legCarried = 0;
      let legPrevBraceFactor = 1;
      const inj = injection[leg];
      for (let y = top; y >= 1; y--) {
        const b = col.get(y);
        if (!b) break;
        let loadAboveRaw = legCarried * legPrevBraceFactor;
        if (inj && inj.height === y) loadAboveRaw += inj.amount;
        const band = bandOf(y);
        const windMult = 1 + WIND_TABLE[band] * LEG_WIND_OFFSET[leg];
        const shakeMult =
          this.shakeState === 'active' ? 1 + SHAKE_TABLE[band] * (this.hasNearbyStabilizer(LEG_X[leg], y, 2) ? 0.5 : 1) : 1;
        stress[leg].set(y, (loadAboveRaw * windMult * shakeMult) / this.capacityOf(b));
        const selfW = MATERIAL_DEFS[b.material].weight * this.qualityWeightFactor(b);
        legCarried = selfW + loadAboveRaw;
        legPrevBraceFactor = braceFactorOf(LEG_X[leg], y);
      }
    }

    return { stress, aliveConn: { ...this.connHeight } };
  }

  private collapseFrom(leg: LegId, failY: number): void {
    const col = this.legColumns[leg];
    let maxY = 0;
    for (const y of col.keys()) if (y > maxY) maxY = y;
    for (let y = failY; y <= maxY; y++) {
      const b = col.get(y);
      if (!b) continue;
      col.delete(y);
      this.onBlockLost(b);
    }
  }

  private resolveCollapses(): void {
    let anyCollapse = false;
    for (let iter = 0; iter < 12; iter++) {
      let changed = false;
      for (const leg of LEG_IDS) {
        if (this.truncateGaps(leg)) changed = true;
      }
      this.pruneDeadConnections();
      const { stress } = this.computeStress();
      for (const leg of LEG_IDS) {
        const s = stress[leg];
        let failY: number | null = null;
        for (const [y, ratio] of s) {
          if (ratio > 1 && y > this.foundationHeight) {
            if (failY === null || y < failY) failY = y;
          }
        }
        if (failY !== null) {
          this.collapseFrom(leg, failY);
          changed = true;
          anyCollapse = true;
        }
      }
      // 脚の崩落で切れたbrace/stabilizerの隣接(自分の列・隣の脚どちらにも接していない)ものも撤去
      for (const [k, b] of [...this.decor.entries()]) {
        if (b.material !== 'brace' && b.material !== 'stabilizer') continue;
        const supported =
          b.y === 1 ||
          this.blockAt(b.x - 1, b.y) !== undefined ||
          this.blockAt(b.x + 1, b.y) !== undefined ||
          this.blockAt(b.x, b.y - 1) !== undefined ||
          this.blockAt(b.x, b.y + 1) !== undefined;
        if (!supported) {
          this.decor.delete(k);
          this.onBlockLost(b);
          changed = true;
        }
      }
      if (!changed) break;
    }
    if (anyCollapse) this.metrics.collapseEvents++;
    const final = this.computeStress();
    this.lastStress = final.stress;
  }

  private recompute(): void {
    this.pruneDeadConnections();
    const { stress } = this.computeStress();
    this.lastStress = stress;
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
    const grounded = this.player.y === 0 || this.blockAt(this.player.x, this.player.y) !== undefined;
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

  private applyHpRegen(): void {
    if (this.player.y !== 0 || this.player.hp >= this.player.maxHp) {
      this.hpRegenTicks = 0;
      return;
    }
    this.hpRegenTicks++;
    if (this.hpRegenTicks >= HP_REGEN_INTERVAL) {
      this.hpRegenTicks = 0;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + HP_REGEN_AMOUNT);
    }
  }

  private milestoneBonus(m: number): number {
    if (m <= MILESTONE_TAPER_HEIGHT) return 15 + m * 3;
    return 15 + MILESTONE_TAPER_HEIGHT * 3 + (m - MILESTONE_TAPER_HEIGHT) * 1.5;
  }

  private applyMilestones(prevMax: number, newMax: number): void {
    for (
      let m = Math.floor(prevMax / MILESTONE_STEP) * MILESTONE_STEP + MILESTONE_STEP;
      m <= newMax;
      m += MILESTONE_STEP
    ) {
      if (m <= prevMax) continue;
      const bonus = this.milestoneBonus(m);
      this.player.money += bonus;
      this.metrics.moneyEarned += bonus;
    }
  }

  private canPlaceStruct(tx: number, ty: number): LegId | null {
    const leg = this.legIdAt(tx);
    if (!leg || ty < 1 || ty >= H) return null;
    if (ty === 1) return leg;
    return this.legColumns[leg].has(ty - 1) ? leg : null;
  }

  private canPlaceDecor(tx: number, ty: number): boolean {
    if (tx < 0 || tx >= W || ty < 1 || ty >= H) return false;
    if (ty === 1) return true;
    return (
      this.blockAt(tx - 1, ty) !== undefined ||
      this.blockAt(tx + 1, ty) !== undefined ||
      this.blockAt(tx, ty - 1) !== undefined ||
      this.blockAt(tx, ty + 1) !== undefined
    );
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
        if (horizontal && this.blockAt(nx, ny) !== undefined) {
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
        if (this.blockAt(tx, ty) !== undefined) {
          this.metrics.invalidActions++;
          break;
        }
        if (mat === 'brace' || mat === 'stabilizer') {
          if (!this.canPlaceDecor(tx, ty)) {
            this.metrics.invalidActions++;
            break;
          }
          const count = mat === 'brace' ? this.braceCount : this.stabilizerCount;
          if (count < 1) {
            this.metrics.invalidActions++;
            break;
          }
          if (mat === 'brace') this.braceCount--;
          else this.stabilizerCount--;
          this.decor.set(this.key(tx, ty), { x: tx, y: ty, leg: nearestLeg(tx), material: mat, qualityMult: 1 });
        } else {
          const leg = this.canPlaceStruct(tx, ty);
          if (!leg) {
            this.metrics.invalidActions++;
            break;
          }
          const queueArr = this.qualityQueues[mat];
          const idx = action.lotIndex ?? 0;
          if (idx < 0 || idx >= queueArr.length) {
            this.metrics.invalidActions++;
            break;
          }
          if (action.lotIndex === undefined) this.metrics.blindPlacements++;
          else this.metrics.informedPlacements++;
          const [q] = queueArr.splice(idx, 1);
          this.legColumns[leg].set(ty, { x: tx, y: ty, leg, material: mat, qualityMult: q });
          this.placedQualitySum += q;
          this.placedQualityCount++;
        }
        this.metrics.blocksPlaced++;
        break;
      }
      case 'remove': {
        const [dx, dy] = DIR_VECT[action.dir];
        const tx = this.player.x + dx;
        const ty = this.player.y + dy;
        const b = this.blockAt(tx, ty);
        if (!b || b.material === 'brace' || b.material === 'stabilizer') {
          this.metrics.invalidActions++;
          break;
        }
        const refund = Math.round(MATERIAL_DEFS[b.material].cost * 0.5);
        this.player.money += refund;
        this.legColumns[b.leg].delete(ty);
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
      case 'connect': {
        const leg = this.legIdAt(this.player.x);
        if (!leg || leg === 'center' || this.player.y < 1) {
          this.metrics.invalidActions++;
          break;
        }
        const y = this.player.y;
        if (!this.legColumns[leg].has(y) || !this.legColumns.center.has(y)) {
          this.metrics.invalidActions++;
          break;
        }
        const current = this.connHeight[leg];
        if (current !== null && y <= current) {
          this.metrics.invalidActions++;
          break;
        }
        if (this.player.money < BEAM_COST) {
          this.metrics.invalidActions++;
          break;
        }
        this.player.money -= BEAM_COST;
        this.connHeight[leg] = y;
        this.metrics.connectEvents++;
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
    this.applyHpRegen();

    const prevMax = this.maxHeightReached;
    const newMax = Math.max(prevMax, this.player.y);
    if (newMax > prevMax) this.applyMilestones(prevMax, newMax);
    this.maxHeightReached = newMax;
    this.metrics.maxHeight = newMax;
    if (this.maxHeightReached >= MILESTONE_STEP) this.foundationHeight = MILESTONE_STEP;
    if (this.maxHeightReached >= GOAL_HEIGHT) this.won = true;

    const connectedSides = SIDE_LEGS.filter((leg) => this.connHeight[leg] !== null).length;
    if (connectedSides > this.maxLegsConnectedSoFar) this.maxLegsConnectedSoFar = connectedSides;
    this.metrics.maxLegsConnected = this.maxLegsConnectedSoFar;

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
      Math.round(this.metrics.debrisDamageTaken * 0.5) +
      Math.round(this.metrics.informedPlacements * INFORMED_PLACEMENT_SCORE_BONUS) +
      (this.over && this.player.hp > 0 ? 100 + Math.round(this.player.hp * 2) : 0);

    return this.getState();
  }

  getState(): GameState {
    const blocks: BlockInfo[] = [];
    const legSummaries: LegSummary[] = [];

    for (const legId of LEG_IDS) {
      const col = this.legColumns[legId];
      let topHeight = 0;
      let maxStressRatio = 0;
      let criticalCount = 0;
      for (const [y, b] of col) {
        if (y > topHeight) topHeight = y;
        const stressRatio = this.lastStress[legId].get(y) ?? 0;
        const isProtected = y <= this.foundationHeight;
        blocks.push({
          x: b.x,
          y: b.y,
          leg: legId,
          material: b.material,
          stressRatio,
          protected: isProtected,
          qualityMult: b.qualityMult,
          linked: false,
        });
        if (!isProtected) {
          if (stressRatio > maxStressRatio) maxStressRatio = stressRatio;
          if (stressRatio >= 0.8) criticalCount++;
        }
      }
      let linkedBraceCount = 0;
      for (const b of this.decor.values()) {
        if (b.leg !== legId) continue;
        const linked = b.material === 'brace' && this.lastLinked.has(this.key(b.x, b.y));
        if (linked) linkedBraceCount++;
        blocks.push({
          x: b.x,
          y: b.y,
          leg: legId,
          material: b.material,
          stressRatio: 0,
          protected: b.y <= this.foundationHeight,
          qualityMult: b.qualityMult,
          linked,
        });
      }
      legSummaries.push({
        id: legId,
        x: LEG_X[legId],
        topHeight,
        connHeight: legId === 'center' ? null : this.connHeight[legId as 'left' | 'right'],
        connected: legId === 'center' ? false : this.connHeight[legId as 'left' | 'right'] !== null,
        maxStressRatio,
        criticalCount,
        linkedBraceCount,
        foundationHeight: this.foundationHeight,
      });
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
        grounded: this.player.y === 0 || this.blockAt(this.player.x, this.player.y) !== undefined,
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
        connectCost: BEAM_COST,
      },
      legs: legSummaries,
      metrics: { ...this.metrics },
    };
  }
}
