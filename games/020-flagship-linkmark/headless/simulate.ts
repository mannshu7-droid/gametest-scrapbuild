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
 * - 018新規: 017-mining-forkshaftの「非対称の情報公開（探査ドリルscanner投資で未到達バンドの
 *   実体が見えるようになる。危険度のみLv0でも1バンド先まで常に見える）」「共鳴チャージ（chargeを
 *   満タンにして次の採掘で同x座標の他レーンを巻き込み採掘）」をmining側に統合した。
 *   cautious/pusher/p01/p02の優先度リストにもscanner/chargeを組み込んだ上で、コアファン仮説
 *   「情報公開への投資（探査・チャージ）が経済成長の差として効くか」を専用に検証するため、
 *   scanner/chargeを一切買わずフォグの外へ機械的に突っ込み続ける'blind'と、
 *   他の何よりも先にscanner/chargeへ投資してから前進する'planner'の2戦略を新設した
 * - 020新規: 019-building-hallmarkの建築パターン（非対称の建材品質公開＝鑑定投資、隣接連携共鳴）を
 *   バリケード・タレットへ統合した。コアファン仮説「勘で建てるか鑑定で見極めるか」「隣接配置で
 *   連携させると単体設置より強い」を検証するため、タレットの配置様式と鑑定利用の有無だけを
 *   変えた3戦略を新設した（他の挙動はpusherと同一）:
 *   scatter=タレットをレーン分散（隣接させない＝連携なし）・鑑定なし、
 *   linker=タレットを隣接クラスタで配置（連携あり）・鑑定なし、
 *   smith=linker＋鑑定投資＋ロット選別（高品質ロットをタレットへ、低品質ロットをバリケードへ）
 * - 020 v2新規: タレットの攻撃ダメージ強化を「隣接バリケードのある盾持ち状態」へ変更したため、クラスタ配置
 *   戦略（linker/smith/wall/mason）は盾（バリケード）の建て足しを維持行動として行う。'ranger'は
 *   cautious同様の分散配置＋盾の建て足しで、クラスタ配置が支配的最適解かを公平に比較するための戦略
 */
import { Game, FIELD_WIDTH, LANE_COUNT, LENGTH, BAND_SIZE, bandAt, requiredDrillPower } from '../src/core/game';
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

/**
 * v2 FIX（v1バグ#2）: フォグ越しのUNSCANNEDタイルは実タイル種が分からないため、`requiredDrillPower`に
 * そのまま渡すとTIER未定義でtier0扱いになり実際より要求ドリル威力を低く見積もっていた。
 * 「未知＝最悪ケース（最も硬いORE_GOLD、tier3）を仮定する」判定に変更し、scanner投資で実タイルが
 * 見えている場合とそうでない場合の差（=情報投資の価値）を正しく反映する
 */
function canDig(s: GameState, x: number, y: number): boolean {
  const t = tileAt(s, x, y);
  if (t === null || t === TILE.FLOOR) return false;
  const band = Math.max(0, bandAt(x));
  const worstCase = t === TILE.UNSCANNED;
  const req = requiredDrillPower(worstCase ? TILE.ORE_GOLD : (t as TileId), band);
  return s.player.drillPower >= req;
}
function isHazard(t: number | null): boolean {
  return t === TILE.GAS || t === TILE.UNSTABLE;
}
function isOre(t: number | null): boolean {
  return t === TILE.ORE_COPPER || t === TILE.ORE_IRON || t === TILE.ORE_GOLD;
}
/**
 * v2新規: scannerで見えているバンドの中で最も鉱石密度が高いレーンを返す（見えていなければnull）。
 * v1のヘッドレスbotは探査で得た情報を一切使わず機械的に前進するだけだったため、'planner'が
 * scanner/charge投資を実際に活かして意図的にレーンを選べるようにする（v1レビューLearnings#4）
 */
