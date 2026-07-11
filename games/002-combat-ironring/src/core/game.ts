import { mulberry32, randInt, type Rng } from './rng';
import {
  TILE,
  type Action,
  type Dir,
  type Enemy,
  type EnemyType,
  type GameState,
  type Metrics,
  type UpgradeOption,
} from './types';

// ---- バランス定数（specs/002-combat-ironring/spec.md の表と一致させる） ----
export const W = 32;
export const H = 32;

const PLAYER_START = { x: 16, y: 16 };
const PLAYER_MAX_HP = 120;
const PLAYER_ATK = 16;
const ATTACK_CD_MAX = 3;
const DASH_CD_MAX = 20;
const DASH_RANGE = 3;
const SKILL_DMG = 15;
const SKILL_CD_MAX = 20;
const REGEN_INTERVAL = 50;
const MOVE_EVASION_TICKS = 2;
const MOVE_EVASION_REDUCTION = 0.15;

const ENEMY_STATS: Record<EnemyType, { hp: number; atk: number; atkCdMax: number; moveCdMax: number }> = {
  grunt: { hp: 30, atk: 7, atkCdMax: 8, moveCdMax: 6 },
  runner: { hp: 15, atk: 5, atkCdMax: 6, moveCdMax: 3 },
  brute: { hp: 70, atk: 16, atkCdMax: 12, moveCdMax: 9 },
};

const SPAWN_RADIUS_MIN = 8;
const SPAWN_RADIUS_MAX = 13;

function waveTotalSpawn(wave: number): number {
  if (wave === 1) return 5;
  if (wave === 2) return 7;
  return 9 + 2 * (wave - 3);
}
function waveConcurrentCap(wave: number): number {
  if (wave === 1) return 2;
  if (wave === 2) return 3;
  if (wave <= 4) return 4;
  return Math.min(4 + Math.floor((wave - 5) / 2), 9);
}
function waveSpawnInterval(wave: number): number {
  return Math.max(15, 42 - wave * 3);
}
/**
 * ウェーブ6以降、敵のHP・攻撃力を緩やかに強化する。
 * 強化ドラフトで攻撃力・攻撃速度・吸血を積み重ねたプレイヤーが
 * wave5以降も敵性能が据え置きのまま無限にスノーボールし続け、
 * 実質不死化してしまう問題への対処（v3で発覚）。
 */
function waveEnemyMultiplier(wave: number): number {
  return 1 + Math.max(0, wave - 5) * 0.35;
}
function pickEnemyType(wave: number, rng: Rng): EnemyType {
  if (wave < 3) return 'grunt';
  if (wave < 5) return rng() < 0.3 ? 'runner' : 'grunt';
  const r = rng();
  if (r < 0.2) return 'brute';
  if (r < 0.5) return 'runner';
  return 'grunt';
}

const DELTA4: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
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

interface PlayerState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: Dir;
  atk: number;
  attackCd: number;
  attackCdMax: number;
  dashCd: number;
  dashCdMax: number;
  dashRange: number;
  hasSkill: boolean;
  skillCd: number;
  skillCdMax: number;
  skillDmg: number;
  lifesteal: number;
  thorns: number;
  regen: number;
  /** このtickの間だけ有効な被弾無敵（ダッシュ発動時にtrue） */
  dashInvuln: boolean;
  /** 移動直後の身のこなしで被ダメージを軽減する残りtick数 */
  moveEvasion: number;
}

interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  eligible: (p: PlayerState) => boolean;
  apply: (p: PlayerState) => void;
}

