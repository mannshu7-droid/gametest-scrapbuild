import { mulberry32, randInt, type Rng } from './rng';
import { TILE, type Action, type Dir, type GameState, type Metrics, type Zombie } from './types';

// ---- バランス定数（specs/001-mineforge/spec.md の表と一致させる） ----
export const W = 48;
export const H = 48;
export const DAY_TICKS = 600;
export const NIGHT_START = 420;

const PLAYER_MAX_HP = 100;
const PLAYER_ATK = 10;
const SWORD_ATK = 25;
const REGEN_INTERVAL = 50;

const MINE_HP: Partial<Record<number, number>> = {
  [TILE.TREE]: 3,
  [TILE.ROCK]: 4,
  [TILE.IRON]: 6,
};
const MINE_YIELD: Partial<Record<number, { wood?: number; stone?: number; iron?: number }>> = {
  [TILE.TREE]: { wood: 3 },
  [TILE.ROCK]: { stone: 2 },
  [TILE.IRON]: { iron: 1 },
};

const WALL_HP = 50;
const WALL_COST_STONE = 2;
const SWORD_COST = { iron: 3, wood: 2 };

const ZOMBIE_HP = 30;
const ZOMBIE_ATK = 5;
const ZOMBIE_ATK_CD = 10;
const ZOMBIE_MOVE_CD = 5;
const ZOMBIE_SPAWN_INTERVAL = 40;
const zombieCap = (day: number) => 2 + day * 2;

