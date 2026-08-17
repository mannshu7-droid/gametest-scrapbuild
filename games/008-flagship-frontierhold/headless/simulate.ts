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
 *
 * サイクル11新規: 上記に加え、9種の「single-stat all-in」戦略（drill/capacity/fuel/atk/hp/atkspeed/
 * skill/muffler/engineering、それぞれ対象カテゴリのみに全額投資し他は一切買わない）を追加し、
 * どのアップグレードカテゴリが単独で生存率・到達深度にどれだけ寄与するかを定量的に切り分ける。
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

/**
 * サイクル10新規（cycle9-final指摘#1の調査で判明した副次課題への対応）: 既に掘った床
 * (FLOOR/PROP/OUTPOST)のネットワーク全体をBFSし、現在の採掘威力で掘り進められる最も近い
 * 「minY行以上の深さにある」未掘削タイルへの次の一手を返す。FORWARD_DIRS（down/right/left）は
 * 現在地の隣接1マスしか見ないため、既知の坑道網を辿れば掘削可能な行き止まりが別ルート上に
 * 存在していても発見できない（実測: seed302のP02がマップ右端(x=W-1)付近で完全停滞したケースで、
 * 直下は要求採掘威力6・drillPower4で掘削不能、右は地図外、左は迂回橋代不足という状況が続き、
 * FORWARDS_DIRSの単純な1マス判定だけでは永久に手詰まりになっていた）。
 * minYで深さ下限を絞るのは、既に掘った1マス幅の坑道は左右どちらかの壁に浅い場所の未掘削タイル
 * （岩・鉱石の欠片等）が高確率で隣接しており、それを無条件に「フロンティア」とみなすと
 * 実際にはmaxDepthより浅い場所へ逆走するだけで進捗にならない発見をした（実測でfrontierDirが
 * ほぼ毎回浅い側へのルートを返してしまい、本来必要な迂回橋の貯蓄判断まで到達できなかった）ため。
 * 固定戦略はこのケースで停滞が確認されていないため、既存の実測値（回帰確認済み）に影響しないよう
 * isAdaptive戦略限定で使う
 */
function bfsToFrontier(s: GameState, minY: number): Dir | null {
  const p = s.player;
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
    if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
    if (ny >= minY && canDig(s, nx, ny)) return d;
    const t = tileAt(s, nx, ny);
    if (!passable(t)) continue;
    visited[ny * w + nx] = 1;
    queue.push({ x: nx, y: ny, root: d });
  }
  while (head < queue.length) {
    const cur = queue[head++];
    for (const d of DIRS) {
      const [dx, dy] = DELTA[d];
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
      if (visited[ny * w + nx]) continue;
      if (ny >= minY && canDig(s, nx, ny)) return cur.root;
      const t = tileAt(s, nx, ny);
      if (!passable(t)) continue;
      visited[ny * w + nx] = 1;
      queue.push({ x: nx, y: ny, root: cur.root });
    }
  }
  return null;
}

type BaseStrategy =
  | 'mining-first'
  | 'combat-first'
  | 'balanced'
  | 'bridge-reliant'
  | 'balanced-no-outpost'
  // サイクル11新規（cycle10-final提案#1「ビルド差が結果に与える影響のさらなる検証」）:
  // 既存8戦略は「優先度リスト全体の傾向の違い」の比較にとどまり、個々のアップグレード
  // カテゴリが単独でどれだけ生存率・到達深度に寄与するかは切り分けられていなかった。
  // 各カテゴリだけに全力投資し他は一切買わない「single-stat all-in」戦略を全9カテゴリ分
  // 追加し、定量的に切り分ける
  | 'drill-all-in'
  | 'capacity-all-in'
  | 'fuel-all-in'
  | 'atk-all-in'
  | 'hp-all-in'
  | 'atkspeed-all-in'
  | 'skill-all-in'
  | 'muffler-all-in'
  | 'engineering-all-in';
// サイクル8新規（008final提案#1）: combatRiskLevelを読んで動的に優先度・帰還判断を調整する「適応型」戦略。
// 固定優先度戦略のバリアント名に`-adaptive`を付けて表現する（例: mining-first-adaptive）
type AdaptiveStrategy = 'mining-first-adaptive' | 'combat-first-adaptive' | 'balanced-adaptive';
type Strategy = BaseStrategy | AdaptiveStrategy;