function pickRichestRevealedLane(s: GameState, band: number): number | null {
  const startX = band * BAND_SIZE + 1;
  const endX = Math.min(FIELD_WIDTH, startX + BAND_SIZE - 1);
  const counts = new Array<number>(LANE_COUNT).fill(0);
  let revealedAny = false;
  for (let x = startX; x <= endX; x++) {
    for (let y = 0; y < LANE_COUNT; y++) {
      const t = tileAt(s, x, y);
      if (t === null || t === TILE.UNSCANNED) continue;
      revealedAny = true;
      if (isOre(t)) counts[y]++;
    }
  }
  if (!revealedAny) return null;
  let bestY = 0;
  let bestCount = -1;
  for (let y = 0; y < LANE_COUNT; y++) {
    if (counts[y] > bestCount) {
      bestCount = counts[y];
      bestY = y;
    }
  }
  return bestY;
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
type Strategy = 'cautious' | 'pusher' | 'p01' | 'p02' | 'planner' | 'blind' | 'scatter' | 'linker' | 'smith' | 'wall' | 'mason' | 'ranger' | 'p01n';
const ALL_STRATEGIES: Strategy[] = ['cautious', 'pusher', 'p01', 'p02', 'planner', 'blind', 'scatter', 'linker', 'smith', 'wall', 'mason', 'ranger', 'p01n'];
const DRIFT_CAP = 80;
// v3 FIX バグ#5: HP危険域判定が戦略に関わらず固定25%だった(擬似実プレイ用ペルソナ設定では
// P01=15%・P02=45%と差別化されているのに、10シード比較用のcautious/pusherは無差別だった)。
// 戦略名の意味どおりcautiousをpusherより早めに退避させる。値は10シード比較で検証済み:
// cautious 0.25→0.30はhomeDestroyed 8/10→7/10・avgBaseDamageTaken 459→425と改善したが、
// 0.35/0.40はいずれも10/10へ悪化する非単調な挙動を確認したため、この場しのぎの微調整に留める
// （深追いはせず、根本対策はLearningsへ持ち越す）。p01/p02はv1/v2レビュー記載の値
// （P01=交戦距離6・撤退HP閾値15%、P02=交戦距離2・撤退HP閾値45%）をそのまま踏襲する
// 018新規: planner/blindはどちらも攻勢志向（前進・撃破を優先）という点でpusher/p01と同傾向のため、
// HP撤退閾値・交戦域・前線拠点建設余力・タレット設置余力はいずれもpusherと同値を流用する。
// 両者の唯一の違いはショップ優先度（scanner/chargeを買うか否か）に絞り、情報公開投資の効果だけを
// 分離して比較できるようにする
/**
 * p01（野望型）の系列か。v2新規の'p01n'は「夜フェーズまで到達するP01」: p01は撤退HP15%の攻勢で20シード中19シードが
 * 夜フェーズ到達前（〜500tick）に前線で死亡し、建築パートの評価がほぼ空白になっていた（v1レビュー#4）。
 * p01nは交戦域6・鑑定/前進優先などP01の行動様式はそのまま、撤退HPだけ35%へ引き上げる（過去サイクルとの
 * 比較可能性を保つため既存のp01は変更しない）
 */
function isP01(strategy: Strategy): boolean {
  return strategy === 'p01' || strategy === 'p01n';
}
const HP_RETREAT_THRESHOLD: Record<Strategy, number> = { cautious: 0.3, pusher: 0.25, p01: 0.15, p02: 0.45, planner: 0.25, blind: 0.25, scatter: 0.25, linker: 0.25, smith: 0.25, wall: 0.3, mason: 0.3, ranger: 0.3, p01n: 0.35 };
/** 交戦域（隣接超の敵をどこまで追って戦うか）。cautious/pusherは従来のswitch式を維持し、p01/p02はレビュー記載値を使う */
const ENGAGE_RANGE: Record<Strategy, number> = { cautious: 2, pusher: 5, p01: 6, p02: 2, planner: 5, blind: 5, scatter: 5, linker: 5, smith: 5, wall: 2, mason: 2, ranger: 2, p01n: 6 };
/** 前線拠点の建設余力（購入コストの何倍の所持金があれば建てるか） */
const OUTPOST_BUDGET_MULT: Record<Strategy, number> = { cautious: 1.6, pusher: 1.2, p01: 1.2, p02: 1.6, planner: 1.2, blind: 1.2, scatter: 1.2, linker: 1.2, smith: 1.2, wall: 1.6, mason: 1.6, ranger: 1.6, p01n: 1.2 };
// 016新規: 拠点防衛タレットの設置余力。防衛志向のcautious/p02（あき型・慎重寄り）は低めの
// マージンで早めに投資し、攻勢志向のpusher/p01（野望型・効率重視）は高めのマージンで
// ドリル・攻撃力等の前進投資を優先してから余剰資金で投資する非対称な優先度を設定する
const TURRET_BUDGET_MULT: Record<Strategy, number> = { cautious: 1.3, pusher: 1.8, p01: 1.8, p02: 1.3, planner: 1.8, blind: 1.8, scatter: 1.8, linker: 1.8, smith: 1.8, wall: 1.3, mason: 1.3, ranger: 1.3, p01n: 1.8 };

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

/** 意図的なレーン配置を行う防衛志向ボットの戦略か（v3 FIX）。020新規: scatterも「隣接させず分散させる」意図的配置 */
function usesDeliberateTurretPlacement(strategy: Strategy): boolean {
  return strategy === 'cautious' || strategy === 'p02' || strategy === 'scatter' || strategy === 'ranger';
}
/** 020新規: タレットを既存obstacleと隣接する位置へクラスタ配置して連携を狙う戦略か */
function usesClusterTurretPlacement(strategy: Strategy): boolean {
  return strategy === 'linker' || strategy === 'smith' || strategy === 'wall' || strategy === 'mason';
}
/** 020新規: 鑑定(appraisal)に投資し、ロット品質を見て選別配置する戦略か。p01は仮説検証志向のため利用する */
function usesAppraisal(strategy: Strategy): boolean {
  return strategy === 'smith' || isP01(strategy) || strategy === 'mason';
}

/** v2新規: 盾（隣接バリケード）の建て足しを維持行動として行う戦略か。'ranger'は「分散配置＋盾」で、
 * クラスタ配置（壁を共有できる）との比較用（v1バグ#3: クラスタが支配的最適解か）に用いる */
function usesShieldMaintenance(strategy: Strategy): boolean {
  return usesClusterTurretPlacement(strategy) || strategy === 'ranger';
}

function occupied(s: GameState, x: number, y: number): boolean {
  return s.barricades.some((b) => b.x === x && b.y === y) || s.turrets.some((t) => t.x === x && t.y === y);
}

/**
 * 020新規: この拠点で次にタレットを建てる目標タイルを決める（クラスタ配置）。
 * 既存タレットが無ければ中央レーン、あれば既存タレットに隣接する空きFLOORタイルのうち
 * 「新たに射程(TURRET_RANGE=1)で覆えるレーン数」が最大のもの（同点は既存タレットに近いx）を選ぶ。
 * 隣接（チェビシェフ距離1）＝連携が成立し、かつレーンカバーも広がる位置を意図的に探す
 */
function pickClusterTurretTile(s: GameState, base: { x: number; radius: number }): { x: number; y: number } | null {
  const existing = s.turrets.filter((t) => Math.abs(t.x - base.x) <= base.radius);
  if (existing.length === 0) {
    const y = Math.floor(LANE_COUNT / 2);
    const x = Math.max(base.x - 0, 1);
    return tileAt(s, x, y) === TILE.FLOOR && !occupied(s, x, y) ? { x, y } : null;
  }
  const covered = new Set<number>();
  for (const t of existing) for (let y = Math.max(0, t.y - 1); y <= Math.min(LANE_COUNT - 1, t.y + 1); y++) covered.add(y);
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  for (const t of existing) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = t.x + dx;
        const y = t.y + dy;
        if (y < 0 || y >= LANE_COUNT || x < 0 || x >= LENGTH) continue;
        if (Math.abs(x - base.x) > base.radius) continue;
        if (tileAt(s, x, y) !== TILE.FLOOR || occupied(s, x, y)) continue;
        let gain = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(LANE_COUNT - 1, y + 1); yy++) if (!covered.has(yy)) gain++;
        const score = gain * 10 - Math.abs(dx);
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
  }
  return best;
}

