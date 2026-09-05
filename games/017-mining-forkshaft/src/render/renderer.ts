import { BAND_SIZE, LANES, LENGTH } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 32;
const VIEW_W = 18; // x方向の可視マス数（フィールド長241に対してスクロール表示）
const HUD_PX = 150;

const TILE_COLOR: Record<number, string> = {
  [TILE.FLOOR]: '#1b1b1b',
  [TILE.UNKNOWN]: '#050505',
  [TILE.DIRT]: '#6b4a2f',
  [TILE.ROCK]: '#6d6d6d',
  [TILE.ORE_COPPER]: '#c8763a',
  [TILE.ORE_IRON]: '#9fb0bb',
  [TILE.ORE_GOLD]: '#e0c33d',
  [TILE.ORE_PLATINUM]: '#7fd8e8',
  [TILE.GAS]: '#4caf6a',
  [TILE.UNSTABLE]: '#8a3b3b',
};

const RISK_COLOR: Record<string, string> = {
  safe: '#4caf6a',
  caution: '#e0c33d',
  danger: '#e05a3d',
};

const HAZARD_LABEL = ['安全', '警戒', '危険'];
const RICHNESS_LABEL = ['乏しい', '普通', '豊富', '激豊富'];

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W * TILE_PX;
    canvas.height = LANES * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    const camLeft = Math.max(0, Math.min(LENGTH - VIEW_W, s.player.x - Math.floor(VIEW_W / 2)));

    for (let col = 0; col < VIEW_W; col++) {
      const x = camLeft + col;
      if (x >= LENGTH) continue;
      for (let y = 0; y < LANES; y++) {
        const t = s.map.tiles[x * LANES + y];
        ctx.fillStyle = TILE_COLOR[t] ?? '#000';
        ctx.fillRect(col * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      }
      // フォーク（分岐点）の目印
      if (x % BAND_SIZE === 0 && x < LENGTH - 1) {
        ctx.strokeStyle = '#3498db';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(col * TILE_PX + TILE_PX, 0);
        ctx.lineTo(col * TILE_PX + TILE_PX, LANES * TILE_PX);
        ctx.stroke();
      }
    }

    // 採掘中タイルの進捗バー
    if (s.player.digging) {
      const d = s.player.digging;
      const col = d.x - camLeft;
      if (col >= 0 && col < VIEW_W) {
        const ratio = 1 - d.remaining / d.total;
        ctx.fillStyle = '#000';
        ctx.fillRect(col * TILE_PX, d.y * TILE_PX + TILE_PX - 5, TILE_PX, 4);
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(col * TILE_PX, d.y * TILE_PX + TILE_PX - 5, TILE_PX * ratio, 4);
      }
    }

    // プレイヤー
    const pcol = s.player.x - camLeft;
    ctx.fillStyle = s.player.chargeReady ? '#ffd54a' : '#f5f5f5';
    ctx.fillRect(pcol * TILE_PX + 2, s.player.y * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);

    // HUD
    const hudY = LANES * TILE_PX;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, hudY, VIEW_W * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '13px monospace';
    const returnFuelText = s.player.estFuelToReturn === null ? '' : `  帰還推定燃料 ${s.player.estFuelToReturn}`;
    ctx.fillText(
      `x ${s.player.x}/${LENGTH - 1}  HP ${Math.max(0, Math.round(s.player.hp))}/${s.player.maxHp}  fuel ${Math.round(s.player.fuel)}/${s.player.maxFuel}${returnFuelText}`,
      8,
      hudY + 18,
    );
    ctx.fillStyle = RISK_COLOR[s.player.miningRiskLevel] ?? '#fff';
    const bannerText = s.player.riskEscalationBanner ? '  ▲ 危険度上昇！' : '';
    ctx.fillText(`risk: ${s.player.miningRiskLevel}${bannerText}`, 8, hudY + 36);
    ctx.fillStyle = s.player.chargeReady ? '#ffd54a' : '#fff';
    ctx.fillText(
      `money ${s.player.money}  cargo ${s.player.cargoUnits}/${s.player.maxCapacity} (value ${s.player.cargoValue})  drill Lv${s.player.drillPower}  charge ${s.player.charge}/${s.player.maxCharge}${s.player.chargeReady ? ' READY!' : ''}`,
      8,
      hudY + 54,
    );
    ctx.fillStyle = '#fff';
    ctx.fillText(`tick ${s.tick}  maxDistance ${s.metrics.maxDistance}  oreMined ${s.metrics.oreMined}  score ${s.metrics.score}`, 8, hudY + 72);

    // フォーク上ならこれから進む先のヒントを表示
    if (s.player.atFork) {
      const nextBand = Math.floor(s.player.x / BAND_SIZE);
      const hint = s.bandHints[nextBand];
      if (hint) {
        ctx.fillText(`【フォーク】次バンド(${nextBand})のヒント（up/down移動＋rightで確定）:`, 8, hudY + 92);
        hint.lanes.forEach((l, i) => {
          const haz = l.hazardTier === null ? '?' : HAZARD_LABEL[l.hazardTier];
          const rich = l.richness === null ? '?' : RICHNESS_LABEL[l.richness];
          ctx.fillStyle = i === s.player.y ? '#ffd54a' : '#fff';
          ctx.fillText(`  L${i}: 危険=${haz} / 豊富さ=${rich}`, 8, hudY + 110 + i * 14);
        });
      }
    }

    if (s.phase === 'shop') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, LANES * TILE_PX);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('ホームショップ（1〜8キーで購入 / 移動キーで採掘開始）', 12, 24);
      ctx.font = '12px monospace';
      s.shop.forEach((item, i) => {
        const y = 44 + i * 24;
        const afford = item.nextCost !== null && s.player.money >= item.nextCost;
        ctx.fillStyle = item.nextCost === null ? '#555' : afford ? '#2c3e50' : '#3a2c2c';
        ctx.fillRect(12, y, VIEW_W * TILE_PX - 24, 20);
        ctx.fillStyle = '#fff';
        const costText = item.nextCost === null ? 'MAX' : `¥${item.nextCost}`;
        ctx.fillText(`${i + 1}. ${item.name} Lv${item.level}/${item.maxLevel}  ${costText}`, 18, y + 15);
      });
    }

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, LANES * TILE_PX);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 26px monospace';
      ctx.fillText('GAME OVER', (VIEW_W * TILE_PX) / 2 - 90, (LANES * TILE_PX) / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText(
        `maxDistance ${s.metrics.maxDistance}  oreMined ${s.metrics.oreMined}  score ${s.metrics.score}`,
        (VIEW_W * TILE_PX) / 2 - 130,
        (LANES * TILE_PX) / 2 + 24,
      );
    }
  }
}
