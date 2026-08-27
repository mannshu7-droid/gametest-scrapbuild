/**
 * ヘッドレスシミュレーション: 異なる「ステータス投資の偏り」と「ルート選択方針」を持つボットが
 * 自動プレイし、バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 8000]
 *
 * 検証の狙い（spec.md「サイクル15の狙い」参照）:
 * - atk/defense/mobility/skill の single-stat all-in（008サイクル11の手法を踏襲）を
 *   同一のルート方針（常に危険ルート）で比較し、「ステータス投資の違いが結果に有意差を生むか」を
 *   002finalの積み残し（強化選択の分岐が結果に大差を生まない）に照らして判定する
 * - balanced戦略を safe-always / risky-always / adaptive（危険度ヒントに応じて選ぶ）の
 *   3つのルート方針で比較し、「ルート選択という第三の戦略軸」が意味のある差を生むかを検証する
 */
import { Game } from '../src/core/game';
import type { Action, Dir, GameState, RouteDanger, ShopCategory } from '../src/core/types';

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

function inWaystationRadius(s: GameState): boolean {
  return s.map.waystations.some((wx) => Math.abs(wx - s.player.x) <= s.map.waystationRadius);
}

type StatFocus = 'offense' | 'defense' | 'mobility' | 'skill' | 'balanced';
type RoutePolicy = 'risky-always' | 'safe-always' | 'adaptive' | 'dangeronly-adaptive';

const BALANCED_ORDER: ShopCategory[] = ['offense', 'defense', 'mobility', 'skill'];

const RETREAT_HP_THRESHOLD = 0.3;
const RESUME_ADVANCE_HP_THRESHOLD = 0.7;

class Bot {
  private balancedIndex = 0;
  /** 危機的HPで離脱した後、十分回復するまで前進を止めるヒステリシス（005 IronVeinの帰還判断を踏襲） */
  private retreating = false;

  constructor(
    private statFocus: StatFocus,
    private routePolicy: RoutePolicy,
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

  private decideRoute(s: GameState): RouteDanger {
    if (this.routePolicy === 'risky-always') return 'risky';
    if (this.routePolicy === 'safe-always') return 'safe';
    if (!s.routePreview) return 'safe';
    if (this.routePolicy === 'dangeronly-adaptive') {
      // cycle14で確立した「caution変化を見逃しdangerにだけ反応する」人間を模した診断戦略
      return s.routePreview.risky === 'danger' ? 'safe' : 'risky';
    }
    // adaptive: v3でEVベースのrecommendedに切り替え（v2バグ#4対策）。
    // 従来は生存可否（safe/caution/danger）の3段階だけを見ており、balanced型ビルドは
    // 成長ペースが推奨HPの上昇にほぼ追随するため'danger'まで振れることがなく、
    // risky-alwaysと常に同一判断になっていた
    return s.routePreview.recommended;
  }

  decide(s: GameState): Action {
    if (s.over) return { type: 'wait' };
    if (s.awaitingRouteChoice) return { type: 'chooseRoute', route: this.decideRoute(s) };

    const p = s.player;
    const critical = p.hp <= p.maxHp * RETREAT_HP_THRESHOLD;
    const closeThreat = nearestEnemyWithin(s, 2);

    if (this.retreating && p.hp >= p.maxHp * RESUME_ADVANCE_HP_THRESHOLD) this.retreating = false;
    if (critical) this.retreating = true;

    if (critical && p.dashCd === 0 && closeThreat) {
      return { type: 'dash', dir: 'left' as Dir };
    }

    const nearbyForSkill = countEnemiesWithin(s, p.skillRadius);
    if (p.hasSkill && p.skillCd === 0 && nearbyForSkill >= 2) return { type: 'skill' };

    const adj = nearestEnemyWithin(s, 1);
    if (adj) return { type: 'attack' };

    if (inWaystationRadius(s)) {
      const buy = this.tryBuy(s);
      if (buy) return buy;
    }

    // 回復ヒステリシス中は前進を止めて足踏みし、被弾源から距離を取る（005 IronVein由来のパターン）
    if (this.retreating) return { type: 'move', dir: 'left' as Dir };

    return { type: 'move', dir: 'right' as Dir };
  }
}

interface StrategyDef {
  name: string;
  statFocus: StatFocus;
  routePolicy: RoutePolicy;
}

const STRATEGIES: StrategyDef[] = [
  { name: 'atk-allin-risky', statFocus: 'offense', routePolicy: 'risky-always' },
  { name: 'defense-allin-risky', statFocus: 'defense', routePolicy: 'risky-always' },
  { name: 'mobility-allin-risky', statFocus: 'mobility', routePolicy: 'risky-always' },
  { name: 'skill-allin-risky', statFocus: 'skill', routePolicy: 'risky-always' },
  { name: 'balanced-risky', statFocus: 'balanced', routePolicy: 'risky-always' },
  { name: 'balanced-safe', statFocus: 'balanced', routePolicy: 'safe-always' },
  { name: 'balanced-adaptive', statFocus: 'balanced', routePolicy: 'adaptive' },
  { name: 'balanced-dangeronly', statFocus: 'balanced', routePolicy: 'dangeronly-adaptive' },
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
  waystationsReached: number;
  riskyRoutesTaken: number;
  safeRoutesTaken: number;
  score: number;
}

function runOne(seed: number, def: StrategyDef, maxTicks: number): RunResult {
  const game = new Game(seed);
  const bot = new Bot(def.statFocus, def.routePolicy);
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
    waystationsReached: s.metrics.waystationsReached,
    riskyRoutesTaken: s.metrics.riskyRoutesTaken,
    safeRoutesTaken: s.metrics.safeRoutesTaken,
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

console.log(`# IronMarch headless simulation (maxTicks=${maxTicks})`);
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
    `# ${def.name} summary: avgScore=${avg((r) => r.score)} avgDistance=${avg((r) => r.distanceReached)} avgKills=${avg((r) => r.kills)} avgMoneyEarned=${avg((r) => r.moneyEarned)} avgUpgradesBought=${avg((r) => r.upgradesBought)} avgWaystations=${avg((r) => r.waystationsReached)} avgRisky=${avg((r) => r.riskyRoutesTaken)} avgSafe=${avg((r) => r.safeRoutesTaken)} avgDashUses=${avg((r) => r.dashUses)} avgSkillUses=${avg((r) => r.skillUses)} wins=${wins}/${results.length} deaths=${deaths}/${results.length}`,
  );
}