/**
 * v2新規: 盾持ち（隣接にバリケード）でないタレットを1基選び、その隣接の空きFLOORタイルのうち
 * 他の盾なしタレットにも同時に隣接できる（1枚の壁で複数の盾になる）ものを優先して返す。
 * クラスタ配置戦略（linker/smith/wall/mason）は、夜に壊れたバリケードを昼に建て直す維持行動を取る
 */
function pickShieldTile(s: GameState, base: { x: number; radius: number }): { x: number; y: number } | null {
  const bare = s.turrets.filter((t) => Math.abs(t.x - base.x) <= base.radius && !t.shielded);
  if (bare.length === 0) return null;
  let best: { x: number; y: number } | null = null;
  let bestScore = -Infinity;
  for (const t of bare) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = t.x + dx;
        const y = t.y + dy;
        if (y < 0 || y >= LANE_COUNT || x < 0 || x >= LENGTH) continue;
        if (Math.abs(x - base.x) > base.radius) continue;
        if (tileAt(s, x, y) !== TILE.FLOOR || occupied(s, x, y)) continue;
        const covers = bare.filter((o) => chebyshev(o.x, o.y, x, y) <= 1).length;
        if (covers > bestScore) {
          bestScore = covers;
          best = { x, y };
        }
      }
    }
  }
  return best;
}

