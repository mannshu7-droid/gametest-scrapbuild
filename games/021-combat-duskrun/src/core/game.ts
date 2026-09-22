import { mulberry32, randInt, type Rng } from './rng';
import type { Action, DeathPhase, Enemy, GameState, Metrics, RiskLevel, Route, UpgradeKind } from './types';

// --- ワールド定数 ---
export const MAX_DISTANCE = 220;
export const MOVE_SPEED = 1;
export const DASH_BONUS = 3;
export const DASH_REGEN_INTERVAL = 120;
export const ATK_RANGE = 3;
export const ATK_CD_MAX = 4;
export const DECOY_RADIUS = 16;
export const DECOY_STUN_TICKS = 80;
export const DAYS_GOAL = 15;

// --- 帰路（ルート選択）定数 ---
const DIRECT_DISTANCE_DELTA = -14;
const DETOUR_DISTANCE_DELTA = 22;
const DIRECT_SPAWN_INTERVAL_MULT = 0.75;
const DETOUR_SPAWN_INTERVAL_MULT = 1.6;
const DETOUR_ENEMY_SPEED_MULT = 0.85;

// --- 夜間バフ（020-finalの「夜のフィールドで死ぬ」構造を意図的に再現する） ---
const NIGHT_SPEED_MULT = 1.5;
const NIGHT_ATK_MULT = 2.0;
const NIGHT_SPAWN_INTERVAL_MULT = 0.6;

// --- 敵スポーン ---
const BASE_SPAWN_INTERVAL = 30;
const BASE_SPAWN_CHANCE = 0.5;
const ENEMY_ATK_CD_MAX = 9;
const ENEMY_DESPAWN_BEHIND = 35;

// --- リスクヒント閾値 ---
const RISK_SAFE_MARGIN = 40;
const ROUTE_SAFETY_BUFFER = 32;

// --- 強化コスト・効果（008系「常設ショップ・複数の使い道」パターンを踏襲） ---
function atkCost(lv: number): number {
  return 15 + lv * 10;
}
function maxHpCost(lv: number): number {
  return 15 + lv * 10;
}
function maxDashCost(lv: number): number {
  return 20 + lv * 15;
}
function maxFlareCost(lv: number): number {
  return 15 + lv * 10;
}
function daylightCost(lv: number): number {
  return 25 + lv * 18;
}

interface PlayerState {
  distance: number;
  hp: number;
  maxHp: number;
  atk: number;
  atkCd: number;
  money: number;
  dashCharges: number;
  maxDashCharges: number;
  dashRegenCounter: number;
  flareCharges: number;
  maxFlareCharges: number;
  daylightMax: number;
  daylightRemaining: number;
  intent: 'push' | 'retreat';
  routeLocked: Route | null;
  atkLv: number;
  hpLv: number;
  dashLv: number;
  flareLv: number;
  daylightLv: number;
}

