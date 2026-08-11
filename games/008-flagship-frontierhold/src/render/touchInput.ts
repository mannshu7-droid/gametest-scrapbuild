import type { Action, Dir, GameState, ShopItemState, UpgradeId } from '../core/types';

const SAFE_MARGIN_PX = 16;
const DPAD_WIDTH_RATIO = 0.28;
const DPAD_HEIGHT_RATIO = 0.45;
const DEADZONE_WIDTH_RATIO = 0.03;
const MIN_TOUCH_TARGET_PX = 48;
const BUTTON_GAP_PX = 8;
const ACTION_BUTTONS_WIDTH_PX = 3 * MIN_TOUCH_TARGET_PX + 2 * BUTTON_GAP_PX;

const ACTION_BUTTONS: { key: 'attack' | 'skill' | 'dash' | 'build' | 'outpost'; label: string }[] = [
  { key: 'attack', label: '攻撃' },
  { key: 'skill', label: '範囲' },
  { key: 'dash', label: '離脱' },
  { key: 'build', label: '支保工' },
  { key: 'outpost', label: '基地' },
];

/**
 * タッチ操作を1ティック分のアクションに変換する（`Input`とAction型を共有し、main.tsで並存させる）。
 * 画面レイアウト・デッドゾーン等の数値はspec.md「サイクル10・3回目」節の仕様に従う。
 * キャンバスの上にDOMオーバーレイを重ねて実装する（core/render分離を維持し、game.tsは無変更）。
 */
export class TouchInput {
  private queued: Action[] = [];
  private facing: Dir = 'down';
  private moveDir: Dir | null = null;
  private dpadPointerId: number | null = null;
  private outpostEnabled = false;
  private wrap: HTMLDivElement;
  private dpad: HTMLDivElement;
  private outpostBtn: HTMLButtonElement;
  private shopOverlay: HTMLDivElement;
  private shopCards: HTMLButtonElement[] = [];
  private restartOverlay: HTMLDivElement;
  private rotateOverlay: HTMLDivElement;
  private onRestart: () => void;

  constructor(canvas: HTMLCanvasElement, onRestart: () => void) {
    this.onRestart = onRestart;

    const parent = canvas.parentElement!;
    this.wrap = document.createElement('div');
    this.wrap.style.position = 'relative';
    this.wrap.style.display = 'inline-block';
    this.wrap.style.lineHeight = '0';
    parent.insertBefore(this.wrap, canvas);
    this.wrap.appendChild(canvas);

    this.dpad = this.buildDpad();
    this.wrap.appendChild(this.dpad);

    const { container: buttons, outpostBtn } = this.buildActionButtons();
    this.outpostBtn = outpostBtn;
    this.wrap.appendChild(buttons);

    this.shopOverlay = this.buildShopOverlay();
    this.wrap.appendChild(this.shopOverlay);

    this.restartOverlay = this.buildRestartOverlay();
    this.wrap.appendChild(this.restartOverlay);

    this.rotateOverlay = this.buildRotateOverlay();
    this.wrap.appendChild(this.rotateOverlay);
  }

  /** このティックで実行するアクションを返す（`Input.poll()`と同じ契約） */
  poll(): Action {
    const single = this.queued.shift();
    if (single) return single;
    if (this.moveDir) return { type: 'move', dir: this.moveDir };
    return { type: 'wait' };
  }

  /** 毎フレーム呼び、状態依存のUI（ショップ・基地建設可否・ゲームオーバー）を更新する */
  update(state: GameState): void {
    this.outpostEnabled = state.player.canBuildOutpost;
    this.outpostBtn.style.opacity = this.outpostEnabled ? '1' : '0.35';
    this.outpostBtn.style.pointerEvents = this.outpostEnabled ? 'auto' : 'none';

    this.shopOverlay.style.display = state.phase === 'shop' ? 'block' : 'none';
    if (state.phase === 'shop') this.updateShopCards(state.shop);

    this.restartOverlay.style.display = state.over ? 'flex' : 'none';
    // ゲームオーバー後はD-pad/ボタンの重なりはもう無関係なので、
    // リスタート操作をrotateOverlayが覆って塞がないよう優先させる。
    this.rotateOverlay.style.display = !state.over && this.dpadOverlapsButtons() ? 'flex' : 'none';
  }

  /**
   * 極端な横長・低高さのビューポート（スマホの横向き等）ではcanvasが高さ基準で縮小され、
   * D-pad（幅%指定）とアクションボタン（固定px）が同じ行に収まりきらず重なる。
   * 実測の描画幅から重なりの有無を判定し、発生時のみ操作不能である旨を明示する
   * （レイアウト自体の横向き対応はスコープ外、spec.md参照）。
   */
  private dpadOverlapsButtons(): boolean {
    const wrapW = this.wrap.getBoundingClientRect().width;
    if (wrapW <= 0) return false;
    const dpadRight = SAFE_MARGIN_PX + wrapW * DPAD_WIDTH_RATIO;
    const buttonsLeft = wrapW - SAFE_MARGIN_PX - ACTION_BUTTONS_WIDTH_PX;
    return dpadRight > buttonsLeft;
  }

  private buildDpad(): HTMLDivElement {
    const dpad = document.createElement('div');
    Object.assign(dpad.style, {
      position: 'absolute',
      left: `${SAFE_MARGIN_PX}px`,
      bottom: `${SAFE_MARGIN_PX}px`,
      width: `${DPAD_WIDTH_RATIO * 100}%`,
      height: `${DPAD_HEIGHT_RATIO * 100}%`,
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.08)',
      border: '1px solid rgba(255,255,255,0.25)',
      touchAction: 'none',
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const updateDir = (e: PointerEvent) => {
      const rect = dpad.getBoundingClientRect();
      const canvasRect = (dpad.parentElement as HTMLDivElement).getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const deadzonePx = canvasRect.width * DEADZONE_WIDTH_RATIO;
      if (Math.hypot(dx, dy) < deadzonePx) {
        this.moveDir = null;
        return;
      }
      const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      this.moveDir = dir;
      this.facing = dir;
    };

    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.dpadPointerId) return;
      this.dpadPointerId = null;
      this.moveDir = null;
    };

