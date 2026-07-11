import { W, H } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 16;
const HUD_PX = 90;

const ENEMY_COLOR: Record<string, string> = {
  grunt: '#8e44ad',
  runner: '#e67e22',
  brute: '#c0392b',
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
        ctx.fillStyle = s.map.tiles[idx] === TILE.ROCK ? '#5a5a5a' : '#2c3e2f';
        ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      }
    }
    // 敵
    for (const e of s.enemies) {
      ctx.fillStyle = ENEMY_COLOR[e.type] ?? '#999';
      ctx.fillRect(e.x * TILE_PX + 1, e.y * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
      // HPバー
      const ratio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(e.x * TILE_PX, e.y * TILE_PX - 4, TILE_PX, 3);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(e.x * TILE_PX, e.y * TILE_PX - 4, TILE_PX * ratio, 3);
    }
    // プレイヤー（白＋向きマーカー、ダッシュ待機中は薄い金色の縁）
    const p = s.player;
    ctx.fillStyle = p.dashCd === 0 ? '#f1c40f' : '#f5f5f5';
    ctx.fillRect(p.x * TILE_PX + 1, p.y * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
    ctx.fillStyle = '#e74c3c';
    const cx = p.x * TILE_PX + TILE_PX / 2;
    const cy = p.y * TILE_PX + TILE_PX / 2;
    const m = TILE_PX / 2 - 2;
    const [fx, fy] =
      p.facing === 'up' ? [0, -m] : p.facing === 'down' ? [0, m] : p.facing === 'left' ? [-m, 0] : [m, 0];
    ctx.fillRect(cx + fx - 2, cy + fy - 2, 4, 4);

    // HUD
    ctx.fillStyle = '#111';
    ctx.fillRect(0, H * TILE_PX, W * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '13px monospace';
    ctx.fillText(
      `Wave ${s.wave}  HP ${p.hp}/${p.maxHp}  ATK ${p.atk}  ${p.hasSkill ? `SKILL(${p.skillDmg})` : 'no-skill'}`,
      8,
      H * TILE_PX + 18,
    );
    ctx.fillText(
      `attackCd ${p.attackCd}/${p.attackCdMax}  dashCd ${p.dashCd}/${p.dashCdMax}  skillCd ${p.skillCd}/${p.skillCdMax}`,
      8,
      H * TILE_PX + 36,
    );
    ctx.fillText(
      `lifesteal ${(p.lifesteal * 100).toFixed(0)}%  thorns ${(p.thorns * 100).toFixed(0)}%  regen ${p.regen}  kills ${s.metrics.kills}  score ${s.metrics.score}`,
      8,
      H * TILE_PX + 54,
    );

    if (s.phase === 'upgrade') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, W * TILE_PX, H * TILE_PX);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('WAVE CLEAR - 強化を1つ選択 (1/2/3キー)', 40, H * TILE_PX / 2 - 100);
      ctx.font = '14px monospace';
      s.upgradeOptions.forEach((u, i) => {
        const y = H * TILE_PX / 2 - 40 + i * 60;
        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(40, y, W * TILE_PX - 80, 48);
        ctx.fillStyle = '#fff';
        ctx.fillText(`${i + 1}. ${u.name}`, 52, y + 20);
        ctx.fillText(u.desc, 52, y + 38);
      });
    }

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W * TILE_PX, H * TILE_PX);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 28px monospace';
      ctx.fillText('GAME OVER', W * TILE_PX / 2 - 90, H * TILE_PX / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '15px monospace';
      ctx.fillText(
        `wave ${s.wave}  kills ${s.metrics.kills}  score ${s.metrics.score}`,
        W * TILE_PX / 2 - 110,
        H * TILE_PX / 2 + 26,
      );
    }
  }
}
