import type { GameState } from '../core/types';

const PX_PER_DIST = 4;
const VIEW_DIST = 200; // カメラ窓の横幅（distance単位）
const LANE_PX = 24;
const LANES = 3;
const HUD_PX = 130;

const RISK_COLOR: Record<string, string> = {
  safe: '#2ecc71',
  caution: '#f1c40f',
  danger: '#e74c3c',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  constructor(canvas: HTMLCanvasElement) {
    this.width = VIEW_DIST * PX_PER_DIST > 800 ? 800 : VIEW_DIST * PX_PER_DIST;
    this.height = LANES * LANE_PX + HUD_PX;
    canvas.width = this.width;
    canvas.height = this.height;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    const viewH = LANES * LANE_PX;
    // カメラは常にプレイヤーが画面左1/4付近に来るように追従
    const cameraDist = Math.max(0, s.player.distance - this.width / PX_PER_DIST / 4);

    const bg = s.player.night ? '#0b0f1a' : '#1c2a1e';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, viewH);

    // 拠点（distance=0）
    const homeSx = (0 - cameraDist) * PX_PER_DIST;
    if (homeSx > -40 && homeSx < this.width) {
      ctx.fillStyle = 'rgba(52,152,219,0.35)';
      ctx.fillRect(homeSx - 12, 0, 24, viewH);
      ctx.fillStyle = '#3498db';
      ctx.fillText('HOME', homeSx - 12, 12);
    }

    // 敵
    for (const e of s.enemies) {
      const sx = (e.distance - cameraDist) * PX_PER_DIST;
      if (sx < -20 || sx > this.width) continue;
      const sy = e.y * LANE_PX;
      ctx.fillStyle = e.dazedTicks > 0 ? '#7f8c8d' : '#c0392b';
      ctx.fillRect(sx, sy + 2, 14, LANE_PX - 4);
      const ratio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx, sy - 4, 14, 3);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(sx, sy - 4, 14 * ratio, 3);
    }

    // プレイヤー
    const psx = (s.player.distance - cameraDist) * PX_PER_DIST;
    ctx.fillStyle = s.player.intent === 'push' ? '#f1c40f' : '#5dade2';
    ctx.fillRect(psx, LANE_PX + 2, 16, LANE_PX - 4);

    // HUD
    ctx.fillStyle = '#111';
    ctx.fillRect(0, viewH, this.width, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    const p = s.player;
    ctx.fillText(
      `day ${s.day + 1}  distance ${Math.round(p.distance)}  HP ${Math.round(p.hp)}/${p.maxHp}  ATK ${p.atk}  money ${p.money}`,
      6,
      viewH + 16,
    );
    ctx.fillText(
      `dash ${p.dashCharges}/${p.maxDashCharges}  flare ${p.flareCharges}/${p.maxFlareCharges}  route ${p.routeLocked ?? '未選択'}`,
      6,
      viewH + 32,
    );
    ctx.fillStyle = p.night ? '#e74c3c' : '#f1c40f';
    ctx.fillText(
      `${p.night ? '夜（危険）' : '日照'} ${Math.max(0, Math.round(p.daylightRemaining))}/${p.daylightMax}`,
      6,
      viewH + 48,
    );
    ctx.fillStyle = RISK_COLOR[p.retreatRiskLevel];
    ctx.fillText(
      `帰還マージン ${Math.round(p.returnMargin)}  (${p.retreatRiskLevel})  推奨ルート: ${p.routeRecommended}`,
      6,
      viewH + 64,
    );
    ctx.fillStyle = '#fff';
    ctx.fillText(
      `shop: atk${p.upgradeCosts.atk} hp${p.upgradeCosts.maxHp} dash${p.upgradeCosts.maxDash} flare${p.upgradeCosts.maxFlare} daylight${p.upgradeCosts.daylight} restock${p.upgradeCosts.restockFlare}`,
      6,
      viewH + 80,
    );
    ctx.fillText(
      `kills ${s.metrics.kills}  daysSurvived ${s.metrics.daysSurvived}  score ${s.metrics.score}`,
      6,
      viewH + 96,
    );

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, this.width, viewH);
      ctx.fillStyle = s.won ? '#2ecc71' : '#e74c3c';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(s.won ? `${s.day}日生存！勝利` : 'GAME OVER', 20, viewH / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '13px monospace';
      ctx.fillText(`daysSurvived ${s.metrics.daysSurvived}  deathPhase ${s.metrics.deathPhase}  score ${s.metrics.score}`, 20, viewH / 2 + 22);
    }
  }
}
