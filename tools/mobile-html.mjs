// スマホからブラウザで動作確認できる単一ページを作る（4回目 FINAL REVIEW で Artifact として公開する用）。
// ゲーム本体（src/core・src/render）は変えず、外付けのオーバーレイで次の2つを足す:
//   1. 観戦: 検証ボット（headless/simulate.ts の Bot）を __AIP__ 経由で動かし、速度を変えて眺める
//   2. 操作: 画面のボタンからキー入力（KeyboardEvent）を合成して、タッチで遊ぶ（移植時の本番のタッチ入力ではない）
// ボタンの割り当ては games/<NNN>/mobile.json（無ければ移動・攻撃だけ）。
// 使い方: node tools/mobile-html.mjs games/036-flagship-trodvent
//   → mobile/<NNN>.html（Artifact の公開用。doctype/html/head/body を持たない断片。リポジトリにコミットする）
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const gameDir = resolve(process.argv[2] ?? '.');
const name = basename(gameDir);
const repoRoot = resolve(gameDir, '..', '..');
const out = mkdtempSync(join(tmpdir(), 'mobile-html-'));
execSync(`npx vite build --base ./ --outDir "${out}" --emptyOutDir`, { cwd: gameDir, stdio: 'ignore' });
const builtHtml = readFileSync(join(out, 'index.html'), 'utf-8');
const js = readdirSync(join(out, 'assets')).find((f) => f.endsWith('.js'));
const gameCode = readFileSync(join(out, 'assets', js), 'utf-8');

let botCode = '';
if (existsSync(join(gameDir, 'headless', 'simulate.ts'))) {
  const botOut = join(out, 'bot.js');
  execSync(
    `npx esbuild headless/simulate.ts --bundle --format=iife --global-name=__BOTLIB__ --platform=browser --outfile="${botOut}"`,
    { cwd: gameDir, stdio: 'ignore' },
  );
  botCode = readFileSync(botOut, 'utf-8');
}
rmSync(out, { recursive: true, force: true });

const pkg = JSON.parse(readFileSync(join(gameDir, 'package.json'), 'utf-8'));
const title = (builtHtml.match(/<title>([^<]*)<\/title>/) ?? [, name])[1];
const cfgPath = join(gameDir, 'mobile.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf-8')) : {};
const config = {
  name,
  title,
  version: pkg.version ?? '',
  strategies: cfg.strategies ?? ['p01', 'p02'],
  maxTicks: cfg.maxTicks ?? 20000,
  // { label, key, hold?: true（押している間だけ）, toggle?: true（押すたびに入/切） }
  actions: cfg.actions ?? [{ label: '攻撃', key: ' ' }],
  shop: cfg.shop ?? [],
  help: cfg.help ?? '',
  hasBot: botCode.length > 0,
};
// </script> がコードの中に出ると壊れるので逃がす
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const page = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
[hidden] { display: none !important; }
/* 1画面のアプリ: 上に盤面（横幅いっぱい）、下に観戦／操作の切り替えパネル。ゲーム画面に合わせて暗い1色の世界にする */
:root {
  --ground: #0e1116; --panel: #171c24; --line: #2a3340; --ink: #e3e7ee; --muted: #8b96a8;
  --accent: #5fc4d6; --warn: #e0a84a;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --sans: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  color-scheme: dark;
}
html, body { height: 100%; }
body { background: var(--ground); color: var(--ink); font-family: var(--sans); -webkit-tap-highlight-color: transparent;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 8px;
  box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; overflow-x: hidden; }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bar h1 { font-size: 15px; margin: 0; letter-spacing: .02em; }
