import type { GameState } from '../core/types';

const TILE_PX = 24;
const VIEW_TILES_X = 20; // カメラ窓の横幅（マス）
const HUD_PX = 112;

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

    // 拠点（ホーム + 前線拠点、保護範囲を縦帯で表示）
    const bases: { x: number; r: number; isHome: boolean }[] = [
      { x: 0, r: s.map.homeRadius, isHome: true },
      ...s.outposts.map((x) => ({ x, r: s.map.outpostRadius, isHome: false })),
    ];
    for (const base of bases) {
      const sx = (base.x - cameraX) * TILE_PX;
      if (sx < -base.r * TILE_PX * 2 || sx > VIEW_TILES_X * TILE_PX) continue;
      ctx.fillStyle = base.isHome ? 'rgba(52,152,219,0.25)' : 'rgba(46,204,113,0.25)';
      ctx.fillRect(sx - base.r * TILE_PX, 0, base.r * 2 * TILE_PX, viewH);
      ctx.fillStyle = base.isHome ? '#3498db' : '#2ecc71';
      ctx.fillRect(sx - 2, 0, 4, viewH);
    }

    // バリケード
    for (const b of s.barricades) {
      const sx = (b.x - cameraX) * TILE_PX;
      if (sx < -TILE_PX || sx > VIEW_TILES_X * TILE_PX) continue;
      const sy = b.y * TILE_PX;
      ctx.fillStyle = '#8b5a2b';
      ctx.fillRect(sx + 1, sy + 1, TILE_PX - 2, TILE_PX - 2);
      const ratio = Math.max(0, b.hp / b.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx, sy - 4, TILE_PX, 3);
      ctx.fillStyle = '#e67e22';
      ctx.fillRect(sx, sy - 4, TILE_PX * ratio, 3);
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
    ctx.fillText(
      `build: barricade${p.buildCosts.barricade}  outpost${p.buildCosts.outpost}${p.canBuildOutpost ? ' (建設可能)' : ''}  baseDist ${p.baseDistance}`,
      6,
      viewH + 48,
    );
    ctx.fillStyle = RISK_COLOR[p.combatRiskLevel];
    const bannerFlash = p.riskEscalationBanner > 0 && p.riskEscalationBanner % 20 < 10;
    ctx.fillText(
      `risk: ${p.combatRiskLevel} (recommendedHp ${p.recommendedHp})${bannerFlash ? '  !! ESCALATED !!' : ''}`,
      6,
      viewH + 64,
    );
    ctx.fillStyle = '#fff';
    ctx.fillText(
      `kills ${s.metrics.kills}  outposts ${s.metrics.outpostsBuilt}  barricades ${s.metrics.barricadesBuilt}  score ${s.metrics.score}`,
      6,
      viewH + 80,
    );

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
