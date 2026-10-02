/**
 * ヘッドレスシミュレーション: 9種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 4000]
 *
 * - solo（中央のみ・対照群）: 中央トランクだけに資材を積み続ける。019の単一柱と等価な
 *   「多脚なし」のベースライン。avgMaxHeightの頭打ちが本作でも再現するかを確認する診断ボット
 * - soloBraced（中央のみ＋brace連携）: soloにbrace連携のみ追加。「brace単体では頭打ちを
 *   突破できない」ことを確認するためのもう一つのベースライン
 * - twin（中央＋右脚1本、梁を編む）: 最小構成の多脚。高さ4から3段ごとに右脚へ梁を架けながら3列を育てる
 * - tripod（中央＋左右2脚、梁を編む）: 本命の多脚構成。高さ4から3段ごとに両脚へ梁を架ける
 * - tripodOnce（中央＋左右2脚、梁1段のみ）: v1のtripodと等価（高さ4に1本だけ架けて以後は中央のみ）。
 *   「梁を編み続ける」こと自体の価値をtripodと比較して検証する診断ボット
 * - tripodLate（中央＋左右2脚、後期接続）: 最初の梁を素の石柱で届く上限付近の高さ7まで遅らせ、
 *   以後は3段ごとに編む。「いつ繋ぎ始めるか」の選択をtripodと比較する
 * - tripodCareful（tripod＋brace連携＋鑑定ロット選別）: 019で確立したパターン（brace連携・鑑定投資）が
 *   多脚の梁と素直に積み重なるかを検証する（P01代替）
 * - tripodDense（v3、tripodCarefulの梁を2段ごと）: 密に編む＝崩落は少ないが梁の架設時間がかさむ側
 * - tripodCarefulLate（v3、tripodCarefulの最初の梁を15へ）: 中央を先に伸ばして早く稼ぎ、後から編む側
 *
 * 掃引: --override tripodCareful.rungSpacing=4,tripodCareful.firstRung=9 のように設定を上書きできる。
 * lateFrom/lateSpacingを指定すると、その高さ以上で梁の間隔を切り替える
 */
import { BEAM_COST, Game, GOAL_HEIGHT, LEG_X, TIME_LIMIT } from '../src/core/game';
import type { Action, GameState, LegId, StructMaterial } from '../src/core/types';

type Strategy =
  | 'solo'
  | 'soloBraced'
  | 'twin'
  | 'tripod'
  | 'tripodOnce'
  | 'tripodLate'
  | 'tripodCareful'
  | 'tripodDense'
  | 'tripodCarefulLate';

interface StrategyConfig {
  legsToBuild: LegId[];
  /** 最初の梁の高さ */
  firstRung: number;
  /** 2本目以降の梁の間隔 */
  rungSpacing: number;
  /** 架ける梁の段数の上限（脚1本あたり） */
  maxRungs: number;
  /** v3: この高さ以上の梁は間隔をlateSpacingへ広げる（0なら切り替えない） */
  lateFrom?: number;
  lateSpacing?: number;
  usesBrace: boolean;
  usesInsight: boolean;
}

const NONE = { legsToBuild: [] as LegId[], firstRung: 0, rungSpacing: 0, maxRungs: 0 };
const WEAVE = { firstRung: 4, rungSpacing: 2, maxRungs: 40 };
export const CONFIG: Record<Strategy, StrategyConfig> = {
  solo: { ...NONE, usesBrace: false, usesInsight: false },
  soloBraced: { ...NONE, usesBrace: true, usesInsight: false },
  twin: { legsToBuild: ['right'], ...WEAVE, usesBrace: false, usesInsight: false },
  tripod: { legsToBuild: ['left', 'right'], ...WEAVE, usesBrace: false, usesInsight: false },
  tripodOnce: { legsToBuild: ['left', 'right'], firstRung: 4, rungSpacing: 2, maxRungs: 1, usesBrace: false, usesInsight: false },
  tripodLate: { legsToBuild: ['left', 'right'], firstRung: 7, rungSpacing: 2, maxRungs: 40, usesBrace: false, usesInsight: false },
  tripodCareful: { legsToBuild: ['left', 'right'], firstRung: 6, rungSpacing: 3, maxRungs: 40, usesBrace: true, usesInsight: true },
  // v3: 「どの間隔で・いつ繋ぐか」の比較用。tripodCarefulと同じ投資で、間隔2（密）／最初の梁を15へ遅らせる
  tripodDense: { legsToBuild: ['left', 'right'], firstRung: 6, rungSpacing: 2, maxRungs: 50, usesBrace: true, usesInsight: true },
  tripodCarefulLate: { legsToBuild: ['left', 'right'], firstRung: 15, rungSpacing: 3, maxRungs: 40, usesBrace: true, usesInsight: true },
};

