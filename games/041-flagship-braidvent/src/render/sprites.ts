/**
 * 共通スプライト（Canvas 2D で手続き的に描く。画像ファイルを使わない）
 *
 * 目的: レビュー・観戦で「キャラクター／敵／土／石／鉱石／建物」が一目で分かること。
 * 単色の円や四角（ドット）だけで描かない（2026-11-24、ユーザー指摘「すべてがドットでわからない」への対応）。
 *
 * 使い方: このファイルを games/NNN-名前/src/render/sprites.ts へコピーして import する（各ゲームは独立したフォーク）。
 * - 描画専用。core（ゲームロジック）からは import しない。乱数は使わず、座標のハッシュで模様を決める（毎フレーム同じ絵）
 * - 関数はすべて (ctx, 左上x, 左上y, 一辺px, ...) か (ctx, 中心x, 中心y, 大きさpx, ...)。大きさに比例して描く
 */

/** 座標から決まる 0〜1 の擬似乱数（描画の模様用。ゲームの乱数ではない） */
export function hash01(x: number, y: number, k = 0): number {
  let h = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// ───────────── 地形タイル（左上 x,y・一辺 s、tx,ty はタイル座標＝模様の種） ─────────────

/** 掘った床: 暗い地面に小石 */
export function tileFloor(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tx: number, ty: number): void {
  ctx.fillStyle = '#1c1a18';
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = '#2a2622';
  for (let i = 0; i < 3; i++) {
    const px = x + hash01(tx, ty, i) * (s - 3);
    const py = y + hash01(tx, ty, i + 9) * (s - 3);
    ctx.fillRect(px, py, 2, 2);
  }
}

/** 土: 茶色に濃淡の粒と、上辺の明るい縁（柔らかい・掘りやすい） */
export function tileDirt(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tx: number, ty: number): void {
  ctx.fillStyle = '#6b4a2f';
  ctx.fillRect(x, y, s, s);
  for (let i = 0; i < 7; i++) {
    const px = x + hash01(tx, ty, i) * (s - 3);
    const py = y + hash01(tx, ty, i + 20) * (s - 3);
    ctx.fillStyle = i % 2 ? '#553821' : '#85603e';
    ctx.fillRect(px, py, 2 + (i % 3 === 0 ? 1 : 0), 2);
  }
  ctx.fillStyle = 'rgba(255,220,170,0.10)';
  ctx.fillRect(x, y, s, 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
}

/** 石: 灰色の石積み（2段のブロックと目地、立体の縁）＝硬い */
export function tileRock(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tx: number, ty: number, base = '#707070'): void {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = shade(base, -0.45);
  ctx.lineWidth = 1;
  const h = s / 2;
  const off = (ty + tx) % 2 ? s * 0.5 : s * 0.25;
  ctx.beginPath();
  ctx.moveTo(x, y + h + 0.5);
  ctx.lineTo(x + s, y + h + 0.5);
  ctx.moveTo(x + off + 0.5, y);
  ctx.lineTo(x + off + 0.5, y + h);
  ctx.moveTo(x + ((off + s * 0.5) % s) + 0.5, y + h);
  ctx.lineTo(x + ((off + s * 0.5) % s) + 0.5, y + s);
  ctx.stroke();
  // 立体の縁: 上左が明るく、下右が暗い
  ctx.fillStyle = shade(base, 0.25);
  ctx.fillRect(x, y, s, 1.5);
  ctx.fillRect(x, y, 1.5, s);
  ctx.fillStyle = shade(base, -0.5);
  ctx.fillRect(x, y + s - 1.5, s, 1.5);
  ctx.fillRect(x + s - 1.5, y, 1.5, s);
  // ひび
  if (hash01(tx, ty, 77) < 0.4) {
    ctx.strokeStyle = shade(base, -0.55);
    ctx.beginPath();
    const cx = x + s * (0.3 + 0.4 * hash01(tx, ty, 5));
    ctx.moveTo(cx, y + 3);
    ctx.lineTo(cx + s * 0.12, y + s * 0.3);
    ctx.lineTo(cx - s * 0.05, y + s * 0.42);
    ctx.stroke();
  }
}

/** 鉱石: 石の中に色つきの結晶（ひし形）ときらめき */
export function tileOre(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tx: number, ty: number, gem: string): void {
  tileRock(ctx, x, y, s, tx, ty, '#5c5c5c');
  const n = 3;
  for (let i = 0; i < n; i++) {
    const cx = x + s * (0.22 + 0.56 * hash01(tx, ty, i + 30));
    const cy = y + s * (0.22 + 0.56 * hash01(tx, ty, i + 40));
    const r = s * (0.13 + 0.06 * hash01(tx, ty, i + 50));
    ctx.fillStyle = gem;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.75, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.75, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(gem, -0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(cx - r * 0.3, cy - r * 0.5, 2, 2);
  }
}

/** ガス溜まり: 緑の地面に泡 */
export function tileGas(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tx: number, ty: number, t = 0): void {
  ctx.fillStyle = '#2f5e3c';
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = '#8fe0a5';
  for (let i = 0; i < 3; i++) {
    const r = s * (0.08 + 0.06 * hash01(tx, ty, i));
    const cx = x + s * (0.2 + 0.6 * hash01(tx, ty, i + 3));
    const cy = y + s * (0.85 - ((hash01(tx, ty, i + 6) + t * 0.02) % 1) * 0.7);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/** 崩れやすい岩: 石に赤いひびの網 */
export function tileUnstable(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tx: number, ty: number): void {
  tileRock(ctx, x, y, s, tx, ty, '#6a4a4a');
  ctx.strokeStyle = '#ff6b5a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.15, y + s * 0.2);
  ctx.lineTo(x + s * 0.45, y + s * 0.5);
  ctx.lineTo(x + s * 0.35, y + s * 0.85);
  ctx.moveTo(x + s * 0.45, y + s * 0.5);
  ctx.lineTo(x + s * 0.85, y + s * 0.4);
  ctx.stroke();
  ctx.lineWidth = 1;
}

/** 霧（未調査）: 暗い地面に「?」 */
export function tileFog(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#23232c';
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = '#4a4a5c';
  ctx.font = `bold ${Math.round(s * 0.5)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', x + s / 2, y + s / 2 + 1);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/** 割れ目: 紫に光る裂け目 */
export function tileRift(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t = 0): void {
  ctx.fillStyle = '#2a1640';
  ctx.fillRect(x, y, s, s);
  const glow = 0.6 + 0.4 * Math.sin(t / 3);
  ctx.strokeStyle = `rgba(200,140,255,${glow})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.5, y + 2);
  ctx.lineTo(x + s * 0.38, y + s * 0.35);
  ctx.lineTo(x + s * 0.6, y + s * 0.6);
  ctx.lineTo(x + s * 0.45, y + s - 2);
  ctx.stroke();
  ctx.lineWidth = 1;
}

// ───────────── キャラクター（中心 cx,cy・大きさ size＝おおよその背丈） ─────────────

export interface PlayerLook {
  /** 向き（-1 左 / 1 右） */
  face?: number;
  /** 服の色 */
  body?: string;
  /** 持ち物: 'pick'（つるはし）| 'sword'（剣） */
  tool?: 'pick' | 'sword';
  /** ヘルメットのランプ */
  lamp?: boolean;
  /** 目立たせる外周の光（ダッシュ可能など） */
  glow?: string | null;
}

/** プレイヤー: 頭（顔と目）・ヘルメット・胴・足・道具を持った人の形。白い縁取りで地形から浮かせる */
export function drawPlayer(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, look: PlayerLook = {}): void {
  const f = look.face ?? 1;
  const u = size / 10;
  ctx.save();
  if (look.glow) {
    ctx.fillStyle = look.glow;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineJoin = 'round';
  // 道具（体の後ろ側から前へ）
  ctx.strokeStyle = '#8a5a2b';
  ctx.lineWidth = Math.max(1.5, u * 0.8);
  ctx.beginPath();
  ctx.moveTo(cx + f * u * 2, cy + u * 1.5);
  ctx.lineTo(cx + f * u * 4.2, cy - u * 2.5);
  ctx.stroke();
  if ((look.tool ?? 'pick') === 'pick') {
    ctx.strokeStyle = '#d8dde3';
    ctx.lineWidth = Math.max(1.5, u * 0.9);
    ctx.beginPath();
    ctx.moveTo(cx + f * u * 2.6, cy - u * 3.6);
    ctx.quadraticCurveTo(cx + f * u * 4.4, cy - u * 3.4, cx + f * u * 5.6, cy - u * 1.6);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#e8eef5';
    ctx.lineWidth = Math.max(1.5, u * 0.9);
    ctx.beginPath();
    ctx.moveTo(cx + f * u * 4.2, cy - u * 2.5);
    ctx.lineTo(cx + f * u * 5.4, cy - u * 5);
    ctx.stroke();
  }
  // 足
  ctx.strokeStyle = '#2b2f3a';
  ctx.lineWidth = Math.max(1.5, u * 1.1);
  ctx.beginPath();
  ctx.moveTo(cx - u * 1, cy + u * 2);
  ctx.lineTo(cx - u * 1.3, cy + u * 4.6);
  ctx.moveTo(cx + u * 1, cy + u * 2);
  ctx.lineTo(cx + u * 1.3, cy + u * 4.6);
  ctx.stroke();
  // 胴（服）
  ctx.fillStyle = look.body ?? '#2f7fd8';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, u * 0.5);
  ctx.beginPath();
  ctx.moveTo(cx - u * 2.2, cy + u * 2.4);
  ctx.lineTo(cx - u * 1.8, cy - u * 1.2);
  ctx.lineTo(cx + u * 1.8, cy - u * 1.2);
  ctx.lineTo(cx + u * 2.2, cy + u * 2.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 頭（肌色の顔）
  ctx.fillStyle = '#f2c9a0';
  ctx.beginPath();
  ctx.arc(cx, cy - u * 2.8, u * 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // ヘルメット
  ctx.fillStyle = '#f1c40f';
  ctx.beginPath();
  ctx.arc(cx, cy - u * 3.1, u * 2.05, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  if (look.lamp ?? true) {
    ctx.fillStyle = '#fffbe0';
    ctx.beginPath();
    ctx.arc(cx + f * u * 1.2, cy - u * 4.1, u * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // 目（向いている側に寄せる）
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(cx + f * u * 0.4 - u * 0.35, cy - u * 2.7, u * 0.7, u * 0.8);
  ctx.fillRect(cx + f * u * 1.3 - u * 0.35, cy - u * 2.7, u * 0.7, u * 0.8);
  ctx.restore();
}

export type EnemyShape = 'grunt' | 'runner' | 'brute' | 'archer';

/**
 * 敵: 種類ごとに形を変えた怪物（目・牙・角・手足）。暗い縁取りで地形と区別し、プレイヤー（人の形・黄色いヘルメット）と混ざらない。
 * - grunt（雑兵）: 丸い体に2本の角と牙
 * - runner（走り屋）: 細身のトゲトゲ、尖った耳、前傾
 * - brute（重兵）: 大きな四角い体に太い腕と棍棒
 * - archer（射手）: フードをかぶった細い体と弓
 */
export function drawEnemy(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  shape: EnemyShape,
  color: string,
  face = -1,
): void {
  const u = size / 10;
  ctx.save();
  ctx.lineJoin = 'round';
  const dark = shade(color, -0.55);
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, u * 0.6);
  // 足
  ctx.beginPath();
  ctx.moveTo(cx - u * 1.6, cy + u * 2.6);
  ctx.lineTo(cx - u * 2.0, cy + u * 4.6);
  ctx.moveTo(cx + u * 1.6, cy + u * 2.6);
  ctx.lineTo(cx + u * 2.0, cy + u * 4.6);
  ctx.stroke();
  ctx.fillStyle = color;
  if (shape === 'brute') {
    // 棍棒
    ctx.strokeStyle = '#6b4219';
    ctx.lineWidth = Math.max(2, u * 1.3);
    ctx.beginPath();
    ctx.moveTo(cx + face * u * 3.4, cy + u * 1.5);
    ctx.lineTo(cx + face * u * 5.2, cy - u * 3.5);
    ctx.stroke();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1, u * 0.6);
    ctx.beginPath();
    ctx.roundRect(cx - u * 3.6, cy - u * 3.6, u * 7.2, u * 6.6, u * 1.6);
    ctx.fill();
    ctx.stroke();
    // 角
    ctx.fillStyle = '#efe6d0';
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + sgn * u * 2.2, cy - u * 3.4);
      ctx.lineTo(cx + sgn * u * 3.4, cy - u * 5.6);
      ctx.lineTo(cx + sgn * u * 1.2, cy - u * 3.6);
      ctx.closePath();
      ctx.fill();
    }
  } else if (shape === 'runner') {
    ctx.beginPath();
    ctx.moveTo(cx - face * u * 3.4, cy + u * 1.2);
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      const r = i % 2 ? u * 3.4 : u * 2.4;
      ctx.lineTo(cx + Math.cos(a) * r, cy - u * 0.2 + Math.sin(a) * r);
    }
    ctx.lineTo(cx + face * u * 3.4, cy + u * 1.2);
    ctx.lineTo(cx, cy + u * 2.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (shape === 'archer') {
    // 弓
    ctx.strokeStyle = '#c8a06a';
    ctx.lineWidth = Math.max(1.2, u * 0.6);
    ctx.beginPath();
    ctx.arc(cx + face * u * 2.8, cy - u * 0.5, u * 3.2, -Math.PI / 2.2, Math.PI / 2.2, face < 0);
    ctx.stroke();
    ctx.strokeStyle = dark;
    ctx.lineWidth = Math.max(1, u * 0.6);
    // フード（三角）＋胴
    ctx.beginPath();
    ctx.moveTo(cx, cy - u * 5);
    ctx.lineTo(cx + u * 2.8, cy + u * 2.8);
    ctx.lineTo(cx - u * 2.8, cy + u * 2.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // grunt: 丸い体＋角
    ctx.beginPath();
    ctx.arc(cx, cy, u * 3.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#efe6d0';
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + sgn * u * 1.4, cy - u * 2.8);
      ctx.lineTo(cx + sgn * u * 2.4, cy - u * 4.8);
      ctx.lineTo(cx + sgn * u * 0.4, cy - u * 3.2);
      ctx.closePath();
      ctx.fill();
    }
  }
  // 目（白目＋黒目、怒った眉）
  const ey = shape === 'archer' ? cy - u * 1 : cy - u * 1.2;
  for (const sgn of [-1, 1]) {
    const ex = cx + sgn * u * 1.2 + face * u * 0.4;
    ctx.fillStyle = '#fff6d6';
    ctx.beginPath();
    ctx.arc(ex, ey, u * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(ex + face * u * 0.3, ey + u * 0.1, u * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = Math.max(1, u * 0.45);
    ctx.beginPath();
    ctx.moveTo(ex - u * 0.9, ey - u * 1.0 - sgn * u * 0.3);
    ctx.lineTo(ex + u * 0.9, ey - u * 1.0 + sgn * u * 0.3);
    ctx.stroke();
  }
  // 口と牙
  if (shape !== 'archer') {
    ctx.fillStyle = '#2a0c0c';
    ctx.fillRect(cx - u * 1.4, cy + u * 0.6, u * 2.8, u * 0.9);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx - u * 1.1, cy + u * 0.6);
    ctx.lineTo(cx - u * 0.7, cy + u * 1.4);
    ctx.lineTo(cx - u * 0.3, cy + u * 0.6);
    ctx.moveTo(cx + u * 0.3, cy + u * 0.6);
    ctx.lineTo(cx + u * 0.7, cy + u * 1.4);
    ctx.lineTo(cx + u * 1.1, cy + u * 0.6);
    ctx.fill();
  }
  ctx.restore();
}

// ───────────── 建物・設置物（左上 x,y・一辺 s） ─────────────

/** 木の柵（バリケード）: 横板2枚と杭 */
export function drawBarricade(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#8b5a2b';
  ctx.strokeStyle = '#4a2c12';
  for (const fx of [0.15, 0.5, 0.85]) {
    ctx.fillRect(x + s * fx - s * 0.07, y + s * 0.12, s * 0.14, s * 0.8);
    ctx.strokeRect(x + s * fx - s * 0.07, y + s * 0.12, s * 0.14, s * 0.8);
  }
  for (const fy of [0.3, 0.62]) {
    ctx.fillStyle = '#a8713c';
    ctx.fillRect(x + 1, y + s * fy, s - 2, s * 0.14);
    ctx.strokeRect(x + 1, y + s * fy, s - 2, s * 0.14);
  }
}

/** 砲台（タレット）: 石の台座と回る砲身 */
export function drawTurret(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, aim = 0, active = true): void {
  ctx.fillStyle = '#3d4a5a';
  ctx.strokeStyle = '#a9c6e8';
  ctx.beginPath();
  ctx.roundRect(x + s * 0.12, y + s * 0.45, s * 0.76, s * 0.45, 3);
  ctx.fill();
  ctx.stroke();
  const cx = x + s / 2;
  const cy = y + s * 0.45;
  ctx.strokeStyle = active ? '#4aa3e0' : '#2a4a66';
  ctx.lineWidth = Math.max(2, s * 0.14);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(aim) * s * 0.42, cy + Math.sin(aim) * s * 0.42);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = active ? '#4aa3e0' : '#2a4a66';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d8ecff';
  ctx.stroke();
}

/** 拠点（家）: 三角屋根と扉 */
export function drawHouse(ctx: CanvasRenderingContext2D, cx: number, bottom: number, s: number, roof = '#3498db'): void {
  const w = s * 0.9;
  const h = s * 0.55;
  ctx.fillStyle = '#d9c7a3';
  ctx.strokeStyle = '#3b3024';
  ctx.fillRect(cx - w / 2, bottom - h, w, h);
  ctx.strokeRect(cx - w / 2, bottom - h, w, h);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.62, bottom - h);
  ctx.lineTo(cx, bottom - h - s * 0.4);
  ctx.lineTo(cx + w * 0.62, bottom - h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6b4219';
  ctx.fillRect(cx - w * 0.12, bottom - h * 0.6, w * 0.24, h * 0.6);
}

/** 篝火: 薪と炎（熱 0〜1 で炎の大きさ） */
export function drawCampfire(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, t = 0, power = 0.5): void {
  ctx.strokeStyle = '#6b4219';
  ctx.lineWidth = Math.max(2, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.4, cy + s * 0.3);
  ctx.lineTo(cx + s * 0.4, cy + s * 0.12);
  ctx.moveTo(cx + s * 0.4, cy + s * 0.3);
  ctx.lineTo(cx - s * 0.4, cy + s * 0.12);
  ctx.stroke();
  ctx.lineWidth = 1;
  const fl = (0.55 + 0.45 * power) * (1 + 0.08 * Math.sin(t * 0.9));
  const layer = (col: string, k: number) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.3 * k, cy + s * 0.2);
    ctx.quadraticCurveTo(cx - s * 0.35 * k, cy - s * 0.2 * fl * k, cx, cy - s * 0.65 * fl * k);
    ctx.quadraticCurveTo(cx + s * 0.35 * k, cy - s * 0.2 * fl * k, cx + s * 0.3 * k, cy + s * 0.2);
    ctx.closePath();
    ctx.fill();
  };
  layer('#e8532b', 1);
  layer('#ffa630', 0.72);
  layer('#fff1a8', 0.42);
}

/** 支柱（坑道の柱）: 縦の木材と上下の梁 */
export function drawProp(ctx: CanvasRenderingContext2D, x: number, top: number, s: number, h: number): void {
  ctx.fillStyle = '#c88a3e';
  ctx.strokeStyle = '#5a3612';
  ctx.fillRect(x + s / 2 - s * 0.12, top, s * 0.24, h);
  ctx.strokeRect(x + s / 2 - s * 0.12, top, s * 0.24, h);
  ctx.fillStyle = '#8b5a2b';
  ctx.fillRect(x + 2, top, s - 4, s * 0.16);
  ctx.fillRect(x + 2, top + h - s * 0.16, s - 4, s * 0.16);
}

// ───────────── 凡例 ─────────────

export interface LegendItem {
  label: string;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => void;
}

/** 凡例を1行で描く（左上 x,y、アイコン一辺 s）。返り値は使った幅 */
export function drawLegend(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, items: LegendItem[], maxW = Infinity): number {
  ctx.save();
  ctx.font = `${Math.max(10, Math.round(s * 0.62))}px sans-serif`;
  ctx.textBaseline = 'middle';
  let cx = x;
  let cy = y;
  for (const it of items) {
    const w = s + 4 + ctx.measureText(it.label).width + 10;
    if (cx + w - x > maxW && cx > x) {
      cx = x;
      cy += s + 4;
    }
    it.draw(ctx, cx, cy, s);
    ctx.fillStyle = '#cfd6e0';
    ctx.fillText(it.label, cx + s + 4, cy + s / 2);
    cx += w;
  }
  ctx.restore();
  return cy + s - y;
}