function isAdaptive(strategy: Strategy): boolean {
  return strategy.endsWith('-adaptive');
}
function baseOf(strategy: Strategy): BaseStrategy {
  return (isAdaptive(strategy) ? strategy.slice(0, -'-adaptive'.length) : strategy) as BaseStrategy;
}

const MINING_FIRST: UpgradeId[] = ['drill', 'capacity', 'fuel', 'engineering', 'atk', 'hp', 'skill', 'atkspeed', 'muffler'];
const COMBAT_FIRST: UpgradeId[] = ['atk', 'hp', 'skill', 'atkspeed', 'engineering', 'drill', 'fuel', 'capacity', 'muffler'];
const BALANCED: UpgradeId[] = ['drill', 'atk', 'engineering', 'hp', 'capacity', 'skill', 'fuel', 'atkspeed', 'muffler'];
// 006由来の4戦略目: drillには一切投資せず、代わりに常に現金を「迂回橋を建てられるだけの余力」として
// 手元に残す。combat-firstは全財産をショップで使い切るため、壁に当たった瞬間に迂回橋を買う金が残らず
// 詰まったのと同じ状態になる（実測で確認済み）。この戦略は「drill投資を放棄しても、迂回橋の分だけ
// 常に現金を確保しておけば壁で詰まらない」という006の中核仮説を検証するための戦略
const BRIDGE_RELIANT: UpgradeId[] = ['atk', 'hp', 'skill', 'atkspeed', 'engineering', 'fuel', 'capacity', 'muffler'];
const BRIDGE_RELIANT_RESERVE = 30;

const ALL_IN_SUFFIX = '-all-in';
/** 'hp-all-in' → 'hp' のようにsingle-stat all-in戦略が対象とするUpgradeIdを取り出す。対象外の戦略はnull */
function singleStatOf(strategy: Strategy): UpgradeId | null {
  if (!strategy.endsWith(ALL_IN_SUFFIX)) return null;
  return strategy.slice(0, -ALL_IN_SUFFIX.length) as UpgradeId;
}

function basePriorityFor(strategy: BaseStrategy): UpgradeId[] {
  const single = singleStatOf(strategy);
  // single-stat all-inは対象カテゴリ以外は一切買わない（優先度リストに1項目しか入れない）。
  // maxLevelに達した後は他カテゴリへフォールバックせず金だけ貯まり続ける状態を意図的に許容し、
  // 「このカテゴリだけに全振りしたら何が起きるか」を他カテゴリの寄与と混ざらない形で観測する
  if (single) return [single];
  if (strategy === 'mining-first') return MINING_FIRST;
  if (strategy === 'combat-first') return COMBAT_FIRST;
  if (strategy === 'bridge-reliant') return BRIDGE_RELIANT;
  return BALANCED; // balanced / balanced-no-outpost 共通
}

