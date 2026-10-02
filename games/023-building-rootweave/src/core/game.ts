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
/** v2: 3600→7200（10tps換算で6分→12分。仕様書の想定セッション8〜15分に合わせた） */
export const TIME_LIMIT = 7200;

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

/** 左右の脚を中央トランクへ接続する梁（rung）1本あたりのコスト（v2: 25→8、多段の梁を前提に引き下げ） */
export const BEAM_COST = 8;
/**
 * v2新規: 左右の脚それぞれの高さマイルストーン報酬の倍率（中央の報酬式×この倍率）。
 * v1では脚を建てても所持金が一切増えず（収入は中央の到達高度のみ）、脚の建設コストが
 * まるごと持ち出しになっていた（v1バグ#1の主因の一つ）
 */
export const LEG_MILESTONE_RATIO = 1;
/** v2新規: 梁から上下この距離以内の、梁で繋がった列のブロックは揺れ倍率が半減する（梁が横揺れを止める） */
export const RUNG_SHAKE_RADIUS = 2;
/**
 * v2新規: 梁の高さでのトラス効果。その高さで梁が繋ぐ列（中央＋接続脚）の上方荷重を合算し、
 * この係数を掛けてから均等に再分配する（斜めの力の流れで地面へ逃がす分）。
 * 接続脚の本数ごとの係数（index=脚本数）。脚を増やすほど三角形が増えて効く
 */
