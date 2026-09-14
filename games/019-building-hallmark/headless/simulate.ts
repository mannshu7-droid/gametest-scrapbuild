/**
 * ヘッドレスシミュレーション: 4種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 4000]
 *
 * - careful（慎重派）: stone/steelを主材とし、鑑定を最優先で満額まで投資してロット選別配置
 *   （常に見えている最高品質のロットを選んで置く）＋ braceを毎フロンティアで同じ側に積み、
 *   垂直に隣接させて常時「連携」させ続ける。揺れ予兆・本震中は無理に登らず様子を見る
 * - informed（鑑定のみ）: careful と同じ鑑定投資＋ロット選別配置を行うが、braceは一切使わない。
 *   鑑定システム単体の効果をbrace連携の効果と切り分けて検証するための診断ボット
 * - reckless（脳筋ビルド）: 最安のwoodだけを買い、鑑定もbraceも一切使わず、揺れも無視してひたすら登る
 *   （spec.mdの「AI評価の観点」にある“脳筋ビルドが通用してしまわないか”の検証用）
 * - sloppy（そこそこ雑）: stoneだけを買い、鑑定もbraceも一切使わず揺れも無視して登る。
 *   004由来の「一切適応しない最悪ケースでも詰まないか」の安全網検証用
 */
import { Game, W, GOAL_HEIGHT, TIME_LIMIT } from '../src/core/game';
import type { Action, GameState, StructMaterial } from '../src/core/types';

type Strategy = 'careful' | 'informed' | 'braced' | 'reckless' | 'sloppy';

/** HPがこの割合を下回ったら登坂を中断し地上へ退避する（v2で追加、004最大の積み残し対応の副作用だった「常に死んで終わる」問題への対策） */
const RETREAT_HP_RATIO = 0.4;
/** 地上退避後、この割合までHPが回復するまで再度登り始めない */
const RESUME_HP_RATIO = 0.85;

class Bot {
  private descending = false;
  private appraisalBuys = 0;
  private recovering = false;

  constructor(private strategy: Strategy) {}

  private materialAt(s: GameState, x: number, y: number): string | null {
    const b = s.world.blocks.find((bl) => bl.x === x && bl.y === y);
    return b ? b.material : null;
  }

  private blockAt(s: GameState, x: number, y: number): boolean {
    return this.materialAt(s, x, y) !== null;
  }

  private usesInsight(): boolean {
    return this.strategy === 'careful' || this.strategy === 'informed';
  }

  private usesBrace(): boolean {
    return this.strategy === 'careful' || this.strategy === 'braced';
  }

  private pickMaterial(s: GameState): StructMaterial | null {
    const inv = s.player.inventory;
    if (this.strategy === 'careful' || this.strategy === 'braced') {
      if (inv.steel > 0) return 'steel';
      if (inv.stone > 0) return 'stone';
      return null;
    }
    if (this.strategy === 'informed' || this.strategy === 'sloppy') {
      return inv.stone > 0 ? 'stone' : null;
    }
    return inv.wood > 0 ? 'wood' : null; // reckless
  }

