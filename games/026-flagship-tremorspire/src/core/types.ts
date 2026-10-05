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
  /** 026新規: 支保（揺れのたまる速さ-10%/Lv）。揺れ版（resource='tremor'）でfuelの代わりに売られる */
  | 'brace'
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
  /** 024新規: 隣接(dir)するタレットを1段積み増す（塔化）。RAISE_TICKSの作業時間を要し、
   * 作業中は毎tick同じアクションを送り続ける（掘削と同じ「続けて押す」作業。中断しても進捗は保持） */
  | { type: 'raise'; dir: Dir }
  /** 024新規: 隣接(dir)するタレットから、BEAM_SPAN以内の別の塔へ梁を架ける（高さ=低い方の塔の高さ）。
   * BEAM_TICKSの作業時間を要し、raiseと同じく作業中は毎tick同じアクションを送り続ける */
  | { type: 'beam'; dir: Dir }
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
  /** v3新規: 高い塔の誘引で増えた襲撃か（倒した時の報酬がLURED_REWARD_MULT倍） */
  lured?: boolean;
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
  /** 塔の高さ（024新規、0=地上設置の022タレットと同じ）。射程・パトロール圏が伸びる */
  height: number;
  /** 積み増し作業の進捗（024新規、0〜RAISE_TICKS。0より大きい間は費用支払い済み） */
  raiseProgress: number;
  /** この塔に架かっている梁の最高高さ（024新規、梁が無ければ0=地面）。getState()で算出 */
  topBeamLevel?: number;
  /** 自由長＝height-topBeamLevel（024新規、023の細長さ）。slenderLimitを超えた分だけ崩落リスクが生じる */
  freeLength?: number;
  /** 自由長の安全上限（024新規、全塔共通のSLENDER_LIMIT） */
  slenderLimit?: number;
  /** 自由長の超過分（max(0, freeLength - slenderLimit)、024新規）。0より大きい塔は崩れうる */
  overstress?: number;
  /** 現在の迎撃射程（024新規、TURRET_RANGE + floor(height/TOWER_RANGE_STEP)） */
  range?: number;
  /** 現在のパトロール圏（024新規、022の式＋高さ×PATROL_HEIGHT_MULT） */
  patrolRange?: number;
  /** 梁で編まれた塔の回廊が覆うレーン範囲（024新規、梁で繋がった塔群のy最小〜最大。梁なしは自分のレーンのみ） */
  corridorLanes?: [number, number];
  /** 次の1段の積み増し費用（024新規） */
  raiseCost?: number;
  /** v3新規: 孤塔か（拠点圏内で高さ1以上の塔が自分1本だけ・梁なし）。孤塔は援護半径+loneCoverRadiusBonus */
  lone?: boolean;
}