/** HPがこの割合を下回ったら登坂を中断し地上へ退避する（019から継承） */
const RETREAT_HP_RATIO = 0.4;
const RESUME_HP_RATIO = 0.85;

export class Bot {
  private cfg: StrategyConfig;
  private descending = false;
  private recovering = false;
  private appraisalBuys = 0;

  constructor(strategy: Strategy) {
    this.cfg = CONFIG[strategy];
  }

  private blockAt(s: GameState, x: number, y: number): boolean {
    return s.world.blocks.some((b) => b.x === x && b.y === y);
  }

  private legOf(s: GameState, id: LegId) {
    return s.legs.find((l) => l.id === id)!;
  }

  private isSmart(): boolean {
    return this.cfg.usesBrace || this.cfg.usesInsight || this.cfg.legsToBuild.length > 0;
  }

  private hasMaterialOrBrace(s: GameState): boolean {
    return this.pickMaterial(s) !== null || (this.cfg.usesBrace && s.player.inventory.brace > 0);
  }

  private pickMaterial(s: GameState): StructMaterial | null {
    const inv = s.player.inventory;
    if (inv.steel > 0) return 'steel';
    if (inv.stone > 0) return 'stone';
    return null;
  }

  private bestLotIndex(s: GameState, mat: StructMaterial): number | undefined {
    if (!this.cfg.usesInsight) return undefined;
    const q = s.qualityQueue[mat];
    let bestIdx = -1;
    let bestVal = -Infinity;
    for (let i = 0; i < q.length; i++) {
      const v = q[i];
      if (v !== null && v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }
    return bestIdx >= 0 ? bestIdx : undefined;
  }

  private maybeBuy(s: GameState, target: { legId: LegId; targetHeight: number; wantConnect: boolean }): Action | null {
    const p = s.player;
    const wantConnect = target.wantConnect;
    // v2: 脚を建てている最中は梁1本分の資金を残す（資材を買い溜めて梁代が払えず地上で
    // 労働収入を待ち続ける停滞を避ける）。梁を架ける直前は資材を買わない
    const reserve = wantConnect ? BEAM_COST : 0;
    const hasMaterial = p.inventory.stone + p.inventory.steel > 0;
    if (wantConnect && hasMaterial) return null;
    // v3: braceを使う戦略は、資材が尽きた時点でbraceが1本も無ければ石より先にbraceを1本確保する。
    // v2までは「所持金24以上」でしかbraceを買わず、序盤の貧困時（所持金0〜9）は崩れる石だけを
    // 買い続けて抜け出せなかった（最初の梁を遅らせる戦略・soloBracedの停滞シードの主因）
    if (this.cfg.usesBrace && !hasMaterial && p.inventory.brace < 1 && p.money - reserve >= 6) {
      return { type: 'buy', item: 'brace' };
    }
    if (!hasMaterial && p.money >= 9) return { type: 'buy', item: 'stone' };
    const m = p.money - reserve;
    // v2: 列を複数育てる戦略は1往復で運ぶ量も列数に比例して増やす（地上との往復回数を抑える）
    const carry = 1 + this.cfg.legsToBuild.length;
    if (p.inventory.stone < 4 && m >= 9) return { type: 'buy', item: 'stone' };
    // v2: braceを鑑定より先に確保する（v1は序盤の所持金を鑑定に先に使いbraceが買えず、
    // 中央が崩落を繰り返してマイルストーン収入が止まる停滞がtripodCarefulの主な敗因だった）
    if (this.cfg.usesBrace && p.inventory.brace < 4 * carry && m >= 6 + 9 * 2) return { type: 'buy', item: 'brace' };
    if (this.cfg.usesInsight && this.appraisalBuys < 3 && s.shop.appraisalNextCost !== null) {
      if (m >= s.shop.appraisalNextCost + 9 * 3) {
        this.appraisalBuys++;
        return { type: 'buy', item: 'appraiser' };
      }
    }
    if (p.inventory.steel < 6 * carry && m >= 18 + 9 * 2) return { type: 'buy', item: 'steel' };
    if (p.inventory.stone < 10 * carry && m >= 9) return { type: 'buy', item: 'stone' };
    return null;
  }

  /**
   * 現在どの脚で何をすべきかを状態から導出する（ステートレス）。
   * 梁の予定高さを下から順に見て、「中央をその高さまで→各脚をその高さまで→梁を架ける」を繰り返す
   */
  private currentTarget(s: GameState): { legId: LegId; targetHeight: number; wantConnect: boolean } {
    const center = this.legOf(s, 'center');
    let h = this.cfg.firstRung;
    for (let k = 0; k < this.cfg.maxRungs && this.cfg.legsToBuild.length > 0; k++) {
      if (k > 0) {
        const late = this.cfg.lateFrom && this.cfg.lateSpacing && h >= this.cfg.lateFrom;
        h += late ? this.cfg.lateSpacing! : this.cfg.rungSpacing;
      }
      if (center.topHeight < h) return { legId: 'center', targetHeight: h, wantConnect: false };
      for (const legId of this.cfg.legsToBuild) {
        const li = this.legOf(s, legId);
        if (li.rungs.includes(h)) continue;
        if (li.topHeight < h) return { legId, targetHeight: h, wantConnect: false };
        return { legId, targetHeight: h, wantConnect: true };
      }
    }
    return { legId: 'center', targetHeight: Number.POSITIVE_INFINITY, wantConnect: false };
  }

  /** 今立っている高さの梁の上を歩いて、目的の列のxまで横移動できるか */
  private beamReaches(s: GameState, targetX: number): boolean {
    const p = s.player;
    if (p.y < 1) return false;
    let lo = p.x;
    let hi = p.x;
    for (const leg of s.legs) {
      if (leg.id === 'center' || !leg.rungs.includes(p.y)) continue;
      const a = Math.min(leg.x, LEG_X.center);
      const b = Math.max(leg.x, LEG_X.center);
      if (p.x >= a && p.x <= b) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
      }
    }
    // 中央を介して反対側の梁へ乗り継ぐ
    if (lo <= LEG_X.center && hi >= LEG_X.center) {
      for (const leg of s.legs) {
        if (leg.id === 'center' || !leg.rungs.includes(p.y)) continue;
        lo = Math.min(lo, leg.x);
        hi = Math.max(hi, leg.x);
      }
    }
    return targetX >= lo && targetX <= hi && lo !== hi;
  }

