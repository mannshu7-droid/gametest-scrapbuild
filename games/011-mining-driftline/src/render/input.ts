import type { Action, UpgradeId } from '../core/types';

const BUY_KEYS: Record<string, UpgradeId> = {
  '1': 'drill',
  '2': 'fuel',
  '3': 'hp',
  '4': 'capacity',
  '5': 'digspeed',
  '6': 'lantern',
  '7': 'hazardresist',
  '8': 'teleport',
};

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: WASD/矢印=移動・採掘（left/right=進行方向、up/down=レーン変更）,
 * T=テレポート帰還, 1〜8=ショップ購入（ホーム滞在中のみ意味を持つ）
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (['t', '1', '2', '3', '4', '5', '6', '7', '8'].includes(k)) {
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
    if (single === 't') return { type: 'teleport' };
    if (single && BUY_KEYS[single]) return { type: 'buy', item: BUY_KEYS[single] };

    if (this.pressed.has('w') || this.pressed.has('arrowup')) return { type: 'move', dir: 'up' };
    if (this.pressed.has('s') || this.pressed.has('arrowdown')) return { type: 'move', dir: 'down' };
    if (this.pressed.has('a') || this.pressed.has('arrowleft')) return { type: 'move', dir: 'left' };
    if (this.pressed.has('d') || this.pressed.has('arrowright')) return { type: 'move', dir: 'right' };
    return { type: 'wait' };
  }
}
