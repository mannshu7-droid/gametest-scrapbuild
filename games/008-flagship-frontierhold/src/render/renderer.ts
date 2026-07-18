import { W, H, OUTPOST_MIN_GAP } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 24;
const VIEW_W = W;
const VIEW_H = 18;
const HUD_PX = 168;

const TILE_COLOR: Record<number, string> = {
  [TILE.FLOOR]: '#1b1b1b',
  [TILE.DIRT]: '#6b4a2f',
  [TILE.ROCK]: '#6d6d6d',
  [TILE.ORE_COPPER]: '#c8763a',
  [TILE.ORE_IRON]: '#9fb0bb',
  [TILE.ORE_GOLD]: '#e0c33d',
  [TILE.PROP]: '#8b5a2b',
  [TILE.OUTPOST]: '#1f6f43',
};

const ENEMY_COLOR: Record<string, string> = {
  crawler: '#8e44ad',
  brute: '#c0392b',
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
        if (t === TILE.PROP) {
          ctx.strokeStyle = '#3a2410';
          ctx.lineWidth = 2;
          ctx.strokeRect(x * TILE_PX + 2, row * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
        }
        if (t === TILE.OUTPOST) {
          ctx.fillStyle = '#eafff2';
          ctx.beginPath();
          ctx.moveTo(x * TILE_PX + TILE_PX / 2, row * TILE_PX + 3);
          ctx.lineTo(x * TILE_PX + TILE_PX - 4, row * TILE_PX + TILE_PX / 2);
          ctx.lineTo(x * TILE_PX + TILE_PX / 2, row * TILE_PX + TILE_PX - 3);
          ctx.lineTo(x * TILE_PX + 4, row * TILE_PX + TILE_PX / 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    // 支保工の耐久値バー
    for (const prop of s.props) {
      const row = prop.y - camTop;
      if (row < 0 || row >= VIEW_H) continue;
      const ratio = Math.max(0, prop.hp / prop.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(prop.x * TILE_PX, row * TILE_PX - 4, TILE_PX, 3);
      ctx.fillStyle = '#d2a24c';
      ctx.fillRect(prop.x * TILE_PX, row * TILE_PX - 4, TILE_PX * ratio, 3);
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

    // 敵
    for (const e of s.enemies) {
      const row = e.y - camTop;
      if (row < 0 || row >= VIEW_H) continue;
      ctx.fillStyle = ENEMY_COLOR[e.type] ?? '#999';
      ctx.fillRect(e.x * TILE_PX + 2, row * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
      const ratio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(e.x * TILE_PX, row * TILE_PX - 4, TILE_PX, 3);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(e.x * TILE_PX, row * TILE_PX - 4, TILE_PX * ratio, 3);
    }

    // プレイヤー（dash中は水色、移動回避が乗っている間は金色）
    const prow = s.player.y - camTop;
    ctx.fillStyle = s.player.dashActive > 0 ? '#3498db' : s.player.moveEvasion > 0 ? '#f1c40f' : '#f5f5f5';
    ctx.fillRect(s.player.x * TILE_PX + 2, prow * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);

    // HUD
    const hudY = VIEW_H * TILE_PX;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, hudY, VIEW_W * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '13px monospace';
    const returnFuelText = s.player.estFuelToReturn === null ? '' : `  帰還推定燃料 ${s.player.estFuelToReturn}`;
    ctx.fillText(
      `depth ${s.player.y}  HP ${Math.max(0, Math.round(s.player.hp))}/${s.player.maxHp}  fuel ${Math.round(s.player.fuel)}/${s.player.maxFuel}${returnFuelText}`,
      8,
      hudY + 18,
    );
    ctx.fillText(
      `money ${s.player.money}  cargo ${s.player.cargoUnits}/${s.player.maxCapacity}(¥${s.player.cargoValue})  drill Lv${s.player.drillPower}  atk ${s.player.atk}  noise ${Math.round(s.player.noise)}`,
      8,
      hudY + 36,
    );
    ctx.fillText(
      `tick ${s.tick}  maxDepth ${s.metrics.maxDepth}  kills ${s.metrics.kills}  score ${s.metrics.score}${s.player.hasSkill ? `  skillCd ${s.player.skillCd}/${s.player.skillCdMax}` : ''}  dash(Q) ${s.player.dashActive > 0 ? 'ACTIVE' : s.player.dashCd > 0 ? `CD${s.player.dashCd}` : 'READY'}`,
      8,
      hudY + 54,
    );
    ctx.fillText(
      `支保工(F) ${s.player.buildCd > 0 ? `CD${s.player.buildCd}` : 'READY'}  耐久${s.player.propMaxHp}  橋${s.metrics.bridgesBuilt}本/バリケード${s.metrics.barricadesBuilt}個 (破壊${s.metrics.propsDestroyedByEnemy})`,
      8,
      hudY + 72,
    );
    ctx.fillStyle = s.player.canBuildOutpost ? '#7dffb0' : '#fff';
    ctx.fillText(
      `前線基地(G) 建設数${s.metrics.outpostsBuilt}  直前の基地から${s.player.depthSinceLastBase}マス（要${OUTPOST_MIN_GAP}）  費用¥${s.player.nextOutpostCost}${s.player.canBuildOutpost ? '  [建設可能]' : ''}`,
      8,
      hudY + 90,
    );
    const riskColor = { safe: '#7dffb0', caution: '#f1c40f', danger: '#e74c3c' }[s.player.combatRiskLevel];
    const riskLabel = { safe: '安全', caution: '注意', danger: '危険' }[s.player.combatRiskLevel];
    ctx.fillStyle = riskColor;
    ctx.fillText(
      `この深さの目安HP ${s.player.recommendedHp}（現在maxHP ${s.player.maxHp}） [${riskLabel}]`,
      8,
      hudY + 108,
    );
    ctx.fillStyle = '#fff';

    if (s.phase === 'shop') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, VIEW_H * TILE_PX);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('ショップ（1〜9キーで購入 / 移動キーで再出発 / Gキーで前線基地を建設）', 12, 24);
      ctx.font = '12px monospace';
      s.shop.forEach((item, i) => {
        const y = 44 + i * 26;
        const afford = item.nextCost !== null && s.player.money >= item.nextCost;
        ctx.fillStyle = item.nextCost === null ? '#555' : afford ? '#2c3e50' : '#3a2c2c';
        ctx.fillRect(12, y, VIEW_W * TILE_PX - 24, 22);
        ctx.fillStyle = '#fff';
        const costText = item.nextCost === null ? 'MAX' : `¥${item.nextCost}`;
        ctx.fillText(`${i + 1}. ${item.name} Lv${item.level}/${item.maxLevel}  ${costText}`, 18, y + 15);
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
        `maxDepth ${s.metrics.maxDepth}  kills ${s.metrics.kills}  score ${s.metrics.score}`,
        VIEW_W * TILE_PX / 2 - 120,
        VIEW_H * TILE_PX / 2 + 24,
      );
    }
  }
}
