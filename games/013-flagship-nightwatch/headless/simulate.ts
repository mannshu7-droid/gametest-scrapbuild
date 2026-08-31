/**
 * ヘッドレスシミュレーション: 2種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * 012(戦闘×採掘×建築の統合)の検証手法を、昼夜サイクル/波状の拠点防衛圧力を追加した013へ拡張した版。
 * - cautious: ホームに近い範囲に留まりがちで、戦闘は自衛（隣接のみ応戦）に徹し、耐久・危険耐性を
 *   優先投資する。「無理に前進・交戦しなくても詰まないか」の最低ライン検出用
 * - pusher: 常に進行距離(x)の更新と敵撃破を優先し、ドリル威力・攻撃力を優先購入してさらに先を
 *   目指す。「掘り進めるほど敵が増える」というコアファン仮説が積極プレイでどう機能するかを見る
 * - 両戦略とも、夜フェーズは共通のロジックで「脅かされている拠点があれば最優先、なければ最寄りの
 *   拠点へ予防的に帰還する」動きをする（013固有の追加。どの拠点を見捨てるかの判断が発生するかを見る）
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

/** 既に掘った道(FLOOR)だけを通って指定x座標へ最短で戻る次の一手（012のbfsToHomeをtargetX汎用化） */
function bfsToTargetX(s: GameState, targetX: number): Dir | null {
  const p = s.player;
  if (p.x === targetX) return null;
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
    if (nx === targetX) return d;
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
      if (nx === targetX) return cur.root;
      visited[nx * LANE_COUNT + ny] = 1;
      queue.push({ x: nx, y: ny, root: cur.root });
    }
  }
  return null;
}

/** 現在夜フェーズで、プレイヤーがまだどの拠点圏内にもいないかどうか */
function inBaseRadius(s: GameState): boolean {
  for (const b of s.bases) {
    const r = b.isHome ? s.map.homeRadius : s.map.outpostRadius;
    if (Math.abs(s.player.x - b.x) <= r) return true;
  }
  return false;
}

/**
 * 夜フェーズの帰還先を決める: 既にレイダーに攻撃されている拠点があれば最優先（複数あれば近い方）、
 * なければ最寄りの拠点へ予防的に帰還する。013固有ロジック（どの拠点を見捨てるかの判断が生まれるか）
 */
