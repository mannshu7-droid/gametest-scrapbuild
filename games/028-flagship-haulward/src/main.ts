import { Game, TUNE, PRESET_026, type Resource } from './core/game';
import { Renderer } from './render/renderer';
import { Input } from './render/input';
import { createAIP } from './aip';

const TICK_MS = 100; // 10 tps

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input();

const params = new URLSearchParams(location.search);
// 026新規: ?resource=fuel で024と同じ燃料版（対照群）を遊べる。既定は揺れ版
const resource: Resource = params.get('resource') === 'fuel' ? 'fuel' : 'tremor';
input.resource = resource;
// 028新規: ?preset=026 で026-tremorspire v0.3.0と同じ救助（朝まで手当て＋その日の稼ぎの半分）の対照群を遊べる
if (params.get('preset') === '026') Object.assign(TUNE, PRESET_026);
let game = new Game(Number(params.get('seed') ?? 1), resource);
let aiControlled = false;

window.__AIP__ = createAIP({
  getGame: () => game,
  setGame: (g) => (game = g),
  render: () => renderer.draw(game.getState(), input.selectedLot),
  setAiControlled: (on) => (aiControlled = on),
});

// R キーでリスタート（同じシード）
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && game.over) {
    game = new Game(game.seed, game.resource);
  }
});

setInterval(() => {
  if (aiControlled) return; // AIPが step() で進める
  const state = game.getState();
  if (!state.over) game.step(input.poll());
  // 3回目: 救助の手当て（朝まで）はcoreが同じstepの中で飛ばす（rescueSkip）。v2の×12早送りは不要になった
  renderer.draw(game.getState(), input.selectedLot);
}, TICK_MS);

renderer.draw(game.getState(), input.selectedLot);
