import './ui/style.css';
import * as core from './core';
import { openDuel } from './ui/duel-modal';
import { GameView } from './ui/game-view';
import type { MatchConfig } from './ui/game-view';
import { showSetup } from './ui/setup';

const root = document.getElementById('app')!;
let view: GameView | null = null;
let last: MatchConfig | null = null;

function start(config: MatchConfig): void {
  last = config;
  view?.destroy();
  view = new GameView(root, config, (rematch) => {
    view?.destroy();
    view = null;
    if (rematch && last) start({ ...last, seed: Math.floor(Math.random() * 2 ** 31) });
    else showSetup(root, last, start);
  });
  view.mount();
}

showSetup(root, null, start);

// Ganchos de depuração (testes automatizados no navegador e console).
(window as unknown as { __debug: unknown }).__debug = {
  core,
  openDuel,
  get view() {
    return view;
  },
  quickStart: (seed = 42) => start({ difficulty: 'veterano', seed }),
};
