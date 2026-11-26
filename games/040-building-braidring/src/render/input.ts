import type { Action } from '../core/types';

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: 矢印/WASD=移動、E=隣の塔を1段積む、B=梁を時計回りの隣へ、V=梁を反時計回りの隣へ、何も押さない=待つ
 * タッチ移植時は src/render/ にタッチ用の同等クラスを足す（仕様書「タッチ操作の想定」参照）
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'e' || k === 'b' || k === 'v') {
        this.queued.push(k);
        e.preventDefault();
      }
      this.pressed.add(k);
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.key.toLowerCase()));
  }

  poll(): Action {
    const single = this.queued.shift();
    if (single === 'e') return { type: 'raise' };
    if (single === 'b') return { type: 'beam', side: 'cw' };
    if (single === 'v') return { type: 'beam', side: 'ccw' };
    if (this.pressed.has('a') || this.pressed.has('arrowleft')) return { type: 'move', dir: 'left' };
    if (this.pressed.has('d') || this.pressed.has('arrowright')) return { type: 'move', dir: 'right' };
    if (this.pressed.has('w') || this.pressed.has('arrowup')) return { type: 'move', dir: 'up' };
    if (this.pressed.has('s') || this.pressed.has('arrowdown')) return { type: 'move', dir: 'down' };
    return { type: 'wait' };
  }
}
