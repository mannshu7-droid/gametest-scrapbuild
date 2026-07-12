import type { Action, Dir, Material } from '../core/types';

const MATERIAL_KEYS: Record<string, Material> = {
  '1': 'wood',
  '2': 'stone',
  '3': 'steel',
  '4': 'brace',
  '5': 'stabilizer',
};

const DIR_KEYS: Record<string, Dir> = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
};

/**
 * キーボード入力を1ティック分のアクションに変換する。
 * 操作: WASD/矢印=移動（押した方向を「向き」として記憶）、1〜5=設置資材選択、
 * F=向いている方向へ設置、G=向いている方向を撤去、B=地上で選択中資材を購入、R=リスタート
 */
export class Input {
  private pressed = new Set<string>();
  private queued: string[] = [];
  private facing: Dir = 'up';
  private material: Material = 'wood';

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (DIR_KEYS[k]) this.facing = DIR_KEYS[k];
      if (['f', 'g', 'b', '1', '2', '3', '4', '5'].includes(k)) {
        this.queued.push(k);
        e.preventDefault();
      }
      this.pressed.add(k);
      if (Object.keys(DIR_KEYS).includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.pressed.delete(e.key.toLowerCase()));
  }

  selectedMaterial(): Material {
    return this.material;
  }

  /** このティックで実行するアクションを返す */
  poll(): Action {
    const single = this.queued.shift();
    if (single) {
      if (MATERIAL_KEYS[single]) {
        this.material = MATERIAL_KEYS[single];
        return { type: 'wait' };
      }
      if (single === 'f') return { type: 'place', dir: this.facing, material: this.material };
      if (single === 'g') return { type: 'remove', dir: this.facing };
      if (single === 'b') return { type: 'buy', material: this.material };
    }

    for (const k of Object.keys(DIR_KEYS)) {
      if (this.pressed.has(k)) return { type: 'move', dir: DIR_KEYS[k] };
    }
    return { type: 'wait' };
  }
}
