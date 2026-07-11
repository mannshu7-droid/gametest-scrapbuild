/**
 * ヘッドレスシミュレーション: 2種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * - shallow: 浅い層（y<40 = バンド0〜1相当）に留まり続け、ドリル威力・テレポートには一切投資しない戦略。
 *   「浅い層で粘るだけでも稼げてしまわないか」の最低ライン検出用（002のpassiveに相当）
 * - diver: 常に深さ更新を最優先し、詰まったらドリル威力強化を優先購入して深部を目指す戦略
 *   （002のactiveに相当）。002final レビューで「この比較手法は他要素にも転用価値が高い」とされた手法を踏襲
 */
import { Game, W, H, bandAt, requiredDrillPower } from '../src/core/game';
import { TILE, type Action, type Dir, type GameState, type TileId, type UpgradeId } from '../src/core/types';

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

function tileAt(s: GameState, x: number, y: number): number | null {
  if (x < 0 || x >= s.map.w || y < 0 || y >= s.map.h) return null;
  return s.map.tiles[y * s.map.w + x];
}

/** 既に掘った床(FLOOR)だけを通って地上(y=0)へ最短で戻る次の一手 */
function bfsToSurface(s: GameState): Dir | null {
  const p = s.player;
  if (p.y === 0) return null;
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
    const t = tileAt(s, nx, ny);
    if (t !== TILE.FLOOR) continue;
    if (ny === 0) return d;
    visited[ny * w + nx] = 1;
    queue.push({ x: nx, y: ny, root: d });
  }
  while (head < queue.length) {
    const cur = queue[head++];
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (visited[ny * w + nx]) continue;
      const t = tileAt(s, nx, ny);
      if (t !== TILE.FLOOR) continue;
      if (ny === 0) return cur.root;
      visited[ny * w + nx] = 1;
      queue.push({ x: nx, y: ny, root: cur.root });
    }
  }
  return null;
}

function canDig(s: GameState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  if (t === null || t === TILE.FLOOR) return false;
  const band = bandAt(y);
  return s.player.drillPower >= requiredDrillPower(t as TileId, band);
}

type Strategy = 'shallow' | 'diver';
const SHALLOW_DEPTH_CAP = 40;

function mineDirs(s: GameState, strategy: Strategy): Dir[] {
  if (strategy === 'diver') return ['down', 'right', 'left', 'up'];
  return s.player.y < SHALLOW_DEPTH_CAP ? ['down', 'right', 'left', 'up'] : ['right', 'left', 'up'];
}

const DIVER_PRIORITY: UpgradeId[] = ['drill', 'fuel', 'capacity', 'hp', 'digspeed', 'hazardresist', 'lantern', 'teleport'];
const SHALLOW_PRIORITY: UpgradeId[] = ['capacity', 'fuel', 'hp', 'digspeed', 'lantern', 'hazardresist'];

class Bot {
  constructor(private strategy: Strategy) {}

  decide(s: GameState): Action {
    if (s.phase === 'shop') {
      const priority = this.strategy === 'diver' ? DIVER_PRIORITY : SHALLOW_PRIORITY;
      for (const id of priority) {
        const item = s.shop.find((it) => it.id === id);
        if (item && item.nextCost !== null && s.player.money >= item.nextCost) {
          return { type: 'buy', item: id };
        }
      }
      return { type: 'move', dir: 'down' };
    }

    const p = s.player;
    if (p.fuel <= 0 || p.cargoUnits >= p.maxCapacity || p.fuel <= p.maxFuel * 0.25) {
      const dir = bfsToSurface(s);
      if (dir) return { type: 'move', dir };
    }

    for (const dir of mineDirs(s, this.strategy)) {
      const [dx, dy] = DELTA[dir];
      const nx = p.x + dx;
      const ny = p.y + dy;
      const t = tileAt(s, nx, ny);
      if (t === TILE.FLOOR) return { type: 'move', dir };
      if (canDig(s, nx, ny)) return { type: 'move', dir };
    }

    // 全方向掘削不可（ドリル威力不足） → diverは強化を買いに戻る、shallowはその場で待つ
    if (this.strategy === 'diver') {
      const dir = bfsToSurface(s);
      if (dir) return { type: 'move', dir };
    }
    return { type: 'wait' };
  }
}

interface RunResult {
  seed: number;
  strategy: Strategy;
  ticks: number;
  over: boolean;
  finalHp: number;
  money: number;
  moneyEarned: number;
  maxDepth: number;
  oreMined: number;
  oreWasted: number;
  tripsToSurface: number;
  upgradesBought: number;
  hazardHits: number;
  hazardDamage: number;
  fuelEmptyTicks: number;
  score: number;
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
    ticks,
    over: s.over,
    finalHp: s.player.hp,
    money: s.player.money,
    moneyEarned: s.metrics.moneyEarned,
    maxDepth: s.metrics.maxDepth,
    oreMined: s.metrics.oreMined,
    oreWasted: s.metrics.oreWasted,
    tripsToSurface: s.metrics.tripsToSurface,
    upgradesBought: s.metrics.upgradesBought,
    hazardHits: s.metrics.hazardHits,
    hazardDamage: s.metrics.hazardDamage,
    fuelEmptyTicks: s.metrics.fuelEmptyTicks,
    score: s.metrics.score,
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

console.log(`# DeepVein headless simulation  (shaft ${W}x${H}, maxTicks=${maxTicks})`);
for (const strategy of ['shallow', 'diver'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDepth=${avg((r) => r.maxDepth)} avgOreMined=${avg((r) => r.oreMined)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgTrips=${avg((r) => r.tripsToSurface)} deaths=${results.filter((r) => r.over).length}/${results.length}`,
  );
}
