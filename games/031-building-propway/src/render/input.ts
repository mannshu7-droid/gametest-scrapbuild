import type { Action } from '../core/types';

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: A/D・←/→=移動、Space/S=掘り出す（押しっぱなし）、P=支柱を建てる、F=足場を建てる、何も押さない=待つ（足場の上なら休む）
 * タッチ移植時は src/render/ にタッチ用の同等クラスを足す（仕様書「タッチ操作の想定」参照）
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'p' || k === 'f') {
        this.queued.push(k);
        e.preventDefault();
      }
      this.pressed.add(k);
      if (['arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.key.toLowerCase()));
  }

  poll(): Action {
    const single = this.queued.shift();
    if (single === 'p') return { type: 'prop' };
    if (single === 'f') return { type: 'scaffold' };
    if (this.pressed.has('a') || this.pressed.has('arrowleft')) return { type: 'move', dir: 'left' };
    if (this.pressed.has('d') || this.pressed.has('arrowright')) return { type: 'move', dir: 'right' };
    if (this.pressed.has(' ') || this.pressed.has('s')) return { type: 'work' };
    return { type: 'wait' };
  }
}