export const TRUSS_FACTOR = [1, 0.5, 0.35];
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

  /** v2: 脚ごとの梁（rung）の高さ集合。1本の脚に複数の梁を架けられる */
  private rungs: Record<'left' | 'right', Set<number>> = { left: new Set(), right: new Set() };

  private groundScrap = new Map<number, number>();
  private stabilizerRemaining = 3;
  private maxHeightReached = 0;
  private foundationHeight = 0;
  private maxLegsConnectedSoFar = 0;
  /** v2: 左右の脚ごとの到達済み最高高度（脚マイルストーン報酬の判定用） */
  private legMaxReached: Record<'left' | 'right', number> = { left: 0, right: 0 };

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

  /** 梁がまだ物理的に有効か（両端のブロックが現存するか）を確認し、無効な梁を撤去する */
  private pruneDeadConnections(): void {
    for (const leg of SIDE_LEGS) {
      for (const h of [...this.rungs[leg]]) {
        if (!this.legColumns[leg].has(h) || !this.legColumns.center.has(h)) this.rungs[leg].delete(h);
      }
    }
  }

  private topOf(leg: LegId): number {
    let top = 0;
    for (const y of this.legColumns[leg].keys()) if (y > top) top = y;
    return top;
  }

  /** その列のその高さが、梁（rung）から上下RUNG_SHAKE_RADIUS以内か。中央はどちらかの脚の梁が対象 */
  private nearRung(leg: LegId, y: number): boolean {
    const sides = leg === 'center' ? SIDE_LEGS : [leg];
    for (const side of sides) {
      for (const h of this.rungs[side]) if (Math.abs(h - y) <= RUNG_SHAKE_RADIUS) return true;
    }
    return false;
  }

  /** 左右の脚の最も高い梁（梁より下の脚は横揺れが抑えられ風オフセットが消える） */
  private highestRung(leg: 'left' | 'right'): number {
    let h = 0;
    for (const y of this.rungs[leg]) if (y > h) h = y;
    return h;
  }

  /**
   * 3本の列を上から同時にたどり、負荷率を計算する。
   * v2: 梁の高さでは「中央＋その高さに梁がある脚」の上方荷重を合算し、TRUSS_FACTORを掛けて
   * 均等に再分配する（脚側の取り分には距離に応じた橋の風トルクが乗る）
   */
  private computeStress(): StressResult {
    this.pruneDeadConnections();
    const braceFactorOf = this.buildBraceFactorLookup();
    const stress: Record<LegId, Map<number, number>> = { left: new Map(), center: new Map(), right: new Map() };
    const carried: Record<LegId, number> = { left: 0, center: 0, right: 0 };
    const prevBrace: Record<LegId, number> = { left: 1, center: 1, right: 1 };
    const tops: Record<LegId, number> = { left: this.topOf('left'), center: this.topOf('center'), right: this.topOf('right') };
    const maxTop = Math.max(tops.left, tops.center, tops.right);

    for (let y = maxTop; y >= 1; y--) {
      const loadAbove: Partial<Record<LegId, number>> = {};
      for (const leg of LEG_IDS) {
        if (y > tops[leg] || !this.legColumns[leg].has(y)) continue;
        loadAbove[leg] = carried[leg] * prevBrace[leg];
      }

      const rungLegs = SIDE_LEGS.filter((leg) => this.rungs[leg].has(y));
      if (rungLegs.length > 0 && loadAbove.center !== undefined) {
        let pool = loadAbove.center;
        for (const leg of rungLegs) pool += loadAbove[leg] ?? 0;
        const share = (pool * TRUSS_FACTOR[rungLegs.length]) / (1 + rungLegs.length);
        loadAbove.center = share;
        for (const leg of rungLegs) {
          const dist = Math.abs(LEG_X[leg] - LEG_X.center);
          loadAbove[leg] = share * (1 + BRIDGE_DISTANCE_WIND_FACTOR * dist);
        }
      }

      const band = bandOf(y);
      for (const leg of LEG_IDS) {
        const raw = loadAbove[leg];
        if (raw === undefined) continue;
        const b = this.legColumns[leg].get(y)!;
        const offset = leg !== 'center' && y <= this.highestRung(leg) ? 0 : LEG_WIND_OFFSET[leg];
        const windMult = 1 + WIND_TABLE[band] * offset;
        const damped = this.hasNearbyStabilizer(LEG_X[leg], y, 2) || this.nearRung(leg, y);
        const shakeMult = this.shakeState === 'active' ? 1 + SHAKE_TABLE[band] * (damped ? 0.5 : 1) : 1;
        stress[leg].set(y, (raw * windMult * shakeMult) / this.capacityOf(b));
        const selfW = MATERIAL_DEFS[b.material].weight * this.qualityWeightFactor(b);
        carried[leg] = selfW + raw;
        prevBrace[leg] = braceFactorOf(LEG_X[leg], y);
      }
    }

    return { stress };
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
    const grounded = this.isGrounded(this.player.x, this.player.y);
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

  /** v2: 梁の上（脚〜中央の間の同じ高さ）か。梁の上は足場として立てて横移動できる */
  private onBeam(x: number, y: number): boolean {
    if (y < 1) return false;
    for (const leg of SIDE_LEGS) {
      if (!this.rungs[leg].has(y)) continue;
      const lo = Math.min(LEG_X[leg], LEG_X.center);
      const hi = Math.max(LEG_X[leg], LEG_X.center);
      if (x >= lo && x <= hi) return true;
    }
    return false;
  }

  private isGrounded(x: number, y: number): boolean {
    return y === 0 || this.blockAt(x, y) !== undefined || this.onBeam(x, y);
  }

  /** v2: 左右の脚の高さが新たに3の倍数を超えたら、中央の報酬×LEG_MILESTONE_RATIOを支払う */
  private applyLegMilestones(): void {
    for (const leg of SIDE_LEGS) {
      const top = this.topOf(leg);
      const prev = this.legMaxReached[leg];
      if (top <= prev) continue;
      for (let m = Math.floor(prev / MILESTONE_STEP) * MILESTONE_STEP + MILESTONE_STEP; m <= top; m += MILESTONE_STEP) {
        const bonus = Math.round(this.milestoneBonus(m) * LEG_MILESTONE_RATIO);
        this.player.money += bonus;
        this.metrics.moneyEarned += bonus;
      }
      this.legMaxReached[leg] = top;
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
        // 梁の上の横移動は列・補強材の位置も通り抜けられる（梁が足場になる）
        const alongBeam = this.onBeam(this.player.x, this.player.y) && this.onBeam(nx, ny);
        if (horizontal && !alongBeam && this.blockAt(nx, ny) !== undefined) {
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
        if (this.rungs[leg].has(y)) {
          this.metrics.invalidActions++;
          break;
        }
        if (this.player.money < BEAM_COST) {
          this.metrics.invalidActions++;
          break;
        }
        this.player.money -= BEAM_COST;
        this.rungs[leg].add(y);
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
    this.applyLegMilestones();
    this.maxHeightReached = newMax;
    this.metrics.maxHeight = newMax;
    if (this.maxHeightReached >= MILESTONE_STEP) this.foundationHeight = MILESTONE_STEP;
    if (this.maxHeightReached >= GOAL_HEIGHT) this.won = true;

    const connectedSides = SIDE_LEGS.filter((leg) => this.rungs[leg].size > 0).length;
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
        connHeight: legId === 'center' ? null : this.highestRung(legId as 'left' | 'right') || null,
        connected: legId === 'center' ? false : this.rungs[legId as 'left' | 'right'].size > 0,
        rungs: legId === 'center' ? [] : [...this.rungs[legId as 'left' | 'right']].sort((a, b) => a - b),
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
        grounded: this.isGrounded(this.player.x, this.player.y),
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
