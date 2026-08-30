/**
 * ヘッドレスシミュレーション: 2種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * 009(戦闘)/010(戦闘×建築)/011(採掘)のcautious/pusher比較手法を、戦闘・採掘・建築を
 * 同時に統合した本命ゲーム試作機012へ拡張した版。
 * - cautious: ホームに近い範囲に留まりがちで、戦闘は自衛（隣接のみ応戦）に徹し、耐久・危険耐性を
 *   優先投資する。「無理に前進・交戦しなくても詰まないか」の最低ライン検出用
 * - pusher: 常に進行距離(x)の更新と敵撃破を優先し、ドリル威力・攻撃力を優先購入してさらに先を
 *   目指す。「掘り進めるほど敵が増える」というコアファン仮説が積極プレイでどう機能するかを見る
 */
import { Game, FIELD_WIDTH, LANE_COUNT, LENGTH, bandAt, requiredDrillPower } from '../src/core/game';
import { TILE, type Action, type Dir, type Enemy, type GameState, type ShopItemId, type TileId } from '../src/core/types';

const DELTA: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const DIRS: Dir[] = ['left', 'right', 'up', 'down'];

function tileAt(s: GameState, x: number, y: number): number | null {
  if (x < 0 || x >= LENGTH || y < 0 || y >= LANE_COUNT) return null;
  return s.map.tiles[x * LANE_COUNT + y];
}

function chebyshev(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function nearestEnemy(s: GameState): { enemy: Enemy; dist: number } | null {
  let best: { enemy: Enemy; dist: number } | null = null;
  for (const e of s.enemies) {
    const d = chebyshev(e.x, e.y, s.player.x, s.player.y);
    if (!best || d < best.dist) best = { enemy: e, dist: d };
  }
  return best;
}

function stepToward(s: GameState, tx: number, ty: number): Dir {
  const dx = tx - s.player.x;
  const dy = ty - s.player.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) return dx > 0 ? 'right' : 'left';
  if (dy !== 0) return dy > 0 ? 'down' : 'up';
  return dx >= 0 ? 'right' : 'left';
}

/** 既に掘った道(FLOOR)だけを通ってホーム(x=0)へ最短で戻る次の一手 */
function bfsToHome(s: GameState): Dir | null {
  const p = s.player;
  if (p.x === 0) return null;
  const visited = new Uint8Array(LENGTH * LANE_COUNT);
  visited[p.x * LANE_COUNT + p.y] = 1;
  const queue: { x: number; y: number; root: Dir }[] = [];
  let head = 0;
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    const nx = p.x + dx;
    const ny = p.y + dy;
    const t = tileAt(s, nx, ny);
    if (t !== TILE.FLOOR) continue;
    if (nx === 0) return d;
    visited[nx * LANE_COUNT + ny] = 1;
    queue.push({ x: nx, y: ny, root: d });
  }
  while (head < queue.length) {
    const cur = queue[head++];
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx >= LENGTH || ny < 0 || ny >= LANE_COUNT) continue;
      if (visited[nx * LANE_COUNT + ny]) continue;
      const t = tileAt(s, nx, ny);
      if (t !== TILE.FLOOR) continue;
      if (nx === 0) return cur.root;
      visited[nx * LANE_COUNT + ny] = 1;
      queue.push({ x: nx, y: ny, root: cur.root });
    }
  }
  return null;
}

function canDig(s: GameState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  if (t === null || t === TILE.FLOOR) return false;
  const band = Math.max(0, bandAt(x));
  return s.player.drillPower >= requiredDrillPower(t as TileId, band);
}
function isHazard(t: number | null): boolean {
  return t === TILE.GAS || t === TILE.UNSTABLE;
}
function inBaseRadius(s: GameState): boolean {
  if (Math.abs(s.player.x - 0) <= s.map.homeRadius) return true;
  for (const ox of s.outposts) if (Math.abs(s.player.x - ox) <= s.map.outpostRadius) return true;
  return false;
}

type Strategy = 'cautious' | 'pusher';
const DRIFT_CAP = 80;

function mineDirs(s: GameState, strategy: Strategy): Dir[] {
  if (strategy === 'pusher') return ['right', 'up', 'down', 'left'];
  return s.player.x < DRIFT_CAP ? ['right', 'up', 'down', 'left'] : ['up', 'down', 'left'];
}

const PUSHER_PRIORITY: ShopItemId[] = ['drill', 'fuel', 'offense', 'vitality', 'capacity', 'digspeed', 'mobility', 'hazardresist', 'lantern', 'teleport'];
const CAUTIOUS_PRIORITY: ShopItemId[] = ['vitality', 'fuel', 'hazardresist', 'capacity', 'offense', 'drill', 'digspeed', 'lantern', 'mobility', 'teleport'];

class Bot {
  constructor(private strategy: Strategy) {}

