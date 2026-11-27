// 041新規: `npm run simulate -- ... --cell <名前>` のログ（{"cell":...} の行）を集めて、セルごとの要約と合格線の数を出す。
// 使い方: node headless/cells.mjs <ログ>... （ラベルは「条件:シードの組」。同じ条件の組は80合計の順位にもまとめる）
// 出すもの: セルごとの 1位・2位・1〜2位の差・全勝・大差の全勝・bare が勝ち越す相手・p02 の順位、
//          全勝のいるセル／大差の全勝／差3%以内の数、条件ごとの合計（平均）の順位、`_r3` と `_d0` の対で迷いの罰（bare を除く各戦略の比の平均）
import { readFileSync } from 'node:fs';

const cells = [];
for (const f of process.argv.slice(2)) {
  for (const line of readFileSync(f, 'utf-8').split('\n')) {
    if (!line.startsWith('{"cell"')) continue;
    cells.push(JSON.parse(line).cell);
  }
}
if (!cells.length) {
  console.error('cell の行がありません');
  process.exit(1);
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log('| セル | 1位 | 2位 | 1〜2位の差 | 全勝 | bareが勝ち越す | p02 の順位 | weave の柵（止めた/秒/荒らされ） |');
console.log('|---|---|---|---|---|---|---|---|');
for (const c of cells) {
  const p02 = c.rows.findIndex((r) => r.name === 'p02') + 1;
  const w = c.rows.find((r) => r.name === 'weave');
  console.log(
    `| ${c.label} | ${c.top} ${c.rows[0].score} | ${c.second} ${c.rows[1].score} | ${pct(c.gap)} | ${c.sweep ?? 'なし'}${c.bigSweep ? '（大差）' : ''} | ${c.bareBeats.length ? c.bareBeats.join(',') : '0'} | ${p02 || '-'} | ${w ? `${w.holds}/${w.heldSec}/${w.plunder}` : '-'} |`,
  );
}
const sweeps = cells.filter((c) => c.sweep);
const bigs = cells.filter((c) => c.bigSweep);
const close = cells.filter((c) => c.close);
console.log(`\n全勝のいるセル ${sweeps.length}/${cells.length}（${sweeps.map((c) => `${c.label}:${c.sweep}`).join(' ')}）`);
console.log(`大差の全勝 ${bigs.length}/${cells.length}、差3%以内 ${close.length}/${cells.length}、bare が勝ち越す相手のいるセル ${cells.filter((c) => c.bareBeats.length).length}`);

// 条件ごとの合計（組の平均）
const byCond = new Map();
for (const c of cells) {
  const cond = c.label.split(':')[0];
  if (!byCond.has(cond)) byCond.set(cond, []);
  byCond.get(cond).push(c);
}
const totals = new Map();
console.log('\n| 条件（組の平均） | 順位（score） |');
console.log('|---|---|');
for (const [cond, cs] of byCond) {
  const names = cs[0].rows.map((r) => r.name);
  const avg = names
    .map((n) => {
      const xs = cs.map((c) => c.rows.find((r) => r.name === n));
      const m = (k) => xs.reduce((a, r) => a + r[k] * 1, 0) / xs.length;
      return { name: n, score: m('score'), plunder: m('plunder'), holds: m('holds'), collapses: m('collapses'), hEnd: m('hEnd') };
    })
    .sort((a, b) => b.score - a.score);
  totals.set(cond, avg);
  console.log(`| ${cond}（${cs.length}組） | ${avg.map((r, i) => `${i + 1}.${r.name} ${r.score.toFixed(0)}`).join(' / ')} |`);
}
console.log('\n| 条件 | 戦略 | 荒らされ | 柵で止めた | 崩落 | 塔の高さ（終わり） |');
console.log('|---|---|---|---|---|---|');
for (const [cond, avg] of totals) {
  for (const r of avg) if (['weave', 'spireAll', 'spire'].includes(r.name)) console.log(`| ${cond} | ${r.name} | ${r.plunder.toFixed(0)} | ${r.holds.toFixed(1)} | ${r.collapses.toFixed(2)} | ${r.hEnd.toFixed(2)} |`);
}
// 迷いの罰（X_r3 / X_d0）
for (const [cond, avg] of totals) {
  if (!cond.endsWith('_r3')) continue;
  const base = totals.get(cond.replace(/_r3$/, '_d0'));
  if (!base) continue;
  const ratios = avg
    .filter((r) => r.name !== 'bare')
    .map((r) => ({ name: r.name, ratio: r.score / base.find((b) => b.name === r.name).score - 1 }));
  const meanRatio = ratios.reduce((a, r) => a + r.ratio, 0) / ratios.length;
  console.log(`\n迷いの罰 ${cond}: 平均 ${pct(meanRatio)}（${ratios.map((r) => `${r.name} ${pct(r.ratio)}`).join('・')}）`);
}
