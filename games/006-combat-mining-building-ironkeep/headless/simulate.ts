/**
 * ヘッドレスシミュレーション: 3種類のショップ優先度を持つボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * 005から引き継いだ移動・戦闘・帰還判断ロジックに加え、006の新規要素を検証する2つの振る舞いを追加した:
 * (1) 迂回橋: 採掘威力が足りず4方向すべてで掘り進めなくなった（=壁に当たった）とき、
 *     お金を払って支保工の迂回橋を建てて前進を続ける。「drillに投資しない戦略でも壁で完全に詰まなくなるか」を検証する
 * (2) バリケード: 隣接する敵と交戦中、背後が空いた床タイルなら支保工で塞ぎ、増援の合流を遅らせる
 * ショップ優先度が異なる3戦略（mining-first/combat-first/balanced）はいずれもengineeringカテゴリを
 * 優先度リストに含め、採掘・戦闘と競合する第3の投資先として実際に選ばれるかを比較する。
 */
import { Game, W, H, bandAt, requiredDrillPower, bridgeCost, barricadeCost, buildCostMultOf } from '../src/core/game';
import { TILE, type Action, type Dir, type GameState, type TileId, type UpgradeId } from '../src/core/types';

const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

function tileAt(s: GameState, x: number, y: number): number | null {
  if (x < 0 || x >= s.map.w || y < 0 || y >= s.map.h) return null;
  return s.map.tiles[y * s.map.w + x];
}

function enemyAt(s: GameState, x: number, y: number) {
  return s.enemies.find((e) => e.x === x && e.y === y);
}

/** 既に掘った床(FLOOR)・支保工(PROP)だけを通って地上(y=0)へ最短で戻る次の一手 */
function bfsToSurface(s: GameState): Dir | null {
  const p = s.player;
  if (p.y === 0) return null;
  const w = s.map.w;
  const h = s.map.h;
  const visited = new Uint8Array(w * h);
  visited[p.y * w + p.x] = 1;
  const queue: { x: number; y: number; root: Dir }[] = [];
  let head = 0;
  const passable = (t: number | null) => t === TILE.FLOOR || t === TILE.PROP;
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    const nx = p.x + dx;
    const ny = p.y + dy;
    const t = tileAt(s, nx, ny);
    if (!passable(t)) continue;
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
      if (!passable(t)) continue;
      if (ny === 0) return cur.root;
      visited[ny * w + nx] = 1;
      queue.push({ x: nx, y: ny, root: cur.root });
    }
  }
  return null;
}

