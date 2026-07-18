export const TILE = {
  FLOOR: 0,
  DIRT: 1,
  ROCK: 2,
  ORE_COPPER: 3,
  ORE_IRON: 4,
  ORE_GOLD: 5,
  PROP: 6,
  OUTPOST: 7,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Dir = 'up' | 'down' | 'left' | 'right';

export type EnemyType = 'crawler' | 'brute';

export type Phase = 'mine' | 'shop' | 'gameover';

export type UpgradeId = 'drill' | 'capacity' | 'fuel' | 'atk' | 'hp' | 'atkspeed' | 'skill' | 'muffler' | 'engineering';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'attack'; dir: Dir }
  | { type: 'skill' }
  | { type: 'dash' }
  | { type: 'build'; dir: Dir }
  | { type: 'outpost' }
  | { type: 'buy'; item: UpgradeId }
  | { type: 'wait' };

export interface Enemy {
  id: number;
  type: EnemyType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  atk: number;
  atkCd: number;
  moveCd: number;
}

export interface Digging {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

export interface ShopItemState {
  id: UpgradeId;
  name: string;
  desc: string;
  level: number;
  maxLevel: number;
  nextCost: number | null;
}

export interface PropState {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface OutpostState {
  x: number;
  y: number;
}

export interface Metrics {
  oreMined: number;
  moneyEarned: number;
  maxDepth: number;
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
  /** マップ最下段(y=H-1)へ到達済みか（サイクル8新規: 最深部到達の区切り演出用） */
  bottomReached: boolean;
  score: number;
}

export interface GameState {
  tick: number;
  phase: Phase;
  over: boolean;
  /** 最深部到達バナーの残り表示tick数（0なら非表示。サイクル8新規） */
  bottomReachedBanner: number;
  /** combatRiskLevelが初めてsafe以外になった際の強調バナーの残り表示tick数（0なら非表示。サイクル8新規） */
  firstRiskWarningBanner: number;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    fuel: number;
    maxFuel: number;
    money: number;
    drillPower: number;
    cargoUnits: number;
    maxCapacity: number;
    cargoValue: number;
    atk: number;
    attackCd: number;
    attackCdMax: number;
    hasSkill: boolean;
    skillCd: number;
    skillCdMax: number;
    skillDmg: number;
    /** 掘削音の蓄積値（0〜100）。高いほど周辺の敵湧き確率が上がる。移動すると減衰が速い */
    noise: number;
    /** 直近の移動直後、被ダメージ軽減が乗っている残りtick数（0なら未発動） */
    moveEvasion: number;
    /** 緊急離脱（dash）の残り無敵・すり抜けtick数。0なら未発動 */
    dashActive: number;
    /** dashの残りクールダウン。0なら発動可能 */
    dashCd: number;
    dashCdMax: number;
    /** 支保工設置の残りクールダウン。0なら発動可能 */
    buildCd: number;
    buildCdMax: number;
    /** 支保工の耐久値（工兵レベルで上昇） */
    propMaxHp: number;
    digging: Digging | null;
    /** 現在地から既に掘った床・支保工だけを通って最寄りの基地（地上 or 前線基地）へ戻るのに必要な推定燃料（BFS距離×消費率） */
    estFuelToReturn: number | null;
    /** 直前に確立した基地（地上 or 最も新しい前線基地）からの深さ */
    depthSinceLastBase: number;
    /** 今この場所に前線基地を建てた場合のコスト。建設できない状況でも参考値として常に計算する */
    nextOutpostCost: number;
    /** 今この場所に前線基地を建てられるか（床タイル上・間隔条件・所持金すべて満たす） */
    canBuildOutpost: boolean;
    /** 現在地の深さの敵に対して、目安として耐えられるとされる最大HP（平均的な敵の一撃×5発分） */
    recommendedHp: number;
    /** maxHpがrecommendedHpを下回っている度合い。'safe'=recommendedHp以上、'caution'=70%以上100%未満、'danger'=70%未満 */
    combatRiskLevel: 'safe' | 'caution' | 'danger';
  };
  map: {
    w: number;
    h: number;
    tiles: number[];
  };
  enemies: Enemy[];
  props: PropState[];
  outposts: OutpostState[];
  shop: ShopItemState[];
  metrics: Metrics;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  {
    type: 'move',
    params: { dir: 'up|down|left|right' },
    description:
      '指定方向へ1マス移動。既に掘った床(FLOOR)・支保工(PROP)なら即移動、未採掘タイルなら採掘を開始/継続する（複数tick要する場合あり、要求採掘威力不足なら不発）。敵がいるマスへは移動できない',
  },
  {
    type: 'attack',
    params: { dir: 'up|down|left|right' },
    description: '指定方向に隣接する敵1体を攻撃（単体）。クールダウン中は不発',
  },
  { type: 'skill', params: {}, description: '範囲攻撃: 周囲8方向すべての隣接敵にダメージ。習得済み・クールダウン明けのみ発動' },
  {
    type: 'dash',
    params: {},
    description:
      '緊急離脱: 発動後は数tickの間、敵のいるマスへも無敵ですり抜け移動でき、被ダメージを受けない。固定HPコストを消費し、クールダウン中は不発。購入不要・常時使用可',
  },
  {
    type: 'build',
    params: { dir: 'up|down|left|right' },
    description:
      '指定方向の隣接1マスに支保工(PROP)を設置する。対象が未採掘タイルなら採掘威力不要の迂回橋になる（鉱石だった場合は価値を得られない）。対象が既に掘った床（敵・プレイヤー不在）ならバリケードになり、耐久値が尽きるまで敵はそこを通過できない。所持金を消費しクールダウンがある。対象が範囲外・敵が乗っている・既にPROPの場合は不発',
  },
  {
    type: 'outpost',
    params: {},
    description:
      '現在立っている床タイル(FLOOR)に前線基地(OUTPOST)を建てる。直前に確立した基地（地上 or 最も新しい前線基地）から一定の深さ(depthSinceLastBase)以上離れており、かつ所持金がnextOutpostCost以上ないと不発（canBuildOutpostで判定可能）。成功すると積載中の鉱石を売却・燃料全回復・shopフェーズに入る。前線基地は破壊されず、周囲2マスは敵の湧き・侵入が禁止される安全圏になる',
  },
  {
    type: 'buy',
    params: { item: 'drill|capacity|fuel|atk|hp|atkspeed|skill|muffler|engineering' },
    description: '地上フェーズ・前線基地滞在中のみ有効。指定カテゴリを1レベル購入する',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過（燃料は消費され、掘削音は減衰する）' },
];
