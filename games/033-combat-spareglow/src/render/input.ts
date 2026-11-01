import type { Action, Dir, ShopItemId } from '../core/types';

const BUY_KEYS: Record<string, ShopItemId> = { '1': 'blade', '2': 'armor', '3': 'mend', '4': 'vitality' };

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: WASD/矢印=移動、Space=斬る（押しっぱなしで連続）、Shift=直近の向きへダッシュ、
 * B長押し=篝火の上で奉納、1〜4=篝火の上で強化を購入
 * （タッチ移植時: 左の仮想スティック=移動、右の大ボタン=斬る、右下スワイプ=ダッシュ、篝火の上では「奉納」長押しボタンと強化パネル）
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];
  private facing: Dir = 'right';

  constructor() {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!e.repeat && (k === 'shift' || BUY_KEYS[k])) this.queued.push(k);
      this.pressed.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.pressed.clear());
  }

  poll(): Action {
    const single = this.queued.shift();
    if (single === 'shift') return { type: 'dash', dir: this.facing };
    if (single && BUY_KEYS[single]) return { type: 'buy', item: BUY_KEYS[single] };
    if (this.pressed.has('b')) return { type: 'bank' };
    if (this.pressed.has(' ')) return { type: 'attack' };
    const moves: [string[], Dir][] = [
      [['w', 'arrowup'], 'up'],
      [['s', 'arrowdown'], 'down'],
      [['a', 'arrowleft'], 'left'],
      [['d', 'arrowright'], 'right'],
    ];
    for (const [keys, dir] of moves) {
      if (keys.some((k) => this.pressed.has(k))) {
        this.facing = dir;
        return { type: 'move', dir };
      }
    }
    return { type: 'wait' };
  }
}
