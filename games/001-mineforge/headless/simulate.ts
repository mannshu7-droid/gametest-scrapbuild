/**
 * ヘッドレスシミュレーション: 戦略ボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --days 7]
 *
 * ボット戦略（素朴なベースライン）:
 * - 昼: 足りない資源（石→鉄→木の優先度）に最も近い資源タイルへ向かい採掘。剣が作れたら作る
 * - 夕方（夜の80ティック前）: 拠点（初期地点）へ戻り、周囲に壁を設置
 * - 夜: 隣接ゾンビがいれば攻撃、いなければ待機（壁の内側で籠城）
 */
import { Game, W, H, DAY_TICKS, NIGHT_START } from '../src/core/game';
import { TILE, type Action, type Dir, type GameState } from '../src/core/types';

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

function dirTo(dx: number, dy: number): Dir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

class Bot {
  private home: { x: number; y: number };
  constructor(s: GameState) {
    this.home = { x: s.player.x, y: s.player.y };
  }

  decide(s: GameState): Action {
    const p = s.player;

    // 隣接ゾンビは昼夜問わず最優先で反撃
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      if (s.zombies.some((z) => z.x === p.x + dx && z.y === p.y + dy)) return { type: 'attack', dir: d };
    }

    // 剣が作れるなら作る
    if (!p.hasSword && p.inventory.iron >= 3 && p.inventory.wood >= 2) return { type: 'craft', item: 'sword' };

    const duskSoon = s.tickOfDay >= NIGHT_START - 80;

    if (s.isNight || duskSoon) {
      // 拠点に戻る
      const hx = this.home.x - p.x;
      const hy = this.home.y - p.y;
      if (Math.abs(hx) + Math.abs(hy) > 0) return this.moveToward(s, this.home.x, this.home.y);
      // 拠点周囲4マスに壁を張る
      for (const d of DIRS) {
        const [dx, dy] = DELTA[d];
        const t = this.tileAt(s, p.x + dx, p.y + dy);
        if (t === TILE.GRASS && p.inventory.stone >= 2) return { type: 'place', dir: d };
      }
      return { type: 'wait' };
    }

    // 昼: 採掘対象を選ぶ（壁用の石を最優先、次に剣用の鉄、木）
    const want: number[] = [];
    if (p.inventory.stone < 8) want.push(TILE.ROCK);
    if (!p.hasSword && p.inventory.iron < 3) want.push(TILE.IRON);
    if (!p.hasSword && p.inventory.wood < 2) want.push(TILE.TREE);
    if (want.length === 0) want.push(TILE.ROCK); // 余剰は石を貯める

    // 隣接に対象があれば掘る
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const t = this.tileAt(s, p.x + dx, p.y + dy);
      if (t !== null && want.includes(t)) return { type: 'mine', dir: d };
    }

    // 最も近い対象タイルへ向かう
    const target = this.nearest(s, want);
    if (target) return this.moveToward(s, target.x, target.y);
    return { type: 'wait' };
  }

  private tileAt(s: GameState, x: number, y: number): number | null {
    if (x < 0 || x >= s.map.w || y < 0 || y >= s.map.h) return null;
    return s.map.tiles[y * s.map.w + x];
  }

  private nearest(s: GameState, types: number[]): { x: number; y: number } | null {
    const p = s.player;
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (let y = 0; y < s.map.h; y++) {
      for (let x = 0; x < s.map.w; x++) {
        if (!types.includes(s.map.tiles[y * s.map.w + x])) continue;
        const d = Math.abs(x - p.x) + Math.abs(y - p.y);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /** 貪欲移動。塞がっていたらもう片方の軸、それも駄目なら障害物を採掘 */
  private moveToward(s: GameState, tx: number, ty: number): Action {
    const p = s.player;
    const dx = tx - p.x;
    const dy = ty - p.y;
    const candidates: Dir[] = [];
    const primary = dirTo(dx, dy);
    candidates.push(primary);
    if (dx !== 0 && dy !== 0) candidates.push(dirTo(dx, dy) === (dx >= 0 ? 'right' : 'left') ? (dy >= 0 ? 'down' : 'up') : dx >= 0 ? 'right' : 'left');
    for (const d of candidates) {
      const [mx, my] = DELTA[d];
      if (this.tileAt(s, p.x + mx, p.y + my) === TILE.GRASS) return { type: 'move', dir: d };
    }
    // 進路が資源で塞がっていたら掘って進む
    for (const d of candidates) {
      const [mx, my] = DELTA[d];
      const t = this.tileAt(s, p.x + mx, p.y + my);
      if (t === TILE.TREE || t === TILE.ROCK || t === TILE.IRON) return { type: 'mine', dir: d };
    }
    // 水などで完全に詰まったら適当な方向へ
    for (const d of DIRS) {
      const [mx, my] = DELTA[d];
      if (this.tileAt(s, p.x + mx, p.y + my) === TILE.GRASS) return { type: 'move', dir: d };
    }
    return { type: 'wait' };
  }
}

interface RunResult {
  seed: number;
  daysSurvived: number;
  kills: number;
  mined: number;
  placed: number;
  damageTaken: number;
  score: number;
  finalHp: number;
  over: boolean;
  ticks: number;
}

function runOne(seed: number, maxDays: number): RunResult {
  const game = new Game(seed);
  const bot = new Bot(game.getState());
  const maxTicks = maxDays * DAY_TICKS;
  let ticks = 0;
  while (!game.over && ticks < maxTicks) {
    game.step(bot.decide(game.getState()));
    ticks++;
  }
  const s = game.getState();
  return {
    seed,
    daysSurvived: s.metrics.daysSurvived,
    kills: s.metrics.kills,
    mined: s.metrics.mined,
    placed: s.metrics.placed,
    damageTaken: s.metrics.damageTaken,
    score: s.metrics.score,
    finalHp: s.player.hp,
    over: s.over,
    ticks,
  };
}

// ---- CLI ----
const args = process.argv.slice(2);
function argVal(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const seeds = (argVal('seeds') ?? '1,2,3,4,5').split(',').map(Number);
const maxDays = Number(argVal('days') ?? 7);

console.log(`# MineForge headless simulation  (map ${W}x${H}, maxDays=${maxDays})`);
const results: RunResult[] = [];
for (const seed of seeds) {
  const r = runOne(seed, maxDays);
  results.push(r);
  console.log(JSON.stringify(r));
}
const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
console.log(
  `# summary: avgDays=${avg((r) => r.daysSurvived)} avgKills=${avg((r) => r.kills)} avgScore=${avg((r) => r.score)} deaths=${results.filter((r) => r.over).length}/${results.length}`,
);
