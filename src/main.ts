import './ui/style.css';
import * as core from './core';
import { openConfronto } from './ui/confronto-modal';
import { GameView } from './ui/game-view';
import { randomComp, showSetup } from './ui/setup';
import type { MatchConfig } from './ui/setup';

const root = document.getElementById('app')!;
let view: GameView | null = null;
let last: MatchConfig | null = null;

function start(config: MatchConfig): void {
  last = config;
  view?.destroy();
  view = new GameView(root, config, (rematch) => {
    view?.destroy();
    view = null;
    if (rematch && last) start({ ...last, seed: Math.floor(Math.random() * 2 ** 31), vermelho: last.vermelho });
    else showSetup(root, last, start);
  });
  view.mount();
}

showSetup(root, null, start);

// Ganchos de depuração (testes automatizados no navegador e console).
(window as unknown as { __debug: unknown }).__debug = {
  core,
  openConfronto,
  get view() {
    return view;
  },
  quickStart: () =>
    start({ azul: ['tank', 'espadachim', 'cavaleiro', 'atirador', 'medico'], vermelho: randomComp(), difficulty: 'veterano', seed: 42 }),
};