  private climbOrBuild(s: GameState): Action {
    const p = s.player;
    const atBlock = this.blockAt(s, p.x, p.y);
    const aboveBlock = this.blockAt(s, p.x, p.y + 1);
    const wantsBrace = this.cfg.usesBrace && atBlock && p.inventory.brace > 0 && !aboveBlock;
    const material = this.pickMaterial(s);
    // 置く手段(brace/資材)が何もないなら、既存ブロックに登ってもやることがないので
    // 無駄な登り降りの往復をせず地上へ戻って資材を補充する
    if (!wantsBrace && !material && !aboveBlock) {
      if (p.y > 0) return { type: 'move', dir: 'down' };
      return { type: 'wait' };
    }
    if (aboveBlock) return { type: 'move', dir: 'up' };
    if (wantsBrace) {
      if (!this.blockAt(s, p.x - 1, p.y)) return { type: 'place', dir: 'left', material: 'brace' };
      if (!this.blockAt(s, p.x + 1, p.y)) return { type: 'place', dir: 'right', material: 'brace' };
    }
    if (material) {
      const lotIndex = this.bestLotIndex(s, material);
      return lotIndex === undefined
        ? { type: 'place', dir: 'up', material }
        : { type: 'place', dir: 'up', material, lotIndex };
    }
    if (p.y > 0) return { type: 'move', dir: 'down' };
    return { type: 'wait' };
  }

