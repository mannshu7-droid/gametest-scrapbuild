import type { GameState, ShopItemId } from '../core/types';

const ARENA_PX = 560;
const HUD_W = 300;
const PAD = 12;

const ENEMY_COLOR: Record<string, string> = {
  grunt: '#9b8a6a',
  runner: '#3fb7c9',
  brute: '#b8433a',
};

const ITEM_LABEL: Record<ShopItemId, string> = {
  blade: '刃（攻撃+4）',
  armor: '鎧（被ダメ×0.88）',
  mend: '癒し（撃破で+2回復）',
  vitality: '器（最大HP+25）',
};
const ITEM_KEY: Record<ShopItemId, string> = { blade: '1', armor: '2', mend: '3', vitality: '4' };

/** 熱の色: 0=灰青 → 50=橙 → 100=白熱 → 100超=青白い過熱（v2で上限を250へ） */
function heatColor(h: number): string {
  if (h > 100) {
    const k = Math.min(1, (h - 100) / 150);
    return `rgb(${Math.round(255 - 95 * k)},${Math.round(250 - 50 * k)},255)`;
  }
  if (h < 50) {
    const k = h / 50;
    return `rgb(${Math.round(120 + 135 * k)},${Math.round(130 + 20 * k)},${Math.round(160 - 120 * k)})`;
  }
  const k = (h - 50) / 50;
  return `rgb(255,${Math.round(150 + 100 * k)},${Math.round(40 + 200 * k)})`;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = ARENA_PX + HUD_W + PAD * 3;
    canvas.height = ARENA_PX + PAD * 2;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(s: GameState): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#0e0d10';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawArena(s);
    this.drawHud(s);
  }

  private drawArena(s: GameState): void {
    const ctx = this.ctx;
    const cx = PAD + ARENA_PX / 2;
    const cy = PAD + ARENA_PX / 2;
    const scale = ARENA_PX / 2 / (s.arenaRadius + 0.3);
    const X = (x: number) => cx + x * scale;
    const Y = (y: number) => cy + y * scale;
    const p = s.player;

    // 闘技場
    ctx.fillStyle = '#1d1a1f';
    ctx.beginPath();
    ctx.arc(cx, cy, s.arenaRadius * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a3340';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 篝火と結界
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, (s.brazierRadius + 0.3) * scale);
    glow.addColorStop(0, 'rgba(255,190,90,0.55)');
    glow.addColorStop(1, 'rgba(255,120,40,0.05)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, (s.brazierRadius + 0.3) * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(cx, cy, s.brazierRadius * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffcf6a';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    // 敵
    for (const e of s.enemies) {
      const r = e.kind === 'brute' ? 0.45 : e.kind === 'runner' ? 0.28 : 0.35;
      ctx.fillStyle = ENEMY_COLOR[e.kind];
      ctx.beginPath();
      ctx.arc(X(e.x), Y(e.y), r * scale, 0, Math.PI * 2);
      ctx.fill();
      if (e.hp < e.maxHp) {
        ctx.fillStyle = '#400';
        ctx.fillRect(X(e.x) - 10, Y(e.y) - r * scale - 6, 20, 3);
        ctx.fillStyle = '#e44';
        ctx.fillRect(X(e.x) - 10, Y(e.y) - r * scale - 6, (20 * e.hp) / e.maxHp, 3);
      }
    }

    // プレイヤー（熱で色と光輪が変わる）
    const hc = heatColor(p.heat);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), 1.5 * scale, 0, Math.PI * 2);
    ctx.stroke();
    if (p.heat > 0) {
      ctx.fillStyle = hc.replace('rgb', 'rgba').replace(')', `,${0.12 + p.heat / 400})`);
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), (0.5 + p.heat / 120) * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = p.iframes > 0 && s.tick % 2 === 0 ? '#fff' : hc;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), 0.4 * scale, 0, Math.PI * 2);
    ctx.fill();
    if (p.attackCd >= 5) {
      // 斬撃の残像
      ctx.strokeStyle = 'rgba(255,240,200,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 1.5 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
    }
    // v3: 踏ん張り（火の加護）の輪
    if (p.grace > 0) {
      ctx.strokeStyle = `rgba(155,231,255,${0.4 + (0.5 * p.grace) / 30})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 0.95 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
    }
    // 奉納の詠唱
    if (p.channel > 0) {
      ctx.strokeStyle = '#ffd76a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 0.7 * scale, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * p.channel) / s.channelNeeded);
      ctx.stroke();
      ctx.lineWidth = 2;
    }

    ctx.font = 'bold 13px monospace';
    for (const f of s.floats) {
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, X(f.x) - 12, Y(f.y) - 10);
    }

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(PAD, cy - 50, ARENA_PX, 100);
      ctx.fillStyle = '#ffd76a';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(`夜明け — 累計奉納 ${s.metrics.score}`, PAD + 40, cy);
      ctx.font = '14px monospace';
      ctx.fillStyle = '#ddd';
      ctx.fillText(`撃破${s.metrics.kills} 奉納${s.metrics.banks}回 救助${s.metrics.downs}回 失った残り火${s.metrics.lostEmbers}  R:もう一度`, PAD + 20, cy + 28);
    }
  }

  private drawHud(s: GameState): void {
    const ctx = this.ctx;
    const p = s.player;
    const x0 = PAD * 2 + ARENA_PX;
    let y = PAD + 14;
    const line = (text: string, color = '#ddd', font = '13px monospace') => {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(text, x0, y);
      y += 19;
    };

    const left = Math.max(0, s.sessionTicks - s.tick);
    const mm = Math.floor(left / 600);
    const ss = Math.floor((left % 600) / 10);
    line(`夜明けまで ${mm}:${String(ss).padStart(2, '0')}`, '#aab', 'bold 14px monospace');

    // HP
    ctx.fillStyle = '#311';
    ctx.fillRect(x0, y - 10, HUD_W - 10, 12);
    ctx.fillStyle = p.hp < p.maxHp * 0.3 ? '#e74c3c' : '#58c46b';
    ctx.fillRect(x0, y - 10, ((HUD_W - 10) * Math.max(0, p.hp)) / p.maxHp, 12);
    y += 8;
    line(`HP ${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`);
    if (p.grace > 0) line(`踏ん張り中 ${(p.grace / 10).toFixed(1)}秒 — 被ダメ半分。今のうちに戻れ`, '#9be7ff', 'bold 12px monospace');
    else line(p.graceReady ? '踏ん張り: 残り1回（HP3割を切ると発動）' : '踏ん張り: 使用済み（奉納で戻る）', p.graceReady ? '#7ab' : '#755', '11px monospace');

    // 熱ゲージ: 報酬倍率と被ダメージ倍率を同じゲージに並べる
    y += 4;
    line(`熱 ${p.heat.toFixed(0)}`, heatColor(p.heat), 'bold 15px monospace');
    const gw = HUD_W - 10;
    const grad = ctx.createLinearGradient(x0, 0, x0 + gw, 0);
    grad.addColorStop(0, heatColor(0));
    grad.addColorStop(50 / s.heatMax, heatColor(50));
    grad.addColorStop(Math.min(1, 100 / s.heatMax), heatColor(100));
    grad.addColorStop(1, heatColor(s.heatMax));
    ctx.fillStyle = '#222';
    ctx.fillRect(x0, y - 12, gw, 14);
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y - 12, (gw * p.heat) / s.heatMax, 14);
    for (const m of [25, 50, 75, 100, 150, 200].filter((v) => v < s.heatMax)) {
      ctx.fillStyle = '#555';
      ctx.fillRect(x0 + (gw * m) / s.heatMax, y - 12, 1, 14);
    }
    y += 18;
    line(`報酬 ×${s.rewardMult.toFixed(2)}   被ダメ ×${s.damageMult.toFixed(2)}`, '#ffcf8a');
    if (p.sinceKill > 40 && p.heat > 0) line('撃破が途切れて熱が冷めている', '#88a');
    else y += 19;

    // 残り火
    line(`抱えた残り火 ${Math.round(p.pool)}`, '#ffb347', 'bold 14px monospace');
    line('（倒れると全て失う。篝火で奉納して確定）', '#998');
    line(`奉納済み ${p.embers}  累計 ${s.metrics.score}`, '#ffd76a');
    const nextGoal = s.goals.find((g) => g > s.metrics.score);
    line(nextGoal ? `今夜の目標: 累計 ${nextGoal}（${s.goals.filter((g) => g <= s.metrics.score).length}/${s.goals.length}達成）` : '今夜の目標: すべて達成！', '#9c9');

    // 篝火
    y += 6;
    if (s.onBrazier) {
      line('篝火の上: B長押しで奉納（被弾で中断）。ここでは斬れない', '#ffd76a');
      line(`多芸は高くつく: 持っている他の強化1種ごとに価格×${s.typePenalty}`, '#c9a', '11px monospace');
      for (const it of ['blade', 'armor', 'mend', 'vitality'] as ShopItemId[]) {
        const c = s.shopCosts[it];
        const can = c > 0 && p.embers >= c;
        line(`${ITEM_KEY[it]}: ${ITEM_LABEL[it]} Lv${p.levels[it]} ${c > 0 ? c : '最大'}`, can ? '#fff' : '#777', '12px monospace');
      }
    } else {
      line('篝火（中央）へ戻ると奉納・強化', '#887');
      line(`刃${p.levels.blade} 鎧${p.levels.armor} 癒し${p.levels.mend} 器${p.levels.vitality}`, '#aaa', '12px monospace');
      y += 19 * 3;
    }

    // 直近の出来事
    y += 6;
    if (s.lastRescue && s.tick - s.lastRescue.tick < 80) {
      line(`救助された: 残り火−${s.lastRescue.lostPool}・熱−${s.lastRescue.lostHeat}`, '#ff6b6b', 'bold 13px monospace');
      line('（装備と奉納済みは無事）', '#c88');
    } else if (s.lastBank && s.tick - s.lastBank.tick < 60) {
      line(`奉納 +${s.lastBank.amount}（熱${s.lastBank.heat}で）`, '#ffd76a', 'bold 13px monospace');
    }
    y = PAD + ARENA_PX - 40;
    line(`撃破 ${s.metrics.kills}  奉納 ${s.metrics.banks}回  救助 ${s.metrics.downs}回`, '#999', '12px monospace');
    line(`敵の強さ ×${s.difficulty.toFixed(2)}  失った残り火 ${s.metrics.lostEmbers}`, '#999', '12px monospace');
  }
}
