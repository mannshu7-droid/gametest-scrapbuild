import { mulberry32, type Rng } from './rng';
import type {
  Action,
  Dir,
  DownPhase,
  Enemy,
  EnemyKind,
  FloatText,
  GameState,
  Metrics,
  Player,
  ShopItemId,
} from './types';

/**
 * 調整値。simulate の --tune key=value で上書きできる（026の--tuneを初版から入れる）。
 * 数値の根拠は specs/027-combat-emberstake/spec.md の「バランス初期値」。
 */
export const TUNE = {
  /** 1セッションの長さ（10tps × 600秒） */
  sessionTicks: 6000,
  arenaRadius: 11,
  brazierRadius: 1.6,
  /** 篝火の結界の余白（敵が近づける最短距離 = brazierRadius + wardMargin） */
  wardMargin: 0.3,
  playerSpeed: 0.25,
  baseHp: 100,
  baseAtk: 10,
  attackCd: 6,
  attackRadius: 1.5,
  dashDist: 3,
  dashCd: 30,
  dashIframes: 4,
  channelTicks: 15,
  /** 熱: 報酬倍率 = 1 + heat / rewardDiv、被ダメージ倍率 = 1 + (heat / damageDiv)^damageExp（同じダイヤルに長所と短所） */
  rewardDiv: 25,
  damageDiv: 45,
  damageExp: 2,
  heatMax: 100,
  /** 撃破が途切れて何tickで熱が冷め始めるか、冷める速さ（heat/tick） */
  heatGraceTicks: 40,
  heatDecay: 0.25,
  /** 時間による敵の強化: HPは difficulty 倍、攻撃は (1 + (difficulty-1) * dmgGrowthShare) 倍 */
  difficultyPerTick: 1 / 3000,
  dmgGrowthShare: 0.6,
  spawnStart: 14,
  spawnEnd: 6,
  maxEnemies: 18,
  /** 救助直後: 篝火の周りの敵を押し返す半径と、無敵tick */
  rescueClearRadius: 5,
  rescueIframes: 20,
  /** ショップ */
  shopBase: 40,
  shopGrowth: 1.9,
  shopMaxLevel: 8,
  bladeAtk: 4,
  /** 防具1段ごとの被ダメージ係数（乗算） */
  armorMult: 0.88,
  /** 癒し1段ごとの撃破時回復 */
  mendHeal: 2,
  vitalityHp: 25,
};

export type Tune = typeof TUNE;

export const SHOP_ITEMS: ShopItemId[] = ['blade', 'armor', 'mend', 'vitality'];

interface EnemyDef {
  hp: number;
  dmg: number;
  speed: number;
  cd: number;
  embers: number;
  heat: number;
  reach: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  grunt: { hp: 20, dmg: 6, speed: 0.08, cd: 12, embers: 4, heat: 5, reach: 0.9 },
  runner: { hp: 10, dmg: 4, speed: 0.16, cd: 8, embers: 3, heat: 4, reach: 0.8 },
  brute: { hp: 60, dmg: 16, speed: 0.06, cd: 20, embers: 12, heat: 10, reach: 1.1 },
};

const DIR_VEC: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

function emptyMetrics(): Metrics {
  return {
    score: 0,
    kills: 0,
    banks: 0,
    downs: 0,
    downsByPhase: { low: 0, mid: 0, high: 0, banking: 0 },
    downPhase: 'none',
    lostEmbers: 0,
    lostHeat: 0,
    unbankedAtEnd: 0,
    peakHeat: 0,
    sumBankHeat: 0,
    ticksHighHeat: 0,
    damageTaken: 0,
    channelBreaks: 0,
    spent: 0,
  };
}

export class Game {
  readonly seed: number;
  readonly tune: Tune;
  private rng: Rng;
  tick = 0;
  over = false;
  player: Player;
  enemies: Enemy[] = [];
  private nextId = 1;
  private spawnTimer = 20;
  private floats: FloatText[] = [];
  private lastRescue: GameState['lastRescue'] = null;
  private lastBank: GameState['lastBank'] = null;
  /** このtickに被弾したか（詠唱リセット判定） */
  private hitThisTick = false;
  metrics: Metrics = emptyMetrics();