/** 塔と塔を繋ぐ梁（024新規、023の梁(rung)を拠点の塔へ移植）。架けた高さで両塔の自由長をリセットする */
export interface Beam {
  id: number;
  aId: number;
  bId: number;
  level: number;
  /** 梁の耐久（v2新規）。夜、塔に引き付けられたレイダーに狙われ、0で落ちる */
  hp: number;
  maxHp: number;
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
  /** うち梁で編まれた回廊（corridorLanes経由）で軽減された累計tick数（024新規） */
  wovenCorridorTicks: number;
  /** 塔の積み増し段数の累計（024新規） */
  raiseLevels: number;
  /** 架けた梁の累計（024新規） */
  beamsBuilt: number;
  /** 最初の梁を架けたtick（024新規、編み方の"いつ"の指標。未架設は-1） */
  firstBeamTick: number;
  /** 積み増し・梁の作業に費やしたtick数（024新規、時間コストの指標） */
  towerWorkTicks: number;
  /** 塔の崩落回数（自由長超過による折損、024新規） */
  towerCollapses: number;
  /** うち塔の破壊・梁の喪失がきっかけの連鎖崩落（024新規） */
  cascadeCollapses: number;
  /** 崩落で失われた段数の累計（024新規） */
  segmentsLost: number;
  /** 崩落の落下物でプレイヤーが受けたダメージの累計（024新規） */
  fallDamage: number;
  /** 到達した最大の塔の高さ（024新規） */
  maxTowerHeight: number;
  /** 塔の射程拡張（高さ由来の射程>1）で発生した迎撃の回数（024新規、高さの効き目の指標） */
  tallShots: number;
  /** 援護射撃（v2新規）: 夜、パトロール圏内のプレイヤーに迫る敵を塔が撃った回数・倒した数 */
  coverShots: number;
  coverKills: number;
  /** 誘引（v2新規）: 高い塔に引き付けられたレイダーが塔を攻撃した回数 */
  lureHits: number;
  /** レイダーに落とされた梁の数（v2新規） */
  beamsLost: number;
  /** 高い塔に呼び寄せられた追加の襲撃者の累計（v2新規） */
  luredRaiders: number;
  /** 夜・拠点圏外でプレイヤーが敵から受けたダメージの累計（v2新規。死亡数が少なく揺らぎに埋もれる領域で、
   * 夜のフィールドの危険を連続量で測る。v1 Learnings） */
  nightFieldDamage: number;
  /** 高さ1以上の塔が破壊された数と、その時に失われた高さの累計（v2新規、高く積むことの代償の指標） */
  towersLost: number;
  heightLostToRaids: number;
  /** 初めて高さ4・8・12の塔ができたtick（v2新規、v1バグ#6。未到達は-1） */
  tickToH4: number;
  tickToH8: number;
  tickToH12: number;
  /** ---- 026新規: 揺れ（resource='tremor'）の指標。燃料版では常に0 ---- */
  /** 落盤の回数・受けたダメージ・落とした積荷の価値 */
  caveIns: number;
  caveInDamage: number;
  caveInLostValue: number;
  /** 揺れの売値ボーナスで上乗せされた稼ぎ（掘った時点の積荷価値ベース） */
  tremorBonusValue: number;
  /** HP0からの救助の回数と、その内訳（夜のフィールド/昼のフィールド/拠点圏内）、救助費と失った積荷 */
  rescues: number;
  rescueNightField: number;
  rescueDaySiege: number;
  rescueInBase: number;
  /** うち落盤が最後の一撃だった救助 */
  rescueByCaveIn: number;
  rescueFees: number;
  rescueLostValue: number;
  /** 梁の回廊（足場）の中で掘らずにいて揺れが下がったtick数 */
  corridorReliefTicks: number;
  /** 夕暮れ（nightWarning中）に積荷を抱えて拠点の外にいて、揺れが速くたまったtick数 */
  duskTicks: number;
  /** 拠点へ戻った瞬間の揺れの最大値と合計（平均=sum/tripsToHome） */
  maxTremor: number;
  score: number;
}

