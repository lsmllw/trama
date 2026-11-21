// Janela de informações de um jogador (quando o mouse para em cima dele na quadra ou no cartão).

import { ROLES, TEAM_NAME, WEIGHT_LABEL } from '../core';
import type { GameState, Player } from '../core';
import { clear, h } from './dom';
import { ROLE_BADGE, roleBadge } from './roles';
import { portraitUrl } from './sprites';

let el: HTMLElement | null = null;
let shownId: string | null = null;

function tipEl(): HTMLElement {
  if (!el) {
    el = h('div', { class: 'ptip' });
    document.body.append(el);
  }
  return el;
}

function content(s: GameState, p: Player): HTMLDivElement[] {
  const d = ROLES[p.role];
  const badge = ROLE_BADGE[p.role];
  const stat = (k: string, v: number, tip: string) => h('span', { title: tip }, h('i', {}, k), String(v));
  const bar = (label: string, v: number, max: number, cls: string) =>
    h(
      'div',
      { class: 'tbar' },
      h('span', {}, label),
      h('div', { class: `bar ${cls}` }, h('div', { style: `width:${(100 * v) / max}%` })),
      h('b', {}, `${v}/${max}`),
    );
  const status: [string, string][] = [];
  if (s.holder === p.id) status.push(['⚽', 'Com a bola']);
  if (s.keeperMustPass === p.id) status.push(['⏱', 'Regra dos 4 segundos: precisa soltar a bola nesta fase']);
  if (p.unbalanced) status.push(['💫', 'Desequilibrado: não marca nem corta passes até a fase dele']);
  if (p.ready && s.activeTeam !== p.team) status.push(['❗', 'Prontidão: +1 lance se for defender um Duelo']);
  if (p.muralha) status.push(['🧱', 'Muralha ativa: reflexo +2']);
  if (p.pedalada) status.push(['🌀', 'Pedalada pronta: +1 Leitura e fintas sem HAB no próximo Duelo']);
  if (s.activeTeam === p.team && p.activated && !s.over) status.push(['✓', 'Já jogou nesta fase']);
  if (p.goals) status.push(['🥅', `${p.goals} gol${p.goals > 1 ? 's' : ''} na partida`]);
  return [
    h(
      'div',
      { class: 'tt-head' },
      h('img', { src: portraitUrl(p, 3), alt: p.name }),
      h(
        'div',
        {},
        h('div', { class: 'tt-name' }, `#${p.number} ${p.name}`),
        h(
          'div',
          { class: 'tt-role', style: `color:${badge.color}` },
          roleBadge(p.role),
          ` ${d.name}`,
          h('span', { class: 'sub' }, ` · ${WEIGHT_LABEL[d.weight]}`),
        ),
        h('div', { class: `tt-team ${p.team}` }, TEAM_NAME[p.team]),
      ),
    ),
    h('div', { class: 'tt-blurb' }, d.blurb),
    h(
      'div',
      { class: 'stats' },
      stat('MOV', d.mov, 'Casas por fase'),
      stat('PAS', d.pas, 'Alcance do passe'),
      stat('DOM', d.dom, 'Domínio: lances com a bola e recepção'),
      stat('HAB', d.hab, 'Pontos para fintas'),
      stat('FIN', d.fin, 'Finalização: alcance e força do chute'),
      stat('MAR', d.mar, 'Marcação: lances sem a bola'),
      p.role === 'goleiro' ? stat('REF', d.ref + (p.muralha ? 2 : 0), 'Reflexo nas defesas') : null,
    ),
    bar('Fôlego', p.fol, d.fol, 'fol'),
    bar('HAB', p.hab, d.hab, 'hab'),
    h(
      'div',
      { class: `tt-special${p.specialUsed ? ' used' : ''}` },
      h('b', {}, `★ ${d.special}`),
      p.specialUsed ? ' (já usado neste tempo)' : '',
      h('div', {}, d.specialText),
    ),
    status.length
      ? h(
          'div',
          { class: 'tt-status' },
          status.map(([i, t]) => h('div', {}, h('span', {}, i), t)),
        )
      : null,
  ].filter((x): x is HTMLDivElement => !!x);
}

/** Mostra (ou atualiza) a janela perto do ponto (x, y) da página. */
export function showPlayerTip(s: GameState, p: Player, x: number, y: number, side: 'auto' | 'left' = 'auto'): void {
  const t = tipEl();
  if (shownId !== p.id || !t.classList.contains('on')) {
    clear(t);
    t.append(...content(s, p));
    t.classList.remove('on');
    void t.offsetWidth; // reinicia a animação de entrada
    t.classList.add('on');
    shownId = p.id;
  }
  const w = t.offsetWidth;
  const hgt = t.offsetHeight;
  let left = side === 'left' ? x - w - 12 : x + 18;
  let top = side === 'left' ? y : y + 14;
  if (left + w > window.innerWidth - 8) left = x - w - 18;
  if (top + hgt > window.innerHeight - 8) top = Math.max(8, window.innerHeight - hgt - 8);
  t.style.left = `${Math.max(8, left)}px`;
  t.style.top = `${top}px`;
}

export function hideTip(): void {
  if (el) el.classList.remove('on');
  shownId = null;
}
