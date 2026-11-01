// v2の集計: grid_1.txt・grid_81.txt（--grid --json の出力）と sw_*.json（--sweepHp の出力）を置いたディレクトリを渡す
// 使い方: node headless/analyze.mjs <dir>
import fs from 'node:fs';
const dir = process.argv[2];
const SETS = [1, 81];
const grid = {};
for (const st of SETS) { const t = fs.readFileSync(`${dir}/grid_${st}.txt`, 'utf8').trim().split('\n'); grid[st] = JSON.parse(t[t.length - 1]); }
const CONDS = ['d0', '1s-reset', '3s-sum', '3s-reset', '6s-reset'];
const CTRL = ['noshop', 'sprinter', 'bare'];
const names = grid[1].d0.rows.map((r) => r.name);
const f1 = (x) => x.toFixed(1);
console.log('## d0');
for (const n of names) {
  const r = SETS.map((st) => grid[st].d0.rows.find((x) => x.name === n));
  const c = SETS.map((st) => grid[st].noCarry.find((x) => x.name === n));
  console.log(`${n}: ${r.map((x) => x.score).join('|')} wins ${r.map((x) => x.wins).join('|')} downs ${r[0].downs} carry ${r[0].carry} bankHp ${r[0].bankHp} shed ${r[0].shed} sorties ${r[0].sorties} med ${r[0].medSec} short ${r[0].short} || noCarry ${c.map((x) => x.noCarry).join('|')} winsNo ${c.map((x) => x.winsNo).join('|')} minusCarry ${c[0].minusCarry} same ${c.map((x) => x.sameRuns).join('|')}`);
}
console.log('## 罰と wins');
for (const cond of CONDS.slice(1)) {
  const out = names.map((n) => { const r = SETS.map((st) => grid[st][cond].rows.find((x) => x.name === n)); return `${n} ${r.map((x) => x.pen.replace('%', '')).join('|')} w${r.map((x) => x.wins).join('|')}`; });
  const within = SETS.map((st) => grid[st][cond].rows.filter((x) => parseFloat(x.pen) > -5).length);
  console.log(`${cond}: within5 ${within.join('|')}/12 :: ${out.join(', ')}`);
}
console.log('## bareBeats');
for (const cond of CONDS) console.log(`${cond}: ${SETS.map((st) => grid[st][cond].bareBeats.join(',') || '0').join(' ｜ ')}  (対照除く: ${SETS.map((st) => grid[st][cond].bareBeats.filter((b) => !CTRL.includes(b)).join(',') || '0').join(' ｜ ')})`);
// sweep
const rows = [];
for (const f of fs.readdirSync(dir).filter((f) => f.startsWith('sw_'))) { const j = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8').trim().split('\n').pop()); for (const r of j.rows) rows.push({ ...r, set: j.start }); }
const Hs = [...new Set(rows.map((r) => r.H))].sort();
const get = (cond, n, H, set) => rows.find((r) => r.cond === cond && r.name === n && r.H === H && r.set === set);
console.log('## sweepHp (1..80)');
const best = {};
for (const cond of ['d0', '3s-reset', '6s-reset']) {
  best[cond] = {};
  for (const n of names) {
    const tab = Hs.map((H) => SETS.map((st) => get(cond, n, H, st).score));
    const pick = SETS.map((_, k) => Hs[tab.map((x) => x[k]).indexOf(Math.max(...tab.map((x) => x[k])))]);
    // A で選んで B で測る、B で選んで A で測る
    const held = [get(cond, n, pick[0], 81), get(cond, n, pick[1], 1)];
    best[cond][n] = { pick, held: held.map((h) => h.score), runs: { 81: held[0].scores, 1: held[1].scores } };
    console.log(`${cond} ${n}: ${tab.map((x) => x[0]).join('/')} pick ${pick.join(',')} held ${best[cond][n].held.join('|')}`);
  }
}
for (const n of names) console.log(`最良線の罰 ${n}: 3s ${[0, 1].map((k) => f1((best['3s-reset'][n].held[k] / best.d0[n].held[k] - 1) * 100)).join('|')}  6s ${[0, 1].map((k) => f1((best['6s-reset'][n].held[k] / best.d0[n].held[k] - 1) * 100)).join('|')}`);
for (const cond of ['d0', '3s-reset', '6s-reset']) {
  const res = SETS.map((st) => {
    const wins = {}; const bareB = [];
    for (const a of names) { wins[a] = 0; for (const b of names) if (a !== b) { const ra = best[cond][a].runs[st], rb = best[cond][b].runs[st]; const w = ra.filter((x, i) => x > rb[i]).length; if (w > ra.length / 2) { wins[a]++; if (a === 'bare') bareB.push(b); } } }
    return { wins, bareB };
  });
  console.log(`最良線どうし ${cond}: ${names.map((n) => `${n} ${res.map((r) => r.wins[n]).join('|')}`).join(', ')} :: bareが勝つ ${res.map((r) => r.bareB.join(',') || '0').join(' ｜ ')}`);
}