  /** 見えている中で最も品質が高いロットのindexを返す。未鑑定(全部null)ならundefined(=キュー先頭任せ) */
  private bestLotIndex(s: GameState, mat: StructMaterial): number | undefined {
    if (!this.usesInsight()) return undefined;
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

  private maybeBuyAppraisal(s: GameState, reserve: number): Action | null {
    if (!this.usesInsight() || this.appraisalBuys >= 3 || s.shop.appraisalNextCost === null) return null;
    if (s.player.money < s.shop.appraisalNextCost + reserve) return null;
    this.appraisalBuys++;
    return { type: 'buy', item: 'appraiser' };
  }

  private maybeBuy(s: GameState): Action | null {
    const p = s.player;
    if (this.strategy === 'careful') {
      if (p.inventory.stone < 3 && p.money >= 9) return { type: 'buy', item: 'stone' };
      if (p.inventory.brace < 6 && p.money >= 6) return { type: 'buy', item: 'brace' };
      const appraisal = this.maybeBuyAppraisal(s, 9 * 3 + 6 * 2);
      if (appraisal) return appraisal;
      if (p.inventory.steel < 8 && p.money >= 18) return { type: 'buy', item: 'steel' };
      if (p.inventory.stone < 10 && p.money >= 9) return { type: 'buy', item: 'stone' };
      return null;
    }
    if (this.strategy === 'braced') {
      // careful から鑑定投資だけを抜いた診断ボット（brace連携単体の効果を切り分ける）
      if (p.inventory.stone < 3 && p.money >= 9) return { type: 'buy', item: 'stone' };
      if (p.inventory.brace < 6 && p.money >= 6) return { type: 'buy', item: 'brace' };
      if (p.inventory.steel < 8 && p.money >= 18) return { type: 'buy', item: 'steel' };
      if (p.inventory.stone < 10 && p.money >= 9) return { type: 'buy', item: 'stone' };
      return null;
    }
    if (this.strategy === 'informed') {
      if (p.inventory.stone < 4 && p.money >= 9) return { type: 'buy', item: 'stone' };
      const appraisal = this.maybeBuyAppraisal(s, 9 * 3);
      if (appraisal) return appraisal;
      if (p.inventory.stone < 10 && p.money >= 9) return { type: 'buy', item: 'stone' };
      return null;
    }
    if (this.strategy === 'sloppy') {
      if (p.inventory.stone < 4 && p.money >= 9) return { type: 'buy', item: 'stone' };
      return null;
    }
    if (p.inventory.wood < 12 && p.money >= 4) return { type: 'buy', item: 'wood' };
    return null;
  }

  private placeOrDescend(s: GameState, atBlockFrontier: boolean): Action {
    const p = s.player;
    // careful: 毎フロンティアで左側にbraceを積む。同じx=player.x-1に高さ1刻みで並ぶため、
    // 前回設置したbrace(y-1)と常にチェビシェフ距離1で隣接し、連携が途切れない
    if (this.usesBrace() && atBlockFrontier && p.inventory.brace > 0) {
      if (p.x > 0 && !this.blockAt(s, p.x - 1, p.y)) {
        return { type: 'place', dir: 'left', material: 'brace' };
      }
      if (p.x < W - 1 && !this.blockAt(s, p.x + 1, p.y)) {
        return { type: 'place', dir: 'right', material: 'brace' };
      }
    }
    const material = this.pickMaterial(s);
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

    // HPが低くなったら登坂を中断し地上へ退避、地上で回復するまで再び登らない（careful/braced/informed限定の安全行動）
    const smart = this.usesInsight() || this.usesBrace();
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
      return { type: 'move', dir: 'down' };
    }

    if (this.recovering && p.y === 0) {
      const buy = this.maybeBuy(s);
      return buy ?? { type: 'wait' };
    }

    if (smart && s.shake.state !== 'idle' && s.structure.maxStressRatio > 0.55 && p.y > 0) {
      return { type: 'wait' };
    }

    if (p.y === 0) {
      const buy = this.maybeBuy(s);
      if (buy) return buy;
    }

    const atBlock = this.blockAt(s, p.x, p.y);
    const aboveBlock = this.blockAt(s, p.x, p.y + 1);
    if (aboveBlock) return { type: 'move', dir: 'up' };
    const action = this.placeOrDescend(s, atBlock);
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
  blindPlacements: number;
  avgPlacedQuality: number;
  appraisalLevel: number;
  linkedBraceCount: number;
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
    blindPlacements: s.metrics.blindPlacements,
    avgPlacedQuality: s.metrics.avgPlacedQuality,
    appraisalLevel: s.shop.appraisalLevel,
    linkedBraceCount: s.structure.linkedBraceCount,
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
  : ['careful', 'braced', 'informed', 'reckless', 'sloppy'];

console.log(`# Hallmark headless simulation (goalHeight=${GOAL_HEIGHT}, timeLimit=${TIME_LIMIT}, maxTicks=${maxTicks})`);
for (const strategy of strategies) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(2);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMaxHeight=${avg((r) => r.maxHeight)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgBlocksPlaced=${avg((r) => r.blocksPlaced)} avgBlocksLost=${avg((r) => r.blocksLost)} avgCollapseEvents=${avg((r) => r.collapseEvents)} avgAppraisalLevel=${avg((r) => r.appraisalLevel)} avgPlacedQuality=${avg((r) => r.avgPlacedQuality)} avgLinkedBraces=${avg((r) => r.linkedBraceCount)} avgBlindPlacements=${avg((r) => r.blindPlacements)} wins=${results.filter((r) => r.won).length}/${results.length} deaths=${results.filter((r) => r.finalHp <= 0).length}/${results.length}`,
  );
}