  decide(s: GameState): Action {
    if (inBaseRadius(s)) {
      const priority = this.strategy === 'pusher' ? PUSHER_PRIORITY : CAUTIOUS_PRIORITY;
      for (const id of priority) {
        const price = s.player.shopPrices[id];
        if (price !== null && s.player.money >= price) return { type: 'buy', item: id };
      }
      return { type: 'move', dir: 'right' };
    }

    const p = s.player;
    const nearest = nearestEnemy(s);

    // 緊急退避: 燃料危険域 / HP危険 / 積載満杯
    const criticalFuel = p.miningRiskLevel === 'danger';
    const criticalHp = p.hp < p.maxHp * 0.25;
    const cargoFull = p.cargoUnits >= p.maxCapacity;
    if (criticalFuel || criticalHp || cargoFull) {
      if (nearest && nearest.dist <= 1 && !criticalHp) return { type: 'attack' };
      const dir = bfsToHome(s);
      if (dir) return { type: 'move', dir };
      if (p.teleportUnlocked && p.fuel >= 25) return { type: 'teleport' };
    }

    // 前線拠点の建設（保護範囲を恒久的に広げる、008パターン#7）
    const outpostBudget = this.strategy === 'pusher' ? 1.2 : 1.6;
    if (p.canBuildOutpost && p.money >= p.buildCosts.outpost * outpostBudget) {
      return { type: 'build', target: 'outpost' };
    }

    // 戦闘: 隣接なら応戦、近ければ交戦域(戦略で射程が違う)
    if (nearest) {
      if (nearest.dist <= 1) return { type: 'attack' };
      const engageRange = this.strategy === 'pusher' ? 5 : 2;
      if (nearest.dist <= engageRange) {
        // 追ってくる敵が中距離なら、割安ならバリケードで足止めしてから戦う
        if (nearest.dist >= 3 && p.money >= p.buildCosts.barricade * 3) {
          return { type: 'build', target: 'barricade', dir: stepToward(s, nearest.enemy.x, nearest.enemy.y) };
        }
        return { type: 'move', dir: stepToward(s, nearest.enemy.x, nearest.enemy.y) };
      }
    }

    // 採掘: 危険タイル(GAS/UNSTABLE)を避けられるレーンがあれば優先
    let hazardFallback: Dir | null = null;
    for (const dir of mineDirs(s, this.strategy)) {
      const [dx, dy] = DELTA[dir];
      const nx = p.x + dx;
      const ny = p.y + dy;
      const t = tileAt(s, nx, ny);
      if (t === TILE.FLOOR) return { type: 'move', dir };
      if (canDig(s, nx, ny)) {
        if (!isHazard(t)) return { type: 'move', dir };
        if (hazardFallback === null) hazardFallback = dir;
      }
    }
    if (hazardFallback !== null) return { type: 'move', dir: hazardFallback };

    // 全方向掘削不可（ドリル威力不足） → pusherは強化を買いに戻る、cautiousはその場で待つ
    if (this.strategy === 'pusher') {
      const dir = bfsToHome(s);
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
  won: boolean;
  finalHp: number;
  money: number;
  moneyEarned: number;
  maxDistance: number;
  oreMined: number;
  oreWasted: number;
  kills: number;
  tripsToHome: number;
  upgradesBought: number;
  outpostsBuilt: number;
  barricadesBuilt: number;
  barricadesLost: number;
  hazardHits: number;
  hazardDamage: number;
  fuelEmptyTicks: number;
  combatRiskEscalations: number;
  miningRiskEscalations: number;
  stuckIncomeEarned: number;
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
    won: s.won,
    finalHp: s.player.hp,
    money: s.player.money,
    moneyEarned: s.metrics.moneyEarned,
    maxDistance: s.metrics.distanceReached,
    oreMined: s.metrics.oreMined,
    oreWasted: s.metrics.oreWasted,
    kills: s.metrics.kills,
    tripsToHome: s.metrics.tripsToHome,
    upgradesBought: s.metrics.upgradesBought,
    outpostsBuilt: s.metrics.outpostsBuilt,
    barricadesBuilt: s.metrics.barricadesBuilt,
    barricadesLost: s.metrics.barricadesLost,
    hazardHits: s.metrics.hazardHits,
    hazardDamage: s.metrics.hazardDamage,
    fuelEmptyTicks: s.metrics.fuelEmptyTicks,
    combatRiskEscalations: s.metrics.combatRiskEscalations,
    miningRiskEscalations: s.metrics.miningRiskEscalations,
    stuckIncomeEarned: s.metrics.stuckIncomeEarned,
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

console.log(`# Frontierline headless simulation (field ${FIELD_WIDTH}x${LANE_COUNT}, maxTicks=${maxTicks})`);
for (const strategy of ['cautious', 'pusher'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDistance=${avg((r) => r.maxDistance)} avgOreMined=${avg((r) => r.oreMined)} avgKills=${avg((r) => r.kills)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgOutposts=${avg((r) => r.outpostsBuilt)} avgBarricadesBuilt=${avg((r) => r.barricadesBuilt)} avgTrips=${avg((r) => r.tripsToHome)} deaths=${results.filter((r) => r.over && !r.won).length}/${results.length} wins=${results.filter((r) => r.won).length}/${results.length}`,
  );
}
