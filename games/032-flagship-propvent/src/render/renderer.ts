import { DAY_LENGTH, FIELD_WIDTH, LANE_COUNT, LENGTH, NIGHT_LENGTH, TUNE } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 28;
const VIEW_W = 20;
const HUD_PX = 152;
const PHASE_BAR_PX = 8;

const TILE_COLOR: Record<number, string> = {
  [TILE.FLOOR]: '#1b1b1b',
  [TILE.DIRT]: '#6b4a2f',
  [TILE.ROCK]: '#6d6d6d',
  [TILE.ORE_COPPER]: '#c8763a',
  [TILE.ORE_IRON]: '#9fb0bb',
  [TILE.ORE_GOLD]: '#e0c33d',
  [TILE.GAS]: '#4caf6a',
  [TILE.UNSTABLE]: '#8a3b3b',
  [TILE.UNSCANNED]: '#26262f',
  [TILE.RIFT]: '#7b2cbf',
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

/** 3回目: 救助の報告を夜明けから出しておくtick数（10tpsで6秒） */
const RESCUE_REPORT_TICKS = 60;
/** 3回目（v2軽微#6）: 稼ぐ前（1日目など）は救助費が0なので、金額ではなく「朝まで」と率を見せる */
function rescueHint(fee: number): string {
  return fee > 0 ? `倒れたら朝まで＋救助費${fee}` : '倒れたら朝まで（救助費は今日の稼ぎの半分）';
}
export class Renderer {
  private ctx: CanvasRenderingContext2D;

  /** バリケード/タレットの品質・連携表示（020新規）。品質は左下の小さな四角の色、連携中はシアンの枠 */
  private drawObstacleMarks(sx: number, sy: number, quality: number, linked: boolean, shielded = false): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.qualityColor(quality);
    ctx.fillRect(sx + 2, sy + TILE_PX - 8, 6, 6);
    ctx.font = '9px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(quality.toFixed(1), sx + TILE_PX - 18, sy + TILE_PX - 3);
    if (linked) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, TILE_PX - 2, TILE_PX - 2);
    }
    if (shielded) {
      // 盾持ちタレット（隣接にバリケードがあり攻撃ダメージ強化中、v2）は右上に金色の印
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(sx + TILE_PX - 9, sy + 3, 6, 6);
    }
  }

  /**
   * 塔の高さゲージ（024新規、023-final バグ#2「自由長が画面で見えない」への対応）。タイル右端に縦の目盛りを描く:
   * 梁より下の段=灰、梁から自由長上限までの段=青、上限を超えた段（崩れうる）=赤の点滅。最高の梁の位置にオレンジの横線、
   * 自由長の上限位置に白い点線を引き、左上に「高さ」と「自由長/上限」を数字で出す
   */
  private drawTowerGauge(sx: number, sy: number, t: GameState['turrets'][number], maxHeight: number): void {
    const ctx = this.ctx;
    const segH = (TILE_PX - 4) / maxHeight;
    const gx = sx + TILE_PX - 5;
    const top = t.topBeamLevel ?? 0;
    const limit = t.slenderLimit ?? 4;
    for (let h = 0; h < t.height; h++) {
      const y = sy + TILE_PX - 2 - (h + 1) * segH;
      const over = h >= top + limit;
      ctx.fillStyle = h < top ? '#7f8c8d' : over ? (Math.floor(Date.now() / 250) % 2 === 0 ? '#e74c3c' : '#7b1f1f') : '#4aa3e0';
      ctx.fillRect(gx, y, 4, Math.max(1, segH - 0.5));
    }
    if (top > 0) {
      ctx.fillStyle = '#e67e22';
      ctx.fillRect(gx - 3, sy + TILE_PX - 2 - top * segH - 1, 8, 2);
    }
    const capY = sy + TILE_PX - 2 - Math.min(maxHeight, top + limit) * segH;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx - 3, capY);
    ctx.lineTo(gx + 5, capY);
    ctx.stroke();
    ctx.setLineDash([]);
    if (t.height > 0) {
      ctx.font = 'bold 9px monospace';
      ctx.fillStyle = (t.overstress ?? 0) > 0 ? '#ff6b6b' : '#fff';
      ctx.fillText(`h${t.height}`, sx + 2, sy + 9);
      ctx.fillText(`${t.freeLength}/${limit}`, sx + 2, sy + 18);
    }
  }

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W * TILE_PX;
    canvas.height = PHASE_BAR_PX + LANE_COUNT * TILE_PX + HUD_PX;
    this.ctx = canvas.getContext('2d')!;
  }

  /** 建材の品質倍率（0.5〜1.5）を色に変換する（低=赤・中=灰・高=緑。020新規、設置後は常に公開） */
  private qualityColor(q: number): string {
    if (q < 0.85) return '#e74c3c';
    if (q > 1.15) return '#2ecc71';
    return '#bdc3c7';
  }

  draw(s: GameState, selectedLot = 0): void {
    const ctx = this.ctx;
    const viewH = LANE_COUNT * TILE_PX;
    const camLeft = Math.max(0, Math.min(LENGTH - VIEW_W, s.player.x - Math.floor(VIEW_W / 3)));

    // 昼夜フェーズバー（画面最上部。残りtickの割合を表示し、夜警告時は点滅）
    const phaseTotal = s.phase === 'day' ? DAY_LENGTH : NIGHT_LENGTH;
    const phaseRatio = Math.max(0, Math.min(1, 1 - s.phaseTicksLeft / phaseTotal));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W * TILE_PX, PHASE_BAR_PX);
    const warnFlash = s.nightWarning && s.tick % 20 < 10;
    ctx.fillStyle = s.phase === 'day' ? (warnFlash ? '#e74c3c' : '#f1c40f') : '#3b4d8b';
    ctx.fillRect(0, 0, VIEW_W * TILE_PX * phaseRatio, PHASE_BAR_PX);

    const fieldTop = PHASE_BAR_PX;

    // タイル（未採掘の地形）
    for (let col = 0; col < VIEW_W; col++) {
      const x = camLeft + col;
      if (x >= LENGTH) continue;
      for (let y = 0; y < LANE_COUNT; y++) {
        const t = s.map.tiles[x * LANE_COUNT + y];
        ctx.fillStyle = TILE_COLOR[t] ?? '#000';
        ctx.fillRect(col * TILE_PX, fieldTop + y * TILE_PX, TILE_PX, TILE_PX);
      }
    }

    // v2（中#5）: 揺れが下がる踊り場を地面に淡く塗る。梁で編んだ回廊（woven）は水色、梁なしの塔のレーン（lane）は薄い緑。
    // HUDの行は増やさない（「▼回廊」の文字だけだった範囲を絵で見せる）
    if (s.resource === 'tremor') {
      for (const t of s.turrets) {
        const range = Math.floor(t.patrolRange ?? 0);
        const woven = (t.topBeamLevel ?? 0) > 0;
        const [lo, hi] = woven ? (t.corridorLanes ?? [t.y, t.y]) : [t.y, t.y];
        const x0 = Math.max(camLeft, t.x - range);
        const x1 = Math.min(camLeft + VIEW_W - 1, t.x + range);
        if (x1 < x0) continue;
        ctx.fillStyle = woven ? 'rgba(120,200,255,0.16)' : 'rgba(140,230,140,0.10)';
        ctx.fillRect((x0 - camLeft) * TILE_PX, fieldTop + lo * TILE_PX, (x1 - x0 + 1) * TILE_PX, (hi - lo + 1) * TILE_PX);
      }
    }

    // 032: 支えられた列（支柱の前後propSpan列）を地面の下端に茶色の帯で、支柱を太い縦の柱で描く。建てかけは進捗の高さまで
    if (s.resource === 'tremor' && s.map.props.length > 0) {
      const span = s.map.propSpan;
      ctx.fillStyle = 'rgba(205,140,70,0.16)';
      for (const q of s.map.props) {
        const x0 = Math.max(camLeft, q.x - span);
        const x1 = Math.min(camLeft + VIEW_W - 1, q.x + span);
        if (x1 < x0) continue;
        ctx.fillRect((x0 - camLeft) * TILE_PX, fieldTop, (x1 - x0 + 1) * TILE_PX, viewH);
      }
      for (const q of s.map.props) {
        const col = q.x - camLeft;
        if (col < 0 || col >= VIEW_W) continue;
        ctx.fillStyle = '#c88a3e';
        ctx.fillRect(col * TILE_PX + TILE_PX / 2 - 3, fieldTop, 6, viewH);
        ctx.fillStyle = '#6b4219';
        ctx.fillRect(col * TILE_PX + 2, fieldTop, TILE_PX - 4, 4);
        ctx.fillRect(col * TILE_PX + 2, fieldTop + viewH - 4, TILE_PX - 4, 4);
      }
    }
    if (s.player.propWork) {
      const w = s.player.propWork;
      const col = w.x - camLeft;
      if (col >= 0 && col < VIEW_W) {
        const h = (viewH * w.progress) / w.total;
        ctx.fillStyle = 'rgba(200,138,62,0.7)';
        ctx.fillRect(col * TILE_PX + TILE_PX / 2 - 3, fieldTop + viewH - h, 6, h);
      }
    }

    // 030: 割れ目（紫に光り、売値と閉じるまでの秒を出す）
    for (const r of s.map.rifts) {
      const col = r.x - camLeft;
      if (col < 0 || col >= VIEW_W) continue;
      const sx = col * TILE_PX;
      const sy = fieldTop + r.y * TILE_PX;
      const pulse = 0.5 + 0.5 * Math.sin(s.tick / 2);
      ctx.strokeStyle = `rgba(220,160,255,${0.5 + 0.5 * pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 2, sy + 2, TILE_PX - 4, TILE_PX - 4);
      ctx.lineWidth = 1;
      ctx.fillStyle = '#fff';
      ctx.font = '9px monospace';
      ctx.fillText(`¥${r.value}`, sx + 3, sy + 11);
      ctx.fillText(`${Math.max(0, (r.closesAt - s.tick) / 10).toFixed(1)}`, sx + 3, sy + 23);
    }

    // 拠点（ホーム + 前線拠点、保護範囲を縦帯で表示。HP割合で色を暗くする）
    for (const base of s.bases) {
      const r = base.isHome ? s.map.homeRadius : s.map.outpostRadius;
      const sx = (base.x - camLeft) * TILE_PX;
      if (sx < -r * TILE_PX * 2 || sx > VIEW_W * TILE_PX) continue;
      const hpRatio = Math.max(0, base.hp / base.maxHp);
      const alpha = 0.15 + 0.25 * hpRatio;
      ctx.fillStyle = base.isHome ? `rgba(52,152,219,${alpha})` : `rgba(46,204,113,${alpha})`;
      ctx.fillRect(sx - r * TILE_PX, fieldTop, r * 2 * TILE_PX, viewH);
      ctx.fillStyle = base.isHome ? '#3498db' : '#2ecc71';
      ctx.fillRect(sx - 2, fieldTop, 4, viewH);
      // 拠点HPバー（保護帯の上端）
      ctx.fillStyle = '#000';
      ctx.fillRect(sx - r * TILE_PX, fieldTop, r * 2 * TILE_PX, 4);
      ctx.fillStyle = hpRatio > 0.5 ? '#2ecc71' : hpRatio > 0.25 ? '#f1c40f' : '#e74c3c';
      ctx.fillRect(sx - r * TILE_PX, fieldTop, r * 2 * TILE_PX * hpRatio, 4);
    }

    // 採掘中タイルの進捗バー
    if (s.player.digging) {
      const d = s.player.digging;
      const col = d.x - camLeft;
      if (col >= 0 && col < VIEW_W) {
        const ratio = 1 - d.remaining / d.total;
        ctx.fillStyle = '#000';
        ctx.fillRect(col * TILE_PX, fieldTop + d.y * TILE_PX + TILE_PX - 5, TILE_PX, 4);
        ctx.fillStyle = '#f1c40f';
        ctx.fillRect(col * TILE_PX, fieldTop + d.y * TILE_PX + TILE_PX - 5, TILE_PX * ratio, 4);
      }
    }

    // バリケード
    for (const b of s.barricades) {
      const sx = (b.x - camLeft) * TILE_PX;
      if (sx < -TILE_PX || sx > VIEW_W * TILE_PX) continue;
      const sy = fieldTop + b.y * TILE_PX;
      ctx.fillStyle = '#8b5a2b';
      ctx.fillRect(sx + 1, sy + 1, TILE_PX - 2, TILE_PX - 2);
      const ratio = Math.max(0, b.hp / b.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx, sy - 4, TILE_PX, 3);
      ctx.fillStyle = '#e67e22';
      ctx.fillRect(sx, sy - 4, TILE_PX * ratio, 3);
      this.drawObstacleMarks(sx, sy, b.quality, b.linked);
    }

    // 拠点防衛タレット（016新規。バリケードと区別できる青系の外観＋充填中は暗く見せる）
    for (const t of s.turrets) {
      const sx = (t.x - camLeft) * TILE_PX;
      if (sx < -TILE_PX || sx > VIEW_W * TILE_PX) continue;
      const sy = fieldTop + t.y * TILE_PX;
      ctx.fillStyle = '#1b3a5c';
      ctx.fillRect(sx + 1, sy + 1, TILE_PX - 2, TILE_PX - 2);
      ctx.fillStyle = '#4aa3e0';
      ctx.fillRect(sx + 6, sy + 6, TILE_PX - 12, TILE_PX - 12);
      const ratio = Math.max(0, t.hp / t.maxHp);
      ctx.fillStyle = '#000';
      ctx.fillRect(sx, sy - 4, TILE_PX, 3);
      ctx.fillStyle = '#4aa3e0';
      ctx.fillRect(sx, sy - 4, TILE_PX * ratio, 3);
      this.drawObstacleMarks(sx, sy, t.quality, t.linked, t.shielded ?? false);
      this.drawTowerGauge(sx, sy, t, s.towerRules.maxHeight);
    }

    // 梁（024新規）: 繋がった塔の中心同士をオレンジの線で結び、架けた高さを数字で示す
    for (const b of s.beams) {
      const a = s.turrets.find((t) => t.id === b.aId);
      const c = s.turrets.find((t) => t.id === b.bId);
      if (!a || !c) continue;
      const ax = (a.x - camLeft) * TILE_PX + TILE_PX / 2;
      const ay = fieldTop + a.y * TILE_PX + TILE_PX / 2;
      const cx = (c.x - camLeft) * TILE_PX + TILE_PX / 2;
      const cy = fieldTop + c.y * TILE_PX + TILE_PX / 2;
      // v2: 梁はレイダーに狙われる弱点。耐久が減るほど赤く、細くなる
      const ratio = Math.max(0, b.hp / b.maxHp);
      ctx.strokeStyle = ratio > 0.6 ? '#e67e22' : ratio > 0.3 ? '#e74c3c' : '#ff2d2d';
      ctx.lineWidth = 1 + 2 * ratio;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.fillStyle = '#ffd59a';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`梁${b.level}${b.hp < b.maxHp ? ` ${Math.ceil(b.hp)}/${b.maxHp}` : ''}`, (ax + cx) / 2 - 8, (ay + cy) / 2 - 2);
    }

    // 敵（夜間レイダーは赤い外枠で通常の前線敵と区別する）
    for (const e of s.enemies) {
      const sx = (e.x - camLeft) * TILE_PX;
      if (sx < -TILE_PX || sx > VIEW_W * TILE_PX) continue;
      const sy = fieldTop + e.y * TILE_PX;
      if (e.isRaider) {
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(sx + 1, sy + 1, TILE_PX - 2, TILE_PX - 2);
      }
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
    const psy = fieldTop + s.player.y * TILE_PX;
    ctx.fillStyle = s.player.dashCd === 0 ? '#f1c40f' : '#f5f5f5';
    ctx.fillRect(psx + 1, psy + 1, TILE_PX - 2, TILE_PX - 2);
    // 2回目（v1軽微#5）: 金鉱石・割れ目の近くでも見分けられるよう白い縁取りと黒い芯
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(psx + 1, psy + 1, TILE_PX - 2, TILE_PX - 2);
    ctx.lineWidth = 1;
    ctx.fillStyle = '#111';
    ctx.fillRect(psx + TILE_PX / 2 - 2, psy + TILE_PX / 2 - 2, 4, 4);
    // 028: 踏ん張りの発動中は青い輪と残り秒数
    if (s.player.gritTicks > 0) {
      ctx.strokeStyle = '#4da6ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(psx + TILE_PX / 2, psy + TILE_PX / 2, TILE_PX * 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#4da6ff';
      ctx.font = '10px monospace';
      ctx.fillText(`踏ん張り ${(s.player.gritTicks / 10).toFixed(1)}s`, psx - 10, psy - 4);
    }

    // 夜間は視界全体をわずかに青暗くティントする
    if (s.phase === 'night') {
      ctx.fillStyle = 'rgba(10,10,40,0.28)';
      ctx.fillRect(0, fieldTop, VIEW_W * TILE_PX, viewH);
    }

    // 3回目（v2中#1）: 救助は待たせずに夜明けまで飛ばすので、その間に起きたことを6秒だけ報告する
    const rep = s.rescueReport;
    if (rep && rep.skippedTicks === 0 && s.tick - rep.untilTick < RESCUE_REPORT_TICKS) {
      // 028: 時間は失わない。失ったのは抱えた積荷だけ
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, fieldTop + 4, VIEW_W * TILE_PX, 24);
      ctx.fillStyle = '#ff9f80';
      ctx.font = '12px monospace';
      ctx.fillText(
        `倒れてホームへ運ばれた  抱えた積荷¥${rep.cargoLost}を失った${rep.cargoKept > 0 ? `（塔の見張りが¥${rep.cargoKept}を拾って届けた）` : ''}  お金・時間・装備は無事`,
        8,
        fieldTop + 20,
      );
    } else if (rep && s.tick - rep.untilTick < RESCUE_REPORT_TICKS) {
      const lines = [
        `倒れて朝まで運ばれた（${rep.skippedTicks}tickを失った）  積荷¥${rep.cargoLost}を失い、救助費${rep.fee}`,
        `その間: 塔と拠点がレイダー${rep.raidersKilled}体を撃破  拠点の被害${Math.round(rep.baseDamage)}（ホーム−${Math.round(rep.homeHpLost)}）` +
          `${rep.towersLost > 0 ? `  塔${rep.towersLost}基を失った` : ''}${rep.outpostsLost > 0 ? `  前哨${rep.outpostsLost}を失った` : ''}`,
      ];
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, fieldTop + 4, VIEW_W * TILE_PX, 40);
      ctx.fillStyle = '#ff9f80';
      ctx.font = '12px monospace';
      lines.forEach((l, i) => ctx.fillText(l, 8, fieldTop + 20 + i * 16));
    }

    // HUD（030: 028の17行を「揺れゲージ1本＋5行」に集約。注意線・危険線・被ダメ倍率・踏ん張りの点・割れ目の残り・粘った秒数はゲージに載せる）
    const hudY = fieldTop + viewH;
    const W = VIEW_W * TILE_PX;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, hudY, W, HUD_PX);
    if (s.resource === 'tremor') this.drawTremorGauge(s, 6, hudY + 6, W - 12);
    const p = s.player;
    // 1行目: 抱えた物（倒れたら失う物）と被ダメ倍率
    ctx.fillStyle = p.dmgMult >= 2 ? '#ff6b6b' : '#fff';
    this.fitText(
      `積荷 ${p.cargoUnits}/${p.maxCapacity} ¥${p.cargoValue}${p.coverKeepNow > 0 ? ` 盾${Math.round(p.coverKeepNow * 100)}%` : ''}  被ダメ×${p.dmgMult.toFixed(1)}  ` +
        // 032: 帰還の宣言の後は「帰るだけ」を最優先で出す
        (p.returnOnly ? (p.returnOnlyBy === 'rest' ? '休んだ＝帰るだけ（もう掘れない）' : '割れ目で帰るだけ（もう掘れない）') : '') +
        (p.returnOnly ? '' : p.rescueDownTicks > 0 ? `手当て中${p.rescueDownTicks}` : p.stakeRescue ? '倒れたら積荷を失う' : rescueHint(p.rescueFee)),
      6,
      hudY + 60,
      W - 12,
    );
    // 2行目: 身体と財布
    ctx.fillStyle = '#fff';
    this.fitText(
      `HP ${Math.max(0, Math.round(p.hp))}/${p.maxHp}  ATK ${p.atk}  防具Lv${p.armorLv}  ¥${p.money}${p.money < 0 ? '(借金)' : ''}  ドリル${p.drillPower}  x${p.x}/${FIELD_WIDTH}${p.teleportUnlocked ? ' [T]' : ''}`,
      6,
      hudY + 77,
      W - 12,
    );
    // 3行目: 昼夜と今夜の予告
    ctx.fillStyle = s.phase === 'day' ? (s.nightWarning ? '#ff9f43' : '#f1c40f') : '#7f9cf5';
    const forecast = s.baseForecasts.map((f) => `${f.isHome ? '本' : '前'}${f.level === 'danger' ? '危' : f.level === 'caution' ? '注' : '安'}`).join(' ');
    this.fitText(
      `${s.phase === 'day' ? '昼' : '夜'} 残り${Math.ceil(s.phaseTicksLeft / 10)}秒  夜${s.metrics.nightsSurvived}回生存${s.nightWarning ? '  夜が近い!' : ''}  今夜: ${forecast || '-'}  誘引+${s.lureRaidCount}${p.coveringTowers > 0 ? `  援護${p.coveringTowers}` : ''}`,
      6,
      hudY + 94,
      W - 12,
    );
    // 4行目: 建てる物と、いちばん近い塔
    const tw = [...s.turrets].sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    const work = p.towerWork;
    ctx.fillStyle = tw && (tw.overstress ?? 0) > 0 ? '#ff6b6b' : '#9fd3ff';
    this.fitText(
      `支柱¥${p.propCost}(${s.map.props.length}本${p.supported ? '・ここは支え有' : ''}) 柵¥${p.buildCosts.barricade} 砲¥${p.buildCosts.turret}(${p.turretsAtCurrentBase}/${p.maxTurretsPerBase}) 前哨¥${p.buildCosts.outpost}${p.canBuildOutpost ? '可' : ''}  ` +
        (p.propWork
          ? `支柱 ${p.propWork.progress}/${p.propWork.total}`
          : work
          ? `作業 ${work.kind === 'raise' ? '積み増し' : '梁'} ${work.progress}/${work.total}`
          : tw
            ? `塔#${tw.id} h${tw.height} 自由長${tw.freeLength}/${tw.slenderLimit} 圏${tw.patrolRange}${tw.topBeamLevel ? ` 梁${tw.topBeamLevel}` : ''}`
            : '塔なし'),
      6,
      hudY + 111,
      W - 12,
    );
    // 5行目: 記録と建材ロット（鑑定Lv1以上）
    ctx.fillStyle = '#aaa';
    const lotText = p.appraisalLv >= 1 ? ` ロット${p.buildLots.map((q, i) => `${i === selectedLot ? '>' : ''}${q === null ? '?' : q.toFixed(1)}`).join(' ')}` : '';
    this.fitText(
      `撃破${s.metrics.kills} 鉱石${s.metrics.oreMined} 割れ目${s.metrics.riftsMined}/${s.metrics.riftsOpened} 救助${s.metrics.rescues}  score ${s.metrics.score}${lotText}`,
      6,
      hudY + 128,
      W - 12,
    );
    ctx.fillStyle = '#777';
    this.fitText('1攻 2機 3耐 4ドリル 5支保 6速 7灯 8耐危 9積 0転送 Q防 Eスキャン Cチャージ V鑑定 F防具 P砲 B柵 O前哨 H積む G梁 K支柱 (止まる=休む)', 6, hudY + 144, W - 12, 10);

    if (s.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, fieldTop, VIEW_W * TILE_PX, viewH);
      ctx.fillStyle = s.won ? '#2ecc71' : '#e74c3c';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(s.won ? 'GOAL!' : 'GAME OVER', 30, fieldTop + viewH / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '13px monospace';
      const reason = s.loseReason === 'homeDestroyed' ? 'ホーム陥落' : s.loseReason === 'playerHp' ? 'HP0' : '';
      ctx.fillText(`distance ${s.metrics.distanceReached}  score ${s.metrics.score}  ${reason}`, 20, fieldTop + viewH / 2 + 22);
    }
  }

  /** 幅に収まるまでフォントを小さくして描く（狭い画面で見出しの右端が欠けないように。029-final軽微#2） */
  private fitText(text: string, x: number, y: number, maxW: number, size = 12): void {
    const ctx = this.ctx;
    let px = size;
    ctx.font = `${px}px monospace`;
    while (px > 7 && ctx.measureText(text).width > maxW) {
      px--;
      ctx.font = `${px}px monospace`;
    }
    ctx.fillText(text, x, y);
  }

  /**
   * 030: 揺れゲージ（HUDの主役、横幅いっぱい）。1本のバーに次を重ねる:
   * - 今の揺れ（色は落盤しやすさ）と帰着線（白い縦線＝帰り道で揺れが最も高くなる見積もり）
   * - 注意線（黄・30）と危険線（赤・45）。注意線の外は紫に塗り、割れ目が開く帯であることを示す
   * - 下の目盛りに被ダメ倍率（×2・×3・×5の位置）、右端に踏ん張りの点、注意線の右に開いている割れ目の残り
   * - 上の見出しに揺れ・帰着・売値ボーナス・落盤率・踊り場・割れ目・粘った秒数（砂時計）
   */
  private drawTremorGauge(s: GameState, x: number, y: number, w: number): void {
    const ctx = this.ctx;
    const p = s.player;
    const h = 14;
    const gy = y + 14;
    const cap = p.tremorCap;
    const gw = w - 34; // 右端は踏ん張りの点
    const X = (v: number) => x + (gw * Math.min(Math.max(v, 0), cap)) / cap;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x, gy, gw, h);
    // 注意線の外＝割れ目が開く帯（割れ目が無効なら塗らない）
    if (p.riftRelief > 0) {
      ctx.fillStyle = 'rgba(176,92,255,0.18)';
      // 2回目: 割れ目に上限（riftCeil）があれば、帯は上限までで切る
      const bandEnd = TUNE.riftCeil > 0 ? X(TUNE.riftCeil) : x + gw;
      ctx.fillRect(X(TUNE.cautionAt), gy, bandEnd - X(TUNE.cautionAt), h);
    }
    const t = p.tremor;
    const danger = p.caveInChance100;
    ctx.fillStyle = danger >= 0.3 ? '#e74c3c' : danger >= 0.05 ? '#f39c12' : '#5dade2';
    ctx.fillRect(x, gy + 3, X(t) - x, h - 6);
    ctx.fillStyle = '#f1c40f';
    ctx.fillRect(X(TUNE.cautionAt) - 1, gy - 2, 2, h + 4);
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(X(TUNE.dangerAt) - 1, gy - 2, 2, h + 4);
    const est = p.estTremorAtReturn;
    if (est !== null) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(X(est) - 1, gy - 4, 3, h + 8);
    }
    // 被ダメ×2を超えたら縁を赤く脈打たせる（タッチ版では振動と同時）
    if (p.dmgMult >= 2 && s.tick % 10 < 5) {
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 1, gy - 1, gw + 2, h + 2);
      ctx.lineWidth = 1;
    }
    // 被ダメ倍率の目盛り（1+(揺れ/45)^2 が 2・3・5 になる揺れ）
    ctx.font = '9px monospace';
    if (TUNE.tremorDmg > 0) {
      ctx.fillStyle = '#bbb';
      for (const m of [2, 3, 5]) {
        const v = TUNE.dmgDiv * Math.pow(m - 1, 1 / TUNE.dmgExp);
        if (v > cap) continue;
        ctx.fillRect(X(v), gy + h, 1, 3);
        ctx.fillText(`×${m}`, X(v) + 2, gy + h + 11);
      }
    }
    ctx.fillStyle = '#f1c40f';
    ctx.fillText('注意', X(TUNE.cautionAt) - 22, gy + h + 11);
    // 2回目（v1軽微#6）: 危険線の札はゲージの中、線の右（下の×2の目盛りと重ならない）
    ctx.fillStyle = '#ff4d4d';
    ctx.fillText('危険', X(TUNE.dangerAt) + 3, gy + h - 3);
    // 踏ん張りの点（残り回数）
    if (p.stakeRescue && TUNE.gritTicks > 0) {
      for (let i = 0; i < TUNE.gritPerDay; i++) {
        ctx.fillStyle = i < p.gritLeft ? '#4da6ff' : '#333';
        ctx.beginPath();
        ctx.arc(x + gw + 14 + i * 10, gy + h / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 開いている割れ目の残り（閉じるまでの時間を紫の棒で）
    const rifts = s.map.rifts;
    rifts.forEach((r, i) => {
      const left = Math.max(0, (r.closesAt - s.tick) / TUNE.riftLife);
      ctx.fillStyle = '#c77dff';
      ctx.fillRect(X(TUNE.cautionAt) + 4 + i * 26, gy + h - 3, 22 * left, 3);
    });
    // 3回目（v2軽微#5）: 逃げ道の残り。注意線の下に、この遠征で次に掘る割れ目から抜ける揺れ（10・7・4.9…）を点の大きさで並べ、
    // 使った段は暗くする（拠点に戻るか救助で戻る）
    if (p.riftRelief > 0 && TUNE.riftReliefDecay < 1) {
      const used = Math.round(Math.log(p.riftRelief / TUNE.riftRelief) / Math.log(TUNE.riftReliefDecay));
      const x0 = X(TUNE.cautionAt) + 8;
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = i < used ? '#444' : '#c77dff';
        ctx.beginPath();
        ctx.arc(x0 + i * 10, gy + h + 7, 1.5 + 2.5 * Math.pow(TUNE.riftReliefDecay, i), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 見出し（1行に収める）
    const rate = p.tremorRate;
    const arrow = (rate < 0 ? (p.corridor === 'woven' ? '▼回廊' : '▼塔の圏') : p.corridor === 'lane' ? '△塔の圏' : rate > 0 ? '▲' : '') + (p.supported ? '▽支柱' : '');
    const riftText =
      p.riftRelief > 0
        ? rifts.length > 0
          ? ` 割れ目${rifts.length}（掘ると揺れ−${p.riftRelief}）`
          : p.riftOpenNow
            ? ` 割れ目${Math.round(p.riftChance * 100)}%/t ¥${p.riftValueHere}`
            : ''
        : '';
    ctx.fillStyle = RISK_COLOR[p.miningRiskLevel];
    this.fitText(
      `揺れ${Math.round(t)} 帰着${est ?? '-'} 売値+${Math.round(p.tremorBonus * 100)}% 落盤${Math.round(danger * 100)}% ${arrow}${p.dusk ? ` 夕×${TUNE.duskMult}` : ''}${riftText}${overLineText(s)}`,
      x,
      y + 10,
      w,
    );
  }
}

/**
 * 3回目（v2中#3）: 注意線の外で帰着線がまだ上がっていた時間（粘った時間。迷いの損を「見える」形にする）。遠征中は今の値、拠点では前の遠征の値。
 * 倒れない慎重な遊び方では損が救助として出ないので、帰る目安を越えた秒数だけを出す
 */
function overLineText(s: GameState): string {
  const p = s.player;
  if (p.estTremorAtReturn !== null) return p.overLineTicks > 0 ? ` ⌛${(p.overLineTicks / 10).toFixed(1)}s` : '';
  return p.lastTripOverLine > 0 ? ` 前回⌛${(p.lastTripOverLine / 10).toFixed(1)}s` : '';
}
