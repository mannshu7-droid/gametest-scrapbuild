/**
 * ヘッドレスシミュレーション: 3種類のショップ優先度を持つボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * 移動・戦闘・帰還判断のロジックは3戦略とも共通（隣接する敵は迎撃、危険なら帰還、それ以外は掘り進む）。
 * 異なるのはショップでの購入優先度のみ:
 * - mining-first: 採掘系（drill/capacity/fuel）を先に強化
 * - combat-first: 戦闘系（atk/hp/skill/atkspeed）を先に強化
 * - balanced: 採掘と戦闘を交互に強化
 * この3つを比較し、「片方だけに投資すると押し戻される」という仮説（意思決定の悩ましさ）を検証する。
 */
import { Game, W, H, bandAt, requiredDrillPower } from '../src/core/game';
import { TILE, type Action, type Dir, type GameState, type TileId, type UpgradeId } from '../src/core/types';

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

function tileAt(s: GameState, x: number, y: number): number | null {
  if (x < 0 || x >= s.map.w || y < 0 || y >= s.map.h) return null;
  return s.map.tiles[y * s.map.w + x];
}

function enemyAt(s: GameState, x: number, y: number) {
  return s.enemies.find((e) => e.x === x && e.y === y);
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

function adjacentEnemyDir(s: GameState): Dir | null {
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    if (enemyAt(s, s.player.x + dx, s.player.y + dy)) return d;
  }
  return null;
}

function adjacentEnemyCount(s: GameState): number {
  let n = 0;
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    if (enemyAt(s, s.player.x + dx, s.player.y + dy)) n++;
  }
  return n;
}

type Strategy = 'mining-first' | 'combat-first' | 'balanced';

const MINING_FIRST: UpgradeId[] = ['drill', 'capacity', 'fuel', 'atk', 'hp', 'skill', 'atkspeed', 'muffler'];
const COMBAT_FIRST: UpgradeId[] = ['atk', 'hp', 'skill', 'atkspeed', 'drill', 'fuel', 'capacity', 'muffler'];
const BALANCED: UpgradeId[] = ['drill', 'atk', 'hp', 'capacity', 'skill', 'fuel', 'atkspeed', 'muffler'];

function priorityFor(strategy: Strategy): UpgradeId[] {
  if (strategy === 'mining-first') return MINING_FIRST;
  if (strategy === 'combat-first') return COMBAT_FIRST;
  return BALANCED;
}

class Bot {
  constructor(private strategy: Strategy) {}

  decide(s: GameState): Action {
    if (s.phase === 'shop') {
      for (const id of priorityFor(this.strategy)) {
        const item = s.shop.find((it) => it.id === id);
        if (item && item.nextCost !== null && s.player.money >= item.nextCost) {
          return { type: 'buy', item: id };
        }
      }
      return { type: 'move', dir: 'down' };
    }

    const p = s.player;

    // 危機的なHPなら迎撃より離脱を優先
    const critical = p.hp <= p.maxHp * 0.2;
    const adjCount = adjacentEnemyCount(s);
    if (!critical && adjCount >= 2 && p.hasSkill && p.skillCd === 0) return { type: 'skill' };
    const adjDir = adjacentEnemyDir(s);
    if (!critical && adjDir) return { type: 'attack', dir: adjDir };

    // 帰還判断: 燃料切れ・満載・低HP・estFuelToReturn残不足のいずれか
    const returnMargin = 15;
    const needsReturn =
      p.fuel <= 0 ||
      p.cargoUnits >= p.maxCapacity ||
      p.hp <= p.maxHp * 0.25 ||
      (p.estFuelToReturn !== null && p.fuel <= p.estFuelToReturn + returnMargin);
    if (needsReturn) {
      const dir = bfsToSurface(s);
      if (dir) return { type: 'move', dir };
      if (adjDir) return { type: 'attack', dir: adjDir }; // 退路なしなら戦うしかない
    }

    for (const dir of ['down', 'right', 'left', 'up'] as Dir[]) {
      const [dx, dy] = DELTA[dir];
      const nx = p.x + dx;
      const ny = p.y + dy;
      const t = tileAt(s, nx, ny);
      if (t === TILE.FLOOR && !enemyAt(s, nx, ny)) return { type: 'move', dir };
      if (canDig(s, nx, ny)) return { type: 'move', dir };
    }

    const dir = bfsToSurface(s);
    if (dir) return { type: 'move', dir };
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
  kills: number;
  damageDealt: number;
  damageTaken: number;
  upgradesBought: number;
  tripsToSurface: number;
  milestonesReached: number;
  skillUses: number;
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
    kills: s.metrics.kills,
    damageDealt: s.metrics.damageDealt,
    damageTaken: s.metrics.damageTaken,
    upgradesBought: s.metrics.upgradesBought,
    tripsToSurface: s.metrics.tripsToSurface,
    milestonesReached: s.metrics.milestonesReached,
    skillUses: s.metrics.skillUses,
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

console.log(`# IronVein headless simulation  (shaft ${W}x${H}, maxTicks=${maxTicks})`);
for (const strategy of ['mining-first', 'combat-first', 'balanced'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDepth=${avg((r) => r.maxDepth)} avgKills=${avg((r) => r.kills)} avgOreMined=${avg((r) => r.oreMined)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgTrips=${avg((r) => r.tripsToSurface)} avgMilestones=${avg((r) => r.milestonesReached)} deaths=${results.filter((r) => r.over).length}/${results.length}`,
  );
}
