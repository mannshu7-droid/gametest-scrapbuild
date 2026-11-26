import type { GameState, TowerState } from '../core/types';
import { drawEnemy, drawHouse, drawLegend, drawPlayer, drawTurret, tileDirt, tileRock, type LegendItem } from './sprites';

const CELL = 36;
const BOARD = 17 * CELL; // 612
const PANEL = 300;
const W = BOARD + PANEL;
const LEGEND_H = 64;
const H = BOARD + LEGEND_H;

const DIR_JA: Record<string, string> = { one: '北だけ', two: '北と南', ring: '全周' };
const GROUND_JA: Record<string, string> = { rock: '岩', soil: '土', marsh: '湿地' };

/**
 * 真上から見た盤面（17×17マス、1マス36px）。右に HUD、下に凡例。
 * 塔は砲台の絵＋右の縦ゲージ（梁より下=灰、自由長の上限まで=青、超えた段=赤）で高さと危うさを見せる
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
  }

  private ground(s: GameState, tx: number, ty: number): void {
    const ctx = this.ctx;
    const x = tx * CELL;
    const y = ty * CELL;
    if (s.ground === 'rock') {
      tileRock(ctx, x, y, CELL, tx, ty, '#6f6f73');
    } else {
      tileDirt(ctx, x, y, CELL, tx, ty);
      if (s.ground === 'marsh') {
        ctx.fillStyle = 'rgba(40,110,120,0.42)';
        ctx.fillRect(x, y, CELL, CELL);
        if ((tx * 7 + ty * 3) % 5 === 0) {
          ctx.strokeStyle = 'rgba(170,230,235,0.55)';
          ctx.beginPath();
          ctx.ellipse(x + CELL * 0.5, y + CELL * 0.55, CELL * 0.3, CELL * 0.1, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  private tower(s: GameState, t: TowerState): void {
    const ctx = this.ctx;
    const x = t.x * CELL;
    const y = t.y * CELL;
    // 台座（石の基礎）
    ctx.fillStyle = '#4b4b52';
    ctx.strokeStyle = '#c9c9d2';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 4);
    ctx.fill();
    ctx.stroke();
    if (t.h <= 0) {
      ctx.fillStyle = '#9aa';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('台座', x + CELL / 2, y + CELL / 2 + 4);
      ctx.textAlign = 'left';
      return;
    }
    drawTurret(ctx, x, y - 4, CELL, t.aim, s.night);
    // 高さの縦ゲージ（右側）
    const gx = x + CELL - 2;
    const seg = Math.min(5, (CELL * 1.6) / Math.max(12, t.h));
    for (let i = 0; i < t.h; i++) {
      const lvl = i + 1;
      ctx.fillStyle = lvl <= t.beamTop ? '#8a8f98' : lvl - t.beamTop <= s.slender ? '#3fa2ff' : '#ff4040';
      ctx.fillRect(gx, y + CELL - 2 - (i + 1) * seg, 6, seg - 1);
    }
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = t.over > 0 ? '#ff6b6b' : '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    const label = `h${t.h}`;
    ctx.strokeText(label, x + 2, y + 12);
    ctx.fillText(label, x + 2, y + 12);
    ctx.lineWidth = 1;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#101214';
    ctx.fillRect(0, 0, W, H);
    for (let ty = 0; ty < s.h; ty++) for (let tx = 0; tx < s.w; tx++) this.ground(s, tx, ty);

    const c = (v: number) => v * CELL + CELL / 2;
    // 梁の通り道（輪）の下書き
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(c(5), c(5), 6 * CELL, 6 * CELL);
    ctx.setLineDash([]);
    // 射程（夜だけ薄く）
    if (s.night) {
      for (const t of s.towers) {
        if (t.h <= 0) continue;
        ctx.strokeStyle = 'rgba(80,170,255,0.18)';
        ctx.beginPath();
        ctx.arc(c(t.x), c(t.y), t.range * CELL, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(200,120,255,0.25)';
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.arc(c(s.baseX), c(s.baseY), 7 * CELL, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 拠点
    drawHouse(ctx, c(s.baseX), s.baseY * CELL + CELL - 2, CELL * 1.1, '#c0392b');
    // 梁
    for (const b of s.beams) {
      if (b.h <= 0) continue;
      const [ax, ay] = [s.towers[b.a].x, s.towers[b.a].y];
      const [bx, by] = [s.towers[b.b].x, s.towers[b.b].y];
      const k = b.hp / Math.max(1, b.maxHp);
      ctx.strokeStyle = '#3a2410';
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(c(ax), c(ay));
      ctx.lineTo(c(bx), c(by));
      ctx.stroke();
      ctx.strokeStyle = k > 0.5 ? '#e69a3c' : k > 0.25 ? '#e0662f' : '#d02a2a';
      ctx.lineWidth = 3 + 5 * k;
      ctx.stroke();
      ctx.lineWidth = 1;
      const mx = (c(ax) + c(bx)) / 2;
      const my = (c(ay) + c(by)) / 2;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#ffe0b0';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      const txt = `梁${b.h} ${b.hp}/${b.maxHp}`;
      ctx.strokeText(txt, mx - 22, my - 7);
      ctx.fillText(txt, mx - 22, my - 7);
      ctx.lineWidth = 1;
    }
    for (const t of s.towers) this.tower(s, t);
    // 敵
    for (const e of s.enemies) {
      const ex = e.x * CELL + CELL / 2;
      const ey = e.y * CELL + CELL / 2;
      if (e.kind === 'archer') drawEnemy(ctx, ex, ey, CELL * 0.85, 'archer', '#9b59b6', e.x < s.baseX ? 1 : -1);
      else drawEnemy(ctx, ex, ey, CELL * 0.85, 'grunt', e.holdEdge >= 0 ? '#e67e22' : '#c0392b', e.x < s.baseX ? 1 : -1);
      ctx.fillStyle = '#000';
      ctx.fillRect(ex - 12, ey - 22, 24, 4);
      ctx.fillStyle = '#5f5';
      ctx.fillRect(ex - 12, ey - 22, (24 * e.hp) / e.maxHp, 4);
    }
    // プレイヤー
    const p = s.player;
    drawPlayer(ctx, c(p.x), c(p.y), CELL * 0.95, { face: p.face, tool: 'pick', glow: p.busy > 0 ? 'rgba(255,230,120,0.35)' : null });
    if (p.busy > 0) {
      ctx.fillStyle = '#222';
      ctx.fillRect(c(p.x) - 16, c(p.y) + 20, 32, 5);
      ctx.fillStyle = '#ffd34d';
      const total = p.busyKind === 'raise' ? 20 : 30;
      ctx.fillRect(c(p.x) - 16, c(p.y) + 20, 32 * (1 - p.busy / total), 5);
    }
    // 夜の暗さ
    if (s.night) {
      ctx.fillStyle = 'rgba(10,20,60,0.25)';
      ctx.fillRect(0, 0, BOARD, BOARD);
    }
    this.hud(s);
    this.legend();
  }

  private hud(s: GameState): void {
    const ctx = this.ctx;
    const x0 = BOARD + 12;
    let y = 22;
    const line = (txt: string, col = '#dfe6ee', size = 14) => {
      ctx.font = `${size}px sans-serif`;
      ctx.fillStyle = col;
      ctx.fillText(txt, x0, y);
      y += size + 6;
    };
    line(`${s.night ? '夜' : '昼'} ${s.day}/6  あと${Math.ceil(s.phaseLeft / 10)}秒`, s.night ? '#9fb4ff' : '#ffe08a', 18);
    line(`所持金 ${Math.floor(s.gold)}   スコア ${s.metrics.score}`, '#ffffff', 16);
    line(`向き: ${DIR_JA[s.dir]}   地盤: ${GROUND_JA[s.ground]}`, '#cfe8c8', 15);
    line(`単独で立つ高さ（自由長の上限）: ${s.slender}段`, '#cfe8c8', 13);
    line(`撃破${s.metrics.kills}  荒らされ${s.metrics.leaks}  矢−${s.metrics.arrowLoss}`, '#dfe6ee', 13);
    line(`折れた塔${s.metrics.collapses}  壊れた梁${s.metrics.beamBreaks}`, '#dfe6ee', 13);
    if (s.night) line(`残りの敵 ${s.enemies.length + s.toSpawn}${s.gustIn >= 0 ? '  突風が来る' : ''}`, '#ffb0b0', 14);
    y += 4;
    line('塔  高さ 梁 自由長/上限 射程', '#9aa4b0', 12);
    for (const t of s.towers) {
      const col = t.over > 0 ? '#ff7070' : t.h > 0 ? '#dfe6ee' : '#6c7580';
      line(`${t.id + 1}   h${t.h}   ${t.beamTop || '-'}   ${t.free}/${s.slender}${t.over > 0 ? '超' : ''}   ${t.range.toFixed(1)}`, col, 12);
    }
    y += 4;
    ctx.font = '11px sans-serif';
    for (const ev of s.events.slice(-6)) {
      ctx.fillStyle = '#b8c2cc';
      ctx.fillText(ev, x0, y);
      y += 15;
    }
    if (s.over) {
      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = '#ffd34d';
      ctx.fillText(`終了 スコア ${s.metrics.score}`, x0, BOARD - 20);
    }
  }

  private legend(): void {
    const ctx = this.ctx;
    const items: LegendItem[] = [
      { label: '自分', draw: (c, x, y, s) => drawPlayer(c, x + s / 2, y + s / 2, s, { tool: 'pick' }) },
      { label: '歩兵（梁で止まる）', draw: (c, x, y, s) => drawEnemy(c, x + s / 2, y + s / 2, s, 'grunt', '#c0392b') },
      { label: '射手（7マスで止まり撃つ）', draw: (c, x, y, s) => drawEnemy(c, x + s / 2, y + s / 2, s, 'archer', '#9b59b6') },
      { label: '塔', draw: (c, x, y, s) => drawTurret(c, x, y, s) },
      {
        label: '梁',
        draw: (c, x, y, s) => {
          c.strokeStyle = '#e69a3c';
          c.lineWidth = 6;
          c.beginPath();
          c.moveTo(x, y + s / 2);
          c.lineTo(x + s, y + s / 2);
          c.stroke();
          c.lineWidth = 1;
        },
      },
      { label: '拠点', draw: (c, x, y, s) => drawHouse(c, x + s / 2, y + s, s, '#c0392b') },
      { label: '岩', draw: (c, x, y, s) => tileRock(c, x, y, s, 1, 1, '#6f6f73') },
      { label: '土', draw: (c, x, y, s) => tileDirt(c, x, y, s, 2, 1) },
      {
        label: '湿地',
        draw: (c, x, y, s) => {
          tileDirt(c, x, y, s, 3, 1);
          c.fillStyle = 'rgba(40,110,120,0.5)';
          c.fillRect(x, y, s, s);
        },
      },
      {
        label: '塔のゲージ 灰=梁の下 青=安全 赤=上限超え',
        draw: (c, x, y, s) => {
          c.fillStyle = '#8a8f98';
          c.fillRect(x + s * 0.35, y + s * 0.66, s * 0.3, s * 0.3);
          c.fillStyle = '#3fa2ff';
          c.fillRect(x + s * 0.35, y + s * 0.34, s * 0.3, s * 0.3);
          c.fillStyle = '#ff4040';
          c.fillRect(x + s * 0.35, y + s * 0.02, s * 0.3, s * 0.3);
        },
      },
    ];
    drawLegend(ctx, 8, BOARD + 6, 22, items, W - 16);
  }
}