/**
 * 008final提案#1: combatRiskLevelが'danger'/'caution'のとき、適応型戦略はhpをベース優先度リストの
 * 先頭へ繰り上げる（重複除去）。固定戦略（isAdaptive=false）はベースの優先度をそのまま返す。
 * これにより「危険度ヒントを見て装備投資の優先順位を変える」という008finalが検証できなかった仮説を
 * 定量比較できる
 *
 * サイクル8・2回目（cycle8-v1指摘#3「mining-first-adaptiveの安全側への振れすぎ懸念」の要否判断）:
 * `priorityFor`を強制的にbaseへ固定する診断実行で原因を切り分けたところ、mining-first-adaptiveの
 * avgMoneyEarned-44%等の低下は`adaptiveRiskRetreat`（撤退判断）ではなく、'caution'（maxHp/recommendedHp
 * 比0.7〜1.0の広い範囲、'danger'よりはるかに頻繁）でのhp優先繰り上げがdrill投資を長期間後回しにする
 * ことが主因と特定した。'caution'の繰り上げ自体を外す変更も試したが、それを適用すると008final・
 * cycle8-v1で確認済みの中核シナリオ（P01 seed301: 固定戦略はtick4524死亡、適応型戦略は6000tick完走・
 * finalHp41/140）が再びtick4414死亡に戻ってしまう回帰を招いた。'caution'でのhp優先繰り上げは
 * 「実害が出る前の早期投資」としてこの生存シナリオに不可欠な役割を果たしており、aggregate指標の
 * 低下はこの安全機構の意図した代償と判断し、'caution'/'danger'とも繰り上げは維持することにした
 * （routine-state.md参照）。唯一変更したのは'danger'側からatkを外したこと: `game.ts`の
 * `combatRiskLevel()`はmaxHp()とrecommendedHpForBand()の比だけで決まりatkを一切考慮しないため、
 * atkの繰り上げはcombatRiskLevel自体を改善しない無駄なdrill投資の後回しにしかならず、外しても
 * 20シード比較・P01/P02シナリオともに悪影響が無いことを確認済み
 *
 * サイクル10・1回目（cycle9-final指摘#1対応、routine-state.md参照）: 'caution'/'danger'中のhp優先
 * 繰り上げは、band境界通過直後にmaxDepthの更新が長時間止まっている（＝停滞している）場合には
 * 適用しない。P02(seed302,balanced-adaptive)で見つかった「'caution'のままdrill/atk投資が
 * 一生後回しにされ続け、band境界の1歩先で6000tickの83%を棒に振る」問題は、「hpを積んでも
 * combatRiskLevelがsafeへ改善しない」状況と「単にhpが足りていないだけの状況」を区別できて
 * いないことが原因（cycle9-final「原因の切り分け」節）。maxDepthの実進捗という結果指標そのものを
 * 停滞シグナルに使うことで、時間ベースの単純な打ち切りより「本当に行き詰まっているか」を正確に
 * 判定できる（bot側`stagnantTicks`、直近STAGNATION_TICKS_LIMIT tick以上maxDepthが更新されて
 * いなければ、hp優先を止めて通常優先度（drill等）に戻す。進捗が再開すれば即座にhp優先へ復帰する）。
 * cycle8-v2で確認済みの中核救済シナリオ（P01 seed301: 固定戦略は死亡、適応型は完走）はhp優先が
 * 効き始めてから短時間で発動するため、この停滞判定が長めの閾値である限り干渉しないことを
 * 20シード比較・P01/P02フルセッションで確認して閾値を決定した（詳細はroutine-state.md参照）
 */
const STAGNATION_TICKS_LIMIT = 800;
// 停滞中に基地で貯蓄のみ試みる上限tick数。LABOR_INCOME(1/15tick)ベースでも十分な回数の購入機会を
// 確保しつつ、際限ない足止めにはしない（詳細はdecide()内コメント参照）
const STAGNATION_SAVE_CAP = 500;
function priorityFor(
  strategy: Strategy,
  riskLevel: 'safe' | 'caution' | 'danger',
  stagnant: boolean,
): UpgradeId[] {
  const base = basePriorityFor(baseOf(strategy));
  if (!isAdaptive(strategy) || riskLevel === 'safe' || stagnant) return base;
  const boosted: UpgradeId[] = ['hp'];
  const rest = base.filter((id) => !boosted.includes(id));
  return [...boosted, ...rest];
}

const RETURN_HP_THRESHOLD = 0.25;
const RESUME_DIVE_HP_THRESHOLD = 0.6;
// サイクル8・2回目（cycle8-v1指摘#1対応）: 当初のadaptiveRiskRetreatはcombatRiskLevel==='danger'に
// なった瞬間（=現在のbandの推奨maxHpに対し自分のmaxHpが70%未満、という「装備の静的な不足」であり
// 現在HPの実際の減り具合とは無関係）に、被弾ゼロ・満タンHPのままでも即座に撤退していた。
// 実際に被弾してHPがこの比率を下回るまでは通常戦略と同じく採掘・戦闘を続け、そこで初めて早期撤退する
// （通常のRETURN_HP_THRESHOLD=0.25より早い安全マージン）よう変更し、「危険を感知しても無傷のうちから
// パニック撤退しない」という現実的な判断に近づけた。20シード比較・P01(seed301)/P02(seed302)シナリオの
// いずれでも数値・生死とも変化がないことを確認済み（優先度側の`priorityFor`の方がaggregate指標への
// 影響が大きいため、この変更単独の効果は本セット内では観測できなかったが、論理的な正しさとして残す）
const ADAPTIVE_DANGER_HP_RATIO = 0.85;

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

