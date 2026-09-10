export type StructMaterial = 'wood' | 'stone' | 'steel';
export type Material = StructMaterial | 'brace' | 'stabilizer';
/** ショップで買えるもの全体（鑑定は資材ではなく恒久アップグレード） */
export type ShopItem = Material | 'appraiser';

export type Dir = 'up' | 'down' | 'left' | 'right';

export type Action =
  | { type: 'move'; dir: Dir }
  /** lotIndexは構造材(wood/stone/steel)のみ有効。省略時はキュー先頭(index0=最も古いロット)を消費する */
  | { type: 'place'; dir: Dir; material: Material; lotIndex?: number }
  | { type: 'remove'; dir: Dir }
  | { type: 'buy'; item: ShopItem }
  | { type: 'wait' };

export type ShakeState = 'idle' | 'warning' | 'active';
export type AppraisalPrecision = 'hidden' | 'coarse' | 'fine' | 'exact';

export interface BlockInfo {
  x: number;
  y: number;
  material: Material;
  /** 現在の負荷率（負荷÷耐荷重）。1.0超で崩落判定（ただしprotectedがtrueの場合は崩落しない） */
  stressRatio: number;
  /** 地面から支持経路で繋がっているか */
  grounded: boolean;
  /** 直近マイルストーン以下の土台として、過負荷崩落から保護されているか */
  protected: boolean;
  /** 実際の品質倍率（brace/stabilizerは常に1）。設置後は鑑定レベルに関係なく常時公開される */
  qualityMult: number;
  /** brace限定: 別のbraceとチェビシェフ距離1以内で連携中か */
  linked: boolean;
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
  /** これまでに設置した構造材(wood/stone/steel)の平均qualityMult */
  avgPlacedQuality: number;
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
  };
  /** 003のestFuelToReturn/004のstressRatio相当の「安全マージン数値公開」サマリ */
  structure: {
    maxStressRatio: number;
    criticalCount: number;
    foundationHeight: number;
    /** 現在連携中のbrace本数 */
    linkedBraceCount: number;
  };
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
      '指定方向の隣接空きマスに、所持している資材を1つ設置する。支持（地面 or 既存の接地ブロック）がない位置には設置できない',
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
      '地上（y=0）にいるときのみ有効。wood/stone/steel/brace/stabilizerは所持資材に加わる（wood/stone/steelは購入時に隠れた品質が決まる）。appraiserは鑑定レベルを1段階恒久的に上げる（最大Lv3）',
  },
  { type: 'wait', params: {}, description: '何もせず1ティック経過する' },
];