const UPGRADE_POOL: UpgradeDef[] = [
  { id: 'atk', name: '攻撃力強化', desc: '武器の威力+5', eligible: () => true, apply: (p) => (p.atk += 5) },
  {
    id: 'maxhp',
    name: '体力強化',
    desc: '最大HP+20（即座に回復）',
    eligible: () => true,
    apply: (p) => {
      p.maxHp += 20;
      p.hp = Math.min(p.maxHp, p.hp + 20);
    },
  },
  {
    id: 'atkspeed',
    name: '攻撃速度強化',
    desc: '攻撃クールダウン-1（下限1）',
    eligible: (p) => p.attackCdMax > 1,
    apply: (p) => (p.attackCdMax = Math.max(1, p.attackCdMax - 1)),
  },
  {
    id: 'dash',
    name: 'ダッシュ強化',
    desc: 'ダッシュのクールダウン-3（下限5）、距離+1（上限5）',
    eligible: (p) => p.dashCdMax > 5 || p.dashRange < 5,
    apply: (p) => {
      p.dashCdMax = Math.max(5, p.dashCdMax - 3);
      p.dashRange = Math.min(5, p.dashRange + 1);
    },
  },
  {
    id: 'skillunlock',
    name: '旋風斬り習得',
    desc: '周囲8方向の敵にダメージを与えるスキルを習得する',
    eligible: (p) => !p.hasSkill,
    apply: (p) => (p.hasSkill = true),
  },
  {
    id: 'skillpower',
    name: '旋風斬り強化',
    desc: 'スキルダメージ+10、クールダウン-3（下限10）',
    eligible: (p) => p.hasSkill,
    apply: (p) => {
      p.skillDmg += 10;
      p.skillCdMax = Math.max(10, p.skillCdMax - 3);
    },
  },
  {
    id: 'lifesteal',
    name: '吸血強化',
    desc: '与ダメージの一部を回復に変換+8%（上限40%）',
    eligible: (p) => p.lifesteal < 0.4,
    apply: (p) => (p.lifesteal = Math.min(0.4, p.lifesteal + 0.08)),
  },
  {
    id: 'thorns',
    name: '反撃強化',
    desc: '被弾時に攻撃者へダメージ反射+10%（上限50%）',
    eligible: (p) => p.thorns < 0.5,
    apply: (p) => (p.thorns = Math.min(0.5, p.thorns + 0.1)),
  },
  {
    id: 'regen',
    name: '再生強化',
    desc: '一定間隔ごとの自動回復量+1',
    eligible: (p) => p.regen < 5,
    apply: (p) => (p.regen += 1),
  },
];