/** 目標タイルに4近傍で隣接して立てる位置から、目標へ向けるdirを返す（既にその位置なら建設方向、そうでなければ移動方向） */
function actionToBuildAt(s: GameState, target: { x: number; y: number }, build: (dir: Dir) => Action): Action | null {
  const p = s.player;
  for (const dir of DIRS) {
    const [dx, dy] = DELTA[dir];
    if (p.x + dx === target.x && p.y + dy === target.y) return build(dir);
  }
  // 立ち位置の候補（目標の4近傍のうちFLOORのもの）へ最短で移動する
  let bestStand: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const dir of DIRS) {
    const [dx, dy] = DELTA[dir];
    const sx = target.x - dx;
    const sy = target.y - dy;
    if (tileAt(s, sx, sy) !== TILE.FLOOR) continue;
    const d = Math.abs(sx - p.x) + Math.abs(sy - p.y);
    if (d < bestDist) {
      bestDist = d;
      bestStand = { x: sx, y: sy };
    }
  }
  if (!bestStand) return null;
  const moveDir = stepToward(s, bestStand.x, bestStand.y);
  if (canAdvance(s, moveDir)) return { type: 'move', dir: moveDir };
  return null;
}

/**
 * 020新規: 建材ロットの選別。鑑定Lv0（品質不明）では常にindex0（undefinedを返し、lotIndex省略）。
 * 鑑定Lv1以上では、タレットには見えている中で最高品質のロット、バリケードには最低品質のロットを
 * 明示指定して使う（良いロットは高価値のタレットへ温存し、悪いロットは品質が薄くしか効かない
 * バリケードで消化する。v2でバリケード側の効きを0.8〜1.2倍へ抑えたため悪ロット消化の損失は小さい）
 */
function pickLot(s: GameState, forTurret: boolean): number | undefined {
  if (s.player.appraisalLv < 1) return undefined;
  const lots = s.player.buildLots;
  let bestIdx = 0;
  for (let i = 1; i < lots.length; i++) {
    const cur = lots[i] as number;
    const best = lots[bestIdx] as number;
    if (forTurret ? cur > best : cur < best) bestIdx = i;
  }
  return bestIdx;
}
function barricadeAction(s: GameState, strategy: Strategy, dir: Dir): Action {
  const lotIndex = usesAppraisal(strategy) ? pickLot(s, false) : undefined;
  return lotIndex === undefined ? { type: 'build', target: 'barricade', dir } : { type: 'build', target: 'barricade', dir, lotIndex };
}
function turretAction(s: GameState, strategy: Strategy, dir: Dir): Action {
  const lotIndex = usesAppraisal(strategy) ? pickLot(s, true) : undefined;
  return lotIndex === undefined ? { type: 'build', target: 'turret', dir } : { type: 'build', target: 'turret', dir, lotIndex };
}

