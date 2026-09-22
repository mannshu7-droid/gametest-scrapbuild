/**
 * ヘッドレスシミュレーション: 「日没の撤退戦」で以下を検証するボット戦略群を自動プレイし、
 * バランス指標をJSONで出力する。
 * 実行: npm run simulate [-- --seeds 1,2,3 --maxTicks 20000]
 *
 * 検証の狙い（spec.md「AI評価の観点」参照）:
 * - push-forever（帰還判断なし・daylight投資なし）が、帰還判断つきの戦略に対してscoreで
 *   劣る（＝帰還判断というスキルに意味がある）ことを確認する
 * - cautious-daylight vs cautious-no-daylight で、daylight強化（帰路投資）が
 *   deathPhase='retreat-night'の発生率を実際に下げるかを検証する（020-finalの核心課題への回答）
 * - direct-always / detour-always / adaptive-route の3択で、ルート選択が意味のある差を生むか
 *   （一方が支配的最適解になっていないか）を検証する
 * - decoy-heavy vs no-decoy で、囮の使用が生存・scoreに実際に効くかを検証する
 */
import { ATK_RANGE, Game } from '../src/core/game';
import type { Action, GameState, Route, UpgradeKind } from '../src/core/types';

function nearCount(s: GameState, range: number): number {
  return s.enemies.filter((e) => Math.abs(e.distance - s.player.distance) <= range).length;
}

interface BotConfig {
  name: string;
  buyOrder: UpgradeKind[];
  marginRetreatThreshold: number;
  hpCriticalRatio: number;
  routePolicy: 'adaptive' | Route;
  useDecoy: boolean;
  useDash: boolean;
}

class Bot {
  private buyIndex = 0;
  private retreating = false;

  constructor(private cfg: BotConfig) {}

  private tryBuy(s: GameState): Action | null {
    const p = s.player;
    if (this.cfg.useDecoy && p.flareCharges < p.maxFlareCharges && p.upgradeCosts.restockFlare > 0 && p.money >= p.upgradeCosts.restockFlare) {
      return { type: 'buyUpgrade', which: 'restockFlare' };
    }
    const order = this.cfg.buyOrder;
    for (let i = 0; i < order.length; i++) {
      const idx = (this.buyIndex + i) % order.length;
      const which = order[idx];
      const cost = p.upgradeCosts[which === 'restockFlare' ? 'restockFlare' : which];
      if (p.money >= cost) {
        this.buyIndex = (idx + 1) % order.length;
        return { type: 'buyUpgrade', which };
      }
    }
    return null;
  }

  decide(s: GameState): Action {
    if (s.over) return { type: 'wait' };
    const p = s.player;

    if (p.distance === 0) {
      this.retreating = false;
      const buy = this.tryBuy(s);
      if (buy) return buy;
      return { type: 'advance' };
    }

    const hpRatio = p.hp / p.maxHp;
    if (!this.retreating) {
      if (hpRatio <= this.cfg.hpCriticalRatio || p.returnMargin <= this.cfg.marginRetreatThreshold) {
        this.retreating = true;
      }
    }

    const swarmed = nearCount(s, ATK_RANGE) >= 2;
    const inRange = nearCount(s, ATK_RANGE) > 0;

    if (this.retreating) {
      if (p.routeLocked === null) {
        const route = this.cfg.routePolicy === 'adaptive' ? p.routeRecommended : this.cfg.routePolicy;
        return { type: 'chooseRoute', route };
      }
      // 複数体に囲まれたら打ち合わず離脱を優先する（1体だけなら退きながら戦う）
      if (swarmed && this.cfg.useDecoy && p.flareCharges > 0) return { type: 'decoy' };
      if (swarmed && this.cfg.useDash && p.dashCharges > 0) return { type: 'dash', dir: 'retreat' };
      if (inRange && p.atkCd === 0) return { type: 'attack' };
      if (this.cfg.useDash && p.dashCharges > 0 && (p.night || p.returnMargin < 0)) {
        return { type: 'dash', dir: 'retreat' };
      }
      return { type: 'retreat' };
    }

    if (inRange && p.atkCd === 0) return { type: 'attack' };
    return { type: 'advance' };
  }
}

