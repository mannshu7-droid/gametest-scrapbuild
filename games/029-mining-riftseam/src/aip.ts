import { Game } from './core/game';
import { ACTION_SPEC, type Action, type ActionSpecEntry, type GameState } from './core/types';

/** docs/ai-interface.md の AIP v1 契約の実装 */
export interface AIP {
  version: 1;
  takeControl(): void;
  release(): void;
  reset(seed: number): GameState;
  getState(): GameState;
  step(action?: Action): GameState;
  run(actions: Action[]): GameState;
  getActionSpec(): ActionSpecEntry[];
}

export interface AipHost {
  getGame(): Game;
  setGame(g: Game): void;
  render(): void;
  setAiControlled(on: boolean): void;
}

export function createAIP(host: AipHost): AIP {
  return {
    version: 1,
    takeControl: () => host.setAiControlled(true),
    release: () => host.setAiControlled(false),
    reset(seed: number) {
      host.setGame(new Game(seed));
      host.render();
      return host.getGame().getState();
    },
    getState: () => host.getGame().getState(),
    step(action?: Action) {
      host.getGame().step(action ?? { type: 'wait' });
      host.render();
      return host.getGame().getState();
    },
    run(actions: Action[]) {
      const g = host.getGame();
      for (const a of actions) {
        g.step(a);
        if (g.over) break;
      }
      host.render();
      return g.getState();
    },
    getActionSpec: () => ACTION_SPEC,
  };
}

declare global {
  interface Window {
    __AIP__: AIP;
  }
}
