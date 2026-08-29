/**
 * ヘッドレスシミュレーション: 2種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * 003-mining-deepvein（縦シャフト）のshallow/diver比較手法を、横方向帯状フィールドに移植した版。
 * - cautious: ホームに近い範囲（x<DRIFT_CAP、band0〜1相当）に留まり続け、ドリル威力・テレポートには
 *   一切投資しない戦略。「浅い範囲で粘るだけでも稼げてしまわないか」の最低ライン検出用（003のshallow相当）
 * - pusher: 常に進行距離(x)の更新を最優先し、詰まったらドリル威力強化を優先購入してさらに先を目指す
 *   戦略（003のdiver相当）。「動くと得をする」の検証に使う
 *
 * 帰還判断は003のように生の残燃料マージンで比較するのではなく、ゲーム本体が公開する
 * miningRiskLevel（新規UIヒント）が'danger'になったら帰還する、という単純なルールに統一した。
 * RISK_DANGER_MARGINは003のbotが使っていたreturnMargin(15)と同値にしてあるため、ヒントを使った
 * 判断と生数値を使った判断が同等に機能するかを間接的に検証できる。
 */
import { Game, LANES, LENGTH, bandAt, requiredDrillPower } from '../src/core/game';
import { TILE, type Action, type Dir, type GameState, type TileId, type UpgradeId } from '../src/core/types';

const DELTA: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const DIRS: Dir[] = ['left', 'right', 'up', 'down'];

function tileAt(s: GameState, x: number, y: number): number | null {
  if (x < 0 || x >= s.map.length || y < 0 || y >= s.map.lanes) return null;
  return s.map.tiles[x * s.map.lanes + y];
}

/** 既に掘った床(FLOOR)だけを通ってホーム(x=0)へ最短で戻る次の一手 */
function bfsToHome(s: GameState): Dir | null {
  const p = s.player;
  if (p.x === 0) return null;
  const lanes = s.map.lanes;
  const length = s.map.length;
  const visited = new Uint8Array(length * lanes);
  visited[p.x * lanes + p.y] = 1;
  const queue: { x: number; y: number; root: Dir }[] = [];
  let head = 0;
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    const nx = p.x + dx;
    const ny = p.y + dy;
    const t = tileAt(s, nx, ny);
    if (t !== TILE.FLOOR) continue;
    if (nx === 0) return d;
    visited[nx * lanes + ny] = 1;
    queue.push({ x: nx, y: ny, root: d });
  }
  while (head < queue.length) {
    const cur = queue[head++];
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || nx >= length || ny < 0 || ny >= lanes) continue;
      if (visited[nx * lanes + ny]) continue;
      const t = tileAt(s, nx, ny);
      if (t !== TILE.FLOOR) continue;
      if (nx === 0) return cur.root;
      visited[nx * lanes + ny] = 1;
      queue.push({ x: nx, y: ny, root: cur.root });
    }
  }
  return null;
}

function canDig(s: GameState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  if (t === null || t === TILE.FLOOR) return false;
  const band = bandAt(x);
  return s.player.drillPower >= requiredDrillPower(t as TileId, band);
}

function isHazard(t: number | null): boolean {
  return t === TILE.GAS || t === TILE.UNSTABLE;
}

type Strategy = 'cautious' | 'pusher';
const DRIFT_CAP = 80; // band0〜1相当（BAND_SIZE=40 x 2）

function mineDirs(s: GameState, strategy: Strategy): Dir[] {
  if (strategy === 'pusher') return ['right', 'up', 'down', 'left'];
  return s.player.x < DRIFT_CAP ? ['right', 'up', 'down', 'left'] : ['up', 'down', 'left'];
}

const PUSHER_PRIORITY: UpgradeId[] = ['drill', 'fuel', 'capacity', 'hp', 'digspeed', 'hazardresist', 'lantern', 'teleport'];
const CAUTIOUS_PRIORITY: UpgradeId[] = ['capacity', 'fuel', 'hp', 'digspeed', 'lantern', 'hazardresist'];

class Bot {
  constructor(private strategy: Strategy) {}

  decide(s: GameState): Action {
    if (s.phase === 'shop') {
      const priority = this.strategy === 'pusher' ? PUSHER_PRIORITY : CAUTIOUS_PRIORITY;
      for (const id of priority) {
        const item = s.shop.find((it) => it.id === id);
        if (item && item.nextCost !== null && s.player.money >= item.nextCost) {
          return { type: 'buy', item: id };
        }
      }
      return { type: 'move', dir: 'right' };
    }

    const p = s.player;
    const needsReturn = p.fuel <= 0 || p.cargoUnits >= p.maxCapacity || p.miningRiskLevel === 'danger';
    if (needsReturn) {
      const dir = bfsToHome(s);
      if (dir) return { type: 'move', dir };
    }

    // 迂回優先度の高い探索: 5レーンの横幅を活かし、同じ優先順位内では危険タイル(GAS/UNSTABLE)を
    // 避けられるレーンがあればそちらを優先する（reviews/011-mining-driftline-v1.md 軽微バグ#3
    // 「5レーンの迂回余地」の検証、v2 中バグ#2「危険度再悪化ハイライトの過剰発火」が探索精度に
    // 起因するかの検証を兼ねる）。危険タイルしか選べない場合のみそこへ進む
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
  finalHp: number;
  money: number;
  moneyEarned: number;
  maxDistance: number;
  oreMined: number;
  oreWasted: number;
  tripsToHome: number;
  upgradesBought: number;
  hazardHits: number;
  hazardDamage: number;
  fuelEmptyTicks: number;
  riskEscalations: number;
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
    maxDistance: s.metrics.maxDistance,
    oreMined: s.metrics.oreMined,
    oreWasted: s.metrics.oreWasted,
    tripsToHome: s.metrics.tripsToHome,
    upgradesBought: s.metrics.upgradesBought,
    hazardHits: s.metrics.hazardHits,
    hazardDamage: s.metrics.hazardDamage,
    fuelEmptyTicks: s.metrics.fuelEmptyTicks,
    riskEscalations: s.metrics.riskEscalations,
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

console.log(`# Driftline headless simulation  (field ${LENGTH - 1}x${LANES}, maxTicks=${maxTicks})`);
for (const strategy of ['cautious', 'pusher'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDistance=${avg((r) => r.maxDistance)} avgOreMined=${avg((r) => r.oreMined)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgTrips=${avg((r) => r.tripsToHome)} avgRiskEscalations=${avg((r) => r.riskEscalations)} deaths=${results.filter((r) => r.over).length}/${results.length}`,
  );
}