const STRATEGIES: BotConfig[] = [
  {
    name: 'push-forever',
    buyOrder: ['atk', 'maxHp', 'maxDash', 'maxFlare', 'daylight'],
    marginRetreatThreshold: -100000,
    hpCriticalRatio: 0.25,
    routePolicy: 'direct',
    useDecoy: false,
    useDash: false,
  },
  {
    name: 'cautious-daylight',
    buyOrder: ['daylight', 'daylight', 'maxHp', 'atk', 'maxDash', 'maxFlare'],
    marginRetreatThreshold: 60,
    hpCriticalRatio: 0.4,
    routePolicy: 'adaptive',
    useDecoy: true,
    useDash: true,
  },
  {
    name: 'cautious-no-daylight',
    buyOrder: ['atk', 'maxHp', 'maxDash', 'maxFlare'],
    marginRetreatThreshold: 60,
    hpCriticalRatio: 0.4,
    routePolicy: 'adaptive',
    useDecoy: true,
    useDash: true,
  },
  {
    name: 'direct-always',
    buyOrder: ['atk', 'maxHp', 'maxDash', 'maxFlare', 'daylight'],
    marginRetreatThreshold: 50,
    hpCriticalRatio: 0.35,
    routePolicy: 'direct',
    useDecoy: true,
    useDash: true,
  },
  {
    name: 'detour-always',
    buyOrder: ['atk', 'maxHp', 'maxDash', 'maxFlare', 'daylight'],
    marginRetreatThreshold: 50,
    hpCriticalRatio: 0.35,
    routePolicy: 'detour',
    useDecoy: true,
    useDash: true,
  },
  {
    name: 'adaptive-route',
    buyOrder: ['atk', 'maxHp', 'maxDash', 'maxFlare', 'daylight'],
    marginRetreatThreshold: 50,
    hpCriticalRatio: 0.35,
    routePolicy: 'adaptive',
    useDecoy: true,
    useDash: true,
  },
  {
    name: 'decoy-heavy',
    // v2レビューで「maxFlareを2連続最優先」の購入順がatk/maxHp投資を遅らせ、decoy自体の効果とは
    // 無関係にscore ROIを悪化させていたと判明したため、atk/maxHpを先に確保してからflare投資へ進む
    // 順番へ変更した（購入順依存性の検証結果はPR本文に記載）
    buyOrder: ['atk', 'maxHp', 'maxFlare', 'maxFlare', 'maxDash', 'daylight'],
    marginRetreatThreshold: 50,
    hpCriticalRatio: 0.35,
    routePolicy: 'adaptive',
    useDecoy: true,
    useDash: true,
  },
  {
    name: 'no-decoy',
    buyOrder: ['atk', 'maxHp', 'maxDash', 'daylight'],
    marginRetreatThreshold: 50,
    hpCriticalRatio: 0.35,
    routePolicy: 'adaptive',
    useDecoy: false,
    useDash: true,
  },
  {
    name: 'p01',
    buyOrder: ['atk', 'atk', 'maxHp', 'maxDash', 'daylight', 'maxFlare'],
    marginRetreatThreshold: 15,
    hpCriticalRatio: 0.25,
    routePolicy: 'adaptive',
    useDecoy: true,
    useDash: true,
  },
  {
    name: 'p02',
    buyOrder: ['maxHp', 'daylight', 'atk', 'maxFlare', 'maxDash'],
    marginRetreatThreshold: 90,
    hpCriticalRatio: 0.5,
    routePolicy: 'adaptive',
    useDecoy: true,
    useDash: true,
  },
];