const DELTA: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export class Game {
  readonly seed: number;
  private rng: Rng;
  private tiles: number[];
  /** 削れたタイル/壁の残りHP（index → 残りHP） */
  private tileHp = new Map<number, number>();
  private tick = 0;
  private zombies: Zombie[] = [];
  private nextZombieId = 1;
  private player = {
    x: Math.floor(W / 2),
    y: Math.floor(H / 2),
    hp: PLAYER_MAX_HP,
    facing: 'down' as Dir,
    hasSword: false,
    inventory: { wood: 0, stone: 0, iron: 0 },
  };
  private metrics: Metrics = { kills: 0, mined: 0, placed: 0, damageTaken: 0, daysSurvived: 0, score: 0 };
  private _over = false;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.tiles = this.generateWorld();
  }

  // ---- ワールド生成 ----
  private generateWorld(): number[] {
    const tiles = new Array<number>(W * H).fill(TILE.GRASS);
    for (let i = 0; i < W * H; i++) {
      const r = this.rng();
      if (r < 0.1) tiles[i] = TILE.TREE;
      else if (r < 0.17) tiles[i] = TILE.ROCK;
      else if (r < 0.2) tiles[i] = TILE.IRON;
    }
    // 水たまり: ランダムウォークで数本
    for (let lake = 0; lake < 4; lake++) {
      let x = randInt(this.rng, W);
      let y = randInt(this.rng, H);
      for (let s = 0; s < 40; s++) {
        tiles[y * W + x] = TILE.WATER;
        x = Math.min(W - 1, Math.max(0, x + randInt(this.rng, 3) - 1));
        y = Math.min(H - 1, Math.max(0, y + randInt(this.rng, 3) - 1));
      }
    }
    // 初期地点の周囲は開けておく（詰み防止）
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        tiles[(cy + dy) * W + (cx + dx)] = TILE.GRASS;
      }
    }
    return tiles;
  }

  // ---- 参照ヘルパー ----
  get over(): boolean {
    return this._over;
  }
  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < W && y >= 0 && y < H;
  }
  tileAt(x: number, y: number): number {
    return this.tiles[y * W + x];
  }
  private passable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tileAt(x, y) === TILE.GRASS;
  }
  private zombieAt(x: number, y: number): Zombie | undefined {
    return this.zombies.find((z) => z.x === x && z.y === y);
  }
  private get day(): number {
    return Math.floor(this.tick / DAY_TICKS) + 1;
  }
  private get isNight(): boolean {
    return this.tick % DAY_TICKS >= NIGHT_START;
  }

  // ---- メインループ: 1ティック進める ----
  step(action: Action = { type: 'wait' }): void {
    if (this._over) return;

    const prevDay = this.day;
    this.tick++;

    // 日付が変わったら: 生存日数+1、ゾンビ退散
    if (this.day !== prevDay) {
      this.metrics.daysSurvived = this.day - 1;
      this.zombies = [];
    }

    this.applyPlayerAction(action);

    // 昼の自然回復
    if (!this.isNight && this.tick % REGEN_INTERVAL === 0 && this.player.hp < PLAYER_MAX_HP) {
      this.player.hp++;
    }

    // 夜のスポーン
    if (this.isNight && this.tick % ZOMBIE_SPAWN_INTERVAL === 0 && this.zombies.length < zombieCap(this.day)) {
      this.spawnZombie();
    }

    for (const z of this.zombies) this.updateZombie(z);
    this.zombies = this.zombies.filter((z) => z.hp > 0);

    if (this.player.hp <= 0) {
      this.player.hp = 0;
      this._over = true;
    }
    this.metrics.score = this.metrics.daysSurvived * 100 + this.metrics.kills * 10 + this.metrics.mined;
  }

  // ---- プレイヤーアクション ----
  private applyPlayerAction(action: Action): void {
    switch (action.type) {
      case 'move': {
        this.player.facing = action.dir;
        const [dx, dy] = DELTA[action.dir];
        const nx = this.player.x + dx;
        const ny = this.player.y + dy;
        if (this.passable(nx, ny) && !this.zombieAt(nx, ny)) {
          this.player.x = nx;
          this.player.y = ny;
        }
        break;
      }
      case 'mine': {
        this.player.facing = action.dir;
        const [dx, dy] = DELTA[action.dir];
        const x = this.player.x + dx;
        const y = this.player.y + dy;
        if (!this.inBounds(x, y)) break;
        const idx = y * W + x;
        const t = this.tiles[idx];
        if (t === TILE.WALL) {
          // 自分の壁の回収: 1叩き10ダメージ、壊すと stone 1 返却
          const hp = (this.tileHp.get(idx) ?? WALL_HP) - 10;
          if (hp <= 0) {
            this.tiles[idx] = TILE.GRASS;
            this.tileHp.delete(idx);
            this.player.inventory.stone += 1;
          } else {
            this.tileHp.set(idx, hp);
          }
        } else if (MINE_HP[t] !== undefined) {
          const hp = (this.tileHp.get(idx) ?? MINE_HP[t]!) - 1;
          if (hp <= 0) {
            this.tiles[idx] = TILE.GRASS;
            this.tileHp.delete(idx);
            const y2 = MINE_YIELD[t]!;
            this.player.inventory.wood += y2.wood ?? 0;
            this.player.inventory.stone += y2.stone ?? 0;
            this.player.inventory.iron += y2.iron ?? 0;
            this.metrics.mined++;
          } else {
            this.tileHp.set(idx, hp);
          }
        }
        break;
      }
      case 'attack': {
        this.player.facing = action.dir;
        const [dx, dy] = DELTA[action.dir];
        const z = this.zombieAt(this.player.x + dx, this.player.y + dy);
        if (z) {
          z.hp -= this.player.hasSword ? SWORD_ATK : PLAYER_ATK;
          if (z.hp <= 0) this.metrics.kills++;
        }
        break;
      }
      case 'place': {
        this.player.facing = action.dir;
        const [dx, dy] = DELTA[action.dir];
        const x = this.player.x + dx;
        const y = this.player.y + dy;
        if (
          this.passable(x, y) &&
          !this.zombieAt(x, y) &&
          this.player.inventory.stone >= WALL_COST_STONE
        ) {
          this.player.inventory.stone -= WALL_COST_STONE;
          this.tiles[y * W + x] = TILE.WALL;
          this.tileHp.set(y * W + x, WALL_HP);
          this.metrics.placed++;
        }
        break;
      }
      case 'craft': {
        if (
          action.item === 'sword' &&
          !this.player.hasSword &&
          this.player.inventory.iron >= SWORD_COST.iron &&
          this.player.inventory.wood >= SWORD_COST.wood
        ) {
          this.player.inventory.iron -= SWORD_COST.iron;
          this.player.inventory.wood -= SWORD_COST.wood;
          this.player.hasSword = true;
        }
        break;
      }
      case 'wait':
        break;
    }
  }

  // ---- ゾンビ ----
  private spawnZombie(): void {
    // マップ端のランダムな位置。塞がっていたら草にして湧く（地面から這い出るイメージ）
    const side = randInt(this.rng, 4);
    let x: number, y: number;
    if (side === 0) [x, y] = [randInt(this.rng, W), 0];
    else if (side === 1) [x, y] = [randInt(this.rng, W), H - 1];
    else if (side === 2) [x, y] = [0, randInt(this.rng, H)];
    else [x, y] = [W - 1, randInt(this.rng, H)];
    if (this.zombieAt(x, y) || (x === this.player.x && y === this.player.y)) return;
    this.tiles[y * W + x] = TILE.GRASS;
    this.tileHp.delete(y * W + x);
    this.zombies.push({ id: this.nextZombieId++, x, y, hp: ZOMBIE_HP, atkCd: 0, moveCd: 0 });
  }

  private updateZombie(z: Zombie): void {
    if (z.hp <= 0) return;
    if (z.atkCd > 0) z.atkCd--;
    if (z.moveCd > 0) z.moveCd--;

    const dx = this.player.x - z.x;
    const dy = this.player.y - z.y;

    // 隣接していたらプレイヤーを攻撃
    if (Math.abs(dx) + Math.abs(dy) === 1) {
      if (z.atkCd === 0) {
        this.player.hp -= ZOMBIE_ATK;
        this.metrics.damageTaken += ZOMBIE_ATK;
        z.atkCd = ZOMBIE_ATK_CD;
      }
      return;
    }

    if (z.moveCd > 0) return;

    // プレイヤーへ貪欲接近（遠い軸を優先）。塞がれていたら障害物を殴る
    const dirs: Dir[] = [];
    const xDir: Dir = dx > 0 ? 'right' : 'left';
    const yDir: Dir = dy > 0 ? 'down' : 'up';
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx !== 0) dirs.push(xDir);
      if (dy !== 0) dirs.push(yDir);
    } else {
      if (dy !== 0) dirs.push(yDir);
      if (dx !== 0) dirs.push(xDir);
    }

    for (const dir of dirs) {
      const [mx, my] = DELTA[dir];
      const nx = z.x + mx;
      const ny = z.y + my;
      if (!this.inBounds(nx, ny)) continue;
      const t = this.tileAt(nx, ny);
      if (t === TILE.GRASS && !this.zombieAt(nx, ny) && !(nx === this.player.x && ny === this.player.y)) {
        z.x = nx;
        z.y = ny;
        z.moveCd = ZOMBIE_MOVE_CD;
        return;
      }
      // 壁・木・岩・鉄が邪魔なら殴って壊す（水は迂回）
      // タイルHPは採掘と同じスケールを使う（壁のみ50HP、ゾンビは壁に5、自然物に1ダメージ）
      if ((t === TILE.WALL || t === TILE.TREE || t === TILE.ROCK || t === TILE.IRON) && z.atkCd === 0) {
        const idx = ny * W + nx;
        const maxHp = t === TILE.WALL ? WALL_HP : MINE_HP[t] ?? 1;
        const dmg = t === TILE.WALL ? ZOMBIE_ATK : 1;
        const hp = (this.tileHp.get(idx) ?? maxHp) - dmg;
        if (hp <= 0) {
          this.tiles[idx] = TILE.GRASS;
          this.tileHp.delete(idx);
        } else {
          this.tileHp.set(idx, hp);
        }
        z.atkCd = ZOMBIE_ATK_CD;
        return;
      }
    }
  }

  // ---- 状態のスナップショット（JSONシリアライズ可能） ----
  getState(): GameState {
    const tileHp: Record<number, number> = {};
    for (const [k, v] of this.tileHp) tileHp[k] = v;
    return {
      tick: this.tick,
      day: this.day,
      isNight: this.isNight,
      tickOfDay: this.tick % DAY_TICKS,
      over: this._over,
      player: {
        x: this.player.x,
        y: this.player.y,
        hp: this.player.hp,
        facing: this.player.facing,
        hasSword: this.player.hasSword,
        inventory: { ...this.player.inventory },
      },
      map: { w: W, h: H, tiles: [...this.tiles], tileHp },
      zombies: this.zombies.map((z) => ({ id: z.id, x: z.x, y: z.y, hp: z.hp })),
      metrics: { ...this.metrics },
    };
  }
}