export class Game {
  seed: number;
  tick = 0;
  over = false;
  won = false;
  day = 0;
  private rng: Rng;
  private nextEnemyId = 1;
  private player: PlayerState;
  private enemies: Enemy[] = [];
  private awayThisDay = false;
  private nightCountedThisDay = false;
  private maxDistanceReached = 0;
  private metrics: Metrics = {
    daysSurvived: 0,
    maxDistanceReached: 0,
    kills: 0,
    moneyEarned: 0,
    upgradesBought: 0,
    dashUses: 0,
    decoyUses: 0,
    directRoutesTaken: 0,
    detourRoutesTaken: 0,
    nightEntries: 0,
    died: false,
    deathPhase: 'none',
    deathDistance: 0,
    score: 0,
  };

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.player = {
      distance: 0,
      hp: 100,
      maxHp: 100,
      atk: 10,
      atkCd: 0,
      money: 0,
      dashCharges: 2,
      maxDashCharges: 2,
      dashRegenCounter: 0,
      flareCharges: 1,
      maxFlareCharges: 1,
      daylightMax: 180,
      daylightRemaining: 180,
      intent: 'push',
      routeLocked: null,
      atkLv: 0,
      hpLv: 0,
      dashLv: 0,
      flareLv: 0,
      daylightLv: 0,
    };
  }

  private night(): boolean {
    return this.player.distance > 0 && this.player.daylightRemaining <= 0;
  }

  private spawnCap(): number {
    return Math.min(2 + Math.floor(this.day / 3), 6);
  }

  private spawnIntervalMult(): number {
    let mult = 1;
    if (this.player.routeLocked === 'direct') mult *= DIRECT_SPAWN_INTERVAL_MULT;
    else if (this.player.routeLocked === 'detour') mult *= DETOUR_SPAWN_INTERVAL_MULT;
    if (this.night()) mult *= NIGHT_SPAWN_INTERVAL_MULT;
    return mult;
  }

  private enemySpeed(): number {
    let speed = 0.9;
    if (this.player.routeLocked === 'detour') speed *= DETOUR_ENEMY_SPEED_MULT;
    if (this.night()) speed *= NIGHT_SPEED_MULT;
    return speed;
  }

  private spawnEnemies() {
    if (this.player.distance <= 0) return; // 拠点内は安全地帯、レイダーは湧かない
    if (this.enemies.length >= this.spawnCap()) return;
    const interval = Math.max(1, Math.round(BASE_SPAWN_INTERVAL * this.spawnIntervalMult()));
    if (this.tick % interval !== 0) return;
    if (this.rng() >= BASE_SPAWN_CHANCE) return;
    const spawnDistance = Math.min(MAX_DISTANCE + 40, this.player.distance + 6 + randInt(this.rng, 9));
    const hp = Math.round(18 + this.day * 4);
    const atk = Math.round(4 + this.day * 0.35);
    this.enemies.push({
      id: this.nextEnemyId++,
      distance: spawnDistance,
      y: randInt(this.rng, 3),
      hp,
      maxHp: hp,
      atk,
      atkCd: 0,
      range: 2,
      dazedTicks: 0,
    });
  }

  private killEnemy(_e: Enemy) {
    this.metrics.kills++;
    const reward = 5 + this.day;
    this.player.money += reward;
    this.metrics.moneyEarned += reward;
  }

  private stepEnemies() {
    const speed = this.enemySpeed();
    const nightNow = this.night();
    for (const e of [...this.enemies]) {
      if (!this.enemies.includes(e)) continue;
      if (e.dazedTicks > 0) {
        e.dazedTicks--;
        // ひるんでいる間はプレイヤーから離れる方向へ半速で移動し、攻撃しない
        const away = e.distance >= this.player.distance ? 1 : -1;
        e.distance = Math.max(0, e.distance + away * speed * 0.5);
        continue;
      }
      // 移動: プレイヤーのdistanceへ向かって接近
      const diff = this.player.distance - e.distance;
      if (Math.abs(diff) > speed) {
        e.distance += Math.sign(diff) * speed;
      } else {
        e.distance = this.player.distance;
      }
      // 攻撃
      if (e.atkCd > 0) e.atkCd--;
      if (Math.abs(e.distance - this.player.distance) <= e.range && e.atkCd <= 0) {
        e.atkCd = ENEMY_ATK_CD_MAX;
        const dmg = e.atk * (nightNow ? NIGHT_ATK_MULT : 1);
        this.player.hp -= dmg;
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0 && e.distance >= this.player.distance - ENEMY_DESPAWN_BEHIND);
  }

  private applyMove(dir: 'advance' | 'retreat', dashing: boolean) {
    const amount = MOVE_SPEED + (dashing ? DASH_BONUS : 0);
    if (dir === 'advance') {
      this.player.distance = Math.min(MAX_DISTANCE, this.player.distance + amount);
      this.player.intent = 'push';
    } else {
      this.player.distance = Math.max(0, this.player.distance - amount);
      this.player.intent = 'retreat';
    }
    if (this.player.distance > 0) this.awayThisDay = true;
  }

  private applyDash(dir: 'advance' | 'retreat') {
    if (this.player.dashCharges <= 0) return;
    this.player.dashCharges--;
    this.metrics.dashUses++;
    this.applyMove(dir, true);
  }

  private applyAttack() {
    if (this.player.atkCd > 0) return;
    let target: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      const d = Math.abs(e.distance - this.player.distance);
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

  private applyDecoy() {
    if (this.player.flareCharges <= 0) return;
    this.player.flareCharges--;
    this.metrics.decoyUses++;
    for (const e of this.enemies) {
      if (Math.abs(e.distance - this.player.distance) <= DECOY_RADIUS) {
        e.dazedTicks = DECOY_STUN_TICKS;
      }
    }
  }

  private applyChooseRoute(route: Route) {
    if (this.player.distance <= 0) return;
    if (this.player.routeLocked !== null) return;
    this.player.routeLocked = route;
    if (route === 'direct') {
      this.player.distance = Math.max(0, this.player.distance + DIRECT_DISTANCE_DELTA);
      this.metrics.directRoutesTaken++;
    } else {
      this.player.distance = Math.min(MAX_DISTANCE + 40, this.player.distance + DETOUR_DISTANCE_DELTA);
      this.metrics.detourRoutesTaken++;
    }
  }

  private applyBuyUpgrade(which: UpgradeKind) {
    if (this.player.distance > 0) return;
    const p = this.player;
    if (which === 'atk') {
      const cost = atkCost(p.atkLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.atkLv++;
      p.atk += 3;
      this.metrics.upgradesBought++;
    } else if (which === 'maxHp') {
      const cost = maxHpCost(p.hpLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.hpLv++;
      p.maxHp += 20;
      p.hp = Math.min(p.maxHp, p.hp + 20);
      this.metrics.upgradesBought++;
    } else if (which === 'maxDash') {
      const cost = maxDashCost(p.dashLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.dashLv++;
      p.maxDashCharges += 1;
      this.metrics.upgradesBought++;
    } else if (which === 'maxFlare') {
      const cost = maxFlareCost(p.flareLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.flareLv++;
      p.maxFlareCharges += 1;
      this.metrics.upgradesBought++;
    } else if (which === 'daylight') {
      const cost = daylightCost(p.daylightLv);
      if (p.money < cost) return;
      p.money -= cost;
      p.daylightLv++;
      p.daylightMax += 25;
      this.metrics.upgradesBought++;
    } else if (which === 'restockFlare') {
      const missing = p.maxFlareCharges - p.flareCharges;
      if (missing <= 0) return;
      const cost = missing * (3 + this.day);
      if (p.money < cost) return;
      p.money -= cost;
      p.flareCharges = p.maxFlareCharges;
    }
  }

  private processArrivalIfNeeded() {
    if (this.player.distance > 0 || !this.awayThisDay) return;
    // 帰投確定: 全回復・日照リセット・ルート解除・翌日へ
    this.player.hp = this.player.maxHp;
    this.player.routeLocked = null;
    this.awayThisDay = false;
    this.nightCountedThisDay = false;
    this.player.intent = 'push';
    this.day++;
    this.metrics.daysSurvived = this.day;
    if (this.day >= DAYS_GOAL && !this.over) {
      this.over = true;
      this.won = true;
    }
  }

  private updateDaylightAndRegen() {
    if (this.player.distance > 0) {
      if (this.player.daylightRemaining > 0) this.player.daylightRemaining--;
      if (this.player.daylightRemaining <= 0 && !this.nightCountedThisDay) {
        this.metrics.nightEntries++;
        this.nightCountedThisDay = true;
      }
    } else {
      this.player.daylightRemaining = this.player.daylightMax;
    }
    if (this.player.dashCharges < this.player.maxDashCharges) {
      this.player.dashRegenCounter++;
      if (this.player.dashRegenCounter >= DASH_REGEN_INTERVAL) {
        this.player.dashRegenCounter = 0;
        this.player.dashCharges++;
      }
    } else {
      this.player.dashRegenCounter = 0;
    }
  }

  private returnMargin(): number {
    return this.player.daylightRemaining - this.player.distance / MOVE_SPEED;
  }

  private retreatRiskLevel(): RiskLevel {
    const margin = this.returnMargin();
    if (margin >= RISK_SAFE_MARGIN) return 'safe';
    if (margin >= 0) return 'caution';
    return 'danger';
  }

  private routeRecommended(): Route {
    // detourは敵密度・速度で安全だが距離が伸びる分だけ日照を消費する。
    // 「行った後も一定の余裕(ROUTE_SAFETY_BUFFER)が残る」場合のみ安全策のdetourを勧め、
    // 際どいマージンでは短距離のdirectを勧める（feasibleというだけでdetourが常に支配的にならないようにする）
    const detourAfter = Math.min(MAX_DISTANCE + 40, this.player.distance + DETOUR_DISTANCE_DELTA);
    const marginDetour = this.player.daylightRemaining - detourAfter / MOVE_SPEED;
    return marginDetour >= ROUTE_SAFETY_BUFFER ? 'detour' : 'direct';
  }

  step(action: Action): GameState {
    if (this.over) return this.getState();
    this.tick++;

    switch (action.type) {
      case 'advance':
        this.applyMove('advance', false);
        break;
      case 'retreat':
        this.applyMove('retreat', false);
        break;
      case 'dash':
        this.applyDash(action.dir);
        break;
      case 'attack':
        this.applyAttack();
        break;
      case 'decoy':
        this.applyDecoy();
        break;
      case 'chooseRoute':
        this.applyChooseRoute(action.route);
        break;
      case 'buyUpgrade':
        this.applyBuyUpgrade(action.which);
        break;
      case 'wait':
        break;
    }

    if (this.player.atkCd > 0) this.player.atkCd--;

    this.spawnEnemies();
    this.stepEnemies();
    this.updateDaylightAndRegen();
    this.processArrivalIfNeeded();

    this.maxDistanceReached = Math.max(this.maxDistanceReached, this.player.distance);
    this.metrics.maxDistanceReached = this.maxDistanceReached;

    if (this.player.hp <= 0 && !this.over) {
      this.over = true;
      this.won = false;
      this.metrics.died = true;
      const deathPhase: DeathPhase =
        this.player.intent === 'push' ? 'push' : this.night() ? 'retreat-night' : 'retreat-day';
      this.metrics.deathPhase = deathPhase;
      this.metrics.deathDistance = this.player.distance;
    }

    this.metrics.score =
      this.metrics.moneyEarned +
      this.metrics.kills * 4 +
      this.metrics.daysSurvived * 150 +
      this.metrics.maxDistanceReached * 2 +
      (this.won ? 300 : 0);

    return this.getState();
  }

  getState(): GameState {
    const p = this.player;
    return {
      tick: this.tick,
      over: this.over,
      won: this.won,
      day: this.day,
      player: {
        distance: p.distance,
        hp: p.hp,
        maxHp: p.maxHp,
        atk: p.atk,
        atkCd: p.atkCd,
        money: p.money,
        dashCharges: p.dashCharges,
        maxDashCharges: p.maxDashCharges,
        flareCharges: p.flareCharges,
        maxFlareCharges: p.maxFlareCharges,
        daylightRemaining: p.daylightRemaining,
        daylightMax: p.daylightMax,
        night: this.night(),
        intent: p.intent,
        routeLocked: p.routeLocked,
        returnMargin: this.returnMargin(),
        retreatRiskLevel: this.retreatRiskLevel(),
        routeRecommended: this.routeRecommended(),
        upgradeCosts: {
          atk: atkCost(p.atkLv),
          maxHp: maxHpCost(p.hpLv),
          maxDash: maxDashCost(p.dashLv),
          maxFlare: maxFlareCost(p.flareLv),
          daylight: daylightCost(p.daylightLv),
          restockFlare: Math.max(0, p.maxFlareCharges - p.flareCharges) * (3 + this.day),
        },
      },
      enemies: this.enemies.map((e) => ({ ...e })),
      metrics: { ...this.metrics },
    };
  }
}
