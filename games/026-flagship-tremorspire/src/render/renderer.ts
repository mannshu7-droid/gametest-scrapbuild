import { DAY_LENGTH, FIELD_WIDTH, LANE_COUNT, LENGTH, NIGHT_LENGTH, TUNE } from '../core/game';
import { TILE, type GameState } from '../core/types';

const TILE_PX = 28;
const VIEW_W = 20;
const HUD_PX = 306;
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

    // 夜間は視界全体をわずかに青暗くティントする
    if (s.phase === 'night') {
      ctx.fillStyle = 'rgba(10,10,40,0.28)';
      ctx.fillRect(0, fieldTop, VIEW_W * TILE_PX, viewH);
    }

    // 3回目（v2中#1）: 救助は待たせずに夜明けまで飛ばすので、その間に起きたことを6秒だけ報告する
    const rep = s.rescueReport;
    if (rep && s.tick - rep.untilTick < RESCUE_REPORT_TICKS) {
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

    // HUD
    const hudY = fieldTop + viewH;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, hudY, VIEW_W * TILE_PX, HUD_PX);
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.fillText(
      `x ${s.player.x}/${FIELD_WIDTH}  HP ${Math.max(0, Math.round(s.player.hp))}/${s.player.maxHp}  ATK ${s.player.atk}${s.resource === 'fuel' ? `  fuel ${Math.round(s.player.fuel)}/${s.player.maxFuel}` : ''}${s.player.rescueDownTicks > 0 ? `  救助の手当て中 ${s.player.rescueDownTicks}` : s.resource === 'tremor' ? `  ${rescueHint(s.player.rescueFee)}${s.player.money < 0 ? ` 借金${-s.player.money}` : ''}` : ''}`,
      6,
      hudY + 16,
    );
    ctx.fillText(
      `money ${s.player.money}  cargo ${s.player.cargoUnits}/${s.player.maxCapacity}(¥${s.player.cargoValue})  drill Lv${s.player.drillPower}${s.player.teleportUnlocked ? '  [T]可' : ''}`,
      6,
      hudY + 32,
    );
    ctx.fillStyle = s.phase === 'day' ? '#f1c40f' : '#7f9cf5';
    ctx.fillText(
      `${s.phase === 'day' ? '☀ 昼' : '🌙 夜'}  残り${s.phaseTicksLeft}tick  夜${s.metrics.nightsSurvived}回生存${s.nightWarning ? '  夜が近い!' : ''}`,
      6,
      hudY + 48,
    );
    ctx.fillStyle = RISK_COLOR[s.player.combatRiskLevel];
    const combatFlash = s.player.combatRiskBanner > 0 && s.player.combatRiskBanner % 20 < 10;
    ctx.fillText(
      `combatRisk: ${s.player.combatRiskLevel} (推奨HP ${s.player.recommendedHp})${combatFlash ? '  !!' : ''}`,
      6,
      hudY + 64,
    );
    if (s.resource === 'fuel') {
      ctx.fillStyle = RISK_COLOR[s.player.miningRiskLevel];
      const miningFlash = !!s.player.miningRiskBanner;
      ctx.fillText(
        `miningRisk: ${s.player.miningRiskLevel} (帰還推定燃料 ${s.player.estFuelToReturn ?? '-'})${miningFlash ? '  !!' : ''}`,
        6,
        hudY + 80,
      );
    } else {
      this.drawTremorGauge(s, 6, hudY + 69);
    }
    ctx.fillStyle = RISK_COLOR[s.player.raidRiskLevel];
    const raidFlash = !!s.player.raidRiskBanner;
    ctx.fillText(
      `raidRisk: ${s.player.raidRiskLevel} (拠点まで${s.player.baseDistance})${raidFlash ? '  !!' : ''}`,
      6,
      hudY + 96,
    );
    ctx.fillStyle = RISK_COLOR[s.player.forecastRiskLevel];
    const forecastFlash = !!s.player.forecastRiskBanner;
    const forecastDetail = s.baseForecasts
      .map((f) => `${f.isHome ? 'home' : `outpost@${f.x}`}:${f.level}`)
      .join(' ');
    ctx.fillText(
      `tonight: ${s.player.forecastRiskLevel}${forecastFlash ? '  !!' : ''}  ${forecastDetail}`,
      6,
      hudY + 112,
    );
    ctx.fillStyle = '#fff';
    ctx.fillText(
      `build: barricade¥${s.player.buildCosts.barricade}  turret¥${s.player.buildCosts.turret}(${s.player.turretsAtCurrentBase}/${s.player.maxTurretsPerBase})  outpost¥${s.player.buildCosts.outpost}${s.player.canBuildOutpost ? '(建設可)' : ''}  baseDist ${s.player.baseDistance}`,
      6,
      hudY + 128,
    );
    const defShop = s.shop.find((it) => it.id === 'basedefense');
    ctx.fillText(
      `拠点防衛投資 Lv${defShop?.level ?? 0}（迎撃dmg${s.player.baseAutoDefenseDmg}/tick）${defShop?.nextCost !== null && defShop?.nextCost !== undefined ? `  次Q¥${defShop.nextCost}` : '  MAX'}  タレット${s.turrets.length}基`,
      6,
      hudY + 144,
    );
    const scannerShop = s.shop.find((it) => it.id === 'scanner');
    ctx.fillStyle = s.player.chargeReady ? '#f1c40f' : '#fff';
    ctx.fillText(
      `探査Lv${scannerShop?.level ?? 0}（未到達の先まで見通せる距離+${scannerShop?.level ?? 0}バンド）  共鳴チャージ ${s.player.charge}/${s.player.maxCharge}${s.player.chargeReady ? '  [READY]' : ''}`,
      6,
      hudY + 160,
    );
    ctx.fillStyle = '#fff';
    ctx.fillText(
      `kills ${s.metrics.kills}(内レイダー${s.metrics.raidersKilled}/タレット撃破${s.metrics.turretKills})  oreMined ${s.metrics.oreMined}  共鳴発動${s.metrics.resonanceTriggers}(巻き込み${s.metrics.resonanceBonusOre})  outposts ${s.metrics.outpostsBuilt}(喪失${s.metrics.outpostsLost})  turrets ${s.metrics.turretsBuilt}(喪失${s.metrics.turretsLost})  score ${s.metrics.score}`,
      6,
      hudY + 176,
    );
    // 建材ロットキュー（020新規）。鑑定Lv0では中身が見えず「?」、Lv1以上で品質推定値を表示し、Z/Xで選択
    ctx.font = '12px monospace';
    ctx.fillStyle = '#fff';
    const lotText = s.player.buildLots
      .map((q, i) => `${i === selectedLot && s.player.appraisalLv >= 1 ? '>' : ' '}${q === null ? '?' : q.toFixed(2)}`)
      .join(' |');
    const linkedCount = s.barricades.filter((b) => b.linked).length + s.turrets.filter((t) => t.linked).length;
    ctx.fillText(`建材ロット[Z/X選択・タレット=品質²で攻撃力/バリケード=薄く] 鑑定Lv${s.player.appraisalLv}: ${lotText}`, 6, hudY + 194);
    ctx.fillText(
      `連携中${linkedCount}/${s.barricades.length + s.turrets.length}基（軽減dmg累計${Math.round(s.metrics.linkSavedDamage)}）盾持ちタレット${s.turrets.filter((t) => t.shielded).length}/${s.turrets.length}  選別配置${s.metrics.informedPlacements}回  平均品質${s.metrics.obstaclesBuilt > 0 ? (s.metrics.qualitySumBuilt / s.metrics.obstaclesBuilt).toFixed(2) : '-'}`,
      6,
      hudY + 210,
    );
    // 塔の一覧（024新規）: 高さ・自由長/上限・射程・パトロール圏・回廊。自由長が上限を超えた塔は赤で警告
    const towers = [...s.turrets].sort((a, b) => Math.abs(a.x - s.player.x) - Math.abs(b.x - s.player.x)).slice(0, 4);
    const towerText = towers
      .map((t) => `#${t.id}(x${t.x},y${t.y}) h${t.height} 自由長${t.freeLength}/${t.slenderLimit} 射程${t.range} 圏${t.patrolRange}${t.topBeamLevel ? ` 梁${t.topBeamLevel}` : t.height > 0 ? (t.lone ? ' 孤塔' : ' 見張り') : ''}`)
      .join('  ');
    ctx.fillStyle = towers.some((t) => (t.overstress ?? 0) > 0) ? '#ff6b6b' : '#9fd3ff';
    ctx.fillText(`塔: ${towerText || '（タレット無し）'}`, 6, hudY + 226);
    const work = s.player.towerWork;
    ctx.fillStyle = '#ffd59a';
    ctx.fillText(
      `${work ? `作業中: ${work.kind === 'raise' ? '積み増し' : '梁の架設'} ${work.progress}/${work.total}  ` : ''}H長押し=積み増し(1段${s.towerRules.raiseTicks}tick)  G長押し=梁(${s.towerRules.beamTicks}tick)  自由長が${s.towerRules.slenderLimit}を超えると崩れうる。隣の塔と梁で編むと上限が梁の高さから数え直し  崩落${s.metrics.towerCollapses}(連鎖${s.metrics.cascadeCollapses})`,
      6,
      hudY + 242,
    );
    // v2新規: 塔の両面（援護射撃と誘引）を常時表示する。高さは「夜の援護」と「呼び寄せる敵」の両方を増やす
    ctx.fillStyle = s.player.coveringTowers > 0 ? '#7dffb0' : s.lureRaidCount > 0 ? '#ffb27d' : '#aaa';
    ctx.fillText(
      `${s.player.coveringTowers > 0 ? `援護射撃中: 塔${s.player.coveringTowers}基  ` : ''}塔の誘引: ${s.phase === 'night' ? '今夜' : '次の夜'} +${s.lureRaidCount}体（拠点ごとの塔の高さ合計÷${s.towerRules.lureRaidStep}）  夜は高い塔の圏内で援護（梁なし=上下${s.towerRules.watchLanes}レーンも見張る）、呼んだ敵の報酬×${s.towerRules.luredRewardMult}、敵は梁(耐久${s.towerRules.beamHp})を狙う  落ちた梁${s.metrics.beamsLost}`,
      6,
      hudY + 258,
    );
    ctx.font = '10px monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(
      `1攻撃 2機動 3耐久 4ドリル 5${s.resource === 'fuel' ? '燃料' : '支保'} 6採掘速度 7ランタン 8危険耐性 9積載 0テレポート解禁 Q拠点防衛 Eスキャナ Cチャージ Pタレット設置`,
      6,
      hudY + 274,
    );

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

  /**
   * 026新規: 揺れゲージ（燃料行の置き換え、HUDの行数は増やさない）。1本のバーに
   * 現在の揺れ（色は落盤しやすさ）・帰着線（白、帰り道で揺れが最も高くなる見積もり）・危険線（赤、60）を重ね、
   * 右に売値ボーナスと100tickの落盤率、回廊（足場）で下がっているか、夕暮れで速いかを1行で出す
   */
  private drawTremorGauge(s: GameState, x: number, y: number): void {
    const ctx = this.ctx;
    const w = 140;
    const h = 12;
    const cap = s.player.tremorCap;
    const t = s.player.tremor;
    ctx.fillStyle = '#333';
    ctx.fillRect(x, y, w, h);
    const danger = s.player.caveInChance100;
    ctx.fillStyle = danger >= 0.3 ? '#e74c3c' : danger >= 0.05 ? '#f39c12' : '#5dade2';
    ctx.fillRect(x, y, (w * Math.min(t, cap)) / cap, h);
    // 危険線（帰着線がこれを超えるとminingRisk=danger）
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(x + (w * TUNE.dangerAt) / cap - 1, y - 2, 2, h + 4);
    // 帰着線
    const est = s.player.estTremorAtReturn;
    if (est !== null) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + (w * Math.min(est, cap)) / cap - 1, y - 3, 2, h + 6);
    }
    const rate = s.player.tremorRate;
    const arrow = rate < 0 ? (s.player.corridor === 'woven' ? '▼回廊' : '▼塔の圏') : s.player.corridor === 'lane' ? '△塔の圏' : rate > 0 ? '▲' : '';
    ctx.fillStyle = RISK_COLOR[s.player.miningRiskLevel];
    ctx.font = '12px monospace';
    ctx.fillText(
      `揺れ${Math.round(t)} 帰着${est ?? '-'} 売値+${Math.round(s.player.tremorBonus * 100)}% 落盤${Math.round(danger * 100)}%/100t ${arrow}${s.player.dusk ? ` 夕暮れ×${TUNE.duskMult}` : ''}`,
      x + w + 8,
      y + 10,
    );
  }
}