  decide(s: GameState): Action {
    const p = s.player;
    if (p.y === 0) this.descending = false;

    const smart = this.isSmart();
    if (smart) {
      if (p.hp / p.maxHp <= RETREAT_HP_RATIO && p.y > 0 && !this.descending) {
        this.recovering = true;
        this.descending = true;
      }
      if (this.recovering && p.y === 0 && p.hp / p.maxHp >= RESUME_HP_RATIO) {
        this.recovering = false;
      }
    }

    if (this.descending) {
      // v2: 退避中でなければ、降りる途中で目的の列へ渡れる梁に着いた時点で地上まで降りずに渡る
      if (!this.recovering && p.y > 0 && this.hasMaterialOrBrace(s)) {
        const t = this.currentTarget(s);
        if (LEG_X[t.legId] !== p.x && this.beamReaches(s, LEG_X[t.legId])) {
          this.descending = false;
          return { type: 'move', dir: p.x < LEG_X[t.legId] ? 'right' : 'left' };
        }
      }
      return { type: 'move', dir: 'down' };
    }
    if (this.recovering && p.y === 0) return this.maybeBuy(s, this.currentTarget(s)) ?? { type: 'wait' };

    const maxStress = Math.max(...s.legs.map((l) => l.maxStressRatio));
    if (smart && s.shake.state !== 'idle' && maxStress > 0.55 && p.y > 0) {
      return { type: 'wait' };
    }

    const target = this.currentTarget(s);
    const targetX = LEG_X[target.legId];

    if (p.x !== targetX) {
      // 梁が架かっていれば地上へ降りずに梁の上を渡る（v2: 梁は足場になる）
      if (p.y !== 0 && this.beamReaches(s, targetX)) {
        return { type: 'move', dir: p.x < targetX ? 'right' : 'left' };
      }
      if (p.y !== 0) {
        this.descending = true;
        return { type: 'move', dir: 'down' };
      }
      return { type: 'move', dir: p.x < targetX ? 'right' : 'left' };
    }

    if (p.y === 0) {
      const buy = this.maybeBuy(s, target);
      if (buy) return buy;
    }

    // v2: 地上で資材もbraceも無いなら、既存の柱に登っても置く物が無いので地上で稼ぎ続ける
    // （v1で直した「登って即降りる往復」が地上起点でも起きており、労働収入が半減していた）
    // v3: braceだけ持っていても登らない（石が買えない貧困時にbraceだけ持って登り降りを繰り返し、
    // 労働収入が止まって石代9に永久に届かない膠着が起きた）
    if (p.y === 0 && !target.wantConnect && !this.pickMaterial(s)) {
      return { type: 'wait' };
    }

    if (target.wantConnect) {
      // 接続コストが足りないなら地上へ戻って稼ぐ（接続高度に居座ったまま要求し続けても
      // 資金は増えない。地上の労働収入で稼いでから登り直す）
      if (p.money < BEAM_COST) {
        if (p.y !== 0) {
          this.descending = true;
          return { type: 'move', dir: 'down' };
        }
        return { type: 'wait' };
      }
      if (p.y < target.targetHeight) {
        const aboveBlock = this.blockAt(s, p.x, p.y + 1);
        if (aboveBlock) return { type: 'move', dir: 'up' };
        return { type: 'wait' };
      }
      if (p.y === target.targetHeight) return { type: 'connect' };
      return { type: 'move', dir: 'down' };
    }

    const action = this.climbOrBuild(s);
    // 資材が尽きて下降を選んだら、地上に着くまで降り続ける（さもないと次tickでaboveBlockが
    // 真になり直後に登り返してしまい、山頂付近で永久に振動するバグになる）
    if (action.type === 'move' && action.dir === 'down') this.descending = true;
    return action;
  }
}

interface RunResult {
  seed: number;
  strategy: Strategy;
  ticks: number;
  won: boolean;
  over: boolean;
  finalHp: number;
  money: number;
  maxHeight: number;
  blocksPlaced: number;
  blocksLost: number;
  collapseEvents: number;
  moneyEarned: number;
  fallDamageTaken: number;
  debrisDamageTaken: number;
  invalidActions: number;
  connectEvents: number;
  maxLegsConnected: number;
  centerTopHeight: number;
  leftTopHeight: number;
  rightTopHeight: number;
  avgPlacedQuality: number;
  appraisalLevel: number;
  score: number;
  /** v3: 到達高度がそれぞれ40・60・80に初めて達したtick（未達はnull）。天井89に張り付く戦略同士の比較用 */
  tickTo40: number | null;
  tickTo60: number | null;
  tickTo80: number | null;
}

