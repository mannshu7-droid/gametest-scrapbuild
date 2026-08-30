import { FIELD_WIDTH, LANE_COUNT, LENGTH } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 28;
const VIEW_W = 20;
const HUD_PX = 150;

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
    canvas.width = VIEW_W * TILE_PX;
    canvas.height = LANE_COUNT * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    const viewH = LANE_COUNT * TILE_PX;
    const camLeft = Math.max(0, Math.min(LENGTH - VIEW_W, s.player.x - Math.floor(VIEW_W / 3)));

    // タイル（未採掘の地形）
    for (let col = 0; col < VIEW_W; col++) {
      const x = camLeft + col;
      if (x >= LENGTH) continue;
      for (let y = 0; y < LANE_COUNT; y++) {
        const t = s.map.tiles[x * LANE_COUNT + y];
        ctx.fillStyle = TILE_COLOR[t] ?? '#000';
        ctx.fillRect(col * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      }
    }

    // 拠点（ホーム + 前線拠点、保護範囲を縦帯で表示）
    const bases: { x: number; r: number; isHome: boolean }[] = [
      { x: 0, r: s.map.homeRadius, isHome: true },
      ...s.outposts.map((x) => ({ x, r: s.map.outpostRadius, isHome: false })),
    ];
    for (const base of bases) {
      const sx = (base.x - camLeft) * TILE_PX;
      if (sx < -base.r * TILE_PX * 2 || sx > VIEW_W * TILE_PX) continue;
      ctx.fillStyle = base.isHome ? 'rgba(52,152,219,0.25)' : 'rgba(46,204,113,0.25)';
      ctx.fillRect(sx - base.r * TILE_PX, 0, base.r * 2 * TILE_PX, viewH);
      ctx.fillStyle = base.isHome ? '#3498db' : '#2ecc71';
      ctx.fillRect(sx - 2, 0, 4, viewH);
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

    // バリケード
    for (const b of s.barricades) {
      const sx = (b.x - camLeft) * TILE_PX;
      if (sx < -TILE_PX || sx > VIEW_W * TILE_PX) continue;
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
      const sx = (e.x - camLeft) * TILE_PX;
      if (sx < -TILE_PX || sx > VIEW_W * TILE_PX) continue;
      const sy = e.y * TILE_PX;
      ctx.fillStyle = ENEMY_COLOR[e.type] ?? '#999';
      ctx.fillRect(sx + 3, sy + 3, TILE_PX - 6, TILE_PX - 6);
      const ratio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx, sy - 4, TILE_PX, 3);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(sx, sy - 4, TILE_PX * ratio, 3);
    }

    // プレイヤー
    const psx = (s.player.x - camLeft) * TILE_PX;
    const psy = s.player.y * TILE_PX;
    ctx.fillStyle = s.player.dashCd === 0 ? '#f1c40f' : '#f5f5f5';
    ctx.fillRect(psx + 1, psy + 1, TILE_PX - 2, TILE_PX - 2);

    // HUD
    const hudY = viewH;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, hudY, VIEW_W * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(
      `x ${s.player.x}/${FIELD_WIDTH}  HP ${Math.max(0, Math.round(s.player.hp))}/${s.player.maxHp}  ATK ${s.player.atk}  fuel ${Math.round(s.player.fuel)}/${s.player.maxFuel}`,
      6,
      hudY + 16,
    );
    ctx.fillText(
      `money ${s.player.money}  cargo ${s.player.cargoUnits}/${s.player.maxCapacity}(¥${s.player.cargoValue})  drill Lv${s.player.drillPower}${s.player.teleportUnlocked ? '  [T]可' : ''}`,
      6,
      hudY + 32,
    );
    ctx.fillStyle = RISK_COLOR[s.player.combatRiskLevel];
    const combatFlash = s.player.combatRiskBanner > 0 && s.player.combatRiskBanner % 20 < 10;
    ctx.fillText(
      `combatRisk: ${s.player.combatRiskLevel} (推奨HP ${s.player.recommendedHp})${combatFlash ? '  !!' : ''}`,
      6,
      hudY + 48,
    );
    ctx.fillStyle = RISK_COLOR[s.player.miningRiskLevel];
    const miningFlash = !!s.player.miningRiskBanner;
    ctx.fillText(
      `miningRisk: ${s.player.miningRiskLevel} (帰還推定燃料 ${s.player.estFuelToReturn ?? '-'})${miningFlash ? '  !!' : ''}`,
      6,
      hudY + 64,
    );
    ctx.fillStyle = '#fff';
    ctx.fillText(
      `build: barricade¥${s.player.buildCosts.barricade}  outpost¥${s.player.buildCosts.outpost}${s.player.canBuildOutpost ? '(建設可)' : ''}  baseDist ${s.player.baseDistance}`,
      6,
      hudY + 80,
    );
    ctx.fillText(
      `kills ${s.metrics.kills}  oreMined ${s.metrics.oreMined}  outposts ${s.metrics.outpostsBuilt}  barricades ${s.metrics.barricadesBuilt}  score ${s.metrics.score}`,
      6,
      hudY + 96,
    );
    ctx.font = '10px monospace';
    ctx.fillText(
      '1攻撃 2機動 3耐久 4ドリル 5燃料 6採掘速度 7ランタン 8危険耐性 9積載 0テレポート解禁',
      6,
      hudY + 114,
    );

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, viewH);
      ctx.fillStyle = s.won ? '#2ecc71' : '#e74c3c';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(s.won ? 'GOAL!' : 'GAME OVER', 30, viewH / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '13px monospace';
      ctx.fillText(`distance ${s.metrics.distanceReached}  score ${s.metrics.score}`, 20, viewH / 2 + 22);
    }
  }
}