  constructor(seed: number, tune: Partial<Tune> = {}) {
    this.seed = seed;
    this.tune = { ...TUNE, ...tune };
    this.rng = mulberry32(seed);
    const t = this.tune;
    this.player = {
      x: 0,
      y: 0,
      hp: t.baseHp,
      maxHp: t.baseHp,
      facing: 'right',
      attackCd: 0,
      dashCd: 0,
      iframes: 0,
      heat: 0,
      sinceKill: 0,
      pool: 0,
      channel: 0,
      embers: 0,
      levels: { blade: 0, armor: 0, mend: 0, vitality: 0 },
    };
  }

  // ---- 派生値 ----

  rewardMult(): number {
    return 1 + this.player.heat / this.tune.rewardDiv;
  }

  damageMult(): number {
    // 被ダメージは熱に対して凸（低い熱では緩く、高い熱で急に重くなる）→ 奉納する熱に内側の最適点を作る
    return 1 + Math.pow(this.player.heat / this.tune.damageDiv, this.tune.damageExp);
  }

  difficulty(): number {
    return 1 + this.tick * this.tune.difficultyPerTick;
  }

  atk(): number {
    return this.tune.baseAtk + this.player.levels.blade * this.tune.bladeAtk;
  }

  shopCost(item: ShopItemId): number {
    const lv = this.player.levels[item];
    if (lv >= this.tune.shopMaxLevel) return Infinity;
    return Math.round(this.tune.shopBase * Math.pow(this.tune.shopGrowth, lv));
  }

  onBrazier(): boolean {
    return Math.hypot(this.player.x, this.player.y) <= this.tune.brazierRadius;
  }

  // ---- 進行 ----

  step(action: Action): void {
    if (this.over) return;
    const p = this.player;
    const t = this.tune;
    this.hitThisTick = false;

    if (p.attackCd > 0) p.attackCd--;
    if (p.dashCd > 0) p.dashCd--;
    if (p.iframes > 0) p.iframes--;

    let channeling = false;
    switch (action.type) {
      case 'move': {
        const [dx, dy] = DIR_VEC[action.dir];
        p.facing = action.dir;
        this.movePlayer(dx * t.playerSpeed, dy * t.playerSpeed);
        break;
      }
      case 'dash': {
        if (p.dashCd === 0) {
          const [dx, dy] = DIR_VEC[action.dir];
          p.facing = action.dir;
          this.movePlayer(dx * t.dashDist, dy * t.dashDist);
          p.dashCd = t.dashCd;
          p.iframes = Math.max(p.iframes, t.dashIframes);
        }
        break;
      }
      case 'attack':
        if (p.attackCd === 0) this.attack();
        break;
      case 'bank':
        if (this.onBrazier()) {
          channeling = true;
          p.channel++;
        }
        break;
      case 'buy':
        this.buy(action.item);
        break;
      case 'wait':
        break;
    }
    if (!channeling) p.channel = 0;

    this.updateEnemies();
    if (channeling && this.hitThisTick && p.hp > 0) {
      p.channel = 0;
      this.metrics.channelBreaks++;
    }
    if (p.hp <= 0) this.rescue(channeling);
    else if (channeling && p.channel >= t.channelTicks) this.bank();

    // 熱の冷め
    p.sinceKill++;
    if (p.sinceKill > t.heatGraceTicks && p.heat > 0) p.heat = Math.max(0, p.heat - t.heatDecay);
    if (p.heat >= 60) this.metrics.ticksHighHeat++;

    this.spawn();
    for (const f of this.floats) {
      f.ttl--;
      f.y -= 0.03;
    }
    this.floats = this.floats.filter((f) => f.ttl > 0);

    this.tick++;
    if (this.tick >= t.sessionTicks) {
      this.over = true;
      this.metrics.unbankedAtEnd = Math.round(p.pool);
    }
  }

