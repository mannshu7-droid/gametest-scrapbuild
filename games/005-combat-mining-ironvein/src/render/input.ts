import type { Action, Dir, UpgradeId } from '../core/types';

const BUY_KEYS: Record<string, UpgradeId> = {
  '1': 'drill',
  '2': 'capacity',
  '3': 'fuel',
  '4': 'atk',
  '5': 'hp',
  '6': 'atkspeed',
  '7': 'skill',
  '8': 'muffler',
};

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: WASD/矢印=移動・採掘（向きも保持）, Space=攻撃（直近の向き）, E=範囲攻撃, Q=緊急離脱(dash), 1〜8=ショップ購入（地上フェーズ中のみ意味を持つ）
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];
  private facing: Dir = 'down';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if ([' ', 'e', 'q', '1', '2', '3', '4', '5', '6', '7', '8'].includes(k)) {
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
    if (single === ' ') return { type: 'attack', dir: this.facing };
    if (single === 'e') return { type: 'skill' };
    if (single === 'q') return { type: 'dash' };
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
