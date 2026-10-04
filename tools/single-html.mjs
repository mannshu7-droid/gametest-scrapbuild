// ビルド済みのJSをHTMLへ埋め込んだ単一ファイルを作る（無人のスケジュール実行でブラウザAIP実プレイをするため）。
// 無人セッションでは preview_start（開発サーバ）が拒否されるが、プロジェクト内に置いた単一HTMLは
// ブラウザペインで開けて window.__AIP__ を操作できる（2026-10-04、サイクル31・1回目で確認）。
// 使い方: node tools/single-html.mjs games/025-mining-tremorvein
//   → games/<NNN>/dist/single.html（dist/ は gitignore 対象）
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const gameDir = resolve(process.argv[2] ?? '.');
const out = mkdtempSync(join(tmpdir(), 'single-html-'));
execSync(`npx vite build --base ./ --outDir "${out}" --emptyOutDir`, { cwd: gameDir, stdio: 'ignore' });
let html = readFileSync(join(out, 'index.html'), 'utf-8');
const js = readdirSync(join(out, 'assets')).find((f) => f.endsWith('.js'));
const code = readFileSync(join(out, 'assets', js), 'utf-8');
html = html.replace(/<script type="module" crossorigin src="[^"]+"><\/script>/, '');
html = html.replace('</body>', () => `<script type="module">\n${code}\n</script>\n</body>`);
mkdirSync(join(gameDir, 'dist'), { recursive: true });
const dest = join(gameDir, 'dist', 'single.html');
writeFileSync(dest, html);
rmSync(out, { recursive: true, force: true });
console.log(dest);