function mineDirs(s: GameState, strategy: Strategy): Dir[] {
  if (strategy === 'pusher' || isP01(strategy) || strategy === 'planner' || strategy === 'blind' || strategy === 'scatter' || strategy === 'linker' || strategy === 'smith') {
    return ['right', 'up', 'down', 'left'];
  }
  return s.player.x < DRIFT_CAP ? ['right', 'up', 'down', 'left'] : ['up', 'down', 'left'];
}

// 015新規: 'basedefense'（拠点防衛投資、全拠点の自動迎撃ダメージを恒久強化）を両優先度リストへ
// 組み込む。014-finalが発見したバグ#4（21夜以降、際限なく強くなるレイダーに固定値の自動迎撃が
// スケールせずhomeDestroyedが再発しうる）への対応として実装したため、「他の強化を差し置いてでも
// 最優先で買う」のではなく既存の10項目と同格の選択肢として競合させ、ボットが実際に資金配分で
// 悩む（＝P01のA1経済軸が機能する）かを検証する
// 018新規: scanner/charge（探査ドリル・共鳴チャージ）をpusher/cautiousの優先度リストへ組み込む。
// P01（仮説検証・数値開示を好むペルソナ、A5軸）に近いpusher系はdrillの直後という高優先度で、
// P02（慎重・世界の一貫性重視）に近いcautious系はhazardresistの後という中位優先度で投資する
const PUSHER_PRIORITY: ShopItemId[] = ['drill', 'scanner', 'charge', 'fuel', 'offense', 'vitality', 'basedefense', 'capacity', 'digspeed', 'mobility', 'hazardresist', 'lantern', 'teleport'];
const CAUTIOUS_PRIORITY: ShopItemId[] = ['vitality', 'fuel', 'hazardresist', 'scanner', 'basedefense', 'charge', 'capacity', 'offense', 'drill', 'digspeed', 'lantern', 'mobility', 'teleport'];
/** 018新規: 'planner'専用。他の何よりも先にscanner・chargeへ投資してから前進する
 * （「情報公開への投資が経済成長の差として効くか」の上限側サンプル） */
const PLANNER_PRIORITY: ShopItemId[] = ['scanner', 'charge', 'drill', 'fuel', 'vitality', 'offense', 'basedefense', 'capacity', 'digspeed', 'hazardresist', 'mobility', 'lantern', 'teleport'];
/** 018新規: 'blind'専用。scanner・chargeを一切買わずフォグの外へ機械的に突っ込み続ける
 * （「情報公開への投資が効くか」の下限側サンプル。中身はPUSHER_PRIORITYからscanner/chargeを除いたもの） */
const BLIND_PRIORITY: ShopItemId[] = ['drill', 'fuel', 'offense', 'vitality', 'basedefense', 'capacity', 'digspeed', 'mobility', 'hazardresist', 'lantern', 'teleport'];
/** 020新規: 'smith'/'p01'専用。PUSHER_PRIORITYにappraisal（鑑定）をscannerの直後に挿入したもの。
 * 鑑定は安価（Lv1=9）なため、drill/scannerの次に低コストで揃えてから他へ投資する */