function pickDefenseTarget(s: GameState): { x: number } {
  let best = s.bases[0];
  let bestScore = -Infinity;
  for (const b of s.bases) {
    const r = b.isHome ? s.map.homeRadius : s.map.outpostRadius;
    const threatened = s.enemies.some((e) => e.isRaider && Math.abs(e.x - b.x) <= r);
    const dist = Math.abs(s.player.x - b.x);
    const score = (threatened ? 100000 : 0) - dist;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
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
/** dir方向が実際に前進可能か（既にFLOOR、またはドリル威力で掘削可能）。
 * v2 FIX: 敵を追う移動がこれを確認せず、ドリル威力不足で掘れない壁の前で敵と睨み合ったまま
 * 何もできずに停滞するケースを検証中に発見（band境界ではband2以降、drillLv0だと全タイル種が
 * 掘削不可になる）。移動先が前進できない時は「敵を追う」を諦め採掘ロジックへフォールバックする */
function canAdvance(s: GameState, dir: Dir): boolean {
  const [dx, dy] = DELTA[dir];
  const nx = s.player.x + dx;
  const ny = s.player.y + dy;
  const t = tileAt(s, nx, ny);
  if (t === TILE.FLOOR) return true;
  return canDig(s, nx, ny);
}

type Strategy = 'cautious' | 'pusher';
const DRIFT_CAP = 80;
// v3 FIX バグ#5: HP危険域判定が戦略に関わらず固定25%だった(擬似実プレイ用ペルソナ設定では
// P01=15%・P02=45%と差別化されているのに、10シード比較用のcautious/pusherは無差別だった)。
// 戦略名の意味どおりcautiousをpusherより早めに退避させる。値は10シード比較で検証済み:
// cautious 0.25→0.30はhomeDestroyed 8/10→7/10・avgBaseDamageTaken 459→425と改善したが、
// 0.35/0.40はいずれも10/10へ悪化する非単調な挙動を確認したため、この場しのぎの微調整に留める
// （深追いはせず、根本対策はLearningsへ持ち越す）
const HP_RETREAT_THRESHOLD: Record<Strategy, number> = { cautious: 0.3, pusher: 0.25 };

function mineDirs(s: GameState, strategy: Strategy): Dir[] {
  if (strategy === 'pusher') return ['right', 'up', 'down', 'left'];
  return s.player.x < DRIFT_CAP ? ['right', 'up', 'down', 'left'] : ['up', 'down', 'left'];
}

const PUSHER_PRIORITY: ShopItemId[] = ['drill', 'fuel', 'offense', 'vitality', 'capacity', 'digspeed', 'mobility', 'hazardresist', 'lantern', 'teleport'];
const CAUTIOUS_PRIORITY: ShopItemId[] = ['vitality', 'fuel', 'hazardresist', 'capacity', 'offense', 'drill', 'digspeed', 'lantern', 'mobility', 'teleport'];

class Bot {
  constructor(private strategy: Strategy) {}

  decide(s: GameState): Action {
    const p = s.player;
    const nearest = nearestEnemy(s);

    if (inBaseRadius(s)) {
      if (s.phase === 'night' && nearest) {
        // 夜間・拠点内: 侵入したレイダーがいれば、購入より迎撃を優先する（v2 FIX バグ#2）。
        // v1では拠点内でショップ購入が常に迎撃より優先され、隣接脅威があっても素通りしていた
        if (nearest.dist <= 1) return { type: 'attack' };
        if (nearest.dist <= 3) {
          const dir = stepToward(s, nearest.enemy.x, nearest.enemy.y);
          if (canAdvance(s, dir)) return { type: 'move', dir };
        }
        // v2 FIX バグ#3: cautiousの交戦距離(2)では従来の「dist>=3でバリケード」判定に
        // 到達できず、cautiousは一度もバリケードを建てられなかった。拠点圏内は交戦距離の
        // 制約を外し、脅威が見えている限りバリケードで迎撃を補助できるようにする
        if (nearest.dist >= 2 && s.player.money >= s.player.buildCosts.barricade * 2) {
          const dir = stepToward(s, nearest.enemy.x, nearest.enemy.y);
          return { type: 'build', target: 'barricade', dir };
        }
      }
      const priority = this.strategy === 'pusher' ? PUSHER_PRIORITY : CAUTIOUS_PRIORITY;
      for (const id of priority) {
        const price = s.player.shopPrices[id];
        if (price !== null && s.player.money >= price) return { type: 'buy', item: id };
      }
      if (s.phase === 'night') return { type: 'wait' };
      return { type: 'move', dir: 'right' };
    }

    if (s.phase === 'night') {
      // 夜間・拠点圏外: レイダーが隣接していれば応戦、それ以外は脅かされている拠点を最優先に
      // 帰還する（013固有。どの拠点を見捨てるかの判断がここで発生する）
      if (nearest && nearest.dist <= 1) return { type: 'attack' };
      const target = pickDefenseTarget(s);
      const dir = bfsToTargetX(s, target.x);
      if (dir) return { type: 'move', dir };
      if (p.teleportUnlocked && p.fuel >= 25) return { type: 'teleport' };
      return { type: 'wait' };
    }

    // 緊急退避: 燃料危険域 / HP危険 / 積載満杯
    const criticalFuel = p.miningRiskLevel === 'danger';
    const criticalHp = p.hp < p.maxHp * HP_RETREAT_THRESHOLD[this.strategy];
    const cargoFull = p.cargoUnits >= p.maxCapacity;
    if (criticalFuel || criticalHp || cargoFull) {
      if (nearest && nearest.dist <= 1 && !criticalHp) return { type: 'attack' };
      const dir = bfsToTargetX(s, 0);
      if (dir) {
        // HP危険時はダッシュで一気に距離を稼いで離脱する（無敵時間もあり安全）
        if (criticalHp && p.dashCd === 0) return { type: 'dash', dir };
        return { type: 'move', dir };
      }
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
        const towardDir = stepToward(s, nearest.enemy.x, nearest.enemy.y);
        // archer等の遠距離敵が距離を維持して撃ち続けてくる場合、通常移動では追いつけないので
        // ダッシュで一気に間合いを詰める（v2 FIX: dashを検証botのレパートリーに追加）
        if (nearest.enemy.range > 1 && nearest.dist >= 2 && nearest.dist <= p.dashRange && p.dashCd === 0) {
          return { type: 'dash', dir: towardDir };
        }
        // 追ってくる敵が中距離なら、割安ならバリケードで足止め（射線も塞げるため遠距離敵にも有効）
        if (nearest.dist >= 3 && p.money >= p.buildCosts.barricade * 3) {
          return { type: 'build', target: 'barricade', dir: towardDir };
        }
        // 追う方向が実際に前進可能な時だけ追う。掘削不可の壁越しなら採掘ロジックへフォールバック
        if (canAdvance(s, towardDir)) return { type: 'move', dir: towardDir };
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

    // 全方向掘削不可（ドリル威力不足） → 強化を買いに拠点へ戻る（v2 FIX: 以前はcautiousのみ
    // その場で待ち続けていたが、band境界のドリル要求ゲートで待機し続けても状況が変わらず
    // 詰みうるため、cautiousも同様に帰還してdrill等を購入できるようにした）
    {
      const dir = bfsToTargetX(s, 0);
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
  raidRiskEscalations: number;
  stuckIncomeEarned: number;
  nightsSurvived: number;
  outpostsLost: number;
  raidersKilled: number;
  baseDamageTaken: number;
  loseReason: 'playerHp' | 'homeDestroyed' | null;
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
    raidRiskEscalations: s.metrics.raidRiskEscalations,
    stuckIncomeEarned: s.metrics.stuckIncomeEarned,
    nightsSurvived: s.metrics.nightsSurvived,
    outpostsLost: s.metrics.outpostsLost,
    raidersKilled: s.metrics.raidersKilled,
    baseDamageTaken: s.metrics.baseDamageTaken,
    loseReason: s.loseReason,
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

console.log(`# Nightwatch headless simulation (field ${FIELD_WIDTH}x${LANE_COUNT}, maxTicks=${maxTicks})`);
for (const strategy of ['cautious', 'pusher'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  const homeDeaths = results.filter((r) => r.loseReason === 'homeDestroyed').length;
  const hpDeaths = results.filter((r) => r.loseReason === 'playerHp').length;
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDistance=${avg((r) => r.maxDistance)} avgOreMined=${avg((r) => r.oreMined)} avgKills=${avg((r) => r.kills)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgOutposts=${avg((r) => r.outpostsBuilt)} avgBarricadesBuilt=${avg((r) => r.barricadesBuilt)} avgTrips=${avg((r) => r.tripsToHome)} avgNightsSurvived=${avg((r) => r.nightsSurvived)} avgOutpostsLost=${avg((r) => r.outpostsLost)} avgRaidersKilled=${avg((r) => r.raidersKilled)} avgBaseDamageTaken=${avg((r) => r.baseDamageTaken)} deaths=${results.filter((r) => r.over && !r.won).length}/${results.length}(hp:${hpDeaths}/home:${homeDeaths}) wins=${results.filter((r) => r.won).length}/${results.length}`,
  );
}