const FORWARD_DIRS: Dir[] = ['down', 'right', 'left'];

/**
 * サイクル10新規（cycle9-final指摘#1の調査で判明した副次バグへの対応）: `minEscapeBridgeCost`は
 * 「次の行のどこかの列に迂回橋不要のタイルがあれば即cost=0」と判定するが、その列が既知の坑道網から
 * 実際に到達可能かどうかは見ていない。到達不可能な列を根拠にcost=0（＝壁ではない）と誤判定すると、
 * wallReserveが一切機能せず、貯めるべき金額が定まらないまま停滞し続ける（実測: seed302で
 * wallReserveが常に0のまま、実際にはx=W-1（地図右端）の直下が要求採掘威力6・drillPower4で
 * 掘削不能、右は地図外、左は迂回橋代不足という現実の壁に当たっていた）。この関数は
 * bfsToFrontier（既知の坑道網を辿った到達可能性の確認）が失敗した後の最終手段として、
 * 「現在地から直接迂回橋を架けられる（＝確実に到達可能な）隣接タイル」の最安コストだけを返す
 */
function nearestBlockedBridgeCost(s: GameState, costMult: number): number {
  const p = s.player;
  let minCost = Infinity;
  for (const dir of FORWARD_DIRS) {
    const [dx, dy] = DELTA[dir];
    const nx = p.x + dx;
    const ny = p.y + dy;
    const t = tileAt(s, nx, ny);
    if (t === null || enemyAt(s, nx, ny)) continue;
    if (t === TILE.FLOOR || t === TILE.PROP || t === TILE.OUTPOST) continue;
    if (requiredDrillPower(t as TileId, bandAt(ny)) <= p.drillPower) continue;
    minCost = Math.min(minCost, bridgeCost(t as TileId, bandAt(ny), costMult));
  }
  return minCost;
}

class Bot {
  private awaitingHeal = false;
  /** 直近のmineフェーズで観測した「今building可能な位置に前線基地を建てるとしたらの費用」。
   * shopフェーズでの購入判断時にこれを現金の予約分として扱い、outpost建設の機会を潰さないようにする */
  private outpostReserve = 0;
  /** v2追加: 壁に当たっている間だけ、迂回橋代を通常購入より優先して確保する */
  private wallReserve = 0;
  /** 008新規: wallReserveが指す「壁の行(y+1)」。この行を実際に通過するまでwallReserveを保持する */
  private wallRow = -1;
  /** 007新規: balanced-no-outpost はA/B比較用に前線基地を一切建てない */
  private readonly buildsOutposts: boolean;
  /** サイクル9新規: 直前に潜行を再開した地点（基地の座標）。潜行セッション中の最大移動距離を測るための基準点 */
  private diveStartPos: { x: number; y: number } | null = null;
  private diveMaxDist = 0;
  /** 潜行を再開しても基地の隣接1マスから一歩も出られないセッションが連続した回数 */
  private deadEndStreak = 0;
  /** マップ最深部(H-1)の袋小路等、行き止まりが確定したら以後は潜行を再開せず基地で待機する */
  private giveUpDiving = false;
  /** サイクル10新規: これまでに観測したmaxDepthの最大値。停滞（進捗停止）検出の基準点 */
  private lastMaxDepth = 0;
  /** maxDepthが更新されないまま経過したtick数。STAGNATION_TICKS_LIMIT以上ならadaptiveのhp優先繰り上げを止める */
  private stagnantTicks = 0;
  /** 停滞中に基地で「何も買えないまま」待機し続けたtick数。STAGNATION_SAVE_CAPで頭打ちにし無限待機を防ぐ */
  private stagnationWaitTicks = 0;
  /** サイクル10新規: 潜行再開時点でwallReserve分の資金を確保できていたかどうかのスナップショット。
   * needsReturn内でstagnantを見る際、毎tickの現在の所持金と比較すると、迂回橋を架けて
   * 支払った直後に「もう資金が足りない」と誤判定して即座に引き返してしまい、せっかく架けた
   * 橋を渡り切る前に撤退する（実測で確認）。潜行開始時点の1回だけ判定し、その潜行が終わる
   * （基地に戻る）までは固定する */
  private diveHasEscapeFunds = true;

