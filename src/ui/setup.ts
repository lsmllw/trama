import { BASE_LANCES, CLASS_IDS, CLASSES, WEIGHT_LABEL } from '../core';
import type { ClassId, Difficulty } from '../core';
import { clear, h } from './dom';

export interface MatchConfig {
  azul: ClassId[];
  vermelho: ClassId[];
  difficulty: Difficulty;
  seed: number;
}

export const SUGGESTED: ClassId[] = ['tank', 'espadachim', 'cavaleiro', 'atirador', 'medico'];

export function randomComp(): ClassId[] {
  const comp: ClassId[] = [];
  while (comp.length < 5) {
    const c = CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)];
    if (comp.filter((x) => x === c).length < 2) comp.push(c);
  }
  return comp;
}

function rangeText(id: ClassId): string {
  const d = CLASSES[id];
  if (d.ranged) {
    const r = d.ranged;
    const kind = { tiro: 'tiro', canhao: 'tiro em linha', morteiro: 'indireto', granada: 'arremesso' }[r.kind];
    const span = r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
    return d.melee ? `1 e ${span} (${kind})` : `${span} (${kind})`;
  }
  return '1';
}

export function showSetup(root: HTMLElement, previous: MatchConfig | null, onStart: (c: MatchConfig) => void): void {
  let team: ClassId[] = previous ? [...previous.azul] : [...SUGGESTED];
  let difficulty: Difficulty = previous?.difficulty ?? 'veterano';

  const render = () => {
    clear(root);
    const count = (c: ClassId) => team.filter((x) => x === c).length;
    const cards = CLASS_IDS.map((id) => {
      const d = CLASSES[id];
      const n = count(id);
      return h(
        'button',
        {
          class: `class-card${n ? ' picked' : ''}`,
          disabled: team.length >= 5 || n >= 2,
          title: n >= 2 ? 'Máximo de 2 por classe' : 'Adicionar ao time',
          onclick: () => {
            if (team.length < 5 && count(id) < 2) team.push(id);
            render();
          },
        },
        h('div', { class: 'name' }, `${d.name}${n ? ` ×${n}` : ''}`),
        h('div', { class: 'meta' }, `${d.arm[0].toUpperCase()}${d.arm.slice(1)} · ${WEIGHT_LABEL[d.weight]} · ${BASE_LANCES[d.weight]} lance(s)`),
        h('div', { class: 'nums' }, `MOV ${d.mov} · Alcance ${rangeText(id)}`),
        h('div', { class: 'nums' }, `HP ${d.hp} · ATQ ${d.atq} · ARM ${d.armadura} · ST ${d.stamina}`),
        h('div', { class: 'meta' }, d.role),
      );
    });

    root.append(
      h(
        'div',
        { class: 'setup' },
        h('h2', {}, 'Monte o time Azul'),
        h(
          'p',
          { class: 'lead' },
          'Escolha 5 unidades (no máximo 2 da mesma classe). O Vermelho é controlado pela máquina, com um time sorteado. Cada classe libera sua habilidade no level 2. Protótipo: sem arte e construções ainda.',
        ),
        h('div', { class: 'class-grid' }, cards),
        h(
          'div',
          { class: 'team-row' },
          h('b', {}, `Seu time (${team.length}/5):`),
          team.map((c, i) =>
            h(
              'button',
              {
                class: 'chip',
                title: 'Remover',
                onclick: () => {
                  team.splice(i, 1);
                  render();
                },
              },
              `${CLASSES[c].name} ✕`,
            ),
          ),
          team.length === 0 ? h('span', { class: 'meta' }, 'nenhuma unidade ainda') : null,
        ),
        h(
          'div',
          { class: 'setup-controls' },
          h(
            'button',
            {
              onclick: () => {
                team = [...SUGGESTED];
                render();
              },
            },
            'Time sugerido',
          ),
          h(
            'button',
            {
              onclick: () => {
                team = randomComp();
                render();
              },
            },
            'Sortear',
          ),
          h(
            'button',
            {
              onclick: () => {
                team = [];
                render();
              },
            },
            'Limpar',
          ),
          h('span', { class: 'meta' }, 'Dificuldade da IA:'),
          (() => {
            const sel = h(
              'select',
              {
                onchange: (e: Event) => {
                  difficulty = (e.target as HTMLSelectElement).value as Difficulty;
                },
              },
              h('option', { value: 'recruta' }, 'Recruta'),
              h('option', { value: 'veterano' }, 'Veterano'),
            );
            sel.value = difficulty;
            return sel;
          })(),
          h(
            'button',
            {
              class: 'primary',
              disabled: team.length !== 5,
              onclick: () =>
                onStart({ azul: [...team], vermelho: randomComp(), difficulty, seed: Math.floor(Math.random() * 2 ** 31) }),
            },
            'Começar partida',
          ),
        ),
      ),
    );
  };
  render();
}
