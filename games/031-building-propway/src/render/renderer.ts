import type { GameState } from '../core/types';

const W = 720;
const H = 380;
const TILE_W = 11; // 坑道61マスを1画面に収める
const TUNNEL_TOP = 40;
const TUNNEL_H = 90;
const GAUGE_Y = 170;
const GAUGE_H = 22;
const GAUGE_MAX = 70;
const HIST_Y = 220;
const HIST_H = 100;
const HIST_LEN = 600; // 帰着線の履歴（60秒）

/**
 * 揺れの情報は「ゲージ1本＋帰着線の履歴グラフ」に集約する（030の学び: HUDを行で増やさない）。
 * 履歴グラフは、支柱の下で帰着線が平らになる／支えのない所で上下して注意線をまたぐ、を目で見せるためのもの
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private hist: { tick: number; line: number; supported: boolean }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
  }

  private gx(v: number): number {
    return 20 + (Math.min(GAUGE_MAX, Math.max(0, v)) / GAUGE_MAX) * (W - 40);
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    const p = s.player;
    const t = s.tremor;
    if (this.hist.length && this.hist[this.hist.length - 1].tick > s.tick) this.hist = [];
    if (!this.hist.length || this.hist[this.hist.length - 1].tick !== s.tick) {
      this.hist.push({ tick: s.tick, line: t.returnLine, supported: s.tunnel.cells[p.x]?.supported ?? false });
      if (this.hist.length > HIST_LEN) this.hist.shift();
    }

    ctx.fillStyle = '#101114';
    ctx.fillRect(0, 0, W, H);

    // 見出し: 帰着線の内訳と落盤率（1行）
    ctx.font = '14px monospace';
    ctx.fillStyle = t.returnLine >= t.danger ? '#ff6b5a' : t.returnLine >= t.caution ? '#ffd166' : '#d8d8d8';
    const head =
      p.x > 0
        ? `帰着線 ${t.returnLine.toFixed(0)}（揺れ${t.value.toFixed(0)}＋帰り道${t.returnCost.toFixed(0)}）  落盤 ${(t.caveChance * 1000).toFixed(1)}%/秒`
        : '拠点（積荷を換金し、揺れ0・HP全快）';
    ctx.fillText(head, 20, 22);

    // 坑道: 天井・床・支柱・足場・主人公
    const x0 = (W - (s.tunnel.length + 1) * TILE_W) / 2;
    for (const c of s.tunnel.cells) {
      const px = x0 + c.x * TILE_W;
      ctx.fillStyle = c.x === 0 ? '#2a3b4f' : c.supported ? '#24384a' : '#2a2420';
      ctx.fillRect(px, TUNNEL_TOP, TILE_W - 1, TUNNEL_H);
      // 天井の岩（支えの無い所は崩れそうな色）
      ctx.fillStyle = c.x === 0 ? '#3b5570' : c.supported ? '#5d6f80' : '#6b4a2f';
      ctx.fillRect(px, TUNNEL_TOP, TILE_W - 1, 10);
      if (c.prop) {
        ctx.fillStyle = '#c8a26a';
        ctx.fillRect(px + 3, TUNNEL_TOP + 10, 4, TUNNEL_H - 14);
        ctx.fillRect(px - 2, TUNNEL_TOP + 10, TILE_W + 3, 4);
      }
      if (c.scaffold) {
        ctx.fillStyle = '#7fd8e8';
        ctx.fillRect(px, TUNNEL_TOP + TUNNEL_H - 22, TILE_W - 1, 4);
        ctx.fillRect(px + 1, TUNNEL_TOP + TUNNEL_H - 18, 2, 14);
        ctx.fillRect(px + TILE_W - 4, TUNNEL_TOP + TUNNEL_H - 18, 2, 14);
      }
      if (c.x % 10 === 0) {
        ctx.fillStyle = '#888';
        ctx.font = '10px monospace';
        ctx.fillText(`${c.x}`, px, TUNNEL_TOP + TUNNEL_H + 12);
      }
    }
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(x0, TUNNEL_TOP + TUNNEL_H - 4, (s.tunnel.length + 1) * TILE_W, 4);
    // 主人公（揺れの色の帽子）
    const ppx = x0 + p.x * TILE_W + TILE_W / 2;
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(ppx - 3, TUNNEL_TOP + TUNNEL_H - 26, 6, 22);
    ctx.fillStyle = t.value >= t.danger ? '#ff6b5a' : t.value >= t.caution ? '#ffd166' : '#6fcf7f';
    ctx.fillRect(ppx - 4, TUNNEL_TOP + TUNNEL_H - 30, 8, 5);
    // HP（頭上の細いバー）
    ctx.fillStyle = '#400';
    ctx.fillRect(ppx - 10, TUNNEL_TOP + 14, 20, 3);
    ctx.fillStyle = '#e05a5a';
    ctx.fillRect(ppx - 10, TUNNEL_TOP + 14, (20 * Math.max(0, p.hp)) / p.maxHp, 3);
    if (p.busy) {
      ctx.fillStyle = '#ffd166';
      ctx.font = '11px monospace';
      const label = p.busy.kind === 'prop' ? '支柱' : p.busy.kind === 'scaffold' ? '足場' : '救助';
      ctx.fillText(`${label} ${Math.round((100 * (p.busy.total - p.busy.remaining)) / p.busy.total)}%`, ppx - 18, TUNNEL_TOP + 30);
    }
    // 直近の落盤（3秒表示）
    if (s.lastCaveIn && s.tick - s.lastCaveIn.tick < 30) {
      const c = s.lastCaveIn;
      ctx.fillStyle = '#ff6b5a';
      ctx.font = '12px monospace';
      ctx.fillText(
        `落盤! HP−${c.damage} 積荷−${Math.round(c.lostValue)}${c.propBroken ? ' 支柱が折れた' : ''}${c.rescued ? ' → 救助（積荷全損）' : ''}`,
        20,
        TUNNEL_TOP + TUNNEL_H + 28,
      );
    }

    // 揺れゲージ1本: 今の揺れ（塗り）・帰着線（白線）・注意線・危険線
    ctx.fillStyle = '#222';
    ctx.fillRect(20, GAUGE_Y, W - 40, GAUGE_H);
    ctx.fillStyle = t.value >= t.danger ? '#c0392b' : t.value >= t.caution ? '#d4a017' : '#3f9b5a';
    ctx.fillRect(20, GAUGE_Y, this.gx(t.value) - 20, GAUGE_H);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(this.gx(t.value), GAUGE_Y, Math.max(0, this.gx(t.returnLine) - this.gx(t.value)), GAUGE_H);
    for (const [v, col, label] of [
      [t.caution, '#ffd166', '注意30'],
      [t.danger, '#ff6b5a', '危険45'],
    ] as const) {
      ctx.fillStyle = col;
      ctx.fillRect(this.gx(v) - 1, GAUGE_Y - 6, 2, GAUGE_H + 12);
      ctx.font = '10px monospace';
      ctx.fillText(label, this.gx(v) - 14, GAUGE_Y - 8);
    }
    if (p.x > 0) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(this.gx(t.returnLine) - 2, GAUGE_Y - 4, 4, GAUGE_H + 8);
    }

    // 帰着線の履歴（60秒）: 支えの下は青、支えの無い所は橙
    ctx.fillStyle = '#16181c';
    ctx.fillRect(20, HIST_Y, W - 40, HIST_H);
    const hy = (v: number) => HIST_Y + HIST_H - (Math.min(GAUGE_MAX, Math.max(0, v)) / GAUGE_MAX) * HIST_H;
    for (const [v, col] of [
      [t.caution, 'rgba(255,209,102,0.6)'],
      [t.danger, 'rgba(255,107,90,0.6)'],
    ] as const) {
      ctx.fillStyle = col;
      ctx.fillRect(20, hy(v), W - 40, 1);
    }
    const n = this.hist.length;
    for (let i = 1; i < n; i++) {
      const a = this.hist[i - 1];
      const b = this.hist[i];
      ctx.strokeStyle = b.supported ? '#6fb6ff' : '#e0a03d';
      ctx.beginPath();
      ctx.moveTo(20 + ((i - 1 + HIST_LEN - n) / HIST_LEN) * (W - 40), hy(a.line));
      ctx.lineTo(20 + ((i + HIST_LEN - n) / HIST_LEN) * (W - 40), hy(b.line));
      ctx.stroke();
    }
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.fillText('帰着線の履歴 60秒（青=支柱の下 / 橙=支えなし）', 24, HIST_Y + 12);

    // 下段HUD（2行）
    ctx.font = '13px monospace';
    ctx.fillStyle = '#d8d8d8';
    const left = Math.max(0, s.timeLimit - s.tick);
    ctx.fillText(
      `所持金 ${p.money}  積荷 ${Math.floor(p.cargo)}  HP ${Math.max(0, p.hp)}  残り ${Math.floor(left / 600)}:${String(Math.floor((left % 600) / 10)).padStart(2, '0')}`,
      20,
      H - 34,
    );
    ctx.fillStyle = '#aaa';
    ctx.fillText(
      `次の支柱 ¥${s.nextPropCost}（前後2マスの帰り道を1/3に・揺れの波を0.35倍）  足場 ¥${s.scaffoldCost}（上で休むと揺れ↓）`,
      20,
      H - 14,
    );
    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = '22px monospace';
      ctx.fillText(`時間切れ  所持金 ${p.money}`, W / 2 - 130, H / 2);
    }
  }
}
