import { W, H, OUTPOST_MIN_GAP, BOTTOM_REACHED_BONUS } from '../core/game';
import { TILE, type GameState } from '../core/types';
import { getSprite, type SpriteName } from './sprites';

const TILE_PX = 24;
const VIEW_W = W;
const VIEW_H = 18;
const HUD_PX = 168;

// スプライト読み込み前・失敗時のフォールバック単色（サイクル15新規: スプライト描画導入前の色を維持）
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

// タイル→スプライト名。鉱石3種(ORE_COPPER/IRON/GOLD)は共通の岩スプライトを土台にし、
// 上にコード描画の鉱脈ドット（ORE_DOT_COLOR）を重ねることで種類を区別する（画像はKenney.nl
// "Tiny Dungeon"のスプライトをそのまま使い、鉱脈の色分けだけをコード側の演出として追加する方針）
const TILE_SPRITE: Partial<Record<number, SpriteName>> = {
  [TILE.FLOOR]: 'tile_floor',
  [TILE.DIRT]: 'tile_dirt',
  [TILE.ROCK]: 'tile_rock',
  [TILE.ORE_COPPER]: 'tile_rock',
  [TILE.ORE_IRON]: 'tile_rock',
  [TILE.ORE_GOLD]: 'tile_rock',
  [TILE.PROP]: 'tile_prop',
  [TILE.OUTPOST]: 'tile_outpost',
};

const ORE_DOT_COLOR: Partial<Record<number, string>> = {
  [TILE.ORE_COPPER]: '#c8763a',
  [TILE.ORE_IRON]: '#cfe0ea',
  [TILE.ORE_GOLD]: '#ffd94a',
};

const ENEMY_SPRITE: Record<string, SpriteName> = {
  crawler: 'enemy_crawler',
  brute: 'enemy_brute',
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W * TILE_PX;
    canvas.height = VIEW_H * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false; // ドット絵素材を拡大表示してもぼやけないようにする
  }

  /** 鉱石タイルの岩スプライトの上に、種類ごとの色で小さな鉱脈ドットをコード描画する */
  private drawOreDots(x: number, rowY: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    const cx = x * TILE_PX;
    const cy = rowY * TILE_PX;
    const r = TILE_PX * 0.09;
    const offsets: [number, number][] = [
      [0.3, 0.32],
      [0.68, 0.28],
      [0.42, 0.62],
      [0.72, 0.68],
    ];
    for (const [ox, oy] of offsets) {
      ctx.beginPath();
      ctx.arc(cx + TILE_PX * ox, cy + TILE_PX * oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    const camTop = Math.max(0, Math.min(H - VIEW_H, s.player.y - Math.floor(VIEW_H / 2)));

    for (let row = 0; row < VIEW_H; row++) {
      const y = camTop + row;
      for (let x = 0; x < VIEW_W; x++) {
        const t = s.map.tiles[y * VIEW_W + x];
        const sprite = TILE_SPRITE[t] ? getSprite(TILE_SPRITE[t]!) : null;
        if (sprite) {
          ctx.drawImage(sprite, x * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
        } else {
          ctx.fillStyle = TILE_COLOR[t] ?? '#000';
          ctx.fillRect(x * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
        }
        const oreColor = ORE_DOT_COLOR[t];
        if (oreColor) this.drawOreDots(x, row, oreColor);
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
      const sprite = getSprite(ENEMY_SPRITE[e.type] ?? 'enemy_crawler');
      if (sprite) {
        ctx.drawImage(sprite, e.x * TILE_PX + 2, row * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
      } else {
        ctx.fillStyle = ENEMY_COLOR[e.type] ?? '#999';
        ctx.fillRect(e.x * TILE_PX + 2, row * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
      }
      const ratio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(e.x * TILE_PX, row * TILE_PX - 4, TILE_PX, 3);
      ctx.fillStyle = '#2ecc71';
      ctx.fillRect(e.x * TILE_PX, row * TILE_PX - 4, TILE_PX * ratio, 3);
    }

    // プレイヤー（dash中は水色、移動回避が乗っている間は金色のグローをスプライトの下に描画）
    const prow = s.player.y - camTop;
    const playerGlow = s.player.dashActive > 0 ? 'rgba(52,152,219,0.6)' : s.player.moveEvasion > 0 ? 'rgba(241,196,15,0.6)' : null;
    if (playerGlow) {
      ctx.fillStyle = playerGlow;
      ctx.fillRect(s.player.x * TILE_PX, prow * TILE_PX, TILE_PX, TILE_PX);
    }
    const playerSprite = getSprite('player');
    if (playerSprite) {
      ctx.drawImage(playerSprite, s.player.x * TILE_PX + 2, prow * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
    } else {
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(s.player.x * TILE_PX + 2, prow * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
    }

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
    if (s.riskEscalationBanner > 0) {
      // サイクル14・2回目新規: 危険度が再悪化した際、小さな色変化だけでは見逃されやすいという分析
      // （cycle14-v2レビュー参照）への対応。該当行の背景を短時間ハイライトするだけで、バランス非接続
      ctx.fillStyle = 'rgba(241,196,15,0.35)';
      ctx.fillRect(0, hudY + 96, VIEW_W * TILE_PX, 18);
    }
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

    if (s.firstRiskWarningBanner > 0) {
      ctx.fillStyle = 'rgba(231,76,60,0.85)';
      ctx.fillRect(0, 0, VIEW_W * TILE_PX, 30);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('危険度上昇！この深さの目安HPをHUDで確認し、攻撃力・体力の強化を検討してください', 8, 20);
    }

    if (s.bottomReachedBanner > 0) {
      ctx.fillStyle = 'rgba(224,195,61,0.85)';
      ctx.fillRect(0, 30, VIEW_W * TILE_PX, 30);
      ctx.fillStyle = '#1b1b1b';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`最深部(y=${H - 1})に到達！ 未知の奥底を踏破したボーナス +¥${BOTTOM_REACHED_BONUS}`, 8, 50);
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