interface RunResult {
  seed: number;
  strategy: string;
  ticks: number;
  over: boolean;
  won: boolean;
  finalHp: number;
  daysSurvived: number;
  maxDistanceReached: number;
  kills: number;
  moneyEarned: number;
  upgradesBought: number;
  dashUses: number;
  decoyUses: number;
  directRoutesTaken: number;
  detourRoutesTaken: number;
  nightEntries: number;
  died: boolean;
  deathPhase: string;
  deathDistance: number;
  score: number;
}

function runOne(seed: number, cfg: BotConfig, maxTicks: number): RunResult {
  const game = new Game(seed);
  const bot = new Bot(cfg);
  let ticks = 0;
  while (!game.over && ticks < maxTicks) {
    game.step(bot.decide(game.getState()));
    ticks++;
  }
  const s = game.getState();
  return {
    seed,
    strategy: cfg.name,
    ticks,
    over: s.over,
    won: s.won,
    finalHp: Math.round(s.player.hp),
    daysSurvived: s.metrics.daysSurvived,
    maxDistanceReached: s.metrics.maxDistanceReached,
    kills: s.metrics.kills,
    moneyEarned: s.metrics.moneyEarned,
    upgradesBought: s.metrics.upgradesBought,
    dashUses: s.metrics.dashUses,
    decoyUses: s.metrics.decoyUses,
    directRoutesTaken: s.metrics.directRoutesTaken,
    detourRoutesTaken: s.metrics.detourRoutesTaken,
    nightEntries: s.metrics.nightEntries,
    died: s.metrics.died,
    deathPhase: s.metrics.deathPhase,
    deathDistance: Math.round(s.metrics.deathDistance),
    score: s.metrics.score,
  };
}

// ---- CLI ----
const args = process.argv.slice(2);
function argVal(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const seedsArg = argVal('seeds') ?? '1..20';
const seeds = seedsArg.includes('..')
  ? (() => {
      const [a, b] = seedsArg.split('..').map(Number);
      const out: number[] = [];
      for (let i = a; i <= b; i++) out.push(i);
      return out;
    })()
  : seedsArg.split(',').map(Number);
const maxTicks = Number(argVal('maxTicks') ?? 20000);

console.log(`# DuskRun headless simulation (maxTicks=${maxTicks}, seeds=${seeds[0]}..${seeds[seeds.length - 1]}, n=${seeds.length})`);
for (const cfg of STRATEGIES) {
  const results: RunResult[] = [];
  for (const seed of seeds) {
    const r = runOne(seed, cfg, maxTicks);
    results.push(r);
  }
  const avg = (f: (r: RunResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
  const deaths = results.filter((r) => r.died).length;
  const wins = results.filter((r) => r.won).length;
  const unresolved = results.filter((r) => !r.over).length;
  if (unresolved > 0) console.log(`  !! ${cfg.name}: ${unresolved}件がmaxTicksまでにover=falseのまま終了（ソフトロック疑い）`);
  const deathPhaseCounts = (phase: string) => results.filter((r) => r.deathPhase === phase).length;
  console.log(
    `${cfg.name}: avgScore=${avg((r) => r.score)} avgDays=${avg((r) => r.daysSurvived)} avgDist=${avg((r) => r.maxDistanceReached)} ` +
      `avgKills=${avg((r) => r.kills)} avgMoney=${avg((r) => r.moneyEarned)} avgUpgrades=${avg((r) => r.upgradesBought)} ` +
      `avgDash=${avg((r) => r.dashUses)} avgDecoy=${avg((r) => r.decoyUses)} avgDirect=${avg((r) => r.directRoutesTaken)} avgDetour=${avg((r) => r.detourRoutesTaken)} avgNightEntries=${avg((r) => r.nightEntries)} ` +
      `wins=${wins}/${results.length} deaths=${deaths}/${results.length} ` +
      `deathPhase[push=${deathPhaseCounts('push')} retreat-day=${deathPhaseCounts('retreat-day')} retreat-night=${deathPhaseCounts('retreat-night')}]`,
  );
}
