export type StructMaterial = 'wood' | 'stone' | 'steel';
export type Material = StructMaterial | 'brace' | 'stabilizer';
/** ショップで買えるもの全体（鑑定は資材ではなく恒久アップグレード） */
export type ShopItem = Material | 'appraiser';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type LegId = 'left' | 'center' | 'right';

export type Action =
  | { type: 'move'; dir: Dir }
  /** lotIndexは構造材(wood/stone/steel)のみ有効。省略時はキュー先頭(index0=最も古いロット)を消費する */
  | { type: 'place'; dir: Dir; material: Material; lotIndex?: number }
  | { type: 'remove'; dir: Dir }
  | { type: 'buy'; item: ShopItem }
  /** 左右の脚の上に立っているとき、同じ高さの中央トランクへ接続する */
  | { type: 'connect' }
  | { type: 'wait' };

export type ShakeState = 'idle' | 'warning' | 'active';
export type AppraisalPrecision = 'hidden' | 'coarse' | 'fine' | 'exact';

export interface BlockInfo {
  x: number;
  y: number;
  leg: LegId;
  material: Material;
  /** 現在の負荷率（負荷÷耐荷重）。1.0超で崩落判定（ただしprotectedがtrueの場合は崩落しない） */
  stressRatio: number;
  /** 直近マイルストーン以下の土台として、過負荷崩落から保護されているか（脚ごとに判定） */
  protected: boolean;
  /** 実際の品質倍率（brace/stabilizerは常に1）。設置後は鑑定レベルに関係なく常時公開される */
  qualityMult: number;
  /** brace限定: 同じ脚内の別のbraceとチェビシェフ距離1以内で連携中か */
  linked: boolean;
}

export interface LegSummary {
  id: LegId;
  x: number;
  /** その脚の構造材の最高到達高度（0=未着手） */
  topHeight: number;
  /** 最も高い梁の高さ（null=未接続）。left/rightのみ意味を持つ */
  connHeight: number | null;
  /** 有効な梁が1本以上あるか（接続点の構造材がまだ崩落していないか） */
  connected: boolean;
  /** v2: 有効な梁（rung）の高さ一覧（昇順）。centerは常に空 */
  rungs: number[];
  maxStressRatio: number;
  criticalCount: number;
  linkedBraceCount: number;
  foundationHeight: number;
}

export interface Metrics {
  maxHeight: number;
  blocksPlaced: number;
  blocksLost: number;
  collapseEvents: number;
  moneyEarned: number;
  fallDamageTaken: number;
  debrisDamageTaken: number;
  invalidActions: number;
  ticksSurvived: number;
  /** lotIndexを指定せず(=キュー先頭任せで)構造材を設置した回数 */
  blindPlacements: number;
  /** lotIndexを明示指定して(=鑑定情報を見て選別して)構造材を設置した回数 */
  informedPlacements: number;
  /** これまでに設置した構造材(wood/stone/steel)の平均qualityMult */
  avgPlacedQuality: number;
  /** connectアクションが成立した回数 */
  connectEvents: number;
  /** セッション中に同時接続していた脚本数の最大値（中央含まず、左右のみ） */
  maxLegsConnected: number;
  /** v3: 左右の脚のマイルストーン報酬の累計（moneyEarnedの内数）。スコアの収入項からは除外する */
  legMilestoneEarned: number;
  score: number;
}

export interface GameState {
  tick: number;
  over: boolean;
  won: boolean;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    money: number;
    /** 手持ち個数（brace/stabilizerも含む）。構造材の内訳はqualityQueueの長さと一致する */
    inventory: Record<Material, number>;
    fallStreak: number;
    /** v3: 梁の架設作業の残りtick。0より大きい間は行動できない（送った行動はwait扱い） */
    busyTicks: number;
    grounded: boolean;
  };
  /** 未設置の構造材ロットの品質。鑑定Lvに応じて丸められる。Lv0（未鑑定）はnull */
  qualityQueue: Record<StructMaterial, (number | null)[]>;
  world: {
    w: number;
    h: number;
    goalHeight: number;
    blocks: BlockInfo[];
    /** 崩落したブロックが地面に積もったスクラップ（列xごとの回収可能額） */
    groundScrap: { x: number; value: number }[];
  };
  shake: {
    state: ShakeState;
    ticksUntilNext: number | null;
    ticksRemainingInPhase: number | null;
  };
  shop: {
    prices: Record<Material, number>;
    stabilizerRemaining: number;
    appraisalLevel: number;
    /** 次のレベルへ上げるコスト。Lv3到達済みならnull */
    appraisalNextCost: number | null;
    appraisalPrecision: AppraisalPrecision;
    connectCost: number;
  };
  /** 脚ごとの状態サマリ。左/中央/右の3件、常に同じ順序で並ぶ */
  legs: LegSummary[];
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
    description: '指定方向の空きマスへ1マス移動する。支持を失うと自動的に落下する',
  },
  {
    type: 'place',
    params: {
      dir: 'up|down|left|right',
      material: 'wood|stone|steel|brace|stabilizer',
      lotIndex: '省略可。wood/stone/steelのみ有効。qualityQueue内のどのロットを消費するか指定する（省略時は先頭=0、最も古いロット）',
    },
    description:
      '指定方向の隣接空きマスに資材を設置する。構造材(wood/stone/steel)は脚スロットのx座標の真上にのみ、' +
      '下から連続して積める。brace/stabilizerは構造材に隣接するマスに置ける',
  },
  {
    type: 'remove',
    params: { dir: 'up|down|left|right' },
    description: '指定方向の隣接ブロックを撤去し、コストの50%を所持金として回収する（brace/stabilizerは撤去不可）',
  },
  {
    type: 'buy',
    params: { item: 'wood|stone|steel|brace|stabilizer|appraiser' },
    description:
      '地上（y=0）にいるときのみ有効。wood/stone/steel/brace/stabilizerは所持資材に加わる。appraiserは鑑定レベルを1段階恒久的に上げる（最大Lv3）',
  },
  {
    type: 'connect',
    params: {},
    description:
      '左右どちらかの脚の構造材の上に立っているとき、同じ高さに中央トランクの構造材があればその高さに梁（rung）を架ける（BEAM_COST）。' +
      '1本の脚に複数の梁を架けられる。梁の高さでは中央＋その高さに梁がある脚の上方荷重が合算されTRUSS_FACTOR倍で均等に再分配され、' +
      '梁の上下2マスは揺れが半減する。梁の上は足場になり、脚〜中央の間を横移動できる',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過する' },
];