function runOne(seed: number, strategy: Strategy, maxTicks: number): RunResult {
  const game = new Game(seed);
  const bot = new Bot(strategy);
  let ticks = 0;
  const reach: Record<number, number | null> = { 40: null, 60: null, 80: null };
  while (!game.over && ticks < maxTicks) {
    game.step(bot.decide(game.getState()));
    ticks++;
    for (const h of [40, 60, 80]) if (reach[h] === null && game.metrics.maxHeight >= h) reach[h] = ticks;
  }
  const s = game.getState();
  const leftLeg = s.legs.find((l) => l.id === 'left')!;
  const centerLeg = s.legs.find((l) => l.id === 'center')!;
  const rightLeg = s.legs.find((l) => l.id === 'right')!;
  return {
    seed,
    strategy,
    ticks,
    won: s.won,
    over: s.over,
    finalHp: s.player.hp,
    money: s.player.money,
    maxHeight: s.metrics.maxHeight,
    blocksPlaced: s.metrics.blocksPlaced,
    blocksLost: s.metrics.blocksLost,
    collapseEvents: s.metrics.collapseEvents,
    moneyEarned: s.metrics.moneyEarned,
    fallDamageTaken: s.metrics.fallDamageTaken,
    debrisDamageTaken: s.metrics.debrisDamageTaken,
    invalidActions: s.metrics.invalidActions,
    connectEvents: s.metrics.connectEvents,
    maxLegsConnected: s.metrics.maxLegsConnected,
    centerTopHeight: centerLeg.topHeight,
    leftTopHeight: leftLeg.topHeight,
    rightTopHeight: rightLeg.topHeight,
    avgPlacedQuality: s.metrics.avgPlacedQuality,
    appraisalLevel: s.shop.appraisalLevel,
    score: s.metrics.score,
    tickTo40: reach[40],
    tickTo60: reach[60],
    tickTo80: reach[80],
  };
}

// ---- CLI ----
if (!process.env.SIM_NO_CLI) {
const args = process.argv.slice(2);
function argVal(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
// v3: "1..20" の範囲指定にも対応（v2レビューの再現手順が範囲指定で書かれていたがNaNになっていた）
const seeds = (argVal('seeds') ?? '1,2,3,4,5').split(',').flatMap((tok) => {
  const m = tok.match(/^(\d+)\.\.(\d+)$/);
  if (!m) return [Number(tok)];
  const out: number[] = [];
  for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
  return out;
});
const maxTicks = Number(argVal('maxTicks') ?? TIME_LIMIT);
const strategiesArg = argVal('strategies');
// v3: 掃引用の上書き（例: --override tripodCareful.rungSpacing=4,tripodCareful.firstRung=9）
const overrideArg = argVal('override');
if (overrideArg) {
  for (const kv of overrideArg.split(',')) {
    const [path, value] = kv.split('=');
    const [strat, field] = path.split('.') as [Strategy, keyof StrategyConfig];
    (CONFIG[strat] as unknown as Record<string, unknown>)[field] =
      value === 'true' ? true : value === 'false' ? false : Number(value);
  }
}
const strategies: Strategy[] = strategiesArg
  ? (strategiesArg.split(',') as Strategy[])
  : ['solo', 'soloBraced', 'twin', 'tripod', 'tripodOnce', 'tripodLate', 'tripodCareful', 'tripodDense', 'tripodCarefulLate'];

console.log(`# Rootweave headless simulation (goalHeight=${GOAL_HEIGHT}, timeLimit=${TIME_LIMIT}, maxTicks=${maxTicks})`);
for (const strategy of strategies) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(2);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMaxHeight=${avg((r) => r.maxHeight)} avgCenterTop=${avg((r) => r.centerTopHeight)} avgLeftTop=${avg((r) => r.leftTopHeight)} avgRightTop=${avg((r) => r.rightTopHeight)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgBlocksPlaced=${avg((r) => r.blocksPlaced)} avgBlocksLost=${avg((r) => r.blocksLost)} avgCollapseEvents=${avg((r) => r.collapseEvents)} avgConnectEvents=${avg((r) => r.connectEvents)} avgMaxLegsConnected=${avg((r) => r.maxLegsConnected)} avgAppraisalLevel=${avg((r) => r.appraisalLevel)} avgPlacedQuality=${avg((r) => r.avgPlacedQuality)} avgTickTo40=${avg((r) => r.tickTo40 ?? maxTicks)} avgTickTo80=${avg((r) => r.tickTo80 ?? maxTicks)} reach80=${results.filter((r) => r.tickTo80 !== null).length}/${results.length} avgFinalMoney=${avg((r) => r.money)} wins=${results.filter((r) => r.won).length}/${results.length} deaths=${results.filter((r) => r.finalHp <= 0).length}/${results.length}`,
  );
}
}
