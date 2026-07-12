/**
 * ヘッドレスシミュレーション: 2種類のボットが自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 4000]
 *
 * - careful（慎重派）: stone/steelを主材とし、brace・stabilizerを併用して補強しながら登る。
 *   揺れ予兆・本震中は無理に登らず様子を見る
 * - reckless（脳筋ビルド）: 最安のwoodだけを買い、補強材を一切使わず、揺れも無視してひたすら登る
 *   （spec.mdの「AI評価の観点」にある“資材だけ積む脳筋ビルドが通用してしまわないか”の検証用）
 */
import { Game, W, H, GOAL_HEIGHT, TIME_LIMIT } from '../src/core/game';
import type { Action, GameState, Material } from '../src/core/types';

type Strategy = 'careful' | 'reckless';

class Bot {
  private stabilizerBought = 0;
  private stabilizerPlaced = false;
  // 資材切れで地上へ戻る途中は「登る先に既存ブロックがあるなら登る」判定を無視しないと、
  // フロンティア(登り切った先端)と資材切れ地点の間を永遠に往復するだけになる
  private descending = false;

  constructor(private strategy: Strategy) {}

  private materialAt(s: GameState, x: number, y: number): Material | null {
    const b = s.world.blocks.find((bl) => bl.x === x && bl.y === y);
    return b ? b.material : null;
  }

  private blockAt(s: GameState, x: number, y: number): boolean {
    return this.materialAt(s, x, y) !== null;
  }

  private pickMaterial(s: GameState): Material | null {
    const inv = s.player.inventory;
    if (this.strategy === 'careful') {
      // steelはstoneより軽くて頑丈（コストは高い）なので、買えている分は優先して使う
      if (inv.steel > 0) return 'steel';
      if (inv.stone > 0) return 'stone';
      if (inv.wood > 0) return 'wood';
      return null;
    }
    return inv.wood > 0 ? 'wood' : null;
  }

  private maybeBuy(s: GameState): Action | null {
    const p = s.player;
    if (this.strategy === 'careful') {
      // 主材とbraceをほぼ1:1で揃える（毎段ブレースを入れて高層化する戦略の検証）。
      // 有り金を全部補強材に使い果たして一度も登れない、という初期バグの再発防止で主材を優先
      if (p.inventory.stone < 3 && p.money >= 9) return { type: 'buy', material: 'stone' };
      if (p.inventory.brace < p.inventory.stone + p.inventory.steel && p.money >= 6) {
        return { type: 'buy', material: 'brace' };
      }
      if (this.stabilizerBought === 0 && p.money >= 30 && s.shop.stabilizerRemaining > 0) {
        this.stabilizerBought++;
        return { type: 'buy', material: 'stabilizer' };
      }
      if (p.inventory.steel < 8 && p.money >= 18) {
        return { type: 'buy', material: 'steel' };
      }
      if (p.inventory.stone < 10 && p.money >= 9) return { type: 'buy', material: 'stone' };
      return null;
    }
    if (p.inventory.wood < 12 && p.money >= 4) return { type: 'buy', material: 'wood' };
    return null;
  }

  private placeOrDescend(s: GameState, atBlockFrontier: boolean): Action {
    const p = s.player;
    if (this.strategy === 'careful' && atBlockFrontier && p.inventory.stabilizer > 0 && !this.stabilizerPlaced) {
      if (p.x > 0 && !this.blockAt(s, p.x - 1, p.y)) {
        this.stabilizerPlaced = true;
        return { type: 'place', dir: 'left', material: 'stabilizer' };
      }
      if (p.x < W - 1 && !this.blockAt(s, p.x + 1, p.y)) {
        this.stabilizerPlaced = true;
        return { type: 'place', dir: 'right', material: 'stabilizer' };
      }
    }
    if (this.strategy === 'careful' && atBlockFrontier && p.inventory.brace > 0) {
      const hasBraceHere = this.materialAt(s, p.x - 1, p.y) === 'brace' || this.materialAt(s, p.x + 1, p.y) === 'brace';
      if (!hasBraceHere) {
        if (p.x > 0 && !this.blockAt(s, p.x - 1, p.y)) return { type: 'place', dir: 'left', material: 'brace' };
        if (p.x < W - 1 && !this.blockAt(s, p.x + 1, p.y)) return { type: 'place', dir: 'right', material: 'brace' };
      }
    }
    const material = this.pickMaterial(s);
    if (material) return { type: 'place', dir: 'up', material };
    if (p.y > 0) return { type: 'move', dir: 'down' };
    return { type: 'wait' };
  }

  decide(s: GameState): Action {
    const p = s.player;

    if (p.y === 0) this.descending = false;

    if (this.descending) {
      return { type: 'move', dir: 'down' };
    }

    if (this.strategy === 'careful' && s.shake.state !== 'idle' && s.structure.maxStressRatio > 0.55 && p.y > 0) {
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

console.log(
  `# SkySpire headless simulation (grid ${W}x${H}, goalHeight=${GOAL_HEIGHT}, timeLimit=${TIME_LIMIT}, maxTicks=${maxTicks})`,
);
for (const strategy of ['careful', 'reckless'] as Strategy[]) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, strategy, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  console.log(
    `# ${strategy} summary: avgScore=${avg((r) => r.score)} avgMaxHeight=${avg((r) => r.maxHeight)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgBlocksPlaced=${avg((r) => r.blocksPlaced)} avgBlocksLost=${avg((r) => r.blocksLost)} avgCollapseEvents=${avg((r) => r.collapseEvents)} avgFallDamage=${avg((r) => r.fallDamageTaken)} avgDebrisDamage=${avg((r) => r.debrisDamageTaken)} wins=${results.filter((r) => r.won).length}/${results.length} deaths=${results.filter((r) => r.over && !r.won && r.finalHp <= 0).length}/${results.length}`,
  );
}
