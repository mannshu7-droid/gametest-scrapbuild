/**
 * ヘッドレスシミュレーション: 6種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 4000]
 *
 * - solo（中央のみ・対照群）: 中央トランクだけに資材を積み続ける。019の単一柱と等価な
 *   「多脚なし」のベースライン。avgMaxHeightの頭打ちが本作でも再現するかを確認する診断ボット
 * - soloBraced（中央のみ＋brace連携）: soloにbrace連携のみ追加。「brace単体では頭打ちを
 *   突破できない」ことを確認するためのもう一つのベースライン
 * - twin（中央＋右脚1本、早期接続）: 最小構成の多脚。右脚を高さ6まで建てて早期に接続する
 * - tripod（中央＋左右2脚、早期接続）: 本命の多脚構成。両脚を高さ6で早期接続する
 * - tripodLate（中央＋左右2脚、後期接続）: tripodと脚本数は同じだが、接続高度を20まで
 *   引き上げる。「いつ繋ぐか」という能動的な選択がavgMaxHeight・scoreに与える影響を
 *   tripodと比較して検証する診断ボット
 * - tripodCareful（中央＋左右2脚、早期接続＋brace連携＋鑑定ロット選別）: 019で確立した
 *   パターン（brace連携・鑑定投資）が多脚接続と素直に積み重なるかを検証する
 */
import { BEAM_COST, Game, GOAL_HEIGHT, LEG_X, TIME_LIMIT } from '../src/core/game';
import type { Action, GameState, LegId, StructMaterial } from '../src/core/types';

type Strategy = 'solo' | 'soloBraced' | 'twin' | 'tripod' | 'tripodLate' | 'tripodCareful';

interface StrategyConfig {
  legsToBuild: LegId[];
  connectHeight: number;
  usesBrace: boolean;
  usesInsight: boolean;
}

const CONFIG: Record<Strategy, StrategyConfig> = {
  solo: { legsToBuild: [], connectHeight: 0, usesBrace: false, usesInsight: false },
  soloBraced: { legsToBuild: [], connectHeight: 0, usesBrace: true, usesInsight: false },
  twin: { legsToBuild: ['right'], connectHeight: 4, usesBrace: false, usesInsight: false },
  tripod: { legsToBuild: ['left', 'right'], connectHeight: 4, usesBrace: false, usesInsight: false },
  tripodLate: { legsToBuild: ['left', 'right'], connectHeight: 9, usesBrace: false, usesInsight: false },
  tripodCareful: { legsToBuild: ['left', 'right'], connectHeight: 4, usesBrace: true, usesInsight: true },
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

  private maybeBuy(s: GameState): Action | null {
    const p = s.player;
    // 資材を優先して確保し、余裕があるぶんだけbrace・鑑定に回す（brace/鑑定の先買いで
    // 資材が買えなくなり登坂自体が止まる事態を避ける）
    if (p.inventory.stone < 4 && p.money >= 9) return { type: 'buy', item: 'stone' };
    if (this.cfg.usesInsight && this.appraisalBuys < 3 && s.shop.appraisalNextCost !== null) {
      if (p.money >= s.shop.appraisalNextCost + 9 * 3) {
        this.appraisalBuys++;
        return { type: 'buy', item: 'appraiser' };
      }
    }
    if (this.cfg.usesBrace && p.inventory.brace < 4 && p.money >= 6 + 9 * 2) return { type: 'buy', item: 'brace' };
    if (p.inventory.steel < 6 && p.money >= 18 + 9 * 2) return { type: 'buy', item: 'steel' };
    if (p.inventory.stone < 10 && p.money >= 9) return { type: 'buy', item: 'stone' };
    return null;
  }

  /** 現在どの脚で何をすべきかを状態から導出する（ステートレス） */
  private currentTarget(s: GameState): { legId: LegId; targetHeight: number; wantConnect: boolean } {
    const center = this.legOf(s, 'center');
    if (this.cfg.legsToBuild.length > 0 && center.topHeight < this.cfg.connectHeight) {
      return { legId: 'center', targetHeight: this.cfg.connectHeight, wantConnect: false };
    }
    for (const legId of this.cfg.legsToBuild) {
      const li = this.legOf(s, legId);
      if (!li.connected) {
        if (li.topHeight < this.cfg.connectHeight) {
          return { legId, targetHeight: this.cfg.connectHeight, wantConnect: false };
        }
        return { legId, targetHeight: this.cfg.connectHeight, wantConnect: true };
      }
    }
    return { legId: 'center', targetHeight: Number.POSITIVE_INFINITY, wantConnect: false };
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

    if (this.descending) return { type: 'move', dir: 'down' };
    if (this.recovering && p.y === 0) return this.maybeBuy(s) ?? { type: 'wait' };

    const maxStress = Math.max(...s.legs.map((l) => l.maxStressRatio));
    if (smart && s.shake.state !== 'idle' && maxStress > 0.55 && p.y > 0) {
      return { type: 'wait' };
    }

    const target = this.currentTarget(s);
    const targetX = LEG_X[target.legId];

    if (p.x !== targetX) {
      if (p.y !== 0) {
        this.descending = true;
        return { type: 'move', dir: 'down' };
      }
      return { type: 'move', dir: p.x < targetX ? 'right' : 'left' };
    }

    if (p.y === 0) {
      const buy = this.maybeBuy(s);
      if (buy) return buy;
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
  };
}

// ---- CLI ----
const args = process.argv.slice(2);
function argVal(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const seeds = (argVal('seeds') ?? '1,2,3,4,5').split(',').map(Number);
const maxTicks = Number(argVal('maxTicks') ?? Math.min(TIME_LIMIT + 200, 4000));
const strategiesArg = argVal('strategies');
const strategies: Strategy[] = strategiesArg
  ? (strategiesArg.split(',') as Strategy[])
  : ['solo', 'soloBraced', 'twin', 'tripod', 'tripodLate', 'tripodCareful'];

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
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMaxHeight=${avg((r) => r.maxHeight)} avgCenterTop=${avg((r) => r.centerTopHeight)} avgLeftTop=${avg((r) => r.leftTopHeight)} avgRightTop=${avg((r) => r.rightTopHeight)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgBlocksPlaced=${avg((r) => r.blocksPlaced)} avgBlocksLost=${avg((r) => r.blocksLost)} avgCollapseEvents=${avg((r) => r.collapseEvents)} avgConnectEvents=${avg((r) => r.connectEvents)} avgMaxLegsConnected=${avg((r) => r.maxLegsConnected)} avgAppraisalLevel=${avg((r) => r.appraisalLevel)} avgPlacedQuality=${avg((r) => r.avgPlacedQuality)} wins=${results.filter((r) => r.won).length}/${results.length} deaths=${results.filter((r) => r.finalHp <= 0).length}/${results.length}`,
  );
}
