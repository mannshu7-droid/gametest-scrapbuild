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
};

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: WASD/矢印=移動（未採掘タイルは掘削）、Space=攻撃、Shift=直近の向きへdash、
 * 1〜0=ショップ購入（拠点滞在中のみ意味を持つ）、Q=拠点防衛投資購入（015新規、同じく拠点滞在中のみ）、
 * B=直近の向きへバリケード設置、O=前線拠点を建設、T=テレポート帰還
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];
  private facing: Dir = 'right';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if ([' ', 'shift', 'b', 'o', 't', 'q', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(k)) {
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
    if (single === 'b') return { type: 'build', target: 'barricade', dir: this.facing };
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
