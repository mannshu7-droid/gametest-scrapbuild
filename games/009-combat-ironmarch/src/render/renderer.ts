import type { GameState } from '../core/types';

const TILE_PX = 24;
const VIEW_TILES_X = 20; // カメラ窓の横幅（マス）
const HUD_PX = 96;

const ENEMY_COLOR: Record<string, string> = {
  skirmisher: '#e67e22',
  archer: '#8e44ad',
  brute: '#c0392b',
};

const RISK_COLOR: Record<string, string> = {
  safe: '#2ecc71',
  caution: '#f1c40f',
  danger: '#e74c3c',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_TILES_X * TILE_PX;
    canvas.height = 5 * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    const laneCount = s.map.laneCount;
    const viewH = laneCount * TILE_PX;
    const cameraX = Math.max(0, s.player.x - Math.floor(VIEW_TILES_X / 3));

    // 背景（帯状フィールド）
    ctx.fillStyle = '#1c2a1e';
    ctx.fillRect(0, 0, VIEW_TILES_X * TILE_PX, viewH);

    // ウェイステーション（保護範囲を縦帯で表示）
    for (const wx of s.map.waystations) {
      const sx = (wx - cameraX) * TILE_PX;
      if (sx < -s.map.waystationRadius * TILE_PX || sx > VIEW_TILES_X * TILE_PX) continue;
      ctx.fillStyle = 'rgba(52,152,219,0.25)';
      ctx.fillRect(sx - s.map.waystationRadius * TILE_PX, 0, s.map.waystationRadius * 2 * TILE_PX, viewH);
      ctx.fillStyle = '#3498db';
      ctx.fillRect(sx - 2, 0, 4, viewH);
    }

    // 敵
    for (const e of s.enemies) {
      const sx = (e.x - cameraX) * TILE_PX;
      if (sx < -TILE_PX || sx > VIEW_TILES_X * TILE_PX) continue;
      const sy = e.y * TILE_PX;
      ctx.fillStyle = ENEMY_COLOR[e.type] ?? '#999';
      ctx.fillRect(sx + 2, sy + 2, TILE_PX - 4, TILE_PX - 4);
      const ratio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx, sy - 4, TILE_PX, 3);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(sx, sy - 4, TILE_PX * ratio, 3);
    }

    // プレイヤー
    const p = s.player;
    const psx = (p.x - cameraX) * TILE_PX;
    const psy = p.y * TILE_PX;
    ctx.fillStyle = p.dashCd === 0 ? '#f1c40f' : '#f5f5f5';
    ctx.fillRect(psx + 1, psy + 1, TILE_PX - 2, TILE_PX - 2);

    // HUD
    ctx.fillStyle = '#111';
    ctx.fillRect(0, viewH, VIEW_TILES_X * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(
      `x ${p.x}/${s.map.goalDistance}  HP ${p.hp}/${p.maxHp}  ATK ${p.atk}  money ${p.money}  ${p.hasSkill ? `SKILL(${p.skillDmg})` : 'no-skill'}`,
      6,
      viewH + 16,
    );
    ctx.fillText(
      `shop: offense${p.shopPrices.offense} defense${p.shopPrices.defense} mobility${p.shopPrices.mobility} skill${p.shopPrices.skill}`,
      6,
      viewH + 32,
    );
    ctx.fillStyle = RISK_COLOR[p.combatRiskLevel];
    const bannerFlash = p.riskEscalationBanner > 0 && p.riskEscalationBanner % 20 < 10;
    ctx.fillText(
      `risk: ${p.combatRiskLevel} (recommendedHp ${p.recommendedHp})${bannerFlash ? '  !! ESCALATED !!' : ''}`,
      6,
      viewH + 48,
    );
    ctx.fillStyle = '#fff';
    ctx.fillText(
      `kills ${s.metrics.kills}  waystations ${s.metrics.waystationsReached}  score ${s.metrics.score}`,
      6,
      viewH + 64,
    );

    if (s.awaitingRouteChoice && s.routePreview) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, VIEW_TILES_X * TILE_PX, viewH);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('ROUTE CHOICE  Z=safe / X=risky', 10, viewH / 2 - 20);
      ctx.fillStyle = RISK_COLOR[s.routePreview.safe];
      ctx.fillText(`safe -> predicted risk: ${s.routePreview.safe}`, 10, viewH / 2 + 4);
      ctx.fillStyle = RISK_COLOR[s.routePreview.risky];
      ctx.fillText(`risky -> predicted risk: ${s.routePreview.risky}`, 10, viewH / 2 + 24);
      ctx.fillStyle = '#3498db';
      ctx.fillText(`EV recommends: ${s.routePreview.recommended}`, 10, viewH / 2 + 44);
    }

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, VIEW_TILES_X * TILE_PX, viewH);
      ctx.fillStyle = s.won ? '#2ecc71' : '#e74c3c';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(s.won ? 'GOAL!' : 'GAME OVER', 30, viewH / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '13px monospace';
      ctx.fillText(`distance ${s.metrics.distanceReached}  score ${s.metrics.score}`, 20, viewH / 2 + 22);
    }
  }
}