  constructor(private strategy: Strategy) {
    this.buildsOutposts = strategy !== 'balanced-no-outpost';
  }

  private tryBuy(s: GameState, stagnant: boolean): Action | null {
    const bridgeReserve = this.strategy === 'bridge-reliant' ? BRIDGE_RELIANT_RESERVE : 0;
    const reserve = Math.max(bridgeReserve, this.wallReserve) + (this.buildsOutposts ? this.outpostReserve : 0);
    // サイクル14新規（cycle13-final提案#2「atk/hp/atkspeed/muffler系all-inのavgScore収束」の調査で発見）:
    // この早期skill購入の特例はsingle-stat all-in導入(サイクル11)より前から存在し、当時はdrillの
    // 早期購入特例だけがsingle-stat除外の対象になった。skill側は除外し忘れており、結果として
    // drill-all-in以外の全single-stat all-in戦略（atk-all-in/hp-all-in等）も「対象カテゴリ以外は
    // 一切買わない」という前提に反してskill Lv1を密かに購入していた（例: capacity-all-inの
    // avgSkillUses=12.3・fuel-all-inの6.2など、優先度リストに'skill'が一切無い戦略でskillが
    // 使われていた）。single-stat all-in戦略はこの特例の対象外にし、単一カテゴリ隔離実験の
    // 前提を正しく守る（skill-all-in自身は元々priorityForの先頭がskillのため無関係）
    const skillItem = s.shop.find((it) => it.id === 'skill');
    if (
      !singleStatOf(this.strategy) &&
      skillItem &&
      skillItem.level === 0 &&
      skillItem.nextCost !== null &&
      s.player.money - skillItem.nextCost >= reserve
    ) {
      return { type: 'buy', item: 'skill' };
    }
    // v2追加（008 v1指摘#2対応）: drillはbaseCost30と全アイテム中最高額なうえ、wallReserve/outpostReserveが
    // 常に上乗せされるため「money - 30 >= reserve」が満たされるまで所持金が育たず、6000tickのセッション全体で
    // 一度もdrillLevelが上がらない個体が確認された（迂回橋の都度払いが恒久投資の代替として機能しすぎた副作用）。
    // bridge-reliant戦略はdrill非投資自体がA/B比較の検証対象のため対象外とし、それ以外の戦略では初回の
    // drill購入だけはwallReserve/outpostReserveを無視してよいことにし、投資の第一歩を踏み出せるようにする
    // サイクル11新規: single-stat all-in戦略はこの早期drill購入の対象外にする。drill-all-in自身は
    // 既にpriorityFor先頭がdrillのため無関係、それ以外（hp-all-in等）にこの特例を適用すると
    // 「対象カテゴリ以外は一切買わない」という単一カテゴリ隔離実験の前提が崩れてしまう
    const drillItem = s.shop.find((it) => it.id === 'drill');
    if (
      this.strategy !== 'bridge-reliant' &&
      !singleStatOf(this.strategy) &&
      drillItem &&
      drillItem.level === 0 &&
      drillItem.nextCost !== null &&
      s.player.money >= drillItem.nextCost
    ) {
      return { type: 'buy', item: 'drill' };
    }
    for (const id of priorityFor(this.strategy, s.player.combatRiskLevel, stagnant)) {
      const item = s.shop.find((it) => it.id === id);
      if (item && item.nextCost !== null && s.player.money - item.nextCost >= reserve) {
        return { type: 'buy', item: id };
      }
    }
    return null;
  }