export interface GameState {
  /** 026新規: 遠征の制約。'tremor'=揺れ（既定）、'fuel'=024と同じ燃料（対照群） */
  resource: 'tremor' | 'fuel';
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
    /** 燃料（燃料版のみ意味を持つ。揺れ版では常に0） */
    fuel: number;
    maxFuel: number;
    /** ---- 026新規: 揺れ（揺れ版のみ意味を持つ。燃料版では常に0） ---- */
    tremor: number;
    tremorCap: number;
    /** 今の揺れで掘った鉱石の売値ボーナス（0〜0.6） */
    tremorBonus: number;
    /** 今の揺れで次の100tickに1回以上落盤する確率 */
    caveInChance100: number;
    /** 今の場所で1tickにたまる揺れ（掘らずにいる時。負なら回廊で下がっている） */
    tremorRate: number;
    /** 今から最寄りの拠点まで歩いて戻った時の揺れの見積もり（帰着線） */
    estTremorAtReturn: number | null;
    /** いま回廊（足場）・パトロール圏のどこにいるか */
    corridor: 'none' | 'lane' | 'woven';
    /** 夕暮れに積荷を抱えて拠点の外にいる（揺れが速い） */
    dusk: boolean;
    /** 救助直後の手当て中の残りtick（0より大きい間は行動できない） */
    rescueDownTicks: number;
    canTeleport: boolean;
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
    /** 進行中の塔作業（024新規）。raise=積み増し、beam=梁の架設。無ければnull */
    towerWork: { kind: 'raise' | 'beam'; turretId: number; progress: number; total: number } | null;
    /** 今プレイヤーを援護射撃の対象にしている塔の数（v2新規。夜・高さ1以上の塔のパトロール圏/回廊の中にいる時のみ>0） */
    coveringTowers: number;
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
  /** 塔と塔を繋ぐ梁（024新規） */
  beams: Beam[];
  /** 塔の構造ルール（024新規、023-final バグ#2対応で自由長の閾値を常時公開する） */
  towerRules: {
    slenderLimit: number;
    maxHeight: number;
    raiseTicks: number;
    beamTicks: number;
    beamSpan: number;
    rangeStep: number;
    patrolHeightMult: number;
    /** v2新規: 梁の耐久、誘引の倍率（x方向に高さ×これ以内のレイダーを引き付ける）、
     * 追加襲撃の刻み（拠点ごとの塔の高さ合計÷これ）、援護射撃の基礎半径 */
    beamHp: number;
    attractPerHeight: number;
    lureRaidStep: number;
    coverRadiusBase: number;
    /** v3新規: 梁なしの塔の援護が届く上下のレーン数（見張り台）、孤塔の援護半径ボーナス、呼び寄せた敵の報酬倍率 */
    watchLanes: number;
    loneCoverRadiusBonus: number;
    luredRewardMult: number;
  };
  /** 次の夜（夜中は今夜）に塔が呼び寄せる追加の襲撃者数（v2新規、拠点ごとの塔の高さ合計÷lureRaidStepの和） */
  lureRaidCount: number;
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
      item: 'offense|mobility|vitality|drill|fuel|brace|digspeed|lantern|hazardresist|capacity|teleport|basedefense|scanner|charge|appraisal',
    },
    description:
      '拠点（ホームor前線拠点）保護半径内滞在中のみ有効。所持金が足りれば該当カテゴリを強化。' +
      'basedefenseは全拠点の自動迎撃ダメージを恒久的に底上げする（015新規）。' +
      'scannerはフォグの先を見通せる距離を伸ばし（018新規）、chargeはLv1で共鳴掘削を解禁し以降チャージ上限を伸ばす（018新規）。' +
      'appraisalは建材ロットの品質（0.5〜1.5倍）が見える精度を上げる（020新規、Lv1=0.2刻み・Lv2=0.1刻み・Lv3=正確値）。' +
      '022新規: 同じLvが夜フェーズ・拠点圏外でのreturnRiskLevel（帰還危険度ヒント）の表示精度にも効く（Lv0はヒントなし、Lv3で正確）。' +
      '実際の危険自体は変わらず、知れる精度だけが変わる。' +
      '026新規: fuel（燃料タンク）は燃料版のみ、brace（支保、揺れのたまる速さ-10%/Lv）は揺れ版のみ売られる（もう一方はshopPricesがnull）',
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
  {
    type: 'teleport',
    params: {},
    description: '解禁済みなら即座にホームへ帰還する（燃料版は燃料25、揺れ版は積荷の価値の1/4を失う）',
  },
  {
    type: 'raise',
    params: { dir: 'up|down|left|right' },
    description:
      '024新規: 隣接(dir)するタレットを1段積み増す（塔化）。開始時に費用（turrets[].raiseCost）を払い、RAISE_TICKS(towerRules.raiseTicks)の間' +
      '毎tick同じアクションを送り続けると高さ+1。高さで迎撃射程（rangeStepごとに+1）とパトロール圏（1段あたり+patrolHeightMult）が伸びる。' +
      '自由長（高さ−その塔に架かる最高の梁の高さ）がslenderLimitを超えると、超過分に比例して毎tick崩落しうる（夜と被弾時は特に危険）。' +
      '崩落すると「最高の梁＋slenderLimit」より上が折れ、隣接していると落下物でダメージを受ける。' +
      'v2: 夜、高さ1以上の塔はパトロール圏（回廊含む）にいるプレイヤーの近く（towerRules.coverRadiusBase＋高さ由来の射程延長）の敵を優先して援護射撃する。' +
      '一方で高い塔は敵を呼ぶ: 拠点ごとの塔の高さ合計÷towerRules.lureRaidStepだけ夜の襲撃が増え（lureRaidCountで予告）、' +
      '塔からx方向に高さ×attractPerHeight以内のレイダーは拠点ではなく最も高い塔を狙う。' +
      'v3: 梁の無い塔は上下towerRules.watchLanesレーンまで援護する（見張り台）。拠点に塔が1本だけなら援護半径+loneCoverRadiusBonus（孤塔）。' +
      '誘引で増えた敵（enemies[].lured）の報酬はluredRewardMult倍',
  },
  {
    type: 'beam',
    params: { dir: 'up|down|left|right' },
    description:
      '024新規: 隣接(dir)するタレットから、towerRules.beamSpan以内（チェビシェフ距離）の別のタレットへ梁を架ける。梁の高さは2塔の低い方の高さで、' +
      'その2塔の間の既存の梁より高い必要がある（何段でも架けられる）。開始時に費用を払い、beamTicksの間毎tick送り続けると完成。' +
      '梁は両塔の自由長をその高さでリセットし（天井を越えられる）、梁で繋がった塔のパトロール圏は繋がった塔のレーン全体を覆う回廊になり燃料消費がさらに軽くなる。' +
      'どちらかの塔が壊れると梁は落ち、残った塔は自由長が伸びて連鎖崩落しうる。' +
      'v2: 梁は耐久(beams[].hp、towerRules.beamHp)を持ち、塔に引き付けられたレイダーは射程内から塔本体ではなく最も高い梁を狙う。梁が落ちると同じく連鎖崩落しうる',
  },
  {
    type: 'wait',
    params: {},
    description:
      '何もせず1ティック経過（燃料版は燃料が減る。揺れ版は拠点の外で揺れがたまるが、梁で編んだ回廊（corridor=woven）の中なら揺れが下がる＝足場）',
  },
];
