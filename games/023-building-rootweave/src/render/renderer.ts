import { BRACE_RADIUS, BRACE_RADIUS_LINKED, H } from '../core/game';
import type { GameState, Material } from '../core/types';

const TILE_PX = 20;
const VIEW_W = 13;
const VIEW_H = 18;
const HUD_PX = 150;

const MATERIAL_COLOR: Record<Material, string> = {
  wood: '#a9793f',
  stone: '#8a8a8a',
  steel: '#b7c6d6',
  brace: '#e67e22',
  stabilizer: '#9b59b6',
};

function fmtQueue(q: (number | null)[]): string {
  if (q.length === 0) return '-';
  return (
    q
      .slice(0, 6)
      .map((v) => (v === null ? '?' : v.toFixed(2)))
      .join(',') + (q.length > 6 ? `,+${q.length - 6}` : '')
  );
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W * TILE_PX;
    canvas.height = VIEW_H * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState, selectedMaterial: Material = 'wood'): void {
    const ctx = this.ctx;
    const maxCamBottom = Math.max(0, H - VIEW_H);
    const camBottom = Math.max(0, Math.min(maxCamBottom, s.player.y - 6));

    ctx.fillStyle = '#87ceeb';
    ctx.fillRect(0, 0, VIEW_W * TILE_PX, VIEW_H * TILE_PX);

    const rowOf = (y: number) => VIEW_H - 1 - (y - camBottom);

    if (camBottom === 0) {
      const row = rowOf(0);
      ctx.fillStyle = '#3d5a2e';
      ctx.fillRect(0, row * TILE_PX, VIEW_W * TILE_PX, TILE_PX);
    }

    for (const scrap of s.world.groundScrap) {
      const row = rowOf(0);
      if (row < 0 || row >= VIEW_H) continue;
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.arc(scrap.x * TILE_PX + TILE_PX / 2, row * TILE_PX + TILE_PX / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 接続済みの脚から中央トランクへ橋を描く
    for (const leg of s.legs) {
      if (leg.id === 'center') continue;
      const centerX = s.legs.find((l) => l.id === 'center')!.x;
      for (const h of leg.rungs) {
        const row = rowOf(h);
        if (row < 0 || row >= VIEW_H) continue;
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(leg.x * TILE_PX + TILE_PX / 2, row * TILE_PX + TILE_PX / 2);
        ctx.lineTo(centerX * TILE_PX + TILE_PX / 2, row * TILE_PX + TILE_PX / 2);
        ctx.stroke();
      }
    }

    const braces = s.world.blocks.filter((b) => b.material === 'brace');
    for (const b of s.world.blocks) {
      const row = rowOf(b.y);
      if (row < 0 || row >= VIEW_H) continue;
      ctx.fillStyle = MATERIAL_COLOR[b.material];
      ctx.fillRect(b.x * TILE_PX + 1, row * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
      if (b.stressRatio >= 0.6 && !b.protected) {
        ctx.fillStyle = `rgba(220,20,20,${Math.min(0.75, (b.stressRatio - 0.6) * 1.8)})`;
        ctx.fillRect(b.x * TILE_PX + 1, row * TILE_PX + 1, TILE_PX - 2, TILE_PX - 2);
      }
      const inBraceRange = braces.some((br) => {
        const radius = br.linked ? BRACE_RADIUS_LINKED : BRACE_RADIUS;
        return Math.abs(br.x - b.x) <= radius && Math.abs(br.y - b.y) <= radius;
      });
      if (b.material !== 'brace' && inBraceRange) {
        ctx.strokeStyle = 'rgba(230,126,34,0.7)';
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x * TILE_PX + 1.5, row * TILE_PX + 1.5, TILE_PX - 3, TILE_PX - 3);
      }
      if (b.material === 'brace' && b.linked) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x * TILE_PX + 2, row * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
      }
      if (b.material === 'wood' || b.material === 'stone' || b.material === 'steel') {
        ctx.fillStyle = b.qualityMult >= 1 ? '#2ecc71' : '#e74c3c';
        ctx.font = '7px monospace';
        ctx.fillText(b.qualityMult.toFixed(1), b.x * TILE_PX + 1, row * TILE_PX + 8);
      }
      if (b.protected) {
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x * TILE_PX + 2, row * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
      }
    }

    const prow = rowOf(s.player.y);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(s.player.x * TILE_PX + 3, prow * TILE_PX + 3, TILE_PX - 6, TILE_PX - 6);

    if (s.shake.state !== 'idle') {
      ctx.fillStyle = s.shake.state === 'warning' ? 'rgba(241,196,15,0.5)' : 'rgba(231,76,60,0.55)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, 20);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(
        s.shake.state === 'warning' ? `揺れ予兆！ 残り${s.shake.ticksRemainingInPhase}` : `本震中！ 残り${s.shake.ticksRemainingInPhase}`,
        6,
        14,
      );
    }

    const hudY = VIEW_H * TILE_PX;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, hudY, VIEW_W * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '11px monospace';
    ctx.fillText(
      `height ${s.player.y}/${s.world.goalHeight}${s.won ? '(達成)' : ''}  HP ${Math.max(0, Math.round(s.player.hp))}/${s.player.maxHp}  money ${s.player.money}`,
      6,
      hudY + 14,
    );
    ctx.fillText(
      `inv w${s.player.inventory.wood} s${s.player.inventory.stone} st${s.player.inventory.steel} b${s.player.inventory.brace} sb${s.player.inventory.stabilizer}  選択:${selectedMaterial}`,
      6,
      hudY + 28,
    );
    ctx.fillText(
      `鑑定Lv${s.shop.appraisalLevel}(${s.shop.appraisalPrecision}) 次${s.shop.appraisalNextCost ?? '-'}  接続コスト${s.shop.connectCost}${s.player.busyTicks > 0 ? `  梁を架設中…残り${s.player.busyTicks}` : ''}`,
      6,
      hudY + 42,
    );
    for (const leg of s.legs) {
      const label = leg.id === 'left' ? '左脚' : leg.id === 'right' ? '右脚' : '中央';
      const connLabel = leg.id === 'center' ? '-' : leg.connected ? `梁${leg.rungs.length}本(最高@${leg.connHeight})` : '未接続';
      ctx.fillText(
        `${label}(x${leg.x}) top${leg.topHeight} stress${leg.maxStressRatio.toFixed(2)} ${connLabel}`,
        6,
        hudY + 56 + ['left', 'center', 'right'].indexOf(leg.id) * 14,
      );
    }
    ctx.fillText(`wood品質[${fmtQueue(s.qualityQueue.wood)}]`, 6, hudY + 100);
    ctx.fillText(`stone品質[${fmtQueue(s.qualityQueue.stone)}]`, 6, hudY + 114);
    ctx.fillText(`steel品質[${fmtQueue(s.qualityQueue.steel)}]`, 6, hudY + 128);
    ctx.fillText(`tick ${s.tick}  maxHeight ${s.metrics.maxHeight}  score ${s.metrics.score}`, 6, hudY + 142);

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, VIEW_H * TILE_PX);
      ctx.fillStyle = s.won ? '#2ecc71' : '#e74c3c';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(s.won ? 'GOAL CLEARED' : 'GAME OVER', (VIEW_W * TILE_PX) / 2 - 90, (VIEW_H * TILE_PX) / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '13px monospace';
      ctx.fillText(
        `maxHeight ${s.metrics.maxHeight}  score ${s.metrics.score}`,
        (VIEW_W * TILE_PX) / 2 - 100,
        (VIEW_H * TILE_PX) / 2 + 22,
      );
    }
  }
}
