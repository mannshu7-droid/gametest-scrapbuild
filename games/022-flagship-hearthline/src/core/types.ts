export const TILE = {
  FLOOR: 0,
  DIRT: 1,
  ROCK: 2,
  ORE_COPPER: 3,
  ORE_IRON: 4,
  ORE_GOLD: 5,
  GAS: 6,
  UNSTABLE: 7,
  /** 未探査（018新規）。フォグの外にある未採掘タイルの実体を隠すための表示専用の値。
   * 内部の実タイル配列(this.tiles)には現れず、getState()が公開するmap.tilesにのみ現れる */
  UNSCANNED: 8,
} as const;
export type TileId = (typeof TILE)[keyof typeof TILE];

export type Dir = 'up' | 'down' | 'left' | 'right';

export type EnemyType = 'skirmisher' | 'archer' | 'brute';

export type RiskLevel = 'safe' | 'caution' | 'danger';

export type Phase = 'day' | 'night';

/** 死亡直前の状況分類（022新規、020/021-finalの教訓でcore Metricsへ標準搭載）。
 * 020-finalが発見した「防衛系の死亡94%は夜のフィールド」を、tickごとの死亡判定時に直接分類する */
export type DeathPhase = 'night-field' | 'day-siege' | 'in-base' | 'none';

export type ShopItemId =
  | 'offense'
  | 'mobility'
  | 'vitality'
  | 'drill'
  | 'fuel'
  | 'digspeed'
  | 'lantern'
  | 'hazardresist'
  | 'capacity'
  | 'teleport'
  | 'basedefense'
  | 'scanner'
  | 'charge'
  | 'appraisal';

export type BuildTarget = 'barricade' | 'outpost' | 'turret';

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'attack' }
  | { type: 'dash'; dir: Dir }
  | { type: 'buy'; item: ShopItemId }
  | { type: 'build'; target: 'barricade'; dir: Dir; lotIndex?: number }
  | { type: 'build'; target: 'outpost' }
  | { type: 'build'; target: 'turret'; dir: Dir; lotIndex?: number }
  | { type: 'teleport' }
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
  /** 遠距離型(archer)の射程。近接型は1 */
  range: number;
  /** 夜間レイダーか（true時のみ拠点圏内へ侵入し拠点HPを攻撃できる） */
  isRaider: boolean;
  /** isRaider時の目標拠点x座標（0=ホーム） */
  targetBaseX: number;
}

export interface Barricade {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 建材ロットの真の品質倍率（020新規、0.5〜1.5）。設置後は鑑定Lvに関係なく常に公開される */
  quality: number;
  /** 隣接（チェビシェフ距離1）に別のバリケード/タレットがあり「連携」状態か（020新規、毎回再計算） */
  linked: boolean;
}

/**
 * 拠点防衛タレット（016新規）。バリケードと同じく「敵に阻まれ攻撃を吸う」obstacleとしても機能しつつ、
 * 015の`basedefense`（恒久ステータス投資・全拠点一括）とは異なり、プレイヤーが拠点保護半径内の
 * 特定タイルに実際に配置する建築物として、毎tick自動でレイダーを迎撃する（射程TURRET_RANGE）。
 * 破壊されうる・拠点ごとに設置数上限があるという「建築ならではのリスクと配置判断」を持つ
 */
export interface Turret {
  id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 次の自動攻撃までの残りtick */
  atkCd: number;
  /** 建材ロットの真の品質倍率（020新規）。HPと自動攻撃ダメージの両方に乗る */
  quality: number;
  /** 隣接に別のバリケード/タレットがある連携状態か（020新規、被ダメージ軽減の対象） */
  linked: boolean;
  /** 隣接にバリケードがある「盾持ち」状態か（v2新規、攻撃ダメージ強化の対象） */
  shielded?: boolean;
}

export interface Base {
  /** 拠点のx座標（0=ホーム） */
  x: number;
  isHome: boolean;
  hp: number;
  maxHp: number;
}

export interface Digging {
  x: number;
  y: number;
  remaining: number;
  total: number;
}