  private movePlayer(dx: number, dy: number): void {
    const p = this.player;
    p.x += dx;
    p.y += dy;
    const r = Math.hypot(p.x, p.y);
    const lim = this.tune.arenaRadius - 0.4;
    if (r > lim) {
      p.x *= lim / r;
      p.y *= lim / r;
    }
  }

  private attack(): void {
    const p = this.player;
    const t = this.tune;
    p.attackCd = t.attackCd;
    const dmg = this.atk();
    for (const e of this.enemies) {
      if (Math.hypot(e.x - p.x, e.y - p.y) <= t.attackRadius) e.hp -= dmg;
    }
    const dead = this.enemies.filter((e) => e.hp <= 0);
    if (dead.length === 0) return;
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    for (const e of dead) {
      const def = ENEMY_DEFS[e.kind];
      // 報酬は撃破した瞬間の熱で決まり、その後に熱が上がる
      const gain = def.embers * this.rewardMult();
      p.pool += gain;
      p.heat = Math.min(t.heatMax, p.heat + def.heat);
      p.hp = Math.min(p.maxHp, p.hp + p.levels.mend * t.mendHeal);
      this.metrics.kills++;
      this.floats.push({ x: e.x, y: e.y, text: `+${gain.toFixed(0)}`, color: '#ffb347', ttl: 12 });
    }
    p.sinceKill = 0;
    if (p.heat > this.metrics.peakHeat) this.metrics.peakHeat = p.heat;
  }

  private buy(item: ShopItemId): void {
    if (!this.onBrazier()) return;
    const p = this.player;
    const cost = this.shopCost(item);
    if (p.embers < cost) return;
    p.embers -= cost;
    p.levels[item]++;
    this.metrics.spent += cost;
    if (item === 'vitality') {
      p.maxHp += this.tune.vitalityHp;
      p.hp += this.tune.vitalityHp;
    }
  }

  private bank(): void {
    const p = this.player;
    const amount = Math.round(p.pool);
    p.embers += amount;
    this.metrics.score += amount;
    this.metrics.banks++;
    this.metrics.sumBankHeat += p.heat;
    this.lastBank = { tick: this.tick, amount, heat: Math.round(p.heat) };
    this.floats.push({ x: p.x, y: p.y - 0.5, text: `奉納 ${amount}`, color: '#ffd76a', ttl: 20 });
    p.pool = 0;
    p.heat = 0;
    p.channel = 0;
    p.hp = p.maxHp;
  }

  /** HP0: 死ではなく救助。失うのは未奉納の残り火と熱だけ（お金・時間・装備は失わない） */
  private rescue(channeling: boolean): void {
    const p = this.player;
    const t = this.tune;
    const phase: Exclude<DownPhase, 'none'> = channeling ? 'banking' : p.heat >= 60 ? 'high' : p.heat >= 30 ? 'mid' : 'low';
    this.metrics.downs++;
    this.metrics.downsByPhase[phase]++;
    this.metrics.downPhase = phase;
    this.metrics.lostEmbers += Math.round(p.pool);
    this.metrics.lostHeat += p.heat;
    this.lastRescue = { tick: this.tick, lostPool: Math.round(p.pool), lostHeat: Math.round(p.heat) };
    this.floats.push({ x: p.x, y: p.y, text: `救助 −${Math.round(p.pool)}`, color: '#ff6b6b', ttl: 25 });
    p.pool = 0;
    p.heat = 0;
    p.channel = 0;
    p.hp = p.maxHp;
    p.x = 0;
    p.y = 0;
    p.iframes = t.rescueIframes;
    // 篝火の周りの敵を闘技場の縁へ押し返す（救助直後の連続ダウンを防ぐ）
    for (const e of this.enemies) {
      const d = Math.hypot(e.x, e.y);
      if (d < t.rescueClearRadius) {
        const a = d > 0.01 ? Math.atan2(e.y, e.x) : this.rng() * Math.PI * 2;
        e.x = Math.cos(a) * (t.arenaRadius - 0.5);
        e.y = Math.sin(a) * (t.arenaRadius - 0.5);
      }
    }
  }

