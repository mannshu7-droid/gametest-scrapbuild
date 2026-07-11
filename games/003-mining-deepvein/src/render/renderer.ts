import { W, H } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 24;
const VIEW_W = W;
const VIEW_H = 18;
const HUD_PX = 130;

const TILE_COLOR: Record<number, string> = {
  [TILE.FLOOR]: '#1b1b1b',
  [TILE.DIRT]: '#6b4a2f',
  [TILE.ROCK]: '#6d6d6d',
  [TILE.ORE_COPPER]: '#c8763a',
  [TILE.ORE_IRON]: '#9fb0bb',
  [TILE.ORE_GOLD]: '#e0c33d',
  [TILE.GAS]: '#4caf6a',
  [TILE.UNSTABLE]: '#8a3b3b',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W * TILE_PX;
    canvas.height = VIEW_H * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    const camTop = Math.max(0, Math.min(H - VIEW_H, s.player.y - Math.floor(VIEW_H / 2)));

    for (let row = 0; row < VIEW_H; row++) {
      const y = camTop + row;
      for (let x = 0; x < VIEW_W; x++) {
        const t = s.map.tiles[y * VIEW_W + x];
        ctx.fillStyle = TILE_COLOR[t] ?? '#000';
        ctx.fillRect(x * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
      }
    }

    // 採掘中タイルの進捗バー
    if (s.player.digging) {
      const d = s.player.digging;
      const row = d.y - camTop;
      if (row >= 0 && row < VIEW_H) {
        const ratio = 1 - d.remaining / d.total;
        ctx.fillStyle = '#000';
        ctx.fillRect(d.x * TILE_PX, row * TILE_PX + TILE_PX - 5, TILE_PX, 4);
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(d.x * TILE_PX, row * TILE_PX + TILE_PX - 5, TILE_PX * ratio, 4);
      }
    }

    // プレイヤー
    const prow = s.player.y - camTop;
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(s.player.x * TILE_PX + 2, prow * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);

    // HUD
    const hudY = VIEW_H * TILE_PX;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, hudY, VIEW_W * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '13px monospace';
    ctx.fillText(
      `depth ${s.player.y}  HP ${Math.max(0, Math.round(s.player.hp))}/${s.player.maxHp}  fuel ${Math.round(s.player.fuel)}/${s.player.maxFuel}`,
      8,
      hudY + 18,
    );
    ctx.fillText(
      `money ${s.player.money}  cargo ${s.player.cargoUnits}/${s.player.maxCapacity} (value ${s.player.cargoValue})  drill Lv${s.player.drillPower}`,
      8,
      hudY + 36,
    );
    ctx.fillText(
      `tick ${s.tick}  maxDepth ${s.metrics.maxDepth}  oreMined ${s.metrics.oreMined}  score ${s.metrics.score}${s.player.teleportUnlocked ? '  [T]teleport可' : ''}`,
      8,
      hudY + 54,
    );

    if (s.phase === 'shop') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, VIEW_H * TILE_PX);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('地上ショップ（1〜8キーで購入 / 移動キーで潜行開始）', 12, 24);
      ctx.font = '12px monospace';
      s.shop.forEach((item, i) => {
        const y = 44 + i * 28;
        const afford = item.nextCost !== null && s.player.money >= item.nextCost;
        ctx.fillStyle = item.nextCost === null ? '#555' : afford ? '#2c3e50' : '#3a2c2c';
        ctx.fillRect(12, y, VIEW_W * TILE_PX - 24, 24);
        ctx.fillStyle = '#fff';
        const costText = item.nextCost === null ? 'MAX' : `¥${item.nextCost}`;
        ctx.fillText(`${i + 1}. ${item.name} Lv${item.level}/${item.maxLevel}  ${costText}`, 18, y + 16);
      });
    }

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, VIEW_H * TILE_PX);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('GAME OVER', VIEW_W * TILE_PX / 2 - 90, VIEW_H * TILE_PX / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText(
        `maxDepth ${s.metrics.maxDepth}  oreMined ${s.metrics.oreMined}  score ${s.metrics.score}`,
        VIEW_W * TILE_PX / 2 - 120,
        VIEW_H * TILE_PX / 2 + 24,
      );
    }
  }
}
