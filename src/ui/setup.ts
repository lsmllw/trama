// Tela inicial: os dois elencos, as posições e a dificuldade.

import { createGame, ROLES, WEIGHT_LABEL } from '../core';
import type { Difficulty, Player, Role } from '../core';
import { clear, h } from './dom';
import type { MatchConfig } from './game-view';
import { portraitUrl } from './sprites';

const ROLE_LIST: Role[] = ['goleiro', 'fixo', 'ala', 'pivo'];

function playerRow(p: Player): HTMLElement {
  const d = ROLES[p.role];
  return h(
    'div',
    { class: `roster-row ${p.team}` },
    h('img', { src: portraitUrl(p, 3), alt: p.name }),
    h('div', {}, h('b', {}, `#${p.number} ${p.name}`), h('div', { class: 'sub' }, `${d.name} · ${d.special}`)),
  );
}

export function showSetup(root: HTMLElement, previous: MatchConfig | null, onStart: (c: MatchConfig) => void): void {
  let difficulty: Difficulty = previous?.difficulty ?? 'veterano';
  const demo = createGame({ seed: 1 });

  const start = () => {
    document.removeEventListener('keydown', onKey);
    onStart({ difficulty, seed: Math.floor(Math.random() * 2 ** 31) });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      start();
    }
  };
  document.addEventListener('keydown', onKey);

  const render = () => {
    clear(root);
    const team = (t: 'azul' | 'vermelho') => demo.players.filter((p) => p.team === t);
    const roleCard = (r: Role) => {
      const d = ROLES[r];
      const sample = demo.players.find((p) => p.team === 'azul' && p.role === r)!;
      const stat = (k: string, v: number, tip: string) => h('span', { title: tip }, h('i', {}, k), String(v));
      return h(
        'div',
        { class: 'role-card' },
        h('img', { src: portraitUrl(sample, 3), alt: d.name }),
        h('div', { class: 'name' }, d.name, h('span', { class: 'sub' }, ` · ${WEIGHT_LABEL[d.weight]}`)),
        h('div', { class: 'meta' }, d.blurb),
        h(
          'div',
          { class: 'stats' },
          stat('MOV', d.mov, 'Casas por fase'),
          stat('PAS', d.pas, 'Alcance do passe'),
          stat('DOM', d.dom, 'Domínio: lances com a bola e recepção'),
          stat('HAB', d.hab, 'Pontos para fintas'),
          stat('FIN', d.fin, 'Finalização: alcance e força do chute'),
          stat('MAR', d.mar, 'Marcação: lances sem a bola'),
          r === 'goleiro' ? stat('REF', d.ref, 'Reflexo nas defesas') : stat('FOL', d.fol, 'Fôlego'),
        ),
        h('div', { class: 'meta special' }, h('b', {}, d.special), ` — ${d.specialText}`),
      );
    };
    root.append(
      h(
        'div',
        { class: 'setup' },
        h('h1', { class: 'logo' }, 'TRAMA ', h('span', {}, 'FUTSAL')),
        h(
          'p',
          { class: 'lead' },
          'Futsal tático por turnos: ande, passe, drible, chute. Cada posição joga diferente. Você é o Azul; a máquina comanda o Vermelho. Dois tempos de 8 rodadas.',
        ),
        h(
          'div',
          { class: 'rosters' },
          h('div', { class: 'roster azul' }, h('h3', {}, 'Azul (você)'), team('azul').map(playerRow)),
          h('div', { class: 'vs-big' }, '×'),
          h('div', { class: 'roster vermelho' }, h('h3', {}, 'Vermelho (IA)'), team('vermelho').map(playerRow)),
        ),
        h('h3', {}, 'As posições'),
        h('div', { class: 'role-grid' }, ROLE_LIST.map(roleCard)),
        h(
          'div',
          { class: 'rules' },
          h('h3', {}, 'Como se joga'),
          h(
            'ul',
            {},
            h('li', {}, 'Na sua fase, cada jogador anda e depois age uma vez: passar, chutar, driblar ou desarmar.'),
            h(
              'li',
              {},
              'Com a bola, quem encosta num marcador para: daí só sai no drible. Passes rasteiros são cortados por quem está perto da linha; o passe alto (A) passa por cima, mas a recepção fica disputada.',
            ),
            h(
              'li',
              {},
              'Drible e desarme viram um Duelo de 3 tempos: Arrancada/Bote vence Finta, Proteger/Fechar vence Arrancada/Bote, Finta vence Proteger e quem espera.',
            ),
            h(
              'li',
              {},
              'No chute você escolhe o canto e o goleiro escolhe o lado. A partir da 6ª falta do time no tempo, toda falta é tiro livre direto do 10 m.',
            ),
            h('li', {}, 'Goleiro com a bola tem que soltar na fase seguinte (regra dos 4 segundos).'),
          ),
        ),
        h(
          'div',
          { class: 'start-row' },
          h('span', {}, 'Dificuldade: '),
          (['recruta', 'veterano'] as Difficulty[]).map((d) =>
            h(
              'button',
              {
                class: difficulty === d ? 'on' : '',
                onclick: () => {
                  difficulty = d;
                  render();
                },
              },
              d === 'recruta' ? 'Recruta' : 'Veterano',
            ),
          ),
          h('button', { class: 'primary big', onclick: start }, 'Começar partida (Enter)'),
        ),
      ),
    );
  };
  render();
}