  decide(s: GameState): Action {
    // サイクル10新規: maxDepthの実進捗を停滞シグナルとして毎tick更新する。tryBuy内のpriorityForが
    // このtick内で参照するため、他の判定より先に行う
    if (s.metrics.maxDepth > this.lastMaxDepth) {
      this.lastMaxDepth = s.metrics.maxDepth;
      this.stagnantTicks = 0;
    } else {
      this.stagnantTicks++;
    }
    // 固定戦略は既存のストレステストで停滞が確認されていないため、対象は適応型戦略のみに絞り
    // 固定戦略の指標（回帰確認済みのベースライン）に一切影響しないようにする
    const stagnant = isAdaptive(this.strategy) && this.stagnantTicks >= STAGNATION_TICKS_LIMIT;

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
    // v4修正（007final #3対応）: v3はmineフェーズ内であれば「今いる行」をそのまま再計算していたため、
    // 壁を発見した後に撤退のため上に戻る途中（まだ壁の行には到達し直していない）でも毎tick
    // 再計算され、既に通行済みの浅い行を見て0にリセットされてしまっていた（最後に評価されるのは
    // 基地の目の前の行になるため）。壁の行(y+1)を`wallRow`として記憶し、実際にその行へ到達/通過して
    // 「もう塞がれていない」と確認できるまではwallReserveを保持するようにした
    if (s.phase === 'mine') {
      const ny = s.player.y + 1;
      const cost = minEscapeBridgeCost(s, buildCostMultOf(engineeringLevel(s)));
      if (this.wallRow >= 0 && ny >= this.wallRow && cost === 0) {
        this.wallReserve = 0;
        this.wallRow = -1;
      } else if (cost > 0) {
        this.wallReserve = cost;
        this.wallRow = ny;
      }
    }

    // サイクル9新規（ストレステストで検出）: マップ最深部(H-1)の隅で前線基地が孤立し、掘る先も
    // 迂回橋を架ける先も無い完全な袋小路に入ると、shopフェーズが機械的に「潜行再開(move down)」を
    // 出し続け、基地の隣接1マスへ一歩踏み出してすぐ舞い戻るだけの3tickサイクルを無限に繰り返し
    // tripsToSurfaceが無意味に積み上がる現象を80シードのストレステストで検出した（balanced seed61で
    // 6142回）。基地の隣接1マス圏から実質的に一歩も出られない潜行セッションが3回連続したら、
    // それ以上再開を試みても進展しないと判断し、以後は基地で待機するだけにする
    if (s.phase === 'mine' && this.diveStartPos) {
      const dist = Math.max(Math.abs(s.player.x - this.diveStartPos.x), Math.abs(s.player.y - this.diveStartPos.y));
      this.diveMaxDist = Math.max(this.diveMaxDist, dist);
    }
    if (s.phase === 'shop' && this.diveStartPos) {
      this.deadEndStreak = this.diveMaxDist <= 1 ? this.deadEndStreak + 1 : 0;
      if (this.deadEndStreak >= 3) this.giveUpDiving = true;
      this.diveStartPos = null;
    }

    if (s.phase === 'shop') {
      if (this.awaitingHeal) {
        if (s.player.hp < s.player.maxHp * RESUME_DIVE_HP_THRESHOLD) {
          return this.tryBuy(s, stagnant) ?? { type: 'wait' };
        }
        this.awaitingHeal = false;
      }
      const buy = this.tryBuy(s, stagnant);
      if (buy) {
        this.stagnationWaitTicks = 0;
        return buy;
      }
      // 直前のmineフェーズで壁に当たっていて、迂回橋代がまだ貯まっていないなら、
      // 「潜行→壁で足止め→即帰還」という無駄な小刻みな往復（tripsToSurfaceを浪費するだけで
      // 何も進展しない）を作らず、基地で待機して資金が貯まるのを待つ。基地滞在中はLABOR_INCOMEで
      // 資金が必ず増え続けるため、待機自体が新種の停滞（凍結）にはならない。
      // サイクル10新規: wallReserveが判明している（＝壁の実コストを知っている）場合はこちらを
      // 優先する。money>=wallReserveならこのブロックは待機を返さずすぐ下へ抜け、再潜行して
      // 実際に迂回橋を架けに行く。以前はここより先に汎用のstagnant待機（下記）を評価していたため、
      // 貯蓄中にたまたま別の安い購入が挟まるたびにその待機カウンタがリセットされ、money>=wallReserve
      // に達しても永久に潜行を再試行できない不具合があった（実測: seed302でmoney=54まで貯まっても
      // 潜行が再開されなかった）
      if (this.wallReserve > 0) {
        if (s.player.money < this.wallReserve) return { type: 'wait' };
      } else if (stagnant) {
        // サイクル10新規（cycle9-final指摘#1対応）: 壁の実コストがまだ判明していない停滞中は、
        // 即座に再潜行して同じ壁へ突っ込む（＝進捗ゼロのままtripsToSurfaceだけ浪費する往復）
        // のではなく、基地に留まってLABOR_INCOMEで資金が貯まるのを待つ。STAGNATION_SAVE_CAP
        // tick待っても何も買えない場合は、無限に足止めされないよう現在の装備で潜行を再試行する
        if (this.stagnationWaitTicks < STAGNATION_SAVE_CAP) {
          this.stagnationWaitTicks++;
          return { type: 'wait' };
        }
        this.stagnationWaitTicks = 0;
      }
      if (this.giveUpDiving) return { type: 'wait' };
      // サイクル10新規: この潜行を開始できる＝wallReserveの条件（0か、既に資金を満たしている）を
      // 満たしたということなので、その判定をこの潜行が終わるまで固定する（詳細はフィールドの
      // コメント参照）
      this.diveHasEscapeFunds = this.wallReserve === 0 || s.player.money >= this.wallReserve;
      this.diveStartPos = { x: s.player.x, y: s.player.y };
      this.diveMaxDist = 0;
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
    // 008final提案#1: 適応型戦略はcombatRiskLevelが'danger'になった時点で、低HPを待たずに自主的に撤退し、
    // 装備投資（hp/atk優先度の繰り上げ）を挟んでから再潜行する。P01のような「drill優先で深く潜れるが
    // 打たれ強さが伴わないまま死ぬ」パターンを、ヒントに反応する行動で回避できるかを検証する
    const adaptiveRiskRetreat =
      isAdaptive(this.strategy) &&
      p.combatRiskLevel === 'danger' &&
      p.hp <= p.maxHp * ADAPTIVE_DANGER_HP_RATIO;
    // サイクル9・2回目（ストレステストで検出）: estFuelToReturnの安全マージン(returnMargin)ちょうどで
    // 燃料切れになるシード（例: 貫通まであと数tickの掘削中）では、毎回「壁の直前まで潜っては
    // 掘削完了の数tick前にestFuelToReturnトリガーで撤退→進捗リセット」を繰り返し、鉱石も稼げず
    // LABOR_INCOME（基地滞在中のみ加算）も貯まらないまま経済が完全に停滞する個体を100シードの
    // ストレステストで確認した（20〜27%のシードでmining-first/combat-first/balanced系がdepth37〜43に
    // 貼り付いたまま20000tick終了）。掘削残りわずか（3tick以下）かつ、それを終えてもなお
    // estFuelToReturn以上の燃料が残る場合に限り、通常のreturnMarginより先に掘削完了を優先させることで
    // 「あと一歩」で進捗を捨てて撤退する無駄なループを避ける。fuel<=0・満載・低HP・adaptiveRiskRetreatの
    // 安全側トリガーはそのまま優先されるため、危険な深追いにはならない
    // 掘削中は通常の移動(PASSIVE_FUEL_DRAIN=1/tick)に加えDIG_FUEL_COST=1/tickが上乗せされ実質2倍消費、
    // かつ掘削完了後は1マス深く進むためestFuelToReturnも(概ね)+1増える。両方を見込んだ余裕を要求する
    const finishingDigSafely =
      p.digging !== null &&
      p.digging.remaining <= 3 &&
      p.estFuelToReturn !== null &&
      p.fuel > p.estFuelToReturn + p.digging.remaining * 2 + 2;
    // サイクル10新規（cycle9-final指摘#1対応）: 停滞中は、既に掘った床の中で行き止まりに突き当たって
    // 1マスだけ後退する（フェーズC、下記）を繰り返すだけで基地に戻らず、LABOR_INCOMEを一切得られない
    // まま何もできない往復に陥ることがある（P02 seed302で確認: y=101〜102間で永久往復、基地(y=100)へは
    // 到達するがtryBuyが何も買えないと即座に再潜行するため滞在時間ゼロで資金が育たない）。
    // 停滞中はbfsToNearestBase（既に掘った床経由の最短経路）で確実に基地まで戻し、貯蓄の機会を作る。
    // ただし、この潜行を開始した時点で既に壁の実コスト分を貯め終えていた（diveHasEscapeFunds）場合は
    // この強制帰還を適用しない。毎tickの現在の所持金で判定すると、迂回橋を架けて支払った直後に
    // 「もう資金が足りない」と誤判定して即座に引き返してしまい、せっかく架けた橋を渡り切る前に
    // 撤退する（実測で確認: money>=wallReserveで再潜行した直後、橋を架けて所持金が減った次のtickで
    // 即座に基地へ引き返し、橋を渡る一手を実行できなかった）
    const stagnantNeedsReturn = stagnant && !this.diveHasEscapeFunds;
    const needsReturn =
      p.fuel <= 0 ||
      p.cargoUnits >= p.maxCapacity ||
      lowHp ||
      adaptiveRiskRetreat ||
      stagnantNeedsReturn ||
      (!finishingDigSafely && p.estFuelToReturn !== null && p.fuel <= p.estFuelToReturn + returnMargin);
    if (needsReturn) {
      if (lowHp || adaptiveRiskRetreat) this.awaitingHeal = true;
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

    // サイクル10新規: 現在地の隣接1マスでは前進も迂回橋も不可能でも、既知の坑道網の別ルート上に
    // 掘削可能なタイルが残っている場合がある（マップ端で右方向の選択肢が無い等）。フェーズC
    // （単純な1マス後退）より先に、そこへの経路をBFSで探す。isAdaptive限定（既存コメント参照）
    if (isAdaptive(this.strategy)) {
      const frontierDir = bfsToFrontier(s, s.metrics.maxDepth);
      if (frontierDir) {
        const [dx, dy] = DELTA[frontierDir];
        if (!enemyAt(s, p.x + dx, p.y + dy)) return { type: 'move', dir: frontierDir };
      } else {
        // サイクル10新規: 既知の坑道網のどこにも掘削可能な逃げ道が無い（bfsToFrontierも失敗）なら、
        // これは`minEscapeBridgeCost`が誤って見逃していた本物の壁である。現在地から直接迂回橋を
        // 架けられる隣接タイルの実コストをwallReserveへ設定し直し、貯蓄目標を正しく機能させる
        const blockedCost = nearestBlockedBridgeCost(s, costMult);
        if (Number.isFinite(blockedCost)) {
          this.wallReserve = blockedCost;
          this.wallRow = p.y + 1;
        }
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
  bottomReached: boolean;
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
    bottomReached: s.metrics.bottomReached,
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
  'mining-first-adaptive',
  'combat-first-adaptive',
  'balanced-adaptive',
  'drill-all-in',
  'capacity-all-in',
  'fuel-all-in',
  'atk-all-in',
  'hp-all-in',
  'atkspeed-all-in',
  'skill-all-in',
  'muffler-all-in',
  'engineering-all-in',
] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgMaxDepth=${avg((r) => r.maxDepth)} avgKills=${avg((r) => r.kills)} avgOreMined=${avg((r) => r.oreMined)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgTrips=${avg((r) => r.tripsToSurface)} avgMilestones=${avg((r) => r.milestonesReached)} avgSkillUses=${avg((r) => r.skillUses)} avgDashUses=${avg((r) => r.dashUses)} avgBridges=${avg((r) => r.bridgesBuilt)} avgBarricades=${avg((r) => r.barricadesBuilt)} avgPropsDestroyed=${avg((r) => r.propsDestroyedByEnemy)} avgOutposts=${avg((r) => r.outpostsBuilt)} bottomReached=${results.filter((r) => r.bottomReached).length}/${results.length} deaths=${results.filter((r) => r.over).length}/${results.length}`,
  );
}
