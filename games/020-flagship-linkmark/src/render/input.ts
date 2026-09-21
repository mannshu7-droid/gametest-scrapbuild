import { LOT_QUEUE_SIZE } from '../core/game';
import type { Action, Dir, ShopItemId } from '../core/types';

const BUY_KEYS: Record<string, ShopItemId> = {
  '1': 'offense',
  '2': 'mobility',
  '3': 'vitality',
  '4': 'drill',
  '5': 'fuel',
  '6': 'digspeed',
  '7': 'lantern',
  '8': 'hazardresist',
  '9': 'capacity',
  '0': 'teleport',
  q: 'basedefense',
  e: 'scanner',
  c: 'charge',
  v: 'appraisal',
};

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: WASD/矢印=移動（未採掘タイルは掘削）、Space=攻撃、Shift=直近の向きへdash、
 * 1〜0=ショップ購入（拠点滞在中のみ意味を持つ）、Q=拠点防衛投資購入（015新規、同じく拠点滞在中のみ）、
 * E=探査ドリル購入（018新規、フォグの先を見通す）、C=共鳴チャージ購入（018新規、満タン時に巻き込み採掘）、
 * B=直近の向きへバリケード設置、P=直近の向きへ拠点防衛タレット設置（016新規、拠点圏内のみ）、
 * O=前線拠点を建設、T=テレポート帰還、
 * V=鑑定購入（020新規、建材ロットの品質が見える精度を上げる）、Z/X=使用する建材ロットの選択を前/次へ
 * （020新規、鑑定Lv1以上のときだけ選択が有効。Lv0ではロットの中身が見えないため常に先頭を消費する）
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];
  private facing: Dir = 'right';
  /** 次のバリケード/タレット設置で使う建材ロットのindex（020新規） */
  selectedLot = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'z') this.selectedLot = (this.selectedLot + LOT_QUEUE_SIZE - 1) % LOT_QUEUE_SIZE;
      if (k === 'x') this.selectedLot = (this.selectedLot + 1) % LOT_QUEUE_SIZE;
      if ([' ', 'shift', 'b', 'o', 't', 'q', 'p', 'e', 'c', 'v', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(k)) {
        this.queued.push(k);
        e.preventDefault();
      }
      this.pressed.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.key.toLowerCase()));
  }

  /** このティックで実行するアクションを返す */
  poll(): Action {
    const single = this.queued.shift();
    if (single === ' ') return { type: 'attack' };
    if (single === 'shift') return { type: 'dash', dir: this.facing };
    if (single === 'b') return { type: 'build', target: 'barricade', dir: this.facing, lotIndex: this.selectedLot };
    if (single === 'p') return { type: 'build', target: 'turret', dir: this.facing, lotIndex: this.selectedLot };
    if (single === 'o') return { type: 'build', target: 'outpost' };
    if (single === 't') return { type: 'teleport' };
    if (single && BUY_KEYS[single]) return { type: 'buy', item: BUY_KEYS[single] };

    if (this.pressed.has('w') || this.pressed.has('arrowup')) {
      this.facing = 'up';
      return { type: 'move', dir: 'up' };
    }
    if (this.pressed.has('s') || this.pressed.has('arrowdown')) {
      this.facing = 'down';
      return { type: 'move', dir: 'down' };
    }
    if (this.pressed.has('a') || this.pressed.has('arrowleft')) {
      this.facing = 'left';
      return { type: 'move', dir: 'left' };
    }
    if (this.pressed.has('d') || this.pressed.has('arrowright')) {
      this.facing = 'right';
      return { type: 'move', dir: 'right' };
    }
    return { type: 'wait' };
  }
}
