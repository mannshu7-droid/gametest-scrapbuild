/**
 * ヘッドレスシミュレーション: 2種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * 017の核心仮説は「探査（scanner）で豊富さを見抜いてフォークで良いレーンを選ぶこと」と
 * 「共鳴チャージ（charge）を貯めて狙ったレーンで巻き込み採掘すること」が経済的に報われるか、なので、
 * この2軸への投資有無で戦略を分ける（003/011のshallow/diver・cautious/pusherに相当する対立軸）:
 * - blind: scanner/chargeを一切買わず、フォークでは常に固定ルール（バンド番号%レーン数）でレーンを
 *   選ぶ。「新システムを無視しても最低限詰まずに遊べるか」の対照群
 * - planner: scanner/chargeを優先的に購入し、見えているヒントから最も期待値の高いレーンを選ぶ。
 *   「新システムに投資すると明確に得をするか」の検証群
 */
import { Game, LANES, LENGTH, BAND_SIZE, NUM_BANDS, bandAt, isForkPos, requiredDrillPower } from '../src/core/game';
import { TILE, type Action, type Dir, type GameState, type TileId, type UpgradeId } from '../src/core/types';

function tileAt(s: GameState, x: number, y: number): number | null {
  if (x < 0 || x >= s.map.length || y < 0 || y >= s.map.lanes) return null;
  return s.map.tiles[x * s.map.lanes + y];
}

function canDig(s: GameState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  if (t === null || t === TILE.FLOOR || t === TILE.UNKNOWN) return false;
  const band = bandAt(x);
  return s.player.drillPower >= requiredDrillPower(t as TileId, band);
}

