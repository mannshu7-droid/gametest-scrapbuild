import type { Action, MoveDir, Route, UpgradeKind } from '../core/types';

const BUY_KEYS: Record<string, UpgradeKind> = {
  '1': 'atk',
  '2': 'maxHp',
  '3': 'maxDash',
  '4': 'maxFlare',
  '5': 'daylight',
  '6': 'restockFlare',
};

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: D/→=前進, A/←=退却, Space=攻撃, Shift=直近方向へdash, F=囮,
 * Z/X=ルート選択（direct/detour）, 1〜6=拠点内ショップ購入, R=リスタート（main.ts側）
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];
  private facing: MoveDir = 'advance';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if ([' ', 'f', 'shift', 'z', 'x', '1', '2', '3', '4', '5', '6'].includes(k)) {
        this.queued.push(k);
        e.preventDefault();
      }
      this.pressed.add(k);
      if (['arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.key.toLowerCase()));
  }

  /** このティックで実行するアクションを返す */
  poll(): Action {
    const single = this.queued.shift();
    if (single === ' ') return { type: 'attack' };
    if (single === 'f') return { type: 'decoy' };
    if (single === 'shift') return { type: 'dash', dir: this.facing };
    if (single === 'z') return { type: 'chooseRoute', route: 'direct' as Route };
    if (single === 'x') return { type: 'chooseRoute', route: 'detour' as Route };
    if (single && BUY_KEYS[single]) return { type: 'buyUpgrade', which: BUY_KEYS[single] };

    if (this.pressed.has('d') || this.pressed.has('arrowright')) {
      this.facing = 'advance';
      return { type: 'advance' };
    }
    if (this.pressed.has('a') || this.pressed.has('arrowleft')) {
      this.facing = 'retreat';
      return { type: 'retreat' };
    }
    return { type: 'wait' };
  }
}