/** 拠点ごとの今夜の脅威予告（014新規）。昼フェーズ中のみ意味を持つ */
export interface BaseForecast {
  x: number;
  isHome: boolean;
  level: RiskLevel;
}

export interface RiskEscalationBanner {
  level: RiskLevel;
  ticksLeft: number;
}

export interface ShopItemState {
  id: ShopItemId;
  name: string;
  desc: string;
  level: number;
  maxLevel: number;
  nextCost: number | null;
}

export interface Metrics {
  distanceReached: number;
  kills: number;
  died: boolean;
  moneyEarned: number;
  oreMined: number;
  oreWasted: number;
  upgradesBought: number;
  dashUses: number;
  barricadesBuilt: number;
  barricadesLost: number;
  turretsBuilt: number;
  turretsLost: number;
  turretKills: number;
  outpostsBuilt: number;
  tripsToHome: number;
  hazardHits: number;
  hazardDamage: number;
  fuelEmptyTicks: number;
  combatRiskEscalations: number;
  miningRiskEscalations: number;
  raidRiskEscalations: number;
  forecastRiskEscalations: number;
  stuckIncomeEarned: number;
  nightsSurvived: number;
  outpostsLost: number;
  raidersKilled: number;
  baseDamageTaken: number;
  /** 共鳴掘削（018新規）の発動回数 */
  resonanceTriggers: number;
  /** 共鳴掘削で巻き込み採掘できた鉱石数（本来の1手では採れなかった分） */
  resonanceBonusOre: number;
  /** 建材ロットを消費して建てたバリケード/タレットの累計数（020新規） */
  obstaclesBuilt: number;
  /** 建材の品質倍率の累計（平均品質=qualitySumBuilt/obstaclesBuilt、020新規） */
  qualitySumBuilt: number;
  /** うちタレットのみの品質倍率累計（平均=turretQualitySumBuilt/turretsBuilt。良いロットをタレットへ回せているかの指標） */
  turretQualitySumBuilt: number;
  /** 鑑定Lv1以上で`lotIndex`を明示指定して設置した回数（020新規、019 v3の「情報に基づく選別配置」加点対象） */
  informedPlacements: number;
  /** 既存のバリケード/タレットに隣接して建て、設置時点で連携状態になった回数（020新規） */
  linkedPlacements: number;
  /** 連携効果で軽減できたobstacleへの被ダメージの累計（020新規、連携共鳴の効き目を数値公開する） */
  linkSavedDamage: number;
  /** タレットの自動攻撃回数・うち盾持ち状態での攻撃回数・与えた総ダメージ（v2新規、防衛系の主指標） */
  turretShots: number;
  turretShieldedShots: number;
  turretDamageDealt: number;
  /** 死亡直前の状況分類（022新規）。死亡していなければ'none' */
  deathPhase: DeathPhase;
  /** returnRiskLevel（帰還危険度ヒント）のエスカレーション回数（022新規、既存4種のリスクヒントと同形式） */
  returnRiskEscalations: number;
  /** タレットのパトロール圏内で受動燃料消費が軽減された累計tick数（022新規、投資ROI計測用） */
  patrolFuelSavedTicks: number;
  score: number;
}

