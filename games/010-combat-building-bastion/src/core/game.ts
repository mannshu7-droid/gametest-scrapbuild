import { mulberry32, randInt, type Rng } from './rng';
import type {
  Action,
  Barricade,
  Dir,
  Enemy,
  EnemyType,
  GameState,
  Metrics,
  RiskLevel,
} from './types';

// --- ワールド定数 ---
export const FIELD_WIDTH = 320;
export const LANE_COUNT = 5;
export const BAND_SIZE = 40;
export const HOME_RADIUS = 3;
export const OUTPOST_RADIUS = 2;
export const OUTPOST_MIN_GAP = 50;

// --- プレイヤー初期値 ---
const PLAYER_INIT_HP = 32;
const PLAYER_INIT_ATK = 6;
const ATK_CD_MAX = 5;
const ATK_RANGE = 1;
const DASH_RANGE_INIT = 4;
const DASH_CD_MAX_INIT = 30;
const DASH_INVULN_TICKS = 3;
const SKILL_DMG_INIT = 8;
const SKILL_RADIUS = 2;
const SKILL_CD_MAX_INIT = 20;
const BASE_REGEN_PER_TICK = 2;

// --- 詰みからの脱出手段（008パターン#4）: 拠点で無一文の間、少額の哨戒報酬が入る ---
const PASSIVE_INCOME_INTERVAL = 20;
const PASSIVE_INCOME_AMOUNT = 3;

// --- 詰みからの脱出手段（HP版、v2追加）: 拠点圏外・非戦闘中は自然回復がごく僅かに働く。
// 拠点回復（1/tick）よりずっと遅く、建築の価値を損なわない範囲に留める ---
const FIELD_REGEN_INTERVAL = 15;
const FIELD_REGEN_AMOUNT = 1;
const FIELD_REGEN_SAFE_RANGE = 4;

// --- 危険度再悪化のたびのHUDハイライト（008パターン#11） ---
const RISK_ESCALATION_BANNER_TICKS = 90;

// --- 建築コスト ---
const BARRICADE_BASE_COST = 5;
const BARRICADE_BAND_MULT = 0.15;
const BARRICADE_HP = 26;
const OUTPOST_BASE_COST = 60;
const OUTPOST_BAND_COST_MULT = 0.2;

// --- ショップ価格・効果 ---
function offenseCost(level: number): number {
  return 12 + 6 * level;
}
function defenseCost(level: number): number {
  return 12 + 6 * level;
}
function mobilityCost(level: number): number {
  return 10 + 5 * level;
}
function skillCost(level: number): number {
  return level === 0 ? 18 : 14 + 8 * level;
}
function barricadeCost(band: number): number {
  return Math.round(BARRICADE_BASE_COST * (1 + band * BARRICADE_BAND_MULT));
}
function outpostCost(band: number): number {
  return Math.round(OUTPOST_BASE_COST * (1 + band * OUTPOST_BAND_COST_MULT));
}

// --- 敵定義 ---
interface EnemyDef {
  hp: number;
  atk: number;
  range: number;
  atkCdMax: number;
  moveCdMax: number;
  value: number; // 撃破時の基礎報酬
}
const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  skirmisher: { hp: 9, atk: 3, range: 1, atkCdMax: 14, moveCdMax: 1, value: 4 },
  archer: { hp: 7, atk: 3, range: 3, atkCdMax: 18, moveCdMax: 2, value: 5 },
  brute: { hp: 24, atk: 5, range: 1, atkCdMax: 16, moveCdMax: 2, value: 8 },
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

function recommendedHpForBand(band: number): number {
  return 22 + band * 4;
}

function severityOf(level: RiskLevel): number {
  return level === 'safe' ? 0 : level === 'caution' ? 1 : 2;
}

function riskLevelFor(maxHp: number, recommended: number): RiskLevel {
  const ratio = maxHp / recommended;
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
  if (dir === 'up') return { nx: x, ny: y - 1 };
  if (dir === 'down') return { nx: x, ny: y + 1 };
  if (dir === 'left') return { nx: x - 1, ny: y };
  return { nx: x + 1, ny: y };
}

interface PlayerState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  atkCd: number;
  dashCd: number;
  dashCdMax: number;
  dashRange: number;
  dashInvulnTicks: number;
  hasSkill: boolean;
  skillCd: number;
  skillCdMax: number;
  skillDmg: number;
  money: number;
  offenseLv: number;
  defenseLv: number;
  mobilityLv: number;
  skillLv: number;
}

