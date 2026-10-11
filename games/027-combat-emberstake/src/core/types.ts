/** 027-combat-emberstake の型定義。core は描画から完全に独立している */

export type Dir = 'up' | 'down' | 'left' | 'right';

export type ShopItemId = 'blade' | 'armor' | 'mend' | 'vitality';

export type Action =
  | { type: 'wait' }
  | { type: 'move'; dir: Dir }
  | { type: 'attack' }
  | { type: 'dash'; dir: Dir }
  /** 篝火の上で毎tick送り続けると奉納の詠唱が進む。被弾すると詠唱は最初から */
  | { type: 'bank' }
  /** 篝火の上でのみ有効 */
  | { type: 'buy'; item: ShopItemId };

export type EnemyKind = 'grunt' | 'runner' | 'brute';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 次に攻撃できるまでのtick */
  cd: number;
}

export interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facing: Dir;
  attackCd: number;
  dashCd: number;
  /** 無敵の残りtick（ダッシュ・救助直後） */
  iframes: number;
  /** 0〜heatMax（100）。攻め続けるほど上がり、報酬倍率と被ダメージ倍率を同時に上げる（1本のダイヤル） */
  heat: number;
  /** 最後に撃破してからのtick（熱の冷め始めの判定） */
  sinceKill: number;
  /** まだ奉納していない残り火（HP0で全て失う） */
  pool: number;
  /** 奉納の詠唱の進み（tick） */
  channel: number;
  /** 奉納済みで使える残り火（ショップ用） */
  embers: number;
  levels: Record<ShopItemId, number>;
  /** v3: 踏ん張りの残りtick（>0の間は被ダメージが軽い） */
  grace: number;
  /** v3: この出撃でまだ踏ん張りを使っていないか（奉納・救助で戻る） */
  graceReady: boolean;
}

/** 倒れた（救助された）ときの熱の帯。021/022の deathPhase に相当する027の主指標 */
export type DownPhase = 'low' | 'mid' | 'high' | 'banking' | 'none';

export interface Metrics {
  /** スコア = 累計奉納（ショップで使っても減らない） */
  score: number;
  kills: number;
  banks: number;
  downs: number;
  downsByPhase: Record<Exclude<DownPhase, 'none'>, number>;
  /** 最後に倒れたときの帯（倒れていなければ none） */
  downPhase: DownPhase;
  /** 救助で失った残り火の合計 */
  lostEmbers: number;
  /** 救助で失った熱の合計 */
  lostHeat: number;
  /** 終了時に奉納されず消えた残り火 */
  unbankedAtEnd: number;
  peakHeat: number;
  /** 奉納したときの熱の合計（平均は sumBankHeat / banks） */
  sumBankHeat: number;
  /** 熱60以上で過ごしたtick */
  ticksHighHeat: number;
  damageTaken: number;
  /** 奉納の詠唱が被弾で途切れた回数 */
  channelBreaks: number;
  spent: number;
  /** v3: 踏ん張りが発動した回数 */
  graces: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  ttl: number;
}

export interface GameState {
  seed: number;
  tick: number;
  sessionTicks: number;
  over: boolean;
  arenaRadius: number;
  brazierRadius: number;
  player: Player;
  enemies: Enemy[];
  /** 現在の倍率（表示・ボット用） */
  rewardMult: number;
  damageMult: number;
  /** 時間による敵の強化倍率 */
  difficulty: number;
  shopCosts: Record<ShopItemId, number>;
  onBrazier: boolean;
  channelNeeded: number;
  /** 救助の報告（直近）。表示用 */
  lastRescue: { tick: number; lostPool: number; lostHeat: number } | null;
  lastBank: { tick: number; amount: number; heat: number } | null;
  floats: FloatText[];
  /** 当日の目標（累計奉納）。v2で800/2000/4000→2000/5000/8000、v3で2000/4000/6000 */
  goals: number[];
  /** 熱の上限（100。--tune heatMax で変えられる） */
  heatMax: number;
  /** 多芸は高くつく: 他の強化1種ごとの価格倍率 */
  typePenalty: number;
  metrics: Metrics;
}

export interface ActionSpecEntry {
  type: Action['type'];
  params?: Record<string, string>;
  description: string;
}

export const ACTION_SPEC: ActionSpecEntry[] = [
  { type: 'wait', description: '何もしない（1tick）' },
  { type: 'move', params: { dir: 'up|down|left|right' }, description: '移動（0.25タイル/tick）' },
  { type: 'attack', description: '周囲（半径1.5）の敵全員を斬る。クールダウン6tick。篝火の上では斬れない' },
  { type: 'dash', params: { dir: 'up|down|left|right' }, description: '3タイル跳ぶ。4tick無敵、クールダウン30tick' },
  {
    type: 'bank',
    description: '篝火の上で送り続けると15tickで奉納: 残り火を確定しHP全快、熱は0に戻る。被弾で詠唱リセット',
  },
  { type: 'buy', params: { item: 'blade|armor|mend|vitality' }, description: '篝火の上で奉納済みの残り火を使って強化' },
];
