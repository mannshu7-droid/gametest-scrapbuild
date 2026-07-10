import type { Action, Dir } from '../core/types';

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: WASD/矢印=移動, Space=攻撃, E=採掘, Q=壁設置, C=剣クラフト
 * 攻撃/採掘/設置は現在の向きに対して行う。
 */
export class Input {
  private pressed = new Set<string>();
  /** 単発キー（押した瞬間だけ有効） */
  private queued: string[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if ([' ', 'e', 'q', 'c'].includes(k)) {
        this.queued.push(k);
        e.preventDefault();
      }
      this.pressed.add(k);
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.key.toLowerCase()));
  }

  /** このティックで実行するアクションを返す */
  poll(facing: Dir): Action {
    const single = this.queued.shift();
    if (single === ' ') return { type: 'attack', dir: facing };
    if (single === 'e') return { type: 'mine', dir: facing };
    if (single === 'q') return { type: 'place', dir: facing };
    if (single === 'c') return { type: 'craft', item: 'sword' };

    if (this.pressed.has('w') || this.pressed.has('arrowup')) return { type: 'move', dir: 'up' };
    if (this.pressed.has('s') || this.pressed.has('arrowdown')) return { type: 'move', dir: 'down' };
    if (this.pressed.has('a') || this.pressed.has('arrowleft')) return { type: 'move', dir: 'left' };
    if (this.pressed.has('d') || this.pressed.has('arrowright')) return { type: 'move', dir: 'right' };
    return { type: 'wait' };
  }
}
