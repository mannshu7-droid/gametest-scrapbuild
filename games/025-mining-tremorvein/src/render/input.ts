import type { Action, UpgradeId } from '../core/types';

const BUY_KEYS: Record<string, UpgradeId> = {
  '1': 'drill',
  '2': 'hp',
  '3': 'brace',
  '4': 'capacity',
  '5': 'winch',
  '6': 'basket',
  '7': 'scaffold',
};

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: WASD/矢印=移動・採掘、1〜7=ショップ購入（地上のみ）、Space/B=送り籠（地下のみ）、H=巻き上げ（地下のみ）、P=足場を据える（地下のみ）
 * タッチ移植時は src/render/ にタッチ用の同等クラスを足す（仕様書「タッチ操作の想定」参照）
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k in BUY_KEYS || k === ' ' || k === 'b' || k === 'h' || k === 'p') {
        this.queued.push(k);
        e.preventDefault();
      }
      this.pressed.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.key.toLowerCase()));
  }

  poll(): Action {
    const single = this.queued.shift();
    if (single) {
      if (BUY_KEYS[single]) return { type: 'buy', item: BUY_KEYS[single] };
      if (single === 'h') return { type: 'hoist' };
      if (single === 'p') return { type: 'place' };
      return { type: 'send' };
    }
    if (this.pressed.has('w') || this.pressed.has('arrowup')) return { type: 'move', dir: 'up' };
    if (this.pressed.has('s') || this.pressed.has('arrowdown')) return { type: 'move', dir: 'down' };
    if (this.pressed.has('a') || this.pressed.has('arrowleft')) return { type: 'move', dir: 'left' };
    if (this.pressed.has('d') || this.pressed.has('arrowright')) return { type: 'move', dir: 'right' };
    return { type: 'wait' };
  }
}
