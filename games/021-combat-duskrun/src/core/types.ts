export type MoveDir = 'advance' | 'retreat';

export type Route = 'direct' | 'detour';

export type RiskLevel = 'safe' | 'caution' | 'danger';

export type UpgradeKind = 'atk' | 'maxHp' | 'maxDash' | 'maxFlare' | 'daylight' | 'restockFlare';

export type DeathPhase = 'none' | 'push' | 'retreat-day' | 'retreat-night';

export type Action =
  | { type: 'advance' }
  | { type: 'retreat' }
  | { type: 'dash'; dir: MoveDir }
  | { type: 'attack' }
  | { type: 'decoy' }
  | { type: 'chooseRoute'; route: Route }
  | { type: 'buyUpgrade'; which: UpgradeKind }
  | { type: 'wait' };

export interface Enemy {
  id: number;
  distance: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  atkCd: number;
  range: number;
  /** 囮でひるんでいる残りtick。>0の間はプレイヤーから離れる方向へ移動し攻撃しない */
  dazedTicks: number;
}

export interface Metrics {
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
  deathPhase: DeathPhase;
  deathDistance: number;
  score: number;
}

export interface GameState {
  tick: number;
  over: boolean;
  won: boolean;
  day: number;
  player: {
    distance: number;
    hp: number;
    maxHp: number;
    atk: number;
    atkCd: number;
    money: number;
    dashCharges: number;
    maxDashCharges: number;
    flareCharges: number;
    maxFlareCharges: number;
    daylightRemaining: number;
    daylightMax: number;
    night: boolean;
    /** このdayの直近の移動意図。死亡局面(deathPhase)判定に使う */
    intent: 'push' | 'retreat';
    routeLocked: Route | null;
    /** distance>0の間だけ有効。distance/移動速度と残り日照の差(概算) */
    returnMargin: number;
    retreatRiskLevel: RiskLevel;
    routeRecommended: Route;
    upgradeCosts: {
      atk: number;
      maxHp: number;
      maxDash: number;
      maxFlare: number;
      daylight: number;
      restockFlare: number;
    };
  };
  enemies: Enemy[];
  metrics: Metrics;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  { type: 'advance', params: {}, description: '拠点から離れる方向へ1移動する（前進、稼ぎ）' },
  { type: 'retreat', params: {}, description: '拠点へ向かって1移動する（退却）。distance=0到達で当日の帰投確定' },
  { type: 'dash', params: { dir: 'advance|retreat' }, description: '指定方向へ通常より多く移動する（ダッシュ枠消費、拠点内では自然回復）' },
  { type: 'attack', params: {}, description: '射程内で最も近いレイダー1体を攻撃' },
  { type: 'decoy', params: {}, description: '囮を使い、周囲のレイダーをしばらくひるませ引き離す（枠消費、拠点でのみ補充可）' },
  { type: 'chooseRoute', params: { route: 'direct|detour' }, description: '1日1回、帰路の方針を選ぶ（direct=近道だが危険、detour=遠回りだが安全）。distance>0の間いつでも呼べる' },
  { type: 'buyUpgrade', params: { which: 'atk|maxHp|maxDash|maxFlare|daylight|restockFlare' }, description: '拠点内（distance=0）でのみ有効。所持金が足りれば該当項目を強化・補充' },
  { type: 'wait', params: {}, description: '何もせず1ティック経過' },
];