const APPRAISER_PRIORITY: ShopItemId[] = ['drill', 'scanner', 'appraisal', 'charge', 'fuel', 'offense', 'vitality', 'basedefense', 'capacity', 'digspeed', 'mobility', 'hazardresist', 'lantern', 'teleport'];
/** 020新規: 'mason'専用。CAUTIOUS_PRIORITYにappraisalをscannerの直後に挿入したもの（wallとの差は鑑定の有無のみ） */
const CAUTIOUS_APPRAISER_PRIORITY: ShopItemId[] = ['vitality', 'fuel', 'hazardresist', 'scanner', 'appraisal', 'basedefense', 'charge', 'capacity', 'offense', 'drill', 'digspeed', 'lantern', 'mobility', 'teleport'];
/** p01（野望型・積み上げ効率マニア）: 効率投資を好みpusherと同傾向のためPUSHER_PRIORITYを流用（020ではAPPRAISER_PRIORITY） */
/** p02（あき型）: 慎重寄りでcautiousと同傾向のためCAUTIOUS_PRIORITYを流用 */
function shopPriorityFor(strategy: Strategy): ShopItemId[] {
  if (strategy === 'planner') return PLANNER_PRIORITY;
  if (strategy === 'blind') return BLIND_PRIORITY;
  if (strategy === 'smith' || isP01(strategy)) return APPRAISER_PRIORITY;
  if (strategy === 'mason') return CAUTIOUS_APPRAISER_PRIORITY;
  if (strategy === 'scatter' || strategy === 'linker') return PUSHER_PRIORITY;
  if (strategy === 'wall' || strategy === 'ranger') return CAUTIOUS_PRIORITY;
  return strategy === 'pusher' ? PUSHER_PRIORITY : CAUTIOUS_PRIORITY;
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
          return barricadeAction(s, this.strategy, dir);
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
          if (usesClusterTurretPlacement(this.strategy)) {
            const base = currentBaseInfo(s);
            if (base) {
              const target = pickClusterTurretTile(s, base);
              if (target) {
                const act = actionToBuildAt(s, target, (dir) => turretAction(s, this.strategy, dir));
                if (act) return act;
              }
            }
          }
          const dir = pickTurretDir(s);
          if (dir) return turretAction(s, this.strategy, dir);
        }
      }
      // v2新規: クラスタ配置戦略は、盾（隣接バリケード）のないタレットに壁を建て足す（昼に維持行動）
      if (usesShieldMaintenance(this.strategy) && s.player.money >= s.player.buildCosts.barricade * 3) {
        const base = currentBaseInfo(s);
        if (base) {
          const target = pickShieldTile(s, base);
          if (target) {
            const act = actionToBuildAt(s, target, (dir) => barricadeAction(s, this.strategy, dir));
            if (act) return act;
          }
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
          return barricadeAction(s, this.strategy, 'right');
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
          return barricadeAction(s, this.strategy, towardDir);
        }
        // 追う方向が実際に前進可能な時だけ追う。掘削不可の壁越しなら採掘ロジックへフォールバック
        if (canAdvance(s, towardDir)) return { type: 'move', dir: towardDir };
      }
    }

    // v2新規（v1レビューLearnings#4）: 'planner'はバンド境界が近く、探査ドリルで次バンドが
    // 見えている場合、最も鉱石密度が高いレーンへ意図的に寄ってから越境する。バンド途中では
    // 頻繁なレーン変更を避けるため境界の直前（残りx<=6）でのみ判断する
    // v3新規（v2レビューroutine-state課題#2）: p01にも同種のロジックを追加する。P01は夜フェーズ
    // 到達前に前線戦闘で決着する構造的傾向があり効果は限定的と見込まれるが、A5仮説検証・A1経済の
    // 評価精度を上げるため'planner'限定だった判断を'p01'にも広げる（cautious/pusher/blind/p02は
    // 戦略間比較の基準線を保つため無変更のまま据え置く）
    const scannerLv = s.shop.find((it) => it.id === 'scanner')?.level ?? 0;
    if ((this.strategy === 'planner' || isP01(this.strategy)) && scannerLv >= 1) {
      const band = Math.max(0, bandAt(p.x));
      const bandEndX = (band + 1) * BAND_SIZE;
      if (bandEndX - p.x <= 6 && bandEndX < FIELD_WIDTH) {
        const richY = pickRichestRevealedLane(s, band + 1);
        if (richY !== null && richY !== p.y) {
          const dir: Dir = richY > p.y ? 'down' : 'up';
          if (canAdvance(s, dir)) return { type: 'move', dir };
        }
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
  turretShots: number;
  turretShieldedShots: number;
  turretDamageDealt: number;
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
  /** 018新規: 共鳴掘削の発動回数・巻き込み採掘できた鉱石数、最終時点のscanner/chargeレベル */
  resonanceTriggers: number;
  resonanceBonusOre: number;
  scannerLv: number;
  chargeLv: number;
  /** 020新規: 建材品質・連携・鑑定関連（最終時点） */
  appraisalLv: number;
  obstaclesBuilt: number;
  avgQuality: number;
  avgTurretQuality: number;
  informedPlacements: number;
  linkedPlacements: number;
  linkSavedDamage: number;
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
    turretShots: s.metrics.turretShots,
    turretShieldedShots: s.metrics.turretShieldedShots,
    turretDamageDealt: Math.round(s.metrics.turretDamageDealt),
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
    resonanceTriggers: s.metrics.resonanceTriggers,
    resonanceBonusOre: s.metrics.resonanceBonusOre,
    scannerLv: s.shop.find((it) => it.id === 'scanner')?.level ?? 0,
    chargeLv: s.shop.find((it) => it.id === 'charge')?.level ?? 0,
    appraisalLv: s.shop.find((it) => it.id === 'appraisal')?.level ?? 0,
    obstaclesBuilt: s.metrics.obstaclesBuilt,
    avgQuality: s.metrics.obstaclesBuilt > 0 ? Math.round((s.metrics.qualitySumBuilt / s.metrics.obstaclesBuilt) * 1000) / 1000 : 0,
    avgTurretQuality: s.metrics.turretsBuilt > 0 ? Math.round((s.metrics.turretQualitySumBuilt / s.metrics.turretsBuilt) * 1000) / 1000 : 0,
    informedPlacements: s.metrics.informedPlacements,
    linkedPlacements: s.metrics.linkedPlacements,
    linkSavedDamage: Math.round(s.metrics.linkSavedDamage),
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

console.log(`# Linkmark headless simulation (field ${FIELD_WIDTH}x${LANE_COUNT}, maxTicks=${maxTicks})`);
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
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDistance=${avg((r) => r.maxDistance)} avgOreMined=${avg((r) => r.oreMined)} avgKills=${avg((r) => r.kills)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgOutposts=${avg((r) => r.outpostsBuilt)} avgBarricadesBuilt=${avg((r) => r.barricadesBuilt)} avgTurretsBuilt=${avg((r) => r.turretsBuilt)} avgTurretsLost=${avg((r) => r.turretsLost)} avgTurretKills=${avg((r) => r.turretKills)} avgTurretDmg=${avg((r) => r.turretDamageDealt)} shieldedShotRatio=${(results.reduce((a, r) => a + r.turretShieldedShots, 0) / Math.max(1, results.reduce((a, r) => a + r.turretShots, 0))).toFixed(3)} turretLossRate=${(results.reduce((a, r) => a + r.turretsLost, 0) / Math.max(1, results.reduce((a, r) => a + r.turretsBuilt, 0))).toFixed(3)} avgTrips=${avg((r) => r.tripsToHome)} avgNightsSurvived=${avg((r) => r.nightsSurvived)} avgOutpostsLost=${avg((r) => r.outpostsLost)} avgRaidersKilled=${avg((r) => r.raidersKilled)} avgBaseDamageTaken=${avg((r) => r.baseDamageTaken)} avgBasedefenseLv=${avg((r) => r.basedefenseLv)} avgScannerLv=${avg((r) => r.scannerLv)} avgChargeLv=${avg((r) => r.chargeLv)} avgResonanceTriggers=${avg((r) => r.resonanceTriggers)} avgResonanceBonusOre=${avg((r) => r.resonanceBonusOre)} avgAppraisalLv=${avg((r) => r.appraisalLv)} avgObstaclesBuilt=${avg((r) => r.obstaclesBuilt)} avgQuality=${(results.reduce((a, r) => a + r.avgQuality, 0) / results.length).toFixed(3)} avgTurretQuality=${(results.filter((r) => r.turretsBuilt > 0).reduce((a, r) => a + r.avgTurretQuality, 0) / Math.max(1, results.filter((r) => r.turretsBuilt > 0).length)).toFixed(3)} avgInformedPlacements=${avg((r) => r.informedPlacements)} avgLinkedPlacements=${avg((r) => r.linkedPlacements)} avgLinkSavedDamage=${avg((r) => r.linkSavedDamage)} avgBarricadesLost=${avg((r) => r.barricadesLost)} avgCombatRiskEsc=${avg((r) => r.combatRiskEscalations)} avgMiningRiskEsc=${avg((r) => r.miningRiskEscalations)} avgRaidRiskEsc=${avg((r) => r.raidRiskEscalations)} avgForecastRiskEsc=${avg((r) => r.forecastRiskEscalations)} deaths=${results.filter((r) => r.over && !r.won).length}/${results.length}(hp:${hpDeaths}/home:${homeDeaths}) wins=${results.filter((r) => r.won).length}/${results.length}`,
  );
}
