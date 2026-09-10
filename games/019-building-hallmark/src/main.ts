import { Game } from './core/game';
import { Renderer } from './render/renderer';
import { Input } from './render/input';
import { createAIP } from './aip';

const TICK_MS = 100; // 10 tps

const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input();

const params = new URLSearchParams(location.search);
let game = new Game(Number(params.get('seed') ?? 1));
let aiControlled = false;

window.__AIP__ = createAIP({
  getGame: () => game,
  setGame: (g) => (game = g),
  render: () => renderer.draw(game.getState(), input.selectedMaterial()),
  setAiControlled: (on) => (aiControlled = on),
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r' && game.over) {
    game = new Game(game.seed);
  }
});

setInterval(() => {
  if (aiControlled) return; // AIPが step() で進める
  const state = game.getState();
  if (!state.over) game.step(input.poll());
  renderer.draw(game.getState(), input.selectedMaterial());
}, TICK_MS);

renderer.draw(game.getState(), input.selectedMaterial());
