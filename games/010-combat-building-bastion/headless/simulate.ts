/**
 * ヘッドレスシミュレーション: 異なる「ステータス投資の偏り」と「建築方針」を持つボットが
 * 自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 8000]
 *
 * 検証の狙い（spec.md「AI評価の観点」参照）:
 * - single-stat all-in（build=none固定）で「ステータス投資の違いが結果に有意差を生むか」
 *   （002final/009finalの積み残し「分岐が大差を生まない」の再検証）
 * - balanced統一のstatFocusで build方針（no-build / outpost-rush / barricade-reactive / builder）
 *   を比較し、「本物の建築（バリケード・前線拠点）がステータス投資と並ぶ意味のある選択肢になるか」
 *   （009のルート選択に代わる本サイクルの核心的検証）を判定する
 */
import { Game } from '../src/core/game';
import type { Action, Dir, GameState, ShopCategory } from '../src/core/types';

function chebyshev(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function nearestEnemyWithin(s: GameState, range: number) {
  let best: GameState['enemies'][number] | null = null;
  let bestDist = Infinity;
  for (const e of s.enemies) {
    const d = chebyshev(e.x, e.y, s.player.x, s.player.y);
    if (d <= range && d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function countEnemiesWithin(s: GameState, range: number): number {
  return s.enemies.filter((e) => chebyshev(e.x, e.y, s.player.x, s.player.y) <= range).length;
}

function inBaseRadius(s: GameState): boolean {
  if (Math.abs(s.player.x - 0) <= s.map.homeRadius) return true;
  return s.outposts.some((ox) => Math.abs(s.player.x - ox) <= s.map.outpostRadius);
}

function hasBarricadeAt(s: GameState, x: number, y: number): boolean {
  return s.barricades.some((b) => b.x === x && b.y === y);
}

type StatFocus = 'offense' | 'defense' | 'mobility' | 'skill' | 'balanced';
type BuildPolicy = 'none' | 'outpost-rush' | 'barricade-reactive' | 'builder';

const BALANCED_ORDER: ShopCategory[] = ['offense', 'defense', 'mobility', 'skill'];

const RETREAT_HP_THRESHOLD = 0.3;
const RESUME_ADVANCE_HP_THRESHOLD = 0.7;
const SWARM_RANGE = 3;
const SWARM_COUNT = 2;

class Bot {
  private balancedIndex = 0;
  /** 危機的HPで離脱した後、十分回復するまで前進を止めるヒステリシス（005 IronVein由来） */
  private retreating = false;

  constructor(
    private statFocus: StatFocus,
    private buildPolicy: BuildPolicy,
  ) {}

  private tryBuy(s: GameState): Action | null {
    if (this.statFocus !== 'balanced') {
      const cat = this.statFocus;
      if (s.player.money >= s.player.shopPrices[cat]) return { type: 'buy', category: cat };
      return null;
    }
    for (let i = 0; i < BALANCED_ORDER.length; i++) {
      const idx = (this.balancedIndex + i) % BALANCED_ORDER.length;
      const cat = BALANCED_ORDER[idx];
      if (s.player.money >= s.player.shopPrices[cat]) {
        this.balancedIndex = (idx + 1) % BALANCED_ORDER.length;
        return { type: 'buy', category: cat };
      }
    }
    return null;
  }

  decide(s: GameState): Action {
    if (s.over) return { type: 'wait' };
    const p = s.player;
    const critical = p.hp <= p.maxHp * RETREAT_HP_THRESHOLD;
    const closeThreat = nearestEnemyWithin(s, 2);

    if (this.retreating && p.hp >= p.maxHp * RESUME_ADVANCE_HP_THRESHOLD) this.retreating = false;
    if (critical) this.retreating = true;

    if (critical && p.dashCd === 0 && closeThreat) {
      return { type: 'dash', dir: 'left' as Dir };
    }

    // 攻撃を最優先にする: 隣接する敵がいるなら常に殴る（建築の空振りループで手が止まらないように）
    const adj = nearestEnemyWithin(s, 1);
    if (adj) return { type: 'attack' };

    const nearbyForSkill = countEnemiesWithin(s, p.skillRadius);
    if (p.hasSkill && p.skillCd === 0 && nearbyForSkill >= 2) return { type: 'skill' };

    if ((this.buildPolicy === 'outpost-rush' || this.buildPolicy === 'builder') && p.canBuildOutpost) {
      return { type: 'build', target: 'outpost' };
    }

    if (this.buildPolicy === 'barricade-reactive' || this.buildPolicy === 'builder') {
      const swarmed = countEnemiesWithin(s, SWARM_RANGE) >= SWARM_COUNT;
      // 隣接する敵がいない（=直接殴れない）遠隔からの圧力のときだけ建てる。
      // 既に前方に自分のバリケードがあるなら再挑戦しても必ず空振りするので試みない
      // （空振り建築の無限ループでボットの手番が完全に止まる致命的softlockをデバッグトレースで検出した）。
      if (swarmed && !hasBarricadeAt(s, p.x + 1, p.y) && p.money >= p.buildCosts.barricade) {
        return { type: 'build', target: 'barricade', dir: 'right' as Dir };
      }
    }

    if (inBaseRadius(s)) {
      const buy = this.tryBuy(s);
      if (buy) return buy;
    }

    if (this.retreating) return { type: 'move', dir: 'left' as Dir };

    return { type: 'move', dir: 'right' as Dir };
  }
}

interface StrategyDef {
  name: string;
  statFocus: StatFocus;
  buildPolicy: BuildPolicy;
}

const STRATEGIES: StrategyDef[] = [
  { name: 'offense-allin', statFocus: 'offense', buildPolicy: 'none' },
  { name: 'defense-allin', statFocus: 'defense', buildPolicy: 'none' },
  { name: 'mobility-allin', statFocus: 'mobility', buildPolicy: 'none' },
  { name: 'skill-allin', statFocus: 'skill', buildPolicy: 'none' },
  { name: 'balanced-no-build', statFocus: 'balanced', buildPolicy: 'none' },
  { name: 'balanced-outpost-rush', statFocus: 'balanced', buildPolicy: 'outpost-rush' },
  { name: 'balanced-barricade-reactive', statFocus: 'balanced', buildPolicy: 'barricade-reactive' },
  { name: 'balanced-builder', statFocus: 'balanced', buildPolicy: 'builder' },
];

interface RunResult {
  seed: number;
  strategy: string;
  ticks: number;
  over: boolean;
  won: boolean;
  finalHp: number;
  money: number;
  moneyEarned: number;
  distanceReached: number;
  kills: number;
  upgradesBought: number;
  dashUses: number;
  skillUses: number;
  outpostsBuilt: number;
  barricadesBuilt: number;
  barricadesLost: number;
  score: number;
}

function runOne(seed: number, def: StrategyDef, maxTicks: number): RunResult {
  const game = new Game(seed);
  const bot = new Bot(def.statFocus, def.buildPolicy);
  let ticks = 0;
  while (!game.over && ticks < maxTicks) {
    game.step(bot.decide(game.getState()));
    ticks++;
  }
  const s = game.getState();
  return {
    seed,
    strategy: def.name,
    ticks,
    over: s.over,
    won: s.won,
    finalHp: s.player.hp,
    money: s.player.money,
    moneyEarned: s.metrics.moneyEarned,
    distanceReached: s.metrics.distanceReached,
    kills: s.metrics.kills,
    upgradesBought: s.metrics.upgradesBought,
    dashUses: s.metrics.dashUses,
    skillUses: s.metrics.skillUses,
    outpostsBuilt: s.metrics.outpostsBuilt,
    barricadesBuilt: s.metrics.barricadesBuilt,
    barricadesLost: s.metrics.barricadesLost,
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
const maxTicks = Number(argVal('maxTicks') ?? 8000);

console.log(`# Bastion headless simulation (maxTicks=${maxTicks})`);
for (const def of STRATEGIES) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, def, maxTicks);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  const deaths = results.filter((r) => !r.won && r.over).length;
  const wins = results.filter((r) => r.won).length;
  console.log(
    `# ${def.name} summary: avgScore=${avg((r) => r.score)} avgDistance=${avg((r) => r.distanceReached)} avgKills=${avg((r) => r.kills)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgOutposts=${avg((r) => r.outpostsBuilt)} avgBarricades=${avg((r) => r.barricadesBuilt)} avgBarricadesLost=${avg((r) => r.barricadesLost)} avgDashUses=${avg((r) => r.dashUses)} avgSkillUses=${avg((r) => r.skillUses)} wins=${wins}/${results.length} deaths=${deaths}/${results.length}`,
  );
}