export class Game {
  seed: number;
  tick = 0;
  over = false;
  won = false;
  private rng: Rng;
  private nextEnemyId = 1;
  private nextBarricadeId = 1;
  private player: PlayerState;
  private enemies: Enemy[] = [];
  private barricades: Barricade[] = [];
  private outposts: number[] = [];
  private prevSeverity = 0;
  private riskEscalationBannerTicks = 0;
  private passiveIncomeTimer = 0;
  private fieldRegenTimer = 0;
  private maxXReached = 0;
  private metrics: Metrics = {
    distanceReached: 0,
    kills: 0,
    died: false,
    moneyEarned: 0,
    upgradesBought: 0,
    dashUses: 0,
    skillUses: 0,
    barricadesBuilt: 0,
    barricadesLost: 0,
    outpostsBuilt: 0,
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.player = {
      x: 0,
      y: Math.floor(LANE_COUNT / 2),
      hp: PLAYER_INIT_HP,
      maxHp: PLAYER_INIT_HP,
      atk: PLAYER_INIT_ATK,
      atkCd: 0,
      dashCd: 0,
      dashCdMax: DASH_CD_MAX_INIT,
      dashRange: DASH_RANGE_INIT,
      dashInvulnTicks: 0,
      hasSkill: false,
      skillCd: 0,
      skillCdMax: SKILL_CD_MAX_INIT,
      skillDmg: SKILL_DMG_INIT,
      money: 0,
      offenseLv: 0,
      defenseLv: 0,
      mobilityLv: 0,
      skillLv: 0,
    };
  }

  private bandAt(x: number): number {
    return Math.floor(x / BAND_SIZE);
  }

  private bases(): number[] {
    return [0, ...this.outposts];
  }

  private nearestBaseDistance(x: number): number {
    let best = Infinity;
    for (const bx of this.bases()) best = Math.min(best, Math.abs(x - bx));
    return best;
  }

  /** 拠点（ホーム or 前線拠点）の保護範囲内か（008パターン#3「固定範囲の保護装置」） */
  private inBaseRadius(x: number): boolean {
    for (const bx of this.bases()) {
      const r = bx === 0 ? HOME_RADIUS : OUTPOST_RADIUS;
      if (Math.abs(x - bx) <= r) return true;
    }
    return false;
  }

  private barricadeAt(x: number, y: number): Barricade | undefined {
    return this.barricades.find((b) => b.x === x && b.y === y);
  }

  private updateRiskTracking() {
    const recommended = recommendedHpForBand(this.bandAt(this.player.x));
    const level = riskLevelFor(this.player.maxHp, recommended);
    const severity = severityOf(level);
    if (severity > this.prevSeverity) {
      this.riskEscalationBannerTicks = RISK_ESCALATION_BANNER_TICKS;
    }
    this.prevSeverity = severity;
    if (this.riskEscalationBannerTicks > 0) this.riskEscalationBannerTicks--;
  }

  private recommendedHp(): number {
    return recommendedHpForBand(this.bandAt(this.player.x));
  }

  private combatRiskLevel(): RiskLevel {
    return riskLevelFor(this.player.maxHp, this.recommendedHp());
  }

