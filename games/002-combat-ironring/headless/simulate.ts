/**
 * ヘッドレスシミュレーション: 2種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * - passive: 移動せず、隣接した敵だけ攻撃する「棒立ち」戦略。最低ラインの検出用
 *   （強化選択は常に1枚目を選ぶだけで戦略性を持たせない）
 * - active: 敵を追いかけ、複数隣接時はスキルを使い、優先度順に強化を選ぶ「まともに遊ぶ」戦略
 */
import { Game, W, H } from '../src/core/game';
import type { Action, Dir, Enemy, GameState } from '../src/core/types';

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

function dirTo(dx: number, dy: number): Dir {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

/**
 * BFSで最短経路の最初の一手を返す。単純な貪欲2方向移動だと岩の凹みで
 * 「進む→戻る」の往復ループや、4マスをぐるぐる回る循環ループに嵌ることがあったため、
 * ボットの移動は経路探索で解く（ゲーム本体の詰みではなく、評価ボットの精度の問題）。
 */
function bfsFirstStep(s: GameState, tx: number, ty: number): Dir | null {
  const p = s.player;
  if (p.x === tx && p.y === ty) return null;
  const w = s.map.w;
  const h = s.map.h;
  const visited = new Uint8Array(w * h);
  visited[p.y * w + p.x] = 1;
  const queue: { x: number; y: number; root: Dir }[] = [];
  let head = 0;
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h || tileAt(s, nx, ny) !== 0) continue;
    if (nx === tx && ny === ty) return d;
    visited[ny * w + nx] = 1;
    queue.push({ x: nx, y: ny, root: d });
  }
  while (head < queue.length) {
    const cur = queue[head++];
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (visited[ny * w + nx]) continue;
      if (tileAt(s, nx, ny) !== 0) continue;
      if (nx === tx && ny === ty) return cur.root;
      visited[ny * w + nx] = 1;
      queue.push({ x: nx, y: ny, root: cur.root });
    }
  }
  return null;
}

function adjacentEnemy(s: GameState): { dir: Dir; enemy: Enemy } | null {
  const p = s.player;
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    const e = s.enemies.find((en) => en.x === p.x + dx && en.y === p.y + dy);
    if (e) return { dir: d, enemy: e };
  }
  return null;
}

function countAdjacent8(s: GameState): number {
  const p = s.player;
  let n = 0;
  for (const e of s.enemies) {
    if (Math.abs(e.x - p.x) <= 1 && Math.abs(e.y - p.y) <= 1 && !(e.x === p.x && e.y === p.y)) n++;
  }
  return n;
}

function nearestEnemy(s: GameState): Enemy | null {
  const p = s.player;
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const e of s.enemies) {
    const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function tileAt(s: GameState, x: number, y: number): number | null {
  if (x < 0 || x >= s.map.w || y < 0 || y >= s.map.h) return null;
  return s.map.tiles[y * s.map.w + x];
}

const UPGRADE_PRIORITY = [
  'skillunlock',
  'atkspeed',
  'atk',
  'maxhp',
  'lifesteal',
  'skillpower',
  'thorns',
  'dash',
  'regen',
];

function chooseUpgrade(s: GameState, strategy: Strategy): Action {
  if (strategy === 'passive') return { type: 'choose', index: 0 };
  for (const id of UPGRADE_PRIORITY) {
    const idx = s.upgradeOptions.findIndex((u) => u.id === id);
    if (idx >= 0) return { type: 'choose', index: idx as 0 | 1 | 2 };
  }
  return { type: 'choose', index: 0 };
}

type Strategy = 'passive' | 'active';

class Bot {
  constructor(private strategy: Strategy) {}

  decide(s: GameState): Action {
    if (s.phase === 'upgrade') return chooseUpgrade(s, this.strategy);

    const adj = adjacentEnemy(s);
    const p = s.player;

    if (p.hasSkill && p.skillCd === 0 && countAdjacent8(s) >= 2) return { type: 'skill' };
    if (p.hasSkill && p.skillCd === 0 && countAdjacent8(s) >= 1 && p.hp < p.maxHp * 0.4) return { type: 'skill' };
    if (adj) return { type: 'attack', dir: adj.dir };

    if (this.strategy === 'passive') return { type: 'wait' };

    if (p.hp < p.maxHp * 0.3 && p.dashCd === 0) {
      const ne = nearestEnemy(s);
      if (ne) return { type: 'dash', dir: dirTo(p.x - ne.x, p.y - ne.y) };
    }
    const ne = nearestEnemy(s);
    if (ne) {
      const dir = bfsFirstStep(s, ne.x, ne.y);
      if (dir) return { type: 'move', dir };
    }
    return { type: 'wait' };
  }
}

interface RunResult {
  seed: number;
  strategy: Strategy;
  wavesCleared: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  upgradesChosen: number;
  skillUses: number;
  score: number;
  finalHp: number;
  over: boolean;
  ticks: number;
}

function runOne(seed: number, strategy: Strategy, maxTicks: number): RunResult {
  const game = new Game(seed);
  const bot = new Bot(strategy);
  let ticks = 0;
  while (!game.over && ticks < maxTicks) {
    game.step(bot.decide(game.getState()));
    ticks++;
  }
  const s = game.getState();
  return {
    seed,
    strategy,
    wavesCleared: s.metrics.wavesCleared,
    kills: s.metrics.kills,
    damageDealt: s.metrics.damageDealt,
    damageTaken: s.metrics.damageTaken,
    upgradesChosen: s.metrics.upgradesChosen,
    skillUses: s.metrics.skillUses,
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
const maxTicks = Number(argVal('maxTicks') ?? 20000);

console.log(`# IronRing headless simulation  (arena ${W}x${H}, maxTicks=${maxTicks})`);
for (const strategy of ['passive', 'active'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgWaves=${avg((r) => r.wavesCleared)} avgKills=${avg((r) => r.kills)} avgScore=${avg((r) => r.score)} avgSkillUses=${avg((r) => r.skillUses)} deaths=${results.filter((r) => r.over).length}/${results.length}`,
  );
}