.ver { color: var(--muted); font: 12px var(--mono); }
#stage { width: 100%; max-width: 960px; align-self: center; }
#game { display: block; width: 100%; height: auto; image-rendering: pixelated; border: 1px solid var(--line); border-radius: 4px; background: #000; }
.status { font: 12px var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; min-height: 1.4em; }
.status b { color: var(--ink); font-weight: 600; }
.tabs { display: flex; gap: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; width: fit-content; }
.tabs button { border: 0; border-radius: 0; background: transparent; }
.tabs button[aria-pressed="true"] { background: var(--accent); color: #062026; }
button, select, input { font: 14px var(--sans); color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; min-height: 40px; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
input[type=number] { width: 6.5em; font-family: var(--mono); }
.panel { display: flex; flex-direction: column; gap: 10px; }
.pad { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: center; touch-action: none; user-select: none; -webkit-user-select: none; }
.dpad { display: grid; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(3, 56px); gap: 4px; }
.dpad button { padding: 0; font-size: 20px; min-height: 0; }
.dpad .c { visibility: hidden; }
.acts { display: flex; flex-wrap: wrap; gap: 6px; align-content: center; }
.acts button { min-width: 64px; }
.shop { display: flex; flex-wrap: wrap; gap: 6px; }
.shop button { padding: 6px 10px; min-height: 36px; font-size: 13px; }
.down { background: var(--accent) !important; color: #062026 !important; }
.help { color: var(--muted); font-size: 12px; line-height: 1.6; max-width: 65ch; }
.note { color: var(--warn); font-size: 12px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
<div class="bar"><h1>${title}</h1><span class="ver">v${config.version}</span></div>
<div id="stage"><canvas id="game"></canvas></div>
<div class="status" id="status">読み込み中…</div>
<div class="bar">
  <div class="tabs" role="group" aria-label="モード">
    <button id="tabWatch" aria-pressed="true">ボット観戦</button>
    <button id="tabPlay" aria-pressed="false">自分で操作</button>
  </div>
  <label class="ver" for="seed">シード</label><input id="seed" type="number" min="1" value="501">
  <button id="reset">最初から</button>
</div>
<section class="panel" id="watch">
  <div class="bar">
    <label class="ver" for="strategy">戦略</label><select id="strategy"></select>
    <button id="playpause">▶ 再生</button>
    <span class="ver">速度</span>
    <span class="bar" id="speeds"></span>
  </div>
  <p class="help">検証ボットが遊ぶ様子を見ます。p01＝野望型、p02＝あき型のペルソナを真似たボットです。同じシードと戦略なら毎回同じ展開になります（ヘッドレスの simulate と一致）。</p>
</section>
<section class="panel" id="play" hidden>
  <div class="pad">
    <div class="dpad" id="dpad">
      <span class="c"></span><button data-key="ArrowUp" aria-label="上">▲</button><span class="c"></span>
      <button data-key="ArrowLeft" aria-label="左">◀</button><span class="c"></span><button data-key="ArrowRight" aria-label="右">▶</button>
      <span class="c"></span><button data-key="ArrowDown" aria-label="下">▼</button><span class="c"></span>
    </div>
    <div class="acts" id="acts"></div>
  </div>
  <div class="shop" id="shop"></div>
  <p class="help" id="help"></p>
  <p class="note">タッチ操作は動作確認用の仮のボタンです（キーボードがあればそのままキーでも遊べます）。</p>
</section>
<script type="module">
${safe(gameCode)}
</script>
<script>
${safe(botCode)}
</script>
<script>
(() => {
  const CFG = ${JSON.stringify(config)};
  const $ = (id) => document.getElementById(id);
  const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
  let mode = 'watch', running = false, speed = 4, bot = null, last = 0, acc = 0, state = null;

  function aip() { return window.__AIP__; }
  function status(s) {
    if (!s) return;
    const m = s.metrics || {}, p = s.player || {};
    const parts = ['tick <b>' + s.tick + '</b>'];
    if (m.score !== undefined) parts.push('score <b>' + Math.round(m.score) + '</b>');
    if (p.hp !== undefined) parts.push('HP <b>' + Math.round(p.hp) + '</b>');
    if (m.moneyEarned !== undefined) parts.push('稼ぎ <b>' + Math.round(m.moneyEarned) + '</b>');
    if (m.rescues !== undefined) parts.push('救助 <b>' + m.rescues + '</b>');
    if (s.over) parts.push('<b>終了</b>');
    else if (mode === 'watch' && s.tick >= CFG.maxTicks) parts.push('<b>' + CFG.maxTicks + 'tickで終了</b>');
    $('status').innerHTML = parts.join('　');
  }
  function seed() { return Math.max(1, Number($('seed').value) || 1); }
  function reset() {
    state = aip().reset(seed());
    bot = CFG.hasBot ? new __BOTLIB__.Bot($('strategy').value) : null;
    status(state);
  }
  function setRunning(on) { running = on && !!bot; $('playpause').textContent = running ? '⏸ 一時停止' : '▶ 再生'; last = performance.now(); acc = 0; }
  function frame(now) {
    if (mode === 'watch' && running && state) {
      acc += Math.min(250, now - last) / 100 * speed;
      const t0 = performance.now();
      while (acc >= 1 && !state.over && state.tick < CFG.maxTicks && performance.now() - t0 < 12) { state = aip().step(bot.decide(state)); acc -= 1; }
      if (acc > 8 * speed) acc = 0; // 端末が遅い時は追いつこうとしない
      if (state.over || state.tick >= CFG.maxTicks) setRunning(false);
      status(state);
    } else if (mode === 'play') {
      status(aip().getState());
    }
    last = now;
    requestAnimationFrame(frame);
  }
  function setMode(m) {
    mode = m;
    $('tabWatch').setAttribute('aria-pressed', String(m === 'watch'));
    $('tabPlay').setAttribute('aria-pressed', String(m === 'play'));
    $('watch').hidden = m !== 'watch';
    $('play').hidden = m !== 'play';
    if (m === 'watch') { aip().takeControl(); } else { setRunning(false); aip().release(); }
  }
  function holdButton(btn, k) {
    const down = (e) => { e.preventDefault(); btn.classList.add('down'); key('keydown', k); };
    const up = (e) => { e.preventDefault(); if (!btn.classList.contains('down')) return; btn.classList.remove('down'); key('keyup', k); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }
  function tapButton(btn, k) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); key('keydown', k); setTimeout(() => key('keyup', k), 120); });
  }
  function toggleButton(btn, k) {
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      key(on ? 'keydown' : 'keyup', k);
    });
  }
  function build() {
    for (const s of CFG.strategies) { const o = document.createElement('option'); o.value = o.textContent = s; $('strategy').appendChild(o); }
    for (const v of [1, 4, 16]) {
      const b = document.createElement('button'); b.textContent = '×' + v; b.setAttribute('aria-pressed', String(v === speed));
      b.onclick = () => { speed = v; for (const x of $('speeds').children) x.setAttribute('aria-pressed', String(x === b)); };
      $('speeds').appendChild(b);
    }
    for (const b of $('dpad').querySelectorAll('button')) holdButton(b, b.dataset.key);
    for (const a of CFG.actions) {
      const b = document.createElement('button'); b.textContent = a.label; $('acts').appendChild(b);
      (a.toggle ? toggleButton : a.hold ? holdButton : tapButton)(b, a.key);
    }
    for (const a of CFG.shop) { const b = document.createElement('button'); b.textContent = a.label; $('shop').appendChild(b); tapButton(b, a.key); }
    $('help').textContent = CFG.help;
    if (!CFG.hasBot) { $('tabWatch').disabled = true; }
    $('playpause').onclick = () => setRunning(!running);
    $('reset').onclick = () => { reset(); if (mode === 'watch') setRunning(false); };
    $('strategy').onchange = () => { reset(); setRunning(false); };
    $('tabWatch').onclick = () => setMode('watch');
    $('tabPlay').onclick = () => { setMode('play'); reset(); };
  }
  function start() {
    if (!window.__AIP__) return setTimeout(start, 30);
    build();
    setMode(CFG.hasBot ? 'watch' : 'play');
    reset();
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
  }
  start();
})();
</script>
`;
const destDir = join(repoRoot, 'mobile');
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, `${name}.html`);
writeFileSync(dest, page);
console.log(dest, `${(page.length / 1024).toFixed(0)}KB`);
