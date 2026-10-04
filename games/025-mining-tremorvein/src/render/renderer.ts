import { DEPTH, SCAFFOLD_RELIEF, TREMOR_BONUS_FULL_AT, TREMOR_CAP, WIDTH, caveInChanceOver } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 32;
const VIEW_H = 16; // 縦の可視マス数
const GAUGE_W = 150; // 縦穴の右に置く揺れゲージの幅
const HUD_PX = 48;

const TILE_COLOR: Record<number, string> = {
  [TILE.FLOOR]: '#1b1b1b',
  [TILE.DIRT]: '#6b4a2f',
  [TILE.ROCK]: '#6d6d6d',
  [TILE.ORE_COPPER]: '#c8763a',
  [TILE.ORE_IRON]: '#9fb0bb',
  [TILE.ORE_GOLD]: '#e0c33d',
  [TILE.ORE_CRYSTAL]: '#7fd8e8',
  [TILE.CORE]: '#e05ad8',
};

/** 揺れの値を色にする（緑→黄→赤） */
function tremorColor(t: number): string {
  if (t < 20) return '#4caf6a';
  if (t < 50) return '#c9d14a';
  if (t < 80) return '#e0a03d';
  return '#e05a3d';
}

/**
 * 024の学び「システムを足すたびにHUDへ1行足す方式は避ける」に従い、揺れに関する情報
 * （今の値・帰着時の見積もり・売値ボーナス・落盤率）はすべて縦穴の右の1本のゲージに集約する。
 * HPは主人公の頭上、積荷は主人公の横、送り籠は籠の絵の数で示し、下段HUDは2行だけにする
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private shaftW = WIDTH * TILE_PX;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = this.shaftW + GAUGE_W;
    canvas.height = VIEW_H * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    const p = s.player;
    const camTop = Math.max(0, Math.min(DEPTH - VIEW_H, p.y - Math.floor(VIEW_H / 3)));
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, this.shaftW + GAUGE_W, VIEW_H * TILE_PX + HUD_PX);

    for (let row = 0; row < VIEW_H; row++) {
      const y = camTop + row;
      for (let x = 0; x < WIDTH; x++) {
        const t = s.map.tiles[y * WIDTH + x];
        ctx.fillStyle = y === 0 ? '#2a3b4f' : TILE_COLOR[t] ?? '#000';
        ctx.fillRect(x * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
        if (t !== TILE.FLOOR && y > 0) {
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.strokeRect(x * TILE_PX + 0.5, row * TILE_PX + 0.5, TILE_PX - 1, TILE_PX - 1);
        }
      }
      // 10マスごとの深さ目盛り
      if (y % 10 === 0 && y > 0) {
        ctx.fillStyle = '#888';
        ctx.font = '10px monospace';
        ctx.fillText(`${y}`, 2, row * TILE_PX + 10);
      }
    }

    // 落盤直後は縦穴全体を赤く揺らす
    const sinceCaveIn = s.lastCaveIn ? s.tick - s.lastCaveIn.tick : 999;
    const shake = sinceCaveIn < 6 ? (sinceCaveIn % 2 === 0 ? 3 : -3) : 0;

    // 採掘中タイルの進捗
    if (p.digging) {
      const d = p.digging;
      const row = d.y - camTop;
      const ratio = 1 - d.remaining / d.total;
      ctx.fillStyle = '#000';
      ctx.fillRect(d.x * TILE_PX, row * TILE_PX + TILE_PX - 5, TILE_PX, 4);
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(d.x * TILE_PX, row * TILE_PX + TILE_PX - 5, TILE_PX * ratio, 4);
    }

    // 主人公（揺れの色の縁取り）＋頭上HP＋横に積荷
    const px = p.x * TILE_PX + shake;
    const py = (p.y - camTop) * TILE_PX;
    ctx.fillStyle = tremorColor(p.tremor);
    ctx.fillRect(px + 2, py + 2, TILE_PX - 4, TILE_PX - 4);
    ctx.fillStyle = p.hasCore ? '#e05ad8' : '#f5f5f5';
    ctx.fillRect(px + 6, py + 6, TILE_PX - 12, TILE_PX - 12);
    const hpRatio = Math.max(0, p.hp) / p.maxHp;
    ctx.fillStyle = '#300';
    ctx.fillRect(px, py - 5, TILE_PX, 4);
    ctx.fillStyle = hpRatio > 0.5 ? '#4caf6a' : hpRatio > 0.25 ? '#e0c33d' : '#e05a3d';
    ctx.fillRect(px, py - 5, TILE_PX * hpRatio, 4);
    // 次の落盤で受けるダメージ分をHPバー上に暗く示す（あと何回耐えられるか）
    if (p.y > 0 && p.caveInDamage > 0) {
      const dmgW = Math.min(hpRatio, p.caveInDamage / p.maxHp) * TILE_PX;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(px + TILE_PX * hpRatio - dmgW, py - 5, dmgW, 4);
    }
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.fillText(`${p.cargoUnits}/${p.maxCapacity}`, Math.min(px + TILE_PX + 2, this.shaftW - 30), py + 12);

    // 足場（踊り場）: 床の上に板を渡した絵（主人公の足元に見えるよう、主人公の後に描く）
    for (const sc of s.map.scaffolds) {
      const row = sc.y - camTop;
      if (row < 0 || row >= VIEW_H) continue;
      ctx.fillStyle = '#b8863b';
      ctx.fillRect(sc.x * TILE_PX + 1, row * TILE_PX + TILE_PX - 7, TILE_PX - 2, 5);
      ctx.fillRect(sc.x * TILE_PX + 3, row * TILE_PX + 4, 3, TILE_PX - 8);
      ctx.fillRect(sc.x * TILE_PX + TILE_PX - 6, row * TILE_PX + 4, 3, TILE_PX - 8);
    }

    if (sinceCaveIn < 25 && s.lastCaveIn) {
      const c = s.lastCaveIn;
      ctx.fillStyle = `rgba(200,40,40,${0.35 * (1 - sinceCaveIn / 25)})`;
      ctx.fillRect(0, 0, this.shaftW, VIEW_H * TILE_PX);
      ctx.fillStyle = '#ffdddd';
      ctx.font = 'bold 13px monospace';
      const msg = c.rescued
        ? '落盤！ 力尽きて引き上げられた（積荷全損・救助費）'
        : `落盤！ HP-${c.damage}${c.spilledUnits > 0 ? ` 積荷${c.spilledUnits}個(¥${c.spilledValue})落とした` : ''}`;
      ctx.fillText(msg, 6, VIEW_H * TILE_PX - 10);
    }

    this.drawGauge(s);

    // 下段HUD（2行だけ）
    const hudY = VIEW_H * TILE_PX;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, hudY, this.shaftW + GAUGE_W, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(
      `¥${p.money}  積荷 ¥${p.cargoValue}  深さ ${p.y}/${DEPTH - 1}（最深 ${s.metrics.maxDepth}）  ドリル${p.drillPower}`,
      6,
      hudY + 18,
    );
    const baskets = '■'.repeat(p.basketsLeft) + '□'.repeat(Math.max(0, p.basketsMax - p.basketsLeft));
    const scaf = s.map.scaffolds.length + p.scaffoldsHeld > 0 ? `  足場 ${s.map.scaffolds.map((sc) => sc.y).join('/') || '-'}${p.scaffoldsHeld > 0 ? `（手持ち${p.scaffoldsHeld}・Pで据える）` : ''}` : '';
    ctx.fillText(
      `送り籠 ${p.basketsMax > 0 ? baskets : 'なし'}${scaf}  救助 ${s.metrics.rescues}回  ${p.hasCore ? '核石を持って地上へ！' : '目標: 深さ120の核石'}`,
      6,
      hudY + 36,
    );

    if (s.phase === 'shop') this.drawShop(s);
    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, this.shaftW + GAUGE_W, VIEW_H * TILE_PX);
      ctx.fillStyle = '#e05ad8';
      ctx.font = 'bold 24px monospace';
      ctx.fillText('核石を持ち帰った！', 40, 200);
      ctx.fillStyle = '#fff';
      ctx.font = '13px monospace';
      ctx.fillText(`${s.metrics.clearedTick} tick  稼ぎ ¥${s.metrics.moneyEarned}  救助 ${s.metrics.rescues}回`, 40, 230);
    }
  }

  /** 揺れゲージ: 縦軸が揺れ0〜150。今の値・帰着時の見積もり・ボーナス・落盤率を1本にまとめる */
  private drawGauge(s: GameState): void {
    const ctx = this.ctx;
    const p = s.player;
    const gx = this.shaftW + 10;
    const gy = 24;
    const gh = VIEW_H * TILE_PX - 64; // 下に2行（売値ボーナス・落盤率）を置く余白を残す
    const gw = 22;
    const toY = (t: number) => gy + gh - (Math.min(t, TREMOR_CAP) / TREMOR_CAP) * gh;
    ctx.fillStyle = '#ddd';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('揺れ', gx, 16);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#999';
    ctx.fillText('割れ目が開き良い面が出る', gx + 30, 15);
    // 背景の帯: 色の段階＋ボーナス上限の線
    for (let t = 0; t < TREMOR_CAP; t += 5) {
      ctx.fillStyle = tremorColor(t);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(gx, toY(t + 5), gw, toY(t) - toY(t + 5));
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = tremorColor(p.tremor);
    ctx.fillRect(gx, toY(p.tremor), gw, gy + gh - toY(p.tremor));
    ctx.strokeStyle = '#888';
    ctx.strokeRect(gx + 0.5, gy + 0.5, gw, gh);
    // 目盛り: 落盤率（100tickあたり）と売値ボーナス
    ctx.font = '10px monospace';
    for (const t of [20, 50, 80, 100, 130]) {
      const yy = toY(t);
      ctx.fillStyle = '#666';
      ctx.fillRect(gx + gw, yy, 4, 1);
      const chance = Math.round(caveInChanceOver(t, 100) * 100);
      const bonus = Math.round((Math.min(t, TREMOR_BONUS_FULL_AT) / TREMOR_BONUS_FULL_AT) * 60);
      ctx.fillStyle = '#999';
      ctx.fillText(`${t} +${bonus}% 100tで${chance}%`, gx + gw + 6, yy + 3);
    }
    // 帰着時の見積もり（今の揺れ＋帰り道の揺れ）をゴーストの線で
    if (p.estReturnTremor !== null) {
      const home = p.tremor + p.estReturnTremor;
      const yy = toY(home);
      ctx.strokeStyle = '#fff';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(gx - 6, yy);
      ctx.lineTo(gx + gw + 2, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.fillText('帰着', gx - 2, yy - 3);
    }
    // 足場が帰り道より近いなら、足場に着いたときの見積もりも黄色の線で（そこで休めば下がる）
    if (p.estScaffoldTremor !== null && !p.onScaffold && (p.estReturnTremor === null || p.estScaffoldTremor < p.estReturnTremor - 0.5)) {
      const yy2 = toY(p.tremor + p.estScaffoldTremor);
      ctx.strokeStyle = '#d9a441';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(gx - 6, yy2);
      ctx.lineTo(gx + gw + 2, yy2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#d9a441';
      ctx.fillText('足場', gx - 2, yy2 + 11);
    }
    // 今の値の読み
    const yy = toY(p.tremor);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${Math.round(p.tremor)}`, gx + 2, Math.max(gy + 10, yy - 3));
    ctx.font = '11px monospace';
    ctx.fillText(`売値+${Math.round(p.tremorBonus * 100)}%`, gx, gy + gh + 14);
    if (p.onScaffold && !p.digging) {
      ctx.fillStyle = '#d9a441';
      ctx.fillText(`足場で休憩 揺れ-${SCAFFOLD_RELIEF}/t`, gx, gy + gh + 26);
    } else {
      ctx.fillText(`落盤 100tで${Math.round(p.caveInChance100 * 100)}%`, gx, gy + gh + 26);
    }
  }

  private drawShop(s: GameState): void {
    const ctx = this.ctx;
    const p = s.player;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, TILE_PX, this.shaftW, s.shop.length * 34 + 30);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('地上（1〜7で購入／↓で潜る）', 8, TILE_PX + 18);
    ctx.font = '11px monospace';
    s.shop.forEach((item, i) => {
      const y = TILE_PX + 28 + i * 34;
      const afford = item.nextCost !== null && p.money >= item.nextCost;
      ctx.fillStyle = item.nextCost === null ? '#444' : afford ? '#2c3e50' : '#3a2c2c';
      ctx.fillRect(6, y, this.shaftW - 12, 30);
      ctx.fillStyle = '#fff';
      const costText = item.nextCost === null ? 'MAX' : `¥${item.nextCost}`;
      ctx.fillText(`${i + 1}.${item.name} Lv${item.level}/${item.maxLevel} ${costText}`, 10, y + 12);
      ctx.fillStyle = '#aaa';
      ctx.fillText(item.desc.slice(0, 24), 10, y + 25);
    });
  }
}
