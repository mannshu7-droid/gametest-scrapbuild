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
 * - 015新規: 拠点防衛への恒久投資(basedefense)を両戦略の購入優先度リストへ追加。014-finalが
 *   発見したバグ#4（極端な長時間プレイでhomeDestroyedが再発しうる境界事象）が、投資システムの
 *   追加によって想定セッション時間の3倍（maxTicks=60000）でも解消されているかを検証する
 * - 016新規: 拠点防衛タレット(turret、プレイヤーが拠点圏内に実際に配置する新規建築)を両戦略に
 *   追加。basedefense（恒久ステータス投資・全拠点一括）と競合する「配置による防衛投資」が、
 *   資金配分の悩ましさ（真っ先に建てられすぎないか・死蔵しないか）と、拠点防衛力の底上げ
 *   （homeDestroyed・baseDamageTakenの改善）の両方に効いているかを検証する
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

/** プレイヤーが現在いる拠点とその保護半径（v3 FIX: 意図的なタレット配置レーン計算に使う） */
function currentBaseInfo(s: GameState): { x: number; radius: number } | null {
  for (const b of s.bases) {
    const r = b.isHome ? s.map.homeRadius : s.map.outpostRadius;
    if (Math.abs(s.player.x - b.x) <= r) return { x: b.x, radius: r };
  }
  return null;
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

const FORECAST_SEVERITY: Record<string, number> = { safe: 0, caution: 1, danger: 2 };
/**
 * 今夜の予告(baseForecasts)が最悪の拠点を返す（014新規）。同severityなら現在地から近い方を優先する。
 * 014のコアファン仮説「予告を見て、今夜の防衛に備えて動くか」をボットで検証するための判断材料
 */
function pickWorstForecastBase(s: GameState): { x: number; isHome: boolean; level: string } | null {
  let best: { x: number; isHome: boolean; level: string } | null = null;
  let bestScore = -Infinity;
  for (const f of s.baseForecasts) {
    const dist = Math.abs(s.player.x - f.x);
    const score = FORECAST_SEVERITY[f.level] * 100000 - dist;
    if (score > bestScore) {
      bestScore = score;
      best = f;
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

// p01/p02は擬似実プレイ（personas/p01-yabou.md, p02-aki.md）用のペルソナ再現戦略（014 v3 FIX）。
// v1/v2レビューではレビュー実施ごとに一時スクリプトへ手で再構築し、レビュー後に削除していたが、
// v2レビューのLearnings「一時検証スクリプトを削除する運用は再現性の観点でトレードオフがある」
// （v1のP01(seed301)とv2のP01(seed301)で夜フェーズ到達の有無が食い違った）を受け、恒久的な
// CLIオプションとしてこのファイルに統合し、以後のレビューは`--strategies p01,p02`で
// 同一パラメータのボットを毎回確実に再現できるようにした。デフォルトの戦略一覧
// （cautious/pusher）は10シード比較の既存ベースラインを崩さないよう変更していない
type Strategy = 'cautious' | 'pusher' | 'p01' | 'p02';
const ALL_STRATEGIES: Strategy[] = ['cautious', 'pusher', 'p01', 'p02'];
const DRIFT_CAP = 80;
// v3 FIX バグ#5: HP危険域判定が戦略に関わらず固定25%だった(擬似実プレイ用ペルソナ設定では
// P01=15%・P02=45%と差別化されているのに、10シード比較用のcautious/pusherは無差別だった)。
// 戦略名の意味どおりcautiousをpusherより早めに退避させる。値は10シード比較で検証済み:
// cautious 0.25→0.30はhomeDestroyed 8/10→7/10・avgBaseDamageTaken 459→425と改善したが、
// 0.35/0.40はいずれも10/10へ悪化する非単調な挙動を確認したため、この場しのぎの微調整に留める
// （深追いはせず、根本対策はLearningsへ持ち越す）。p01/p02はv1/v2レビュー記載の値
// （P01=交戦距離6・撤退HP閾値15%、P02=交戦距離2・撤退HP閾値45%）をそのまま踏襲する
const HP_RETREAT_THRESHOLD: Record<Strategy, number> = { cautious: 0.3, pusher: 0.25, p01: 0.15, p02: 0.45 };
/** 交戦域（隣接超の敵をどこまで追って戦うか）。cautious/pusherは従来のswitch式を維持し、p01/p02はレビュー記載値を使う */
const ENGAGE_RANGE: Record<Strategy, number> = { cautious: 2, pusher: 5, p01: 6, p02: 2 };
/** 前線拠点の建設余力（購入コストの何倍の所持金があれば建てるか） */
const OUTPOST_BUDGET_MULT: Record<Strategy, number> = { cautious: 1.6, pusher: 1.2, p01: 1.2, p02: 1.6 };
// 016新規: 拠点防衛タレットの設置余力。防衛志向のcautious/p02（あき型・慎重寄り）は低めの
// マージンで早めに投資し、攻勢志向のpusher/p01（野望型・効率重視）は高めのマージンで
// ドリル・攻撃力等の前進投資を優先してから余剰資金で投資する非対称な優先度を設定する
const TURRET_BUDGET_MULT: Record<Strategy, number> = { cautious: 1.3, pusher: 1.8, p01: 1.8, p02: 1.3 };

function clampLane(y: number): number {
  return Math.max(0, Math.min(LANE_COUNT - 1, y));
}
/** 現在地からタレットを設置できる空きFLOORタイルを4方向から探す（016新規）。
 * DIRS=[left,right,up,down]の順で探すため、左右（現在のレーンを維持）を優先する副作用がある。 */
function pickTurretDir(s: GameState): Dir | null {
  for (const dir of DIRS) {
    const [dx, dy] = DELTA[dir];
    const nx = dir === 'left' || dir === 'right' ? Math.max(0, Math.min(FIELD_WIDTH, s.player.x + dx)) : s.player.x;
    const ny = dir === 'up' || dir === 'down' ? clampLane(s.player.y + dy) : s.player.y;
    if (tileAt(s, nx, ny) !== TILE.FLOOR) continue;
    if (s.barricades.some((b) => b.x === nx && b.y === ny)) continue;
    if (s.turrets.some((t) => t.x === nx && t.y === ny)) continue;
    return dir;
  }
  return null;
}

/**
 * v3 FIX（v2レビュー観察事項#3への対応）: この拠点に既に設置済みのタレットのレーン(y)から
 * 最も離れたレーンを返す（farthest-point方式でレーンを分散させる）。TURRET_RANGE=1・LANE_COUNT=5
 * の下では、既存レーンが無ければ中央(y=2)、その後は{0,2,4}の順に選ばれ3基で全5レーンをカバーできる。
 * 「意図的に空間トレードオフを解決しようとする」防衛志向ボット(cautious/p02)専用に使う
 */
function pickDefensiveTurretLane(s: GameState, base: { x: number; radius: number }): number {
  const existing = s.turrets.filter((t) => Math.abs(t.x - base.x) <= base.radius).map((t) => t.y);
  if (existing.length === 0) return Math.floor(LANE_COUNT / 2);
  let bestY = 0;
  let bestMinDist = -1;
  for (let y = 0; y < LANE_COUNT; y++) {
    const minDist = Math.min(...existing.map((ey) => Math.abs(ey - y)));
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      bestY = y;
    }
  }
  return bestY;
}

/** 意図的なレーン配置を行う防衛志向ボットの戦略か（v3 FIX） */
function usesDeliberateTurretPlacement(strategy: Strategy): boolean {
  return strategy === 'cautious' || strategy === 'p02';
}

function mineDirs(s: GameState, strategy: Strategy): Dir[] {
  if (strategy === 'pusher' || strategy === 'p01') return ['right', 'up', 'down', 'left'];
  return s.player.x < DRIFT_CAP ? ['right', 'up', 'down', 'left'] : ['up', 'down', 'left'];
}

// 015新規: 'basedefense'（拠点防衛投資、全拠点の自動迎撃ダメージを恒久強化）を両優先度リストへ
// 組み込む。014-finalが発見したバグ#4（21夜以降、際限なく強くなるレイダーに固定値の自動迎撃が
// スケールせずhomeDestroyedが再発しうる）への対応として実装したため、「他の強化を差し置いてでも
// 最優先で買う」のではなく既存の10項目と同格の選択肢として競合させ、ボットが実際に資金配分で
// 悩む（＝P01のA1経済軸が機能する）かを検証する
const PUSHER_PRIORITY: ShopItemId[] = ['drill', 'fuel', 'offense', 'vitality', 'basedefense', 'capacity', 'digspeed', 'mobility', 'hazardresist', 'lantern', 'teleport'];
const CAUTIOUS_PRIORITY: ShopItemId[] = ['vitality', 'fuel', 'hazardresist', 'basedefense', 'capacity', 'offense', 'drill', 'digspeed', 'lantern', 'mobility', 'teleport'];
/** p01（野望型・積み上げ効率マニア）: 効率投資を好みpusherと同傾向のためPUSHER_PRIORITYを流用 */
/** p02（あき型）: 慎重寄りでcautiousと同傾向のためCAUTIOUS_PRIORITYを流用 */
function shopPriorityFor(strategy: Strategy): ShopItemId[] {
  return strategy === 'pusher' || strategy === 'p01' ? PUSHER_PRIORITY : CAUTIOUS_PRIORITY;
}

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
      // 016新規: 拠点防衛タレットの設置。この拠点の設置数がまだ上限未満で、資金に戦略ごとの
      // 予備マージン(TURRET_BUDGET_MULT)を超える余裕があれば設置する。basedefense（既存ショップの
      // 恒久ステータス投資）と同格の選択肢として競合させ、「配置による防衛投資」が実際に
      // 資金配分の悩ましさを生むか（=真っ先に建てられすぎて他の強化が犠牲にならないか、
      // 逆に死蔵しないか）を検証する
      if (s.player.turretsAtCurrentBase < s.player.maxTurretsPerBase) {
        const budgetMult = TURRET_BUDGET_MULT[this.strategy];
        if (s.player.money >= s.player.buildCosts.turret * budgetMult) {
          // v3 FIX（v2観察事項#3）: cautious/p02は「意図的に空いているレーンを埋める」判断をする。
          // まだ狙いのレーンにいなければ先にそちらへ移動してから設置し、pusher/p01は従来通り
          // その場で空いている方向に機械的に設置する（意図的配置 vs 機械的配置の対比を作る）
          if (usesDeliberateTurretPlacement(this.strategy)) {
            const base = currentBaseInfo(s);
            if (base) {
              const targetY = pickDefensiveTurretLane(s, base);
              if (s.player.y !== targetY) {
                const moveDir: Dir = s.player.y < targetY ? 'down' : 'up';
                if (canAdvance(s, moveDir)) return { type: 'move', dir: moveDir };
              }
            }
          }
          const dir = pickTurretDir(s);
          if (dir) return { type: 'build', target: 'turret', dir };
        }
      }
      const priority = shopPriorityFor(this.strategy);
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

    // 014新規: 夜が近づいたら(nightWarning)、今夜の脅威予告(baseForecasts)が最悪の拠点へ
    // 予防的に向かい、既に拠点圏内なら余裕資金でバリケードを増設する。「予告を見て実際に
    // 防衛の準備行動を変えるか」というコアファン仮説をボットで検証する
    if (s.phase === 'day' && s.nightWarning) {
      if (nearest && nearest.dist <= 1) return { type: 'attack' };
      const worst = pickWorstForecastBase(s);
      if (worst && worst.level !== 'safe') {
        const r = worst.isHome ? s.map.homeRadius : s.map.outpostRadius;
        const dist = Math.abs(p.x - worst.x);
        if (dist > r) {
          const dir = bfsToTargetX(s, worst.x);
          if (dir) return { type: 'move', dir };
          if (p.teleportUnlocked && p.fuel >= 25 && worst.isHome) return { type: 'teleport' };
        } else if (s.player.money >= s.player.buildCosts.barricade * 2) {
          return { type: 'build', target: 'barricade', dir: 'right' };
        }
      }
    }

    // 前線拠点の建設（保護範囲を恒久的に広げる、008パターン#7）
    const outpostBudget = OUTPOST_BUDGET_MULT[this.strategy];
    if (p.canBuildOutpost && p.money >= p.buildCosts.outpost * outpostBudget) {
      return { type: 'build', target: 'outpost' };
    }

    // 戦闘: 隣接なら応戦、近ければ交戦域(戦略で射程が違う)
    if (nearest) {
      if (nearest.dist <= 1) return { type: 'attack' };
      const engageRange = ENGAGE_RANGE[this.strategy];
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
  turretsBuilt: number;
  turretsLost: number;
  turretKills: number;
  hazardHits: number;
  hazardDamage: number;
  fuelEmptyTicks: number;
  combatRiskEscalations: number;
  miningRiskEscalations: number;
  raidRiskEscalations: number;
  forecastRiskEscalations: number;
  stuckIncomeEarned: number;
  nightsSurvived: number;
  outpostsLost: number;
  raidersKilled: number;
  baseDamageTaken: number;
  /** 015新規: 最終時点のbasedefenseショップレベル(0〜15) */
  basedefenseLv: number;
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
    turretsBuilt: s.metrics.turretsBuilt,
    turretsLost: s.metrics.turretsLost,
    turretKills: s.metrics.turretKills,
    hazardHits: s.metrics.hazardHits,
    hazardDamage: s.metrics.hazardDamage,
    fuelEmptyTicks: s.metrics.fuelEmptyTicks,
    combatRiskEscalations: s.metrics.combatRiskEscalations,
    miningRiskEscalations: s.metrics.miningRiskEscalations,
    raidRiskEscalations: s.metrics.raidRiskEscalations,
    forecastRiskEscalations: s.metrics.forecastRiskEscalations,
    stuckIncomeEarned: s.metrics.stuckIncomeEarned,
    nightsSurvived: s.metrics.nightsSurvived,
    outpostsLost: s.metrics.outpostsLost,
    raidersKilled: s.metrics.raidersKilled,
    baseDamageTaken: s.metrics.baseDamageTaken,
    basedefenseLv: s.shop.find((it) => it.id === 'basedefense')?.level ?? 0,
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
// --strategies p01,p02 のように指定すると、擬似実プレイのペルソナ再現ボットを直接
// ヘッドライン実行できる（デフォルトはこれまで通りcautious/pusherの2種のみ）
const strategiesArg = argVal('strategies');
const strategies: Strategy[] = strategiesArg
  ? (strategiesArg.split(',') as Strategy[]).filter((s) => ALL_STRATEGIES.includes(s))
  : ['cautious', 'pusher'];

console.log(`# Emplacement headless simulation (field ${FIELD_WIDTH}x${LANE_COUNT}, maxTicks=${maxTicks})`);
for (const strategy of strategies) {
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
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDistance=${avg((r) => r.maxDistance)} avgOreMined=${avg((r) => r.oreMined)} avgKills=${avg((r) => r.kills)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgOutposts=${avg((r) => r.outpostsBuilt)} avgBarricadesBuilt=${avg((r) => r.barricadesBuilt)} avgTurretsBuilt=${avg((r) => r.turretsBuilt)} avgTurretsLost=${avg((r) => r.turretsLost)} avgTurretKills=${avg((r) => r.turretKills)} avgTrips=${avg((r) => r.tripsToHome)} avgNightsSurvived=${avg((r) => r.nightsSurvived)} avgOutpostsLost=${avg((r) => r.outpostsLost)} avgRaidersKilled=${avg((r) => r.raidersKilled)} avgBaseDamageTaken=${avg((r) => r.baseDamageTaken)} avgBasedefenseLv=${avg((r) => r.basedefenseLv)} avgCombatRiskEsc=${avg((r) => r.combatRiskEscalations)} avgMiningRiskEsc=${avg((r) => r.miningRiskEscalations)} avgRaidRiskEsc=${avg((r) => r.raidRiskEscalations)} avgForecastRiskEsc=${avg((r) => r.forecastRiskEscalations)} deaths=${results.filter((r) => r.over && !r.won).length}/${results.length}(hp:${hpDeaths}/home:${homeDeaths}) wins=${results.filter((r) => r.won).length}/${results.length}`,
  );
}
