/**
 * ヘッドレスシミュレーション: ショップ優先度と前線基地建設の有無を組み合わせたボットが自動プレイし、
 * バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * 006から引き継いだ移動・戦闘・帰還判断ロジック（迂回橋・バリケード）に加え、007の新規要素である
 * 前線基地の建設を検証する振る舞いを追加した: 直前の基地からOUTPOST_MIN_GAP以上深く進み、かつ
 * 建設コストを払える状態になったら（canBuildOutpost）、即座に前線基地を建てる。ショップ滞在中は
 * 「次の前線基地の建設費用」を推定してその分を常に手元に残す（bridge-reliant戦略のreserveと同じ仕組み）。
 * 4種のショップ優先度（mining-first/combat-first/balanced/bridge-reliant）はすべて前線基地を建てる設定で走らせ、
 * 加えて「balanced-no-outpost」（balancedの優先度だが前線基地を一切建てない）をA/B比較用に追加し、
 * 前線基地が実際にmaxDepth・生存率・往復コストへ与える効果を定量的に確認する。
 */
import {
  Game,
  W,
  H,
  bandAt,
  requiredDrillPower,
  bridgeCost,
  barricadeCost,
  buildCostMultOf,
  OUTPOST_MIN_GAP,
} from '../src/core/game';
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

/** 既に掘った床(FLOOR)・支保工(PROP)・前線基地(OUTPOST)だけを通って最寄りの基地(地上 or 前線基地)へ最短で戻る次の一手 */
function bfsToNearestBase(s: GameState): Dir | null {
  const p = s.player;
  if (p.y === 0 || tileAt(s, p.x, p.y) === TILE.OUTPOST) return null;
  const w = s.map.w;
  const h = s.map.h;
  const visited = new Uint8Array(w * h);
  visited[p.y * w + p.x] = 1;
  const queue: { x: number; y: number; root: Dir }[] = [];
  let head = 0;
  const passable = (t: number | null) => t === TILE.FLOOR || t === TILE.PROP || t === TILE.OUTPOST;
  for (const d of DIRS) {
    const [dx, dy] = DELTA[d];
    const nx = p.x + dx;
    const ny = p.y + dy;
    const t = tileAt(s, nx, ny);
    if (!passable(t)) continue;
    if (ny === 0 || t === TILE.OUTPOST) return d;
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
      if (ny === 0 || t === TILE.OUTPOST) return cur.root;
      visited[ny * w + nx] = 1;
      queue.push({ x: nx, y: ny, root: cur.root });
    }
  }
  return null;
}