  private spawnEnemies() {
    const band = this.bandAt(this.player.x);
    const cap = Math.min(3 + Math.floor(band / 2), 8);
    if (this.enemies.length >= cap) return;
    const interval = Math.max(4, 7 - Math.floor(band / 2));
    const chance = Math.min(0.55, 0.3 + band * 0.02);
    if (this.tick % interval !== 0) return;
    if (this.rng() >= chance) return;
    const spawnX = Math.min(FIELD_WIDTH, this.player.x + 8 + randInt(this.rng, 6));
    const spawnY = randInt(this.rng, LANE_COUNT);
    if (this.inBaseRadius(spawnX)) return;
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
    });
  }

  private killEnemy(e: Enemy) {
    this.metrics.kills++;
    const reward = ENEMY_DEFS[e.type].value;
    this.player.money += reward;
    this.metrics.moneyEarned += reward;
  }

  /**
   * 敵をプレイヤーへ向けて1マス移動させる。バリケードが移動先を塞いでいる場合は
   * 別軸への迂回を試み、それも塞がれていれば移動せず塞いでいるバリケードを返す
   * （呼び出し側でバリケードへの攻撃に切り替える）。
   */
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
      const b = this.barricadeAt(nx, ny);
      if (!b) {
        e.x = Math.max(0, Math.min(FIELD_WIDTH, nx));
        e.y = ny;
        return null;
      }
      blocker = b;
    }
    return blocker ?? null;
  }

  private stepAway(e: Enemy, tx: number, ty: number) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      e.x = Math.max(0, e.x - Math.sign(dx));
    } else {
      e.y = clampLane(e.y - Math.sign(dy));
    }
  }

  private stepEnemies() {
    for (const e of [...this.enemies]) {
      if (!this.enemies.includes(e)) continue;
      if (this.inBaseRadius(e.x)) continue; // 固定範囲の保護装置（008パターン#3）
      const dist = chebyshev(e.x, e.y, this.player.x, this.player.y);
      let blockedBy: Barricade | null = null;
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
      const newDist = chebyshev(e.x, e.y, this.player.x, this.player.y);
      if (newDist <= e.range && e.atkCd <= 0) {
        e.atkCd = ENEMY_DEFS[e.type].atkCdMax;
        if (this.player.dashInvulnTicks <= 0) {
          this.player.hp -= e.atk;
        }
      }
    }
    // 死んだ敵・player.xより大きく後方に離れた敵を除去
    this.enemies = this.enemies.filter((e) => e.hp > 0 && e.x >= this.player.x - 15);
  }

  private applyMove(dir: Dir) {
    let { x, y } = this.player;
    if (dir === 'right') x = Math.min(FIELD_WIDTH, x + 1);
    else if (dir === 'left') x = Math.max(0, x - 1);
    else if (dir === 'up') y = clampLane(y - 1);
    else if (dir === 'down') y = clampLane(y + 1);
    this.player.x = x;
    this.player.y = y;
  }

  private applyAttack() {
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

  private applySkill() {
    if (!this.player.hasSkill || this.player.skillCd > 0) return;
    this.player.skillCd = this.player.skillCdMax;
    this.metrics.skillUses++;
    for (const e of this.enemies) {
      if (chebyshev(e.x, e.y, this.player.x, this.player.y) <= SKILL_RADIUS) {
        e.hp -= this.player.skillDmg;
        if (e.hp <= 0) this.killEnemy(e);
      }
    }
  }

  private applyDash(dir: Dir) {
    if (this.player.dashCd > 0) return;
    this.player.dashCd = this.player.dashCdMax;
    this.player.dashInvulnTicks = DASH_INVULN_TICKS;
    this.metrics.dashUses++;
    let { x, y } = this.player;
    for (let i = 0; i < this.player.dashRange; i++) {
      if (dir === 'right') x = Math.min(FIELD_WIDTH, x + 1);
      else if (dir === 'left') x = Math.max(0, x - 1);
      else if (dir === 'up') y = clampLane(y - 1);
      else if (dir === 'down') y = clampLane(y + 1);
    }
    this.player.x = x;
    this.player.y = y;
  }

  private applyBuy(category: 'offense' | 'defense' | 'mobility' | 'skill') {
    if (!this.inBaseRadius(this.player.x)) return;
    const p = this.player;
    if (category === 'offense') {
      const cost = offenseCost(p.offenseLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.offenseLv++;
      p.atk += 2;
    } else if (category === 'defense') {
      const cost = defenseCost(p.defenseLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.defenseLv++;
      p.maxHp += 8;
      p.hp = Math.min(p.maxHp, p.hp + 8);
    } else if (category === 'mobility') {
      const cost = mobilityCost(p.mobilityLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.mobilityLv++;
      p.dashCdMax = Math.max(15, p.dashCdMax - 4);
    } else {
      const cost = skillCost(p.skillLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.skillLv++;
      if (!p.hasSkill) p.hasSkill = true;
      else {
        p.skillDmg += 3;
        p.skillCdMax = Math.max(8, p.skillCdMax - 2);
      }
    }
    this.metrics.upgradesBought++;
  }

  /** バリケード設置（008パターン#6「建築を第三の選択肢にする」の直接実装） */
  private applyBuildBarricade(dir: Dir) {
    const { nx, ny } = adjacentTile(this.player.x, this.player.y, dir);
    if (nx < 0 || nx > FIELD_WIDTH || ny < 0 || ny >= LANE_COUNT) return;
    if (this.barricadeAt(nx, ny)) return;
    const cost = barricadeCost(this.bandAt(this.player.x));
    if (this.player.money < cost) return;
    this.player.money -= cost;
    this.barricades.push({ id: this.nextBarricadeId++, x: nx, y: ny, hp: BARRICADE_HP, maxHp: BARRICADE_HP });
    this.metrics.barricadesBuilt++;
  }

  /** 前線拠点の建設（008パターン#7「目標を生む建築」の直接実装） */
  private applyBuildOutpost() {
    const x = this.player.x;
    if (this.nearestBaseDistance(x) < OUTPOST_MIN_GAP) return;
    const cost = outpostCost(this.bandAt(x));
    if (this.player.money < cost) return;
    this.player.money -= cost;
    this.outposts.push(x);
    this.metrics.outpostsBuilt++;
  }

  step(action: Action): GameState {
    if (this.over) return this.getState();
    this.tick++;

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
      case 'skill':
        this.applySkill();
        break;
      case 'buy':
        this.applyBuy(action.category);
        break;
      case 'build':
        if (action.target === 'barricade') this.applyBuildBarricade(action.dir);
        else this.applyBuildOutpost();
        break;
      case 'wait':
        break;
    }

    if (this.player.atkCd > 0) this.player.atkCd--;
    if (this.player.dashCd > 0) this.player.dashCd--;
    if (this.player.dashInvulnTicks > 0) this.player.dashInvulnTicks--;
    if (this.player.skillCd > 0) this.player.skillCd--;

    this.maxXReached = Math.max(this.maxXReached, this.player.x);

    if (!this.over && this.player.x >= FIELD_WIDTH) {
      this.over = true;
      this.won = true;
    }

    if (!this.over) {
      this.spawnEnemies();
      this.stepEnemies();

      if (this.inBaseRadius(this.player.x)) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + BASE_REGEN_PER_TICK);
        if (this.player.money <= 0) {
          this.passiveIncomeTimer++;
          if (this.passiveIncomeTimer >= PASSIVE_INCOME_INTERVAL) {
            this.passiveIncomeTimer = 0;
            this.player.money += PASSIVE_INCOME_AMOUNT;
          }
        } else {
          this.passiveIncomeTimer = 0;
        }
        this.fieldRegenTimer = 0;
      } else if (
        this.player.hp < this.player.maxHp &&
        !this.enemies.some((e) => chebyshev(e.x, e.y, this.player.x, this.player.y) <= FIELD_REGEN_SAFE_RANGE)
      ) {
        // 詰みからの脱出手段（HP版）: 拠点圏外でも非戦闘中はごく僅かに自然回復する
        this.fieldRegenTimer++;
        if (this.fieldRegenTimer >= FIELD_REGEN_INTERVAL) {
          this.fieldRegenTimer = 0;
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + FIELD_REGEN_AMOUNT);
        }
      } else {
        this.fieldRegenTimer = 0;
      }

      this.updateRiskTracking();

      if (this.player.hp <= 0) {
        this.over = true;
        this.won = false;
        this.metrics.died = true;
      }
    }

    this.metrics.distanceReached = this.maxXReached;
    this.metrics.score =
      this.metrics.distanceReached * 2 +
      this.metrics.kills * 5 +
      this.metrics.moneyEarned +
      this.metrics.outpostsBuilt * 60 +
      this.metrics.barricadesBuilt * 2 +
      (this.won ? 200 : 0);

    return this.getState();
  }

  getState(): GameState {
    const p = this.player;
    const band = this.bandAt(p.x);
    const baseDist = this.nearestBaseDistance(p.x);
    return {
      tick: this.tick,
      over: this.over,
      won: this.won,
      player: {
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: p.maxHp,
        atk: p.atk,
        atkCd: p.atkCd,
        atkCdMax: ATK_CD_MAX,
        atkRange: ATK_RANGE,
        dashCd: p.dashCd,
        dashCdMax: p.dashCdMax,
        dashRange: p.dashRange,
        hasSkill: p.hasSkill,
        skillCd: p.skillCd,
        skillCdMax: p.skillCdMax,
        skillDmg: p.skillDmg,
        skillRadius: SKILL_RADIUS,
        money: p.money,
        shopPrices: {
          offense: offenseCost(p.offenseLv),
          defense: defenseCost(p.defenseLv),
          mobility: mobilityCost(p.mobilityLv),
          skill: skillCost(p.skillLv),
        },
        buildCosts: {
          barricade: barricadeCost(band),
          outpost: outpostCost(band),
        },
        canBuildOutpost: baseDist >= OUTPOST_MIN_GAP && p.money >= outpostCost(band),
        recommendedHp: this.recommendedHp(),
        combatRiskLevel: this.combatRiskLevel(),
        riskEscalationBanner: this.riskEscalationBannerTicks,
        baseDistance: baseDist,
      },
      map: {
        width: FIELD_WIDTH,
        laneCount: LANE_COUNT,
        goalDistance: FIELD_WIDTH,
        homeRadius: HOME_RADIUS,
        outpostRadius: OUTPOST_RADIUS,
        outpostMinGap: OUTPOST_MIN_GAP,
      },
      enemies: this.enemies.map((e) => ({ ...e })),
      barricades: this.barricades.map((b) => ({ ...b })),
      outposts: [...this.outposts],
      metrics: { ...this.metrics },
    };
  }
}