function canDig(s: GameState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  if (t === null || t === TILE.FLOOR || t === TILE.PROP) return false;
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

function engineeringLevel(s: GameState): number {
  return s.shop.find((it) => it.id === 'engineering')?.level ?? 0;
}

type Strategy = 'mining-first' | 'combat-first' | 'balanced' | 'bridge-reliant';

const MINING_FIRST: UpgradeId[] = ['drill', 'capacity', 'fuel', 'engineering', 'atk', 'hp', 'skill', 'atkspeed', 'muffler'];
const COMBAT_FIRST: UpgradeId[] = ['atk', 'hp', 'skill', 'atkspeed', 'engineering', 'drill', 'fuel', 'capacity', 'muffler'];
const BALANCED: UpgradeId[] = ['drill', 'atk', 'engineering', 'hp', 'capacity', 'skill', 'fuel', 'atkspeed', 'muffler'];
// 006新規の4戦略目: drillには一切投資せず、代わりに常に現金を「迂回橋を建てられるだけの余力」として
// 手元に残す。combat-firstは全財産をショップで使い切るため、壁に当たった瞬間に迂回橋を買う金が残らず
// 詰まったのと同じ状態になる（実測で確認済み）。この戦略は「drill投資を放棄しても、迂回橋の分だけ
// 常に現金を確保しておけば壁で詰まらない」という006の中核仮説を検証するための戦略
const BRIDGE_RELIANT: UpgradeId[] = ['atk', 'hp', 'skill', 'atkspeed', 'engineering', 'fuel', 'capacity', 'muffler'];
const BRIDGE_RELIANT_RESERVE = 30;

function priorityFor(strategy: Strategy): UpgradeId[] {
  if (strategy === 'mining-first') return MINING_FIRST;
  if (strategy === 'combat-first') return COMBAT_FIRST;
  if (strategy === 'bridge-reliant') return BRIDGE_RELIANT;
  return BALANCED;
}

const RETURN_HP_THRESHOLD = 0.25;
const RESUME_DIVE_HP_THRESHOLD = 0.6;

class Bot {
  private awaitingHeal = false;

  constructor(private strategy: Strategy) {}

  private tryBuy(s: GameState): Action | null {
    const reserve = this.strategy === 'bridge-reliant' ? BRIDGE_RELIANT_RESERVE : 0;
    const skillItem = s.shop.find((it) => it.id === 'skill');
    if (
      skillItem &&
      skillItem.level === 0 &&
      skillItem.nextCost !== null &&
      s.player.money - skillItem.nextCost >= reserve
    ) {
      return { type: 'buy', item: 'skill' };
    }
    for (const id of priorityFor(this.strategy)) {
      const item = s.shop.find((it) => it.id === id);
      if (item && item.nextCost !== null && s.player.money - item.nextCost >= reserve) {
        return { type: 'buy', item: id };
      }
    }
    return null;
  }

  decide(s: GameState): Action {
    if (s.phase === 'shop') {
      if (this.awaitingHeal) {
        if (s.player.hp < s.player.maxHp * RESUME_DIVE_HP_THRESHOLD) {
          return this.tryBuy(s) ?? { type: 'wait' };
        }
        this.awaitingHeal = false;
      }
      return this.tryBuy(s) ?? { type: 'move', dir: 'down' };
    }

    const p = s.player;
    const costMult = buildCostMultOf(engineeringLevel(s));

    const critical = p.hp <= p.maxHp * 0.2;
    const adjCount = adjacentEnemyCount(s);
    if (!critical && adjCount >= 1 && p.hasSkill && p.skillCd === 0) return { type: 'skill' };
    const adjDir = adjacentEnemyDir(s);
    if (!critical && adjDir) {
      // 006新規: 交戦中に背後が空いた床タイルなら支保工バリケードで塞ぎ、増援の合流を遅らせる
      const behindDir = OPPOSITE[adjDir];
      const [bx, by] = DELTA[behindDir];
      const bnx = p.x + bx;
      const bny = p.y + by;
      const behindTile = tileAt(s, bnx, bny);
      if (p.buildCd === 0 && behindTile === TILE.FLOOR && bny > 0 && !enemyAt(s, bnx, bny)) {
        const cost = barricadeCost(bandAt(Math.max(1, bny)), costMult);
        if (p.money >= cost) return { type: 'build', dir: behindDir };
      }
      return { type: 'attack', dir: adjDir };
    }

    // 帰還判断: 燃料切れ・満載・低HP・estFuelToReturn残不足のいずれか
    const returnMargin = 15;
    const lowHp = p.hp <= p.maxHp * RETURN_HP_THRESHOLD;
    const needsReturn =
      p.fuel <= 0 ||
      p.cargoUnits >= p.maxCapacity ||
      lowHp ||
      (p.estFuelToReturn !== null && p.fuel <= p.estFuelToReturn + returnMargin);
    if (needsReturn) {
      if (lowHp) this.awaitingHeal = true;
      const dir = bfsToSurface(s);
      if (dir) {
        const [dx, dy] = DELTA[dir];
        if (enemyAt(s, p.x + dx, p.y + dy)) {
          if (p.dashActive > 0) return { type: 'move', dir };
          if (p.dashCd === 0) return { type: 'dash' };
          if (adjDir) return { type: 'attack', dir: adjDir };
        } else {
          return { type: 'move', dir };
        }
      } else if (adjDir) {
        return { type: 'attack', dir: adjDir };
      }
    }

    // 前進方向（down/right/left）を優先し、各方向ごとに「移動→掘削→迂回橋」まで試してから次の方向に移る。
    // 005由来のボットは方向ごとに移動/掘削しか試さなかったため、「down」が採掘威力の壁で塞がれると
    // 横の未探索列を延々と掘り進むだけで、一度も迂回橋を試さないまま同じ深さを横に彷徨い続ける
    // （帯=同じ深さの行は全列が同じ採掘威力を要求するため、横移動では壁を回避できない）。
    // 迂回橋を各方向の「移動/掘削」と同格の選択肢として扱うことで、この横彷徨いより先に迂回橋を検討させる
    const FORWARD_DIRS: Dir[] = ['down', 'right', 'left'];
    for (const dir of FORWARD_DIRS) {
      const [dx, dy] = DELTA[dir];
      const nx = p.x + dx;
      const ny = p.y + dy;
      const t = tileAt(s, nx, ny);
      if (enemyAt(s, nx, ny)) continue;
      if (t === TILE.FLOOR || t === TILE.PROP) return { type: 'move', dir };
      if (canDig(s, nx, ny)) return { type: 'move', dir };
      if (t !== null && p.buildCd === 0) {
        const band = bandAt(ny);
        const cost = bridgeCost(t as TileId, band, costMult);
        if (p.money >= cost) return { type: 'build', dir };
      }
    }

    // フェーズC（最終手段）: 前進も迂回橋も不可能なら、既に掘った床への後退だけは許容する
    if (tileAt(s, p.x, p.y - 1) === TILE.FLOOR && !enemyAt(s, p.x, p.y - 1)) return { type: 'move', dir: 'up' };

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
  dashUses: number;
  fuelEmptyTicks: number;
  bridgesBuilt: number;
  barricadesBuilt: number;
  propsDestroyedByEnemy: number;
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
    dashUses: s.metrics.dashUses,
    fuelEmptyTicks: s.metrics.fuelEmptyTicks,
    bridgesBuilt: s.metrics.bridgesBuilt,
    barricadesBuilt: s.metrics.barricadesBuilt,
    propsDestroyedByEnemy: s.metrics.propsDestroyedByEnemy,
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

console.log(`# IronKeep headless simulation  (shaft ${W}x${H}, maxTicks=${maxTicks})`);
for (const strategy of ['mining-first', 'combat-first', 'balanced', 'bridge-reliant'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDepth=${avg((r) => r.maxDepth)} avgKills=${avg((r) => r.kills)} avgOreMined=${avg((r) => r.oreMined)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgTrips=${avg((r) => r.tripsToSurface)} avgMilestones=${avg((r) => r.milestonesReached)} avgSkillUses=${avg((r) => r.skillUses)} avgDashUses=${avg((r) => r.dashUses)} avgBridges=${avg((r) => r.bridgesBuilt)} avgBarricades=${avg((r) => r.barricadesBuilt)} avgPropsDestroyed=${avg((r) => r.propsDestroyedByEnemy)} deaths=${results.filter((r) => r.over).length}/${results.length}`,
  );
}
