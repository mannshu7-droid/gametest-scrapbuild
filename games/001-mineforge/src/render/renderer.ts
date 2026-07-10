import { W, H, DAY_TICKS, NIGHT_START } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 12;
const HUD_PX = 56;

const TILE_COLOR: Record<number, string> = {
  [TILE.GRASS]: '#3d5c3a',
  [TILE.TREE]: '#1e7d32',
  [TILE.ROCK]: '#7d7d7d',
  [TILE.IRON]: '#c9a25f',
  [TILE.WATER]: '#2b5d8a',
  [TILE.WALL]: '#c9c2b0',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W * TILE_PX;
    canvas.height = H * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    // タイル
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        ctx.fillStyle = TILE_COLOR[s.map.tiles[idx]] ?? '#000';
        ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
        // 削れているタイルはひび表示
        if (s.map.tileHp[idx] !== undefined) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x * TILE_PX + 3, y * TILE_PX + 3, TILE_PX - 6, TILE_PX - 6);
        }
      }
    }
    // ゾンビ
    for (const z of s.zombies) {
      ctx.fillStyle = '#8e44ad';
      ctx.fillRect(z.x * TILE_PX + 1, z.y * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
    }
    // プレイヤー（白＋向きマーカー）
    const p = s.player;
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(p.x * TILE_PX + 1, p.y * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
    ctx.fillStyle = '#e74c3c';
    const cx = p.x * TILE_PX + TILE_PX / 2;
    const cy = p.y * TILE_PX + TILE_PX / 2;
    const m = TILE_PX / 2 - 2;
    const [fx, fy] =
      p.facing === 'up' ? [0, -m] : p.facing === 'down' ? [0, m] : p.facing === 'left' ? [-m, 0] : [m, 0];
    ctx.fillRect(cx + fx - 2, cy + fy - 2, 4, 4);

    // 夜のオーバーレイ（夜が近づくと徐々に暗く）
    const t = s.tickOfDay;
    let darkness = 0;
    if (t >= NIGHT_START) darkness = 0.45;
    else if (t >= NIGHT_START - 60) darkness = ((t - (NIGHT_START - 60)) / 60) * 0.45;
    if (darkness > 0) {
      ctx.fillStyle = `rgba(10, 10, 40, ${darkness})`;
      ctx.fillRect(0, 0, W * TILE_PX, H * TILE_PX);
    }

    // HUD
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, H * TILE_PX, W * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '13px monospace';
    const inv = p.inventory;
    ctx.fillText(
      `Day ${s.day} ${s.isNight ? 'NIGHT' : 'day'} (${t}/${DAY_TICKS})  HP ${p.hp}  ${p.hasSword ? 'SWORD' : 'fist'}`,
      8,
      H * TILE_PX + 20,
    );
    ctx.fillText(
      `wood ${inv.wood}  stone ${inv.stone}  iron ${inv.iron}  kills ${s.metrics.kills}  score ${s.metrics.score}`,
      8,
      H * TILE_PX + 38,
    );
    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W * TILE_PX, H * TILE_PX);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 32px monospace';
      ctx.fillText('GAME OVER', W * TILE_PX / 2 - 90, H * TILE_PX / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '16px monospace';
      ctx.fillText(`survived ${s.metrics.daysSurvived} days  score ${s.metrics.score}`, W * TILE_PX / 2 - 120, H * TILE_PX / 2 + 28);
    }
  }
}