  private updateEnemies(): void {
    const p = this.player;
    const t = this.tune;
    const diff = this.difficulty();
    const dmgScale = (1 + (diff - 1) * t.dmgGrowthShare) * this.damageMult() * Math.pow(t.armorMult, p.levels.armor);
    for (const e of this.enemies) {
      const def = ENEMY_DEFS[e.kind];
      if (e.cd > 0) e.cd--;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > def.reach * 0.85) {
        e.x += (dx / d) * def.speed;
        e.y += (dy / d) * def.speed;
      }
      if (d <= def.reach && e.cd === 0) {
        e.cd = def.cd;
        if (p.iframes === 0) {
          const dmg = def.dmg * dmgScale;
          p.hp -= dmg;
          this.metrics.damageTaken += dmg;
          this.hitThisTick = true;
        }
      }
    }
    // 篝火の結界: 敵は火の輪（半径brazierRadius+wardMargin）の内側へ入れない。中心にいれば敵の手は届かない
    const ward = t.brazierRadius + t.wardMargin;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x, e.y);
      if (d < ward && d > 0.001) {
        e.x *= ward / d;
        e.y *= ward / d;
      }
    }
    // 敵同士が重ならないよう軽く押し合う
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i];
        const b = this.enemies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.001 && d < 0.6) {
          const push = (0.6 - d) / 2;
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
  }

  private spawn(): void {
    const t = this.tune;
    if (--this.spawnTimer > 0) return;
    const frac = Math.min(1, this.tick / t.sessionTicks);
    this.spawnTimer = Math.round(t.spawnStart + (t.spawnEnd - t.spawnStart) * frac);
    if (this.enemies.length >= t.maxEnemies) return;
    const r = this.rng();
    // 序盤は雑兵中心、時間とともに走り屋・重兵が混ざる
    const kind: EnemyKind = r < 0.15 + 0.15 * frac ? 'brute' : r < 0.45 + 0.1 * frac ? 'runner' : 'grunt';
    const a = this.rng() * Math.PI * 2;
    const def = ENEMY_DEFS[kind];
    const hp = Math.round(def.hp * this.difficulty());
    this.enemies.push({
      id: this.nextId++,
      kind,
      x: Math.cos(a) * (t.arenaRadius - 0.3),
      y: Math.sin(a) * (t.arenaRadius - 0.3),
      hp,
      maxHp: hp,
      cd: def.cd,
    });
  }

  getState(): GameState {
    const p = this.player;
    const costs = {} as Record<ShopItemId, number>;
    for (const it of SHOP_ITEMS) {
      const c = this.shopCost(it);
      costs[it] = Number.isFinite(c) ? c : -1;
    }
    // JSON往復はシミュレーションで重いので、手で複製する（全てプリミティブ／平坦なオブジェクト）
    return {
      seed: this.seed,
      tick: this.tick,
      sessionTicks: this.tune.sessionTicks,
      over: this.over,
      arenaRadius: this.tune.arenaRadius,
      brazierRadius: this.tune.brazierRadius,
      player: { ...p, levels: { ...p.levels } },
      enemies: this.enemies.map((e) => ({ ...e })),
      rewardMult: this.rewardMult(),
      damageMult: this.damageMult(),
      difficulty: this.difficulty(),
      shopCosts: costs,
      onBrazier: this.onBrazier(),
      channelNeeded: this.tune.channelTicks,
      lastRescue: this.lastRescue && { ...this.lastRescue },
      lastBank: this.lastBank && { ...this.lastBank },
      floats: this.floats.map((f) => ({ ...f })),
      goals: [800, 2000, 4000],
      metrics: { ...this.metrics, downsByPhase: { ...this.metrics.downsByPhase } },
    };
  }
}