function canDig(s: GameState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  if (t === null || t === TILE.FLOOR || t === TILE.PROP || t === TILE.OUTPOST) return false;
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

type Strategy = 'mining-first' | 'combat-first' | 'balanced' | 'bridge-reliant' | 'balanced-no-outpost';

const MINING_FIRST: UpgradeId[] = ['drill', 'capacity', 'fuel', 'engineering', 'atk', 'hp', 'skill', 'atkspeed', 'muffler'];
const COMBAT_FIRST: UpgradeId[] = ['atk', 'hp', 'skill', 'atkspeed', 'engineering', 'drill', 'fuel', 'capacity', 'muffler'];
const BALANCED: UpgradeId[] = ['drill', 'atk', 'engineering', 'hp', 'capacity', 'skill', 'fuel', 'atkspeed', 'muffler'];
// 006由来の4戦略目: drillには一切投資せず、代わりに常に現金を「迂回橋を建てられるだけの余力」として
// 手元に残す。combat-firstは全財産をショップで使い切るため、壁に当たった瞬間に迂回橋を買う金が残らず
// 詰まったのと同じ状態になる（実測で確認済み）。この戦略は「drill投資を放棄しても、迂回橋の分だけ
// 常に現金を確保しておけば壁で詰まらない」という006の中核仮説を検証するための戦略
const BRIDGE_RELIANT: UpgradeId[] = ['atk', 'hp', 'skill', 'atkspeed', 'engineering', 'fuel', 'capacity', 'muffler'];
const BRIDGE_RELIANT_RESERVE = 30;

function priorityFor(strategy: Strategy): UpgradeId[] {
  if (strategy === 'mining-first') return MINING_FIRST;
  if (strategy === 'combat-first') return COMBAT_FIRST;
  if (strategy === 'bridge-reliant') return BRIDGE_RELIANT;
  return BALANCED; // balanced / balanced-no-outpost 共通
}

const RETURN_HP_THRESHOLD = 0.25;
const RESUME_DIVE_HP_THRESHOLD = 0.6;

/**
 * v2追加（バグ#3対応）: 「1つ下の行(y+1、次のband)」全16列を見て、現在の採掘威力で1列でも掘れるか、
 * 既に床/支保工/前線基地で通行可能かを調べる。1列も無ければband境界の完全な壁（実測: drillLevel0だと
 * band2は全タイルが要求採掘威力2以上でband1のdrillPower1では1列も掘れない）とみなし、
 * 抜けるのに必要な最安の迂回橋コストを返す（1つでもあれば0=壁ではない）。
 * 直前の実装は同じ行(y)内のleft/rightも「進行可能」と誤判定していたため、同じband内を
 * 横移動できることを理由に壁を壁と認識できず、前線基地を建てた直後にband境界の壁へ当たって
 * 「基地と壁の間を無限往復するだけで進行が完全停止する」個体を解消できていなかった
 */
function minEscapeBridgeCost(s: GameState, costMult: number): number {
  const ny = s.player.y + 1;
  if (ny >= s.map.h) return 0;
  const band = bandAt(ny);
  let minCost = Infinity;
  for (let x = 0; x < s.map.w; x++) {
    const t = tileAt(s, x, ny);
    if (t === null) continue;
    if (t === TILE.FLOOR || t === TILE.PROP || t === TILE.OUTPOST) return 0;
    if (requiredDrillPower(t as TileId, band) <= s.player.drillPower) return 0;
    minCost = Math.min(minCost, bridgeCost(t as TileId, band, costMult));
  }
  return Number.isFinite(minCost) ? minCost : 0;
}

class Bot {
  private awaitingHeal = false;
  /** 直近のmineフェーズで観測した「今building可能な位置に前線基地を建てるとしたらの費用」。
   * shopフェーズでの購入判断時にこれを現金の予約分として扱い、outpost建設の機会を潰さないようにする */
  private outpostReserve = 0;
  /** v2追加: 壁に当たっている間だけ、迂回橋代を通常購入より優先して確保する */
  private wallReserve = 0;
  /** 007新規: balanced-no-outpost はA/B比較用に前線基地を一切建てない */
  private readonly buildsOutposts: boolean;

  constructor(private strategy: Strategy) {
    this.buildsOutposts = strategy !== 'balanced-no-outpost';
  }

  private tryBuy(s: GameState): Action | null {
    const bridgeReserve = this.strategy === 'bridge-reliant' ? BRIDGE_RELIANT_RESERVE : 0;
    const reserve = Math.max(bridgeReserve, this.wallReserve) + (this.buildsOutposts ? this.outpostReserve : 0);
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
    // depthSinceLastBaseだけを条件に予約すると、貧しいうちから毎トリップ「今日はどうせ届かない貯金」に
    // 全予算を凍結し、序盤の安い購入すら一切できず永久に成長しないままの停滞（実測で確認済み）を招く。
    // 「既にコストの一定割合貯まっている」を条件に加えることで、貧しいうちは通常どおり買い物して
    // 成長し、ある程度貯まった後だけ前線基地のために手元の資金を守るようにする。
    // v2修正: 従来は`s.phase==='mine'`のときだけ再計算していたため、基地到着直後（鉱石売却で所持金が
    // 一気に増えた直後）のshopフェーズでは売却前の古い（低い）所持金を基準にした予約額のまま買い物してしまい、
    // 大口の売却益がそのまま通常購入に溶けて一向に貯まらないバグがあった。phase判定を外し毎tick再計算する
    if (this.buildsOutposts) {
      const cost = s.player.nextOutpostCost;
      const closeEnough = s.player.depthSinceLastBase >= OUTPOST_MIN_GAP * 0.2 && s.player.money >= cost * 0.25;
      this.outpostReserve = closeEnough ? cost : 0;
    }
    // v3修正（バグ#3残存パターン対応）: v2まではshopフェーズでも毎tick再計算していたため、
    // 「深部の壁で足止めされて撤退→基地(shopフェーズ)に戻った瞬間、wallReserveが基地の足元の
    // （とっくに通行可能な）行を見て0にリセットされる」ことで、実際にブロックされている深部の壁の
    // 存在をshopフェーズ側が忘れてしまい、資金不足のまま何度も同じ壁へ突っ込んでは即撤退する
    // 「小刻みな往復」を引き起こしていた。mineフェーズ（実際にその深さにいる間）でのみ再計算し、
    // shopフェーズでは直前にブロックされた地点のwallReserveを保持することで、資金が貯まるまで
    // 基地で待機できるようにする
    if (s.phase === 'mine') {
      this.wallReserve = minEscapeBridgeCost(s, buildCostMultOf(engineeringLevel(s)));
    }

    if (s.phase === 'shop') {
      if (this.awaitingHeal) {
        if (s.player.hp < s.player.maxHp * RESUME_DIVE_HP_THRESHOLD) {
          return this.tryBuy(s) ?? { type: 'wait' };
        }
        this.awaitingHeal = false;
      }
      const buy = this.tryBuy(s);
      if (buy) return buy;
      // 直前のmineフェーズで壁に当たっていて、迂回橋代がまだ貯まっていないなら、
      // 「潜行→壁で足止め→即帰還」という無駄な小刻みな往復（tripsToSurfaceを浪費するだけで
      // 何も進展しない）を作らず、基地で待機して資金が貯まるのを待つ。基地滞在中はLABOR_INCOMEで
      // 資金が必ず増え続けるため、待機自体が新種の停滞（凍結）にはならない
      if (this.wallReserve > 0 && s.player.money < this.wallReserve) return { type: 'wait' };
      return { type: 'move', dir: 'down' };
    }

    const p = s.player;
    const costMult = buildCostMultOf(engineeringLevel(s));

    // 007新規: 前線基地を今建てられるなら最優先で建てる（戦闘中でなければ）。
    // 建てた瞬間に鉱石売却・燃料全回復・shopフェーズ突入という「基地に帰り着いた」のと同じ恩恵を受けられるため、
    // 交戦中でない限り後回しにする理由がない
    const adjCountEarly = adjacentEnemyCount(s);
    if (this.buildsOutposts && adjCountEarly === 0 && p.canBuildOutpost) return { type: 'outpost' };

    const critical = p.hp <= p.maxHp * 0.2;
    const adjCount = adjacentEnemyCount(s);
    if (!critical && adjCount >= 1 && p.hasSkill && p.skillCd === 0) return { type: 'skill' };
    const adjDir = adjacentEnemyDir(s);
    if (!critical && adjDir) {
      // 006由来: 交戦中に背後が空いた床タイルなら支保工バリケードで塞ぎ、増援の合流を遅らせる
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

    // 帰還判断: 燃料切れ・満載・低HP・estFuelToReturn残不足のいずれか（estFuelToReturnは最寄りの前線基地も考慮する）
    const returnMargin = 15;
    const lowHp = p.hp <= p.maxHp * RETURN_HP_THRESHOLD;
    const needsReturn =
      p.fuel <= 0 ||
      p.cargoUnits >= p.maxCapacity ||
      lowHp ||
      (p.estFuelToReturn !== null && p.fuel <= p.estFuelToReturn + returnMargin);
    if (needsReturn) {
      if (lowHp) this.awaitingHeal = true;
      const dir = bfsToNearestBase(s);
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
      if (t === TILE.FLOOR || t === TILE.PROP || t === TILE.OUTPOST) return { type: 'move', dir };
      if (canDig(s, nx, ny)) return { type: 'move', dir };
      if (t !== null && p.buildCd === 0) {
        const band = bandAt(ny);
        const cost = bridgeCost(t as TileId, band, costMult);
        if (p.money >= cost) return { type: 'build', dir };
      }
    }

    // フェーズC（最終手段）: 前進も迂回橋も不可能なら、既に掘った床への後退だけは許容する
    if (tileAt(s, p.x, p.y - 1) === TILE.FLOOR && !enemyAt(s, p.x, p.y - 1)) return { type: 'move', dir: 'up' };

    const dir = bfsToNearestBase(s);
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
  outpostsBuilt: number;
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
    outpostsBuilt: s.metrics.outpostsBuilt,
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

console.log(`# Outpost headless simulation  (shaft ${W}x${H}, maxTicks=${maxTicks})`);
for (const strategy of [
  'mining-first',
  'combat-first',
  'balanced',
  'bridge-reliant',
  'balanced-no-outpost',
] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDepth=${avg((r) => r.maxDepth)} avgKills=${avg((r) => r.kills)} avgOreMined=${avg((r) => r.oreMined)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgTrips=${avg((r) => r.tripsToSurface)} avgMilestones=${avg((r) => r.milestonesReached)} avgSkillUses=${avg((r) => r.skillUses)} avgDashUses=${avg((r) => r.dashUses)} avgBridges=${avg((r) => r.bridgesBuilt)} avgBarricades=${avg((r) => r.barricadesBuilt)} avgPropsDestroyed=${avg((r) => r.propsDestroyedByEnemy)} avgOutposts=${avg((r) => r.outpostsBuilt)} deaths=${results.filter((r) => r.over).length}/${results.length}`,
  );
}