export class Game {
  readonly seed: number;
  private rng: Rng;
  private tiles: number[];
  private tick = 0;
  private wave = 1;
  private phase: 'combat' | 'upgrade' | 'gameover' = 'combat';
  private spawnedCount = 0;
  private totalToSpawn = waveTotalSpawn(1);
  private spawnTimer = waveSpawnInterval(1);
  private enemies: Enemy[] = [];
  private nextEnemyId = 1;
  private upgradeOptions: UpgradeOption[] = [];
  private upgradeDefsShown: UpgradeDef[] = [];
  private player: PlayerState = {
    x: PLAYER_START.x,
    y: PLAYER_START.y,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    facing: 'down',
    atk: PLAYER_ATK,
    attackCd: 0,
    attackCdMax: ATTACK_CD_MAX,
    dashCd: 0,
    dashCdMax: DASH_CD_MAX,
    dashRange: DASH_RANGE,
    hasSkill: false,
    skillCd: 0,
    skillCdMax: SKILL_CD_MAX,
    skillDmg: SKILL_DMG,
    lifesteal: 0,
    thorns: 0,
    regen: 0,
    dashInvuln: false,
    moveEvasion: 0,
  };
  private metrics: Metrics = {
    wavesCleared: 0,
    kills: 0,
    damageDealt: 0,
    damageTaken: 0,
    upgradesChosen: 0,
    skillUses: 0,
    score: 0,
  };
  private _over = false;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.tiles = this.generateWorld();
  }

  get over(): boolean {
    return this._over;
  }

  // ---- ワールド生成: 岩クラスタをいくつか撒くだけの静的アリーナ ----
  private generateWorld(): number[] {
    const tiles = new Array<number>(W * H).fill(TILE.FLOOR);
    for (let cluster = 0; cluster < 8; cluster++) {
      let x = randInt(this.rng, W);
      let y = randInt(this.rng, H);
      const size = 2 + randInt(this.rng, 3);
      for (let s = 0; s < size; s++) {
        if (x >= 0 && x < W && y >= 0 && y < H) tiles[y * W + x] = TILE.ROCK;
        x = Math.min(W - 1, Math.max(0, x + randInt(this.rng, 3) - 1));
        y = Math.min(H - 1, Math.max(0, y + randInt(this.rng, 3) - 1));
      }
    }
    // 開始地点周囲は必ず開けておく
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = PLAYER_START.x + dx;
        const y = PLAYER_START.y + dy;
        if (x >= 0 && x < W && y >= 0 && y < H) tiles[y * W + x] = TILE.FLOOR;
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
    return this.enemies.find((e) => e.x === x && e.y === y);
  }
  private isFloor(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tileAt(x, y) !== TILE.ROCK;
  }

  // ---- メインループ: 1ティック進める ----
  step(action: Action = { type: 'wait' }): void {
    if (this._over) return;
    this.tick++;

    if (this.phase === 'upgrade') {
      this.applyUpgradeChoice(action);
      this.metrics.score = this.metrics.wavesCleared * 150 + this.metrics.kills * 10;
      return;
    }

    // ---- combat フェーズ ----
    this.player.dashInvuln = false;
    if (this.player.attackCd > 0) this.player.attackCd--;
    if (this.player.dashCd > 0) this.player.dashCd--;
    if (this.player.skillCd > 0) this.player.skillCd--;
    if (this.player.moveEvasion > 0) this.player.moveEvasion--;

    this.applyPlayerAction(action);

    // 自動回復
    if (this.player.regen > 0 && this.tick % REGEN_INTERVAL === 0 && this.player.hp < this.player.maxHp) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.regen);
    }

    // スポーン
    if (this.spawnTimer > 0) this.spawnTimer--;
    if (
      this.spawnTimer <= 0 &&
      this.spawnedCount < this.totalToSpawn &&
      this.enemies.length < waveConcurrentCap(this.wave)
    ) {
      if (this.trySpawnEnemy()) this.spawnedCount++;
      this.spawnTimer = waveSpawnInterval(this.wave);
    }

    this.updateEnemies();
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this._over = true;
      this.phase = 'gameover';
    } else if (this.spawnedCount >= this.totalToSpawn && this.enemies.length === 0) {
      this.metrics.wavesCleared++;
      this.beginUpgradePhase();
    }

    this.metrics.score = this.metrics.wavesCleared * 150 + this.metrics.kills * 10;
  }

  private damageEnemy(e: Enemy, dmg: number): void {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    this.metrics.damageDealt += dmg;
    if (e.hp <= 0) this.metrics.kills++;
  }

  private applyPlayerAction(action: Action): void {
    const p = this.player;
    switch (action.type) {
      case 'move': {
        p.facing = action.dir;
        const [dx, dy] = DELTA4[action.dir];
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (this.isFloor(nx, ny) && !this.enemyAt(nx, ny)) {
          p.x = nx;
          p.y = ny;
          p.moveEvasion = MOVE_EVASION_TICKS;
        }
        break;
      }
      case 'attack': {
        p.facing = action.dir;
        if (p.attackCd > 0) break;
        const [dx, dy] = DELTA4[action.dir];
        const target = this.enemyAt(p.x + dx, p.y + dy);
        if (target) {
          this.damageEnemy(target, p.atk);
          if (p.lifesteal > 0) p.hp = Math.min(p.maxHp, p.hp + p.atk * p.lifesteal);
        }
        p.attackCd = p.attackCdMax;
        break;
      }
      case 'dash': {
        p.facing = action.dir;
        if (p.dashCd > 0) break;
        const [dx, dy] = DELTA4[action.dir];
        for (let i = 1; i <= p.dashRange; i++) {
          const nx = p.x + dx * i;
          const ny = p.y + dy * i;
          if (!this.isFloor(nx, ny) || this.enemyAt(nx, ny)) break;
          p.x = nx;
          p.y = ny;
        }
        p.dashCd = p.dashCdMax;
        p.dashInvuln = true;
        break;
      }
      case 'skill': {
        if (!p.hasSkill || p.skillCd > 0) break;
        this.metrics.skillUses++;
        for (const [dx, dy] of DELTA8) {
          const target = this.enemyAt(p.x + dx, p.y + dy);
          if (target) {
            this.damageEnemy(target, p.skillDmg);
            if (p.lifesteal > 0) p.hp = Math.min(p.maxHp, p.hp + p.skillDmg * p.lifesteal);
          }
        }
        p.skillCd = p.skillCdMax;
        break;
      }
      case 'choose':
      case 'wait':
        break;
    }
  }

  // ---- スポーン ----
  private trySpawnEnemy(): boolean {
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = this.rng() * Math.PI * 2;
      const radius = SPAWN_RADIUS_MIN + randInt(this.rng, SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN + 1);
      const x = Math.round(this.player.x + Math.cos(angle) * radius);
      const y = Math.round(this.player.y + Math.sin(angle) * radius);
      if (!this.isFloor(x, y) || this.enemyAt(x, y) || (x === this.player.x && y === this.player.y)) continue;
      const type = pickEnemyType(this.wave, this.rng);
      const stats = ENEMY_STATS[type];
      const mult = waveEnemyMultiplier(this.wave);
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
      return true;
    }
    return false;
  }

  // ---- 敵AI ----
  /**
   * 全敵の行動をまとめて処理する。各敵が個別にプレイヤー座標へBFSすると、
   * 同じ経路に複数体が収束して先着の後ろに一列で渋滞し、実質1体ずつしか
   * 同時接敵できなくなる（v2レビューで発覚した「棒立ちが最適」現象の原因）。
   * それを避けるため、プレイヤーに隣接する空き4マス（囲みスロット）を
   * 事前に割り当ててから各敵をそのスロットへ向かわせ、複数方向から
   * 同時に回り込ませる。
   */
  private updateEnemies(): void {
    const p = this.player;
    const slots: [number, number][] = [];
    for (const d of ['up', 'down', 'left', 'right'] as Dir[]) {
      const [dx, dy] = DELTA4[d];
      const sx = p.x + dx;
      const sy = p.y + dy;
      if (this.isFloor(sx, sy)) slots.push([sx, sy]);
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
        if (!p.dashInvuln) {
          const dmg = p.moveEvasion > 0 ? Math.round(e.atk * (1 - MOVE_EVASION_REDUCTION)) : e.atk;
          p.hp -= dmg;
          this.metrics.damageTaken += dmg;
          if (p.thorns > 0) this.damageEnemy(e, Math.round(e.atk * p.thorns));
        }
        e.atkCd = stats.atkCdMax;
      }
      return;
    }

    if (e.moveCd > 0) return;

    const [tx, ty] = moveTarget ?? [p.x, p.y];
    const dir = this.bfsStepToward(e.x, e.y, tx, ty);
    if (dir) {
      const [mx, my] = DELTA4[dir];
      const nx = e.x + mx;
      const ny = e.y + my;
      if (this.isFloor(nx, ny) && !this.enemyAt(nx, ny) && !(nx === p.x && ny === p.y)) {
        e.x = nx;
        e.y = ny;
        e.moveCd = stats.moveCdMax;
      }
    }
  }

  /**
   * BFSで最短経路の最初の一手を返す（岩だけを障害物として扱う）。
   * 貪欲な2方向移動だと岩の凹みで永久に循環し、敵がプレイヤーへ辿り着けなくなる
   * ケースがあったため経路探索に置き換えている。
   */
  private bfsStepToward(sx: number, sy: number, tx: number, ty: number): Dir | null {
    if (sx === tx && sy === ty) return null;
    const dirs: Dir[] = ['up', 'down', 'left', 'right'];
    const visited = new Uint8Array(W * H);
    visited[sy * W + sx] = 1;
    const queue: { x: number; y: number; root: Dir }[] = [];
    let head = 0;
    for (const d of dirs) {
      const [dx, dy] = DELTA4[d];
      const nx = sx + dx;
      const ny = sy + dy;
      if (!this.inBounds(nx, ny) || this.tileAt(nx, ny) === TILE.ROCK) continue;
      if (nx === tx && ny === ty) return d;
      visited[ny * W + nx] = 1;
      queue.push({ x: nx, y: ny, root: d });
    }
    while (head < queue.length) {
      const cur = queue[head++];
      for (const d of dirs) {
        const [dx, dy] = DELTA4[d];
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (!this.inBounds(nx, ny) || visited[ny * W + nx]) continue;
        if (this.tileAt(nx, ny) === TILE.ROCK) continue;
        if (nx === tx && ny === ty) return cur.root;
        visited[ny * W + nx] = 1;
        queue.push({ x: nx, y: ny, root: cur.root });
      }
    }
    return null;
  }

  // ---- 強化ドラフト ----
  private beginUpgradePhase(): void {
    const eligible = UPGRADE_POOL.filter((u) => u.eligible(this.player));
    const pool = [...eligible];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randInt(this.rng, i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.upgradeDefsShown = pool.slice(0, 3);
    this.upgradeOptions = this.upgradeDefsShown.map((u) => ({ id: u.id, name: u.name, desc: u.desc }));
    this.phase = 'upgrade';
  }

  private applyUpgradeChoice(action: Action): void {
    if (action.type !== 'choose') return;
    const def = this.upgradeDefsShown[action.index];
    if (!def) return;
    def.apply(this.player);
    this.metrics.upgradesChosen++;
    this.wave++;
    this.totalToSpawn = waveTotalSpawn(this.wave);
    this.spawnedCount = 0;
    this.spawnTimer = waveSpawnInterval(this.wave);
    this.upgradeOptions = [];
    this.upgradeDefsShown = [];
    this.phase = 'combat';
  }

  // ---- 状態のスナップショット（JSONシリアライズ可能） ----
  getState(): GameState {
    return {
      tick: this.tick,
      wave: this.wave,
      phase: this.phase,
      over: this._over,
      player: {
        x: this.player.x,
        y: this.player.y,
        hp: this.player.hp,
        maxHp: this.player.maxHp,
        facing: this.player.facing,
        atk: this.player.atk,
        attackCd: this.player.attackCd,
        attackCdMax: this.player.attackCdMax,
        dashCd: this.player.dashCd,
        dashCdMax: this.player.dashCdMax,
        dashRange: this.player.dashRange,
        hasSkill: this.player.hasSkill,
        skillCd: this.player.skillCd,
        skillCdMax: this.player.skillCdMax,
        skillDmg: this.player.skillDmg,
        lifesteal: this.player.lifesteal,
        thorns: this.player.thorns,
        regen: this.player.regen,
        moveEvasion: this.player.moveEvasion,
      },
      map: { w: W, h: H, tiles: [...this.tiles] },
      enemies: this.enemies.map((e) => ({ ...e })),
      upgradeOptions: [...this.upgradeOptions],
      metrics: { ...this.metrics },
    };
  }
}
