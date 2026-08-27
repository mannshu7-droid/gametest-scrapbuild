import { mulberry32, randInt, type Rng } from './rng';
import type {
  Action,
  Enemy,
  EnemyType,
  GameState,
  Metrics,
  RiskLevel,
  RouteDanger,
} from './types';

// --- ワールド定数 ---
export const FIELD_WIDTH = 400;
export const LANE_COUNT = 5;
export const SEGMENT_INTERVAL = 40;
export const SEGMENT_COUNT = FIELD_WIDTH / SEGMENT_INTERVAL; // 10
export const WAYSTATION_RADIUS = 3;
const WAYSTATIONS: number[] = Array.from({ length: SEGMENT_COUNT }, (_, i) => (i + 1) * SEGMENT_INTERVAL);

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
const WAYSTATION_REGEN_PER_TICK = 1;

// --- 詰みからの脱出手段（008パターン#4）: ウェイステーションで無一文の間、少額の哨戒報酬が入る ---
const PASSIVE_INCOME_INTERVAL = 20;
const PASSIVE_INCOME_AMOUNT = 3;

// --- 危険度再悪化のたびのHUDハイライト（008パターン#11） ---
const RISK_ESCALATION_BANNER_TICKS = 90;

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

function recommendedHpForSegment(band: number, danger: RouteDanger): number {
  const base = 22 + band * 4;
  return danger === 'risky' ? Math.round(base * 1.2) : base;
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

function nearestWaystationDistance(x: number): number {
  let best = Infinity;
  for (const wx of WAYSTATIONS) {
    const d = Math.abs(x - wx);
    if (d < best) best = d;
  }
  return best;
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
  private player: PlayerState;
  private enemies: Enemy[] = [];
  private segments: (RouteDanger | null)[];
  private awaitingRouteChoice = false;
  private waystationsReachedSet = new Set<number>();
  private prevSeverity = 0;
  private riskEscalationBannerTicks = 0;
  private passiveIncomeTimer = 0;
  private maxXReached = 0;
  private metrics: Metrics = {
    distanceReached: 0,
    kills: 0,
    died: false,
    moneyEarned: 0,
    upgradesBought: 0,
    dashUses: 0,
    skillUses: 0,
    waystationsReached: 0,
    riskyRoutesTaken: 0,
    safeRoutesTaken: 0,
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
    this.segments = new Array(SEGMENT_COUNT).fill(null);
    this.segments[0] = 'safe'; // 最初の区間は選択なしの安全区間（チュートリアル）
  }

  private currentBand(): number {
    return Math.min(SEGMENT_COUNT - 1, Math.floor(this.player.x / SEGMENT_INTERVAL));
  }

  private currentDanger(): RouteDanger {
    return this.segments[this.currentBand()] ?? 'safe';
  }

  private inWaystationRadius(): boolean {
    return nearestWaystationDistance(this.player.x) <= WAYSTATION_RADIUS;
  }

  /**
   * awaitingRouteChoice中に選択対象となっているセグメントのindexを返す。
   * ちょうどウェイステーションのx座標にいる間だけ意味を持つ（それ以外はnull）。
   * 注意: currentBand()=floor(x/interval)はx=40のようなウェイステーション直上では
   * 既に次のband(1)を指してしまうため、ここではWAYSTATIONS配列のindexから直接算出する
   * （このズレが原因でルート選択が常に1つ先のセグメントに書き込まれ、
   * awaitingRouteChoiceが永久にtrueのまま前進不能になるバグを実装中に検出・修正した）
   */
  private awaitingSegmentIndex(): number | null {
    const wIdx = WAYSTATIONS.indexOf(this.player.x);
    if (wIdx === -1) return null;
    return wIdx + 1;
  }

  private updateRiskTracking() {
    const band = this.currentBand();
    const danger = this.currentDanger();
    const recommended = recommendedHpForSegment(band, danger);
    const level = riskLevelFor(this.player.maxHp, recommended);
    const severity = severityOf(level);
    if (severity > this.prevSeverity) {
      this.riskEscalationBannerTicks = RISK_ESCALATION_BANNER_TICKS;
    }
    this.prevSeverity = severity;
    if (this.riskEscalationBannerTicks > 0) this.riskEscalationBannerTicks--;
  }

  private recommendedHp(): number {
    return recommendedHpForSegment(this.currentBand(), this.currentDanger());
  }

  private combatRiskLevel(): RiskLevel {
    return riskLevelFor(this.player.maxHp, this.recommendedHp());
  }

  private routePreview(): { safe: RiskLevel; risky: RiskLevel } | null {
    if (!this.awaitingRouteChoice) return null;
    const idx = this.awaitingSegmentIndex();
    const nextBand = Math.min(SEGMENT_COUNT - 1, idx ?? this.currentBand() + 1);
    return {
      safe: riskLevelFor(this.player.maxHp, recommendedHpForSegment(nextBand, 'safe')),
      risky: riskLevelFor(this.player.maxHp, recommendedHpForSegment(nextBand, 'risky')),
    };
  }

  private maybeArriveAtWaystation() {
    const idx = WAYSTATIONS.indexOf(this.player.x);
    if (idx === -1) return;
    if (!this.waystationsReachedSet.has(idx)) {
      this.waystationsReachedSet.add(idx);
      this.metrics.waystationsReached++;
      this.player.money += 10; // 区切り・報酬演出（008パターン#9）
    }
    if (idx === SEGMENT_COUNT - 1) {
      // 最後のウェイステーション = ゴール
      this.over = true;
      this.won = true;
      return;
    }
    if (this.segments[idx + 1] === null) {
      this.awaitingRouteChoice = true;
    }
  }

  private spawnEnemies() {
    const band = this.currentBand();
    const danger = this.currentDanger();
    const cap = Math.min(3 + Math.floor(band / 3), 8);
    if (this.enemies.length >= cap) return;
    const interval = danger === 'risky' ? 5 : 7;
    const chance = danger === 'risky' ? 0.5 : 0.35;
    if (this.tick % interval !== 0) return;
    if (this.rng() >= chance) return;
    const spawnX = Math.min(FIELD_WIDTH, this.player.x + 8 + randInt(this.rng, 6));
    const spawnY = randInt(this.rng, LANE_COUNT);
    // ウェイステーションの保護半径内には出現させない
    if (nearestWaystationDistance(spawnX) <= WAYSTATION_RADIUS) return;
    const type = pickEnemyType(this.rng);
    const def = ENEMY_DEFS[type];
    const dangerMul = danger === 'risky' ? 1.15 : 1;
    const bandMul = 1 + band * 0.06;
    const mul = dangerMul * bandMul;
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

  private enemyValue(type: EnemyType, danger: RouteDanger): number {
    const base = ENEMY_DEFS[type].value;
    return Math.round(base * (danger === 'risky' ? 1.5 : 1));
  }

  private killEnemy(e: Enemy) {
    this.metrics.kills++;
    const reward = this.enemyValue(e.type, this.currentDanger());
    this.player.money += reward;
    this.metrics.moneyEarned += reward;
  }

  private stepEnemies() {
    for (const e of [...this.enemies]) {
      if (!this.enemies.includes(e)) continue;
      const protectedZone = nearestWaystationDistance(e.x) <= WAYSTATION_RADIUS;
      if (protectedZone) continue; // 固定範囲の保護装置（008パターン#3）
      const dist = chebyshev(e.x, e.y, this.player.x, this.player.y);
      // 移動
      if (e.moveCd > 0) e.moveCd--;
      else {
        e.moveCd = ENEMY_DEFS[e.type].moveCdMax;
        const desiredDist = e.type === 'archer' ? Math.max(1, e.range - 1) : 0;
        if (dist > desiredDist) {
          this.stepToward(e, this.player.x, this.player.y);
        } else if (e.type === 'archer' && dist < desiredDist) {
          this.stepAway(e, this.player.x, this.player.y);
        }
      }
      // 攻撃
      const newDist = chebyshev(e.x, e.y, this.player.x, this.player.y);
      if (e.atkCd > 0) e.atkCd--;
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

  private stepToward(e: Enemy, tx: number, ty: number) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      e.x += Math.sign(dx);
    } else {
      e.y = Math.max(0, Math.min(LANE_COUNT - 1, e.y + Math.sign(dy)));
    }
  }

  private stepAway(e: Enemy, tx: number, ty: number) {
    const dx = tx - e.x;
    const dy = ty - e.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      e.x = Math.max(0, e.x - Math.sign(dx));
    } else {
      e.y = Math.max(0, Math.min(LANE_COUNT - 1, e.y - Math.sign(dy)));
    }
  }

  private applyMove(dir: 'up' | 'down' | 'left' | 'right') {
    let { x, y } = this.player;
    if (dir === 'right') {
      if (this.awaitingRouteChoice) return; // ルート選択待ちの間は前進不可
      x = Math.min(FIELD_WIDTH, x + 1);
    } else if (dir === 'left') {
      x = Math.max(0, x - 1);
    } else if (dir === 'up') {
      y = Math.max(0, y - 1);
    } else if (dir === 'down') {
      y = Math.min(LANE_COUNT - 1, y + 1);
    }
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

  private applyDash(dir: 'up' | 'down' | 'left' | 'right') {
    if (this.player.dashCd > 0) return;
    this.player.dashCd = this.player.dashCdMax;
    this.player.dashInvulnTicks = DASH_INVULN_TICKS;
    this.metrics.dashUses++;
    let { x, y } = this.player;
    for (let i = 0; i < this.player.dashRange; i++) {
      if (dir === 'right') {
        if (this.awaitingRouteChoice) break;
        x = Math.min(FIELD_WIDTH, x + 1);
      } else if (dir === 'left') x = Math.max(0, x - 1);
      else if (dir === 'up') y = Math.max(0, y - 1);
      else if (dir === 'down') y = Math.min(LANE_COUNT - 1, y + 1);
    }
    this.player.x = x;
    this.player.y = y;
  }

  private applyBuy(category: 'offense' | 'defense' | 'mobility' | 'skill') {
    if (!this.inWaystationRadius()) return;
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

  private applyChooseRoute(route: RouteDanger) {
    if (!this.awaitingRouteChoice) return;
    const idx = this.awaitingSegmentIndex();
    if (idx === null || idx >= SEGMENT_COUNT || this.segments[idx] !== null) return;
    this.segments[idx] = route;
    this.awaitingRouteChoice = false;
    if (route === 'risky') this.metrics.riskyRoutesTaken++;
    else this.metrics.safeRoutesTaken++;
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
      case 'chooseRoute':
        this.applyChooseRoute(action.route);
        break;
      case 'wait':
        break;
    }

    if (this.player.atkCd > 0) this.player.atkCd--;
    if (this.player.dashCd > 0) this.player.dashCd--;
    if (this.player.dashInvulnTicks > 0) this.player.dashInvulnTicks--;
    if (this.player.skillCd > 0) this.player.skillCd--;

    this.maybeArriveAtWaystation();
    this.spawnEnemies();
    this.stepEnemies();

    if (this.inWaystationRadius()) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + WAYSTATION_REGEN_PER_TICK);
      if (this.player.money <= 0) {
        this.passiveIncomeTimer++;
        if (this.passiveIncomeTimer >= PASSIVE_INCOME_INTERVAL) {
          this.passiveIncomeTimer = 0;
          this.player.money += PASSIVE_INCOME_AMOUNT;
        }
      } else {
        this.passiveIncomeTimer = 0;
      }
    }

    this.maxXReached = Math.max(this.maxXReached, this.player.x);
    this.updateRiskTracking();

    if (this.player.hp <= 0 && !this.over) {
      this.over = true;
      this.won = false;
      this.metrics.died = true;
    }

    this.metrics.distanceReached = this.maxXReached;
    this.metrics.score =
      this.metrics.distanceReached * 2 +
      this.metrics.kills * 5 +
      this.metrics.moneyEarned +
      this.metrics.waystationsReached * 20 +
      (this.won ? 200 : 0);

    return this.getState();
  }

  getState(): GameState {
    const p = this.player;
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
        recommendedHp: this.recommendedHp(),
        combatRiskLevel: this.combatRiskLevel(),
        riskEscalationBanner: this.riskEscalationBannerTicks,
      },
      map: {
        width: FIELD_WIDTH,
        laneCount: LANE_COUNT,
        goalDistance: FIELD_WIDTH,
        waystations: WAYSTATIONS,
        waystationRadius: WAYSTATION_RADIUS,
      },
      enemies: this.enemies.map((e) => ({ ...e })),
      segments: [...this.segments],
      awaitingRouteChoice: this.awaitingRouteChoice,
      routePreview: this.routePreview(),
      metrics: { ...this.metrics },
    };
  }
}