export interface GameState {
  tick: number;
  over: boolean;
  won: boolean;
  loseReason: 'playerHp' | 'homeDestroyed' | null;
  phase: Phase;
  phaseTicksLeft: number;
  nightWarning: boolean;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    fuel: number;
    maxFuel: number;
    atk: number;
    atkCd: number;
    atkCdMax: number;
    atkRange: number;
    dashCd: number;
    dashCdMax: number;
    dashRange: number;
    money: number;
    drillPower: number;
    cargoUnits: number;
    maxCapacity: number;
    cargoValue: number;
    teleportUnlocked: boolean;
    digging: Digging | null;
    /** 現在地から既に掘った道(FLOOR)だけを通ってホーム(x=0)へ戻るのに必要な推定燃料 */
    estFuelToReturn: number | null;
    /** 現在地のbandに対するmaxHpの余裕度（009/010のcombatRiskLevel） */
    recommendedHp: number;
    combatRiskLevel: RiskLevel;
    combatRiskBanner: number;
    /** estFuelToReturnに対する現在燃料の余裕度（011のminingRiskLevel） */
    miningRiskLevel: RiskLevel;
    miningRiskBanner: RiskEscalationBanner | null;
    /** 夜フェーズかつどの拠点圏内にもいない時に発火する新規ヒント */
    raidRiskLevel: RiskLevel;
    raidRiskBanner: RiskEscalationBanner | null;
    /** 全拠点中で最悪の今夜の脅威予告（014新規、baseForecastsの要約値）。夜フェーズ中は'safe'固定（予告は解決済みのため） */
    forecastRiskLevel: RiskLevel;
    forecastRiskBanner: RiskEscalationBanner | null;
    shopPrices: Record<ShopItemId, number | null>;
    buildCosts: { barricade: number; outpost: number; turret: number };
    canBuildOutpost: boolean;
    baseDistance: number;
    /** 全拠点共通の自動迎撃ダメージ（BASE_AUTO_DEFENSE_DMG + basedefenseLv * DEFENSE_LEVEL_DMG_BONUS、015新規） */
    baseAutoDefenseDmg: number;
    /** 現在地が属する拠点（拠点圏内の場合のみ）に既に建っているタレット数。拠点圏外なら0（016新規） */
    turretsAtCurrentBase: number;
    /** 拠点1つあたりのタレット設置上限（016新規、MAX_TURRETS_PER_BASE） */
    maxTurretsPerBase: number;
    /** 共鳴チャージ現在値（018新規、chargeLv=0なら常に0） */
    charge: number;
    maxCharge: number;
    /** チャージが満タンで次の採掘で共鳴掘削が発動する状態か */
    chargeReady: boolean;
    /** 鑑定Lv（020新規、0〜3）。建材ロットの品質が見える精度を決める。022では帰還危険度の表示精度にも効く */
    appraisalLv: number;
    /** 現在地がいずれかのタレットのパトロール圏内か（022新規）。true時は受動燃料消費が軽減される */
    inPatrolCorridor: boolean;
    /** 夜フェーズ・拠点圏外での帰還危険度（022新規）。鑑定Lv0はnull（ヒントなし）、Lv1〜2は確率的に
     * 1段階ずれた値、Lv3のみ常に正確。実際の危険自体（敵の攻撃力等）は鑑定Lvに関係なく変わらない */
    returnRiskLevel: RiskLevel | null;
    returnRiskBanner: RiskEscalationBanner | null;
    /** 帰還時に寄るべきレーン（パトロール圏がカバーするレーン、022新規）。推奨がなければnull */
    recommendedReturnLane: number | null;
    /**
     * 建材ロットキュー（020新規、先頭=index0）。要素は鑑定Lvに応じた精度で公開される品質推定値
     * （Lv0=null完全不明、Lv1=0.2刻み、Lv2=0.1刻み、Lv3=正確値）。タレット・バリケード設置時に
     * 1つ消費される（v2: 品質はタレットには攻撃ダメージ^2・HPへ、バリケードには薄く0.8〜1.2倍のHPへ効く）。
     * `lotIndex`はこの配列のindexを指す（省略時は0＝先頭を消費）
     */
    buildLots: (number | null)[];
  };
  map: {
    width: number;
    laneCount: number;
    goalDistance: number;
    homeRadius: number;
    outpostRadius: number;
    outpostMinGap: number;
    /** 列優先の平坦配列（index = x * laneCount + y）。値は TILE の数値 */
    tiles: number[];
  };
  enemies: Enemy[];
  barricades: Barricade[];
  /** プレイヤーが設置した拠点防衛タレット一覧（016新規、破壊されたものは除去済み） */
  turrets: Turret[];
  /** プレイヤーが建てた前線拠点のx座標一覧（ホームのx=0は含まない、破壊された拠点は除去済み） */
  outposts: number[];
  /** ホーム+全前線拠点のHP状態（破壊された拠点は含まない） */
  bases: Base[];
  /** 拠点ごとの今夜の脅威予告（014新規）。昼フェーズ中のみ算出、夜フェーズ中は空配列（予告は解決済み） */
  baseForecasts: BaseForecast[];
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
      '1マス移動。既に掘った道(FLOOR)なら即移動、未採掘タイルなら掘削を開始/継続する（複数tick要する場合あり、ドリル威力不足なら不発）',
  },
  { type: 'attack', params: {}, description: '射程内で最も近い敵1体を攻撃（単体、方向指定不要）' },
  {
    type: 'dash',
    params: { dir: 'up|down|left|right' },
    description: '指定方向へ最大dashRangeマス移動し、発動中は無敵。購入不要・常時使用可・クールダウンあり',
  },
  {
    type: 'buy',
    params: {
      item: 'offense|mobility|vitality|drill|fuel|digspeed|lantern|hazardresist|capacity|teleport|basedefense|scanner|charge|appraisal',
    },
    description:
      '拠点（ホームor前線拠点）保護半径内滞在中のみ有効。所持金が足りれば該当カテゴリを強化。' +
      'basedefenseは全拠点の自動迎撃ダメージを恒久的に底上げする（015新規）。' +
      'scannerはフォグの先を見通せる距離を伸ばし（018新規）、chargeはLv1で共鳴掘削を解禁し以降チャージ上限を伸ばす（018新規）。' +
      'appraisalは建材ロットの品質（0.5〜1.5倍）が見える精度を上げる（020新規、Lv1=0.2刻み・Lv2=0.1刻み・Lv3=正確値）。' +
      '022新規: 同じLvが夜フェーズ・拠点圏外でのreturnRiskLevel（帰還危険度ヒント）の表示精度にも効く（Lv0はヒントなし、Lv3で正確）。' +
      '実際の危険自体は変わらず、知れる精度だけが変わる',
  },
  {
    type: 'build',
    params: { target: 'barricade', dir: 'up|down|left|right', lotIndex: '(任意) 使用する建材ロットのindex(0〜3)。省略時は0' },
    description:
      '隣接する既に掘った道(dir)にバリケードを設置。空きマスのみ・所持金消費。敵の移動を塞ぎ、射線上にあれば遠距離攻撃の身代わりにもなる。' +
      '建材ロットを1つ消費するが、品質はHPに薄く(0.8〜1.2倍)しか効かない＝悪ロットの捨て先（v2）。他のバリケード/タレットに隣接して置くと連携し被ダメージが軽減される。隣接タレットの攻撃ダメージを強化する「盾」にもなる（020新規）',
  },
  {
    type: 'build',
    params: { target: 'outpost' },
    description: '現在地（既に掘った道）に前線拠点を建設。最寄り拠点からoutpostMinGap以上離れている必要あり',
  },
  {
    type: 'build',
    params: { target: 'turret', dir: 'up|down|left|right', lotIndex: '(任意) 使用する建材ロットのindex(0〜3)。省略時は0' },
    description:
      '隣接する既に掘った道(dir)に拠点防衛タレットを設置（016新規）。建材ロットを1つ消費し品質倍率がHP・攻撃ダメージ（品質^1.5）に掛かる。他のバリケード/タレットに隣接すると連携し被ダメージ軽減、隣接にバリケードがある「盾持ち」状態だと攻撃ダメージが1.5倍（020新規、v2で盾持ち条件に変更）。拠点（ホームor前線拠点）保護半径内のみ・' +
      '拠点ごとにmaxTurretsPerBase基まで・空きマスのみ・所持金消費。設置後は毎tick自動でレイダーを射程内から迎撃する。' +
      'バリケード同様に敵に阻まれ攻撃を受けて破壊されうる。022新規: 同じレーン上に品質・連携に応じたパトロール圏を投影し、' +
      'プレイヤーがその範囲内を歩くと受動燃料消費が軽減される（迎撃射程TURRET_RANGEとは別枠）',
  },
  { type: 'teleport', params: {}, description: '解禁済みなら燃料を消費して即座にホームへ帰還する' },
  { type: 'wait', params: {}, description: '何もせず1ティック経過（燃料は消費される）' },
];