/** 既に掘った床(FLOOR)だけを通ってホーム(x=0)へ最短で戻る次の一手（上下移動はフォークでのみ許可） */
function bfsToHome(s: GameState): Dir | null {
  const p = s.player;
  if (p.x === 0) return null;
  const lanes = s.map.lanes;
  const length = s.map.length;
  const visited = new Uint8Array(length * lanes);
  visited[p.x * lanes + p.y] = 1;
  const queue: { x: number; y: number; root: Dir }[] = [];
  let head = 0;
  const startNeighbors: [Dir, number, number][] = [
    ['left', p.x - 1, p.y],
    ['right', p.x + 1, p.y],
  ];
  if (isForkPos(p.x)) {
    startNeighbors.push(['up', p.x, p.y - 1], ['down', p.x, p.y + 1]);
  }
  for (const [d, nx, ny] of startNeighbors) {
    if (nx < 0 || nx >= length || ny < 0 || ny >= lanes) continue;
    const t = tileAt(s, nx, ny);
    if (t !== TILE.FLOOR) continue;
    if (nx === 0) return d;
    visited[nx * lanes + ny] = 1;
    queue.push({ x: nx, y: ny, root: d });
  }
  while (head < queue.length) {
    const cur = queue[head++];
    const neighbors: [number, number][] = [
      [cur.x - 1, cur.y],
      [cur.x + 1, cur.y],
    ];
    if (isForkPos(cur.x)) neighbors.push([cur.x, cur.y - 1], [cur.x, cur.y + 1]);
    for (const [nx, ny] of neighbors) {
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

type Strategy = 'blind' | 'planner';

const BLIND_PRIORITY: UpgradeId[] = ['drill', 'capacity', 'fuel', 'hp', 'digspeed', 'hazardresist'];
const PLANNER_PRIORITY: UpgradeId[] = ['scanner', 'drill', 'charge', 'capacity', 'fuel', 'hp', 'digspeed', 'hazardresist'];

/**
 * フォーク選択bot。「一度入ったレーンは次のフォークまで変えられない」設計のため、単純に固定レーンへ
 * 突っ込むだけのbotだと、たまたま要求ドリル威力を満たせないタイルが混じったレーンに詰まり続けて
 * 見かけ上の停滞（=ゲーム本体のバグに見える偽の停滞）を起こす。003/011のLearnings
 * 「ヘッドレスbotの単純な意思決定ロジックはゲーム本体のバグと見分けがつかない偽の停滞を生む」に
 * 倣い、両戦略とも最低限「直接踏んで確認した詰みレーンは避けて次は別レーンを試す」適応を持たせた上で、
 * blind/plannerの差は「フォーク到達前に危険度/豊富さの予測ヒントを使うかどうか」だけに絞る。
 */
class Bot {
  private progressLane = new Map<number, number>();
  private blockedLane = new Map<number, Set<number>>();
  private lastDrillLevel = 0;
  private farthestX = 0;

  constructor(private strategy: Strategy) {}

  private candidateLanes(band: number): number[] {
    const blocked = this.blockedLane.get(band);
    const all = [0, 1, 2];
    if (!blocked || blocked.size === 0) return all;
    return all.filter((l) => !blocked.has(l));
  }

  /** そのバンドの3レーン全てが現在のドリル威力では詰みと判明済みか */
  private allLanesBlocked(band: number): boolean {
    return (this.blockedLane.get(band)?.size ?? 0) >= 3;
  }

  private chooseLane(s: GameState, band: number): number {
    const blocked = this.blockedLane.get(band);
    const progress = this.progressLane.get(band);
    if (progress !== undefined && !(blocked && blocked.has(progress))) return progress; // 既に前進済みの経路を再利用

    const candidates = this.candidateLanes(band);
    if (candidates.length === 0) return 0; // 全滅（呼び出し側でallLanesBlockedとして扱われるはずの防御的フォールバック）
    if (this.strategy === 'blind') return candidates[0];

    const hint = s.bandHints[band];
    if (!hint) return candidates[0];
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const lane of hint.lanes) {
      if (!candidates.includes(lane.lane)) continue;
      const rich = lane.richness ?? 1;
      const haz = lane.hazardTier ?? 1;
      const score = rich - haz * 0.7;
      if (score > bestScore) {
        bestScore = score;
        best = lane.lane;
      }
    }
    return best;
  }

  decide(s: GameState): Action {
    if (s.player.drillPower !== this.lastDrillLevel) {
      this.lastDrillLevel = s.player.drillPower;
      this.blockedLane.clear(); // 強化後は詰みレーンも掘れる可能性があるため再挑戦を許す
    }
    if (s.player.x > this.farthestX) {
      this.farthestX = s.player.x;
      if (s.player.x > 0) this.progressLane.set(bandAt(s.player.x), s.player.y);
    }

    const p = s.player;
    const nextBand = Math.floor(p.x / BAND_SIZE);

    if (s.phase === 'shop') {
      const priority = this.strategy === 'blind' ? BLIND_PRIORITY : PLANNER_PRIORITY;
      for (const id of priority) {
        const item = s.shop.find((it) => it.id === id);
        if (item && item.nextCost !== null && s.player.money >= item.nextCost) {
          return { type: 'buy', item: id };
        }
      }
      // 次バンドの全レーンが詰みと判明済みなら、無駄に出発せずホームで足踏みして
      // 詰みからの脱出手段（stuckIncome）が資金を貯めるのを待つ（ドリル強化で自動的に再挑戦になる）
      if (this.allLanesBlocked(nextBand)) return { type: 'wait' };
      return this.moveTowardChosenLane(s, nextBand);
    }

    const needsReturn = p.fuel <= 0 || p.cargoUnits >= p.maxCapacity || p.miningRiskLevel === 'danger';
    if (needsReturn) {
      const dir = bfsToHome(s);
      if (dir) return { type: 'move', dir };
    }

    if (p.atFork) {
      // 遠方のフォークで詰みと判明した場合は、そこで足踏みせずホームへ戻って強化を待つ
      if (p.x > 0 && this.allLanesBlocked(nextBand)) {
        const dir = bfsToHome(s);
        if (dir) return { type: 'move', dir };
      }
      return this.moveTowardChosenLane(s, nextBand);
    }

    // バンド内: 一本道を前進する。ドリル威力不足で掘れない場合はこのレーンを詰みとして記録しホームへ戻る
    const nx = p.x + 1;
    if (nx < s.map.length) {
      const t = tileAt(s, nx, p.y);
      if (t === TILE.FLOOR || canDig(s, nx, p.y)) return { type: 'move', dir: 'right' };
    }
    const band = bandAt(p.x);
    if (!this.blockedLane.has(band)) this.blockedLane.set(band, new Set());
    this.blockedLane.get(band)!.add(p.y);
    const dir = bfsToHome(s);
    if (dir) return { type: 'move', dir };
    return { type: 'wait' };
  }

  private moveTowardChosenLane(s: GameState, nextBand: number): Action {
    const target = this.chooseLane(s, nextBand);
    if (s.player.y < target) return { type: 'move', dir: 'down' };
    if (s.player.y > target) return { type: 'move', dir: 'up' };
    return { type: 'move', dir: 'right' };
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
  resonanceTriggers: number;
  resonanceBonusOre: number;
  forkSwitches: number;
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
    resonanceTriggers: s.metrics.resonanceTriggers,
    resonanceBonusOre: s.metrics.resonanceBonusOre,
    forkSwitches: s.metrics.forkSwitches,
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

console.log(`# Forkshaft headless simulation  (field ${LENGTH - 1}x${LANES}, ${NUM_BANDS} bands, maxTicks=${maxTicks})`);
for (const strategy of ['blind', 'planner'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDistance=${avg((r) => r.maxDistance)} avgOreMined=${avg((r) => r.oreMined)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgResonanceTriggers=${avg((r) => r.resonanceTriggers)} avgResonanceBonusOre=${avg((r) => r.resonanceBonusOre)} avgForkSwitches=${avg((r) => r.forkSwitches)} deaths=${results.filter((r) => r.over).length}/${results.length}`,
  );
}