    dpad.addEventListener('pointerdown', (e) => {
      if (this.dpadPointerId !== null) return;
      this.dpadPointerId = e.pointerId;
      dpad.setPointerCapture(e.pointerId);
      e.preventDefault();
      updateDir(e);
    });
    dpad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.dpadPointerId) return;
      e.preventDefault();
      updateDir(e);
    });
    dpad.addEventListener('pointerup', end);
    dpad.addEventListener('pointercancel', end);
    dpad.addEventListener('contextmenu', (e) => e.preventDefault());

    return dpad;
  }

  private buildActionButtons(): { container: HTMLDivElement; outpostBtn: HTMLButtonElement } {
    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'absolute',
      right: `${SAFE_MARGIN_PX}px`,
      bottom: `${SAFE_MARGIN_PX}px`,
      display: 'grid',
      gridTemplateColumns: `repeat(3, ${MIN_TOUCH_TARGET_PX}px)`,
      gridAutoRows: `${MIN_TOUCH_TARGET_PX}px`,
      gap: `${BUTTON_GAP_PX}px`,
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    let outpostBtn: HTMLButtonElement | null = null;
    for (const { key, label } of ACTION_BUTTONS) {
      const btn = document.createElement('button');
      btn.textContent = label;
      Object.assign(btn.style, {
        width: `${MIN_TOUCH_TARGET_PX}px`,
        height: `${MIN_TOUCH_TARGET_PX}px`,
        borderRadius: '50%',
        border: '1px solid rgba(255,255,255,0.4)',
        background: 'rgba(255,255,255,0.12)',
        color: '#fff',
        fontSize: '12px',
        touchAction: 'none',
        pointerEvents: 'auto',
      } satisfies Partial<CSSStyleDeclaration>);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (key === 'attack') this.queued.push({ type: 'attack', dir: this.facing });
        else if (key === 'skill') this.queued.push({ type: 'skill' });
        else if (key === 'dash') this.queued.push({ type: 'dash' });
        else if (key === 'build') this.queued.push({ type: 'build', dir: this.facing });
        else if (key === 'outpost') {
          if (this.outpostEnabled) this.queued.push({ type: 'outpost' });
        }
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      container.appendChild(btn);
      if (key === 'outpost') outpostBtn = btn;
    }

    return { container, outpostBtn: outpostBtn! };
  }

  private buildShopOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      padding: `${SAFE_MARGIN_PX}px`,
      boxSizing: 'border-box',
      background: 'rgba(0,0,0,0.7)',
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '6px',
      marginTop: '28px',
    } satisfies Partial<CSSStyleDeclaration>);

    for (let i = 0; i < 9; i++) {
      const card = document.createElement('button');
      Object.assign(card.style, {
        minHeight: `${MIN_TOUCH_TARGET_PX}px`,
        textAlign: 'left',
        color: '#fff',
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: '6px',
        fontSize: '11px',
        padding: '6px',
        touchAction: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      card.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const item = this.shopCards[i].dataset.itemId;
        const disabled = this.shopCards[i].dataset.disabled === '1';
        if (item && !disabled) this.queued.push({ type: 'buy', item: item as UpgradeId });
      });
      grid.appendChild(card);
      this.shopCards.push(card);
    }

    const title = document.createElement('div');
    title.textContent = 'ショップ（タップで購入）';
    Object.assign(title.style, { color: '#fff', fontSize: '13px', position: 'absolute', top: `${SAFE_MARGIN_PX}px` } satisfies Partial<CSSStyleDeclaration>);
    overlay.appendChild(title);
    overlay.appendChild(grid);
    return overlay;
  }

  private updateShopCards(shop: ShopItemState[]): void {
    shop.forEach((item, i) => {
      const card = this.shopCards[i];
      if (!card) return;
      const afford = item.nextCost !== null && item.nextCost >= 0;
      const costText = item.nextCost === null ? 'MAX' : `¥${item.nextCost}`;
      card.textContent = `${item.name} Lv${item.level}/${item.maxLevel}  ${costText}`;
      card.dataset.itemId = item.id;
      const disabled = item.nextCost === null;
      card.dataset.disabled = disabled ? '1' : '0';
      card.style.opacity = disabled ? '0.35' : afford ? '1' : '0.6';
      card.style.pointerEvents = disabled ? 'none' : 'auto';
    });
  }

  private buildRestartOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const label = document.createElement('div');
    label.textContent = 'タップでリスタート';
    Object.assign(label.style, {
      color: '#fff',
      fontSize: '16px',
      background: 'rgba(0,0,0,0.6)',
      padding: '10px 16px',
      borderRadius: '8px',
      marginTop: '120px',
    } satisfies Partial<CSSStyleDeclaration>);
    overlay.appendChild(label);
    overlay.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onRestart();
    });
    return overlay;
  }

  private buildRotateOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.85)',
      pointerEvents: 'auto',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    const label = document.createElement('div');
    label.textContent = '画面が狭すぎて操作ボタンが重なっています。端末を縦向きにするか、画面を広げてください。';
    Object.assign(label.style, {
      color: '#fff',
      fontSize: '13px',
      textAlign: 'center',
      padding: '0 20px',
    } satisfies Partial<CSSStyleDeclaration>);
    overlay.appendChild(label);
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    return overlay;
  }
}
