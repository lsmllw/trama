// Janela do Duelo (drible, desarme, carrinho, bola dividida) quando o jogador participa.

import { canPlay, chooseLance, LANCE_FOL, lanceName, otherSide, resolveTempo, ROLES, sidePlayer, TEMPOS, useRead, WEIGHT_LABEL } from '../core';
import type { Difficulty, DuelState, GameState, Lance, LanceMemory, SideKey } from '../core';
import { clear, h } from './dom';
import { DuelStage } from './duel-stage';

export interface DuelContext {
  s: GameState;
  cs: DuelState;
  playerSide: SideKey;
  difficulty: Difficulty;
  memory: LanceMemory;
}

type Order = 'simultaneo' | 'jogadorPrimeiro' | 'iaRevelada';

const KIND_TITLE: Record<DuelState['kind'], string> = {
  drible: 'Drible',
  desarme: 'Desarme',
  carrinho: 'Carrinho',
  dividida: 'Bola dividida',
};

/** O que cada lance vence, para quem está com a bola e para quem marca. */
const BEATS: Record<'bola' | 'marca', Record<Lance, string>> = {
  bola: {
    golpe: 'vence Simular bote',
    guarda: 'vence o Bote (e o Bote vira falta)',
    finta: 'vence Fechar e Recuar; gasta 1 HAB',
    esperar: 'segura o Bote sem gastar; perde para a Finta',
  },
  marca: {
    golpe: 'vence a Finta; contra Proteger é falta',
    guarda: 'vence a Arrancada',
    finta: 'vence Proteger e Cadenciar; gasta 1 HAB',
    esperar: 'deixa a Arrancada passar no vazio; perde para a Finta',
  },
};

export function openDuel(ctx: DuelContext): Promise<void> {
  const { s, cs, playerSide, difficulty, memory } = ctx;
  const aiSide = otherSide(playerSide);
  const bg = h('div', { class: 'modal-bg' });
  const box = h('div', { class: 'modal' });
  bg.append(box);
  document.body.append(bg);
  let order: Order = 'simultaneo';
  let aiChoice: Lance | null = null;
  let notice = '';
  let last: { atk: Lance; def: Lance } | null = null;
  const stage = new DuelStage(s, cs, playerSide);

  const prepareTempo = () => {
    aiChoice = null;
    last = null;
    if (cs.exposed === playerSide) {
      order = 'jogadorPrimeiro';
      notice = 'Você está desequilibrado: o adversário verá a sua escolha.';
    } else if (cs.exposed === aiSide) {
      aiChoice = chooseLance(s, cs, aiSide, memory, null, difficulty);
      order = 'iaRevelada';
      notice = `O adversário está desequilibrado: ele vai de ${lanceName(cs, aiSide, aiChoice)}.`;
    } else if (cs[aiSide].readsLeft > 0 && useRead(cs, aiSide)) {
      order = 'jogadorPrimeiro';
      notice = 'O adversário leu o lance: ele verá a sua escolha.';
    } else {
      order = 'simultaneo';
      notice = 'Escolham ao mesmo tempo.';
    }
  };

  return new Promise<void>((resolve) => {
    const close = () => {
      if (stage.busy) return;
      stage.destroy();
      bg.remove();
      document.removeEventListener('keydown', onKey);
      resolve();
    };

    const play = (mine: Lance) => {
      if (cs.done || stage.busy) return;
      if (!canPlay(s, cs, playerSide, mine)) return;
      if (order === 'jogadorPrimeiro') aiChoice = chooseLance(s, cs, aiSide, memory, mine, difficulty);
      else if (aiChoice === null) aiChoice = chooseLance(s, cs, aiSide, memory, null, difficulty);
      memory[mine]++;
      const atk = playerSide === 'atk' ? mine : aiChoice;
      const def = playerSide === 'def' ? mine : aiChoice;
      const r = resolveTempo(s, cs, atk, def);
      box.querySelectorAll<HTMLButtonElement>('.lance-buttons button').forEach((b) => (b.disabled = true));
      stage.play(r, () => {
        last = { atk: r.atk, def: r.def };
        if (!cs.done) {
          const keep = last;
          prepareTempo();
          last = keep;
        } else notice = resultText();
        render();
      });
    };

    const resultText = () => {
      if (cs.foul) return 'Falta!';
      const b = cs[cs.ball].vantage;
      const m = cs[otherSide(cs.ball)].vantage;
      const ballName = sidePlayer(s, cs, cs.ball).name;
      const markName = sidePlayer(s, cs, otherSide(cs.ball)).name;
      if (m > b) return `${markName} fica com a bola.`;
      if (b > m && cs.ball === 'atk') return `${ballName} passa!`;
      return `${ballName} segura a bola.`;
    };

    const read = () => {
      if (stage.busy || order !== 'simultaneo' || !useRead(cs, playerSide)) return;
      aiChoice = chooseLance(s, cs, aiSide, memory, null, difficulty);
      order = 'iaRevelada';
      notice = `Leitura: o adversário vai de ${lanceName(cs, aiSide, aiChoice)}.`;
      render();
    };

    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Lance> = {
        '1': 'golpe',
        '2': 'guarda',
        '3': 'finta',
        '4': 'esperar',
      };
      if (map[e.key]) play(map[e.key]);
      else if (['Enter', ' ', 'Escape', 'z', 'Z', 'x', 'X'].includes(e.key) && cs.done) {
        e.preventDefault();
        close();
      } else if (e.key.toLowerCase() === 'l') read();
    };
    document.addEventListener('keydown', onKey);

    const fighter = (k: SideKey) => {
      const p = sidePlayer(s, cs, k);
      const def = ROLES[p.role];
      const side = cs[k];
      const pips = [];
      for (let i = 0; i < side.lances; i++) pips.push(h('div', { class: `pip${i >= side.lancesLeft ? ' used' : ''}` }));
      for (let i = 0; i < side.readsLeft; i++) pips.push(h('div', { class: 'pip read', title: 'Leitura' }));
      let shown = '';
      if (last) shown = lanceName(cs, k, k === 'atk' ? last.atk : last.def);
      else if (k === aiSide && order === 'iaRevelada' && aiChoice) shown = lanceName(cs, k, aiChoice);
      else if (k === aiSide && !cs.done) shown = '?';
      return h(
        'div',
        { class: `fighter ${p.team}` },
        h('div', { class: 'nm' }, `${p.name} · ${def.name}${k === playerSide ? ' (você)' : ''}`),
        h(
          'div',
          { class: 'sub' },
          `${cs.ball === k ? 'Com a bola' : 'Marcando'} · ${WEIGHT_LABEL[def.weight]} · lance gasta ${LANCE_FOL[def.weight]} de fôlego`,
        ),
        h('div', { class: 'sub' }, `Fôlego ${p.fol}/${def.fol} · HAB ${p.hab}/${def.hab} · Vantagem ${side.vantage}`),
        h('div', { class: 'pips', title: 'Lances restantes' }, pips),
        h('div', { class: 'sub' }, side.notes.join(' · ')),
        h('div', { class: 'choice' }, shown),
      );
    };

    const render = () => {
      clear(box);
      const track = [];
      for (let t = 1; t <= TEMPOS; t++) track.push(h('span', { class: t === cs.tempo && !cs.done ? 'on' : '' }, `Tempo ${t}`));
      const mine = cs.ball === playerSide ? 'bola' : 'marca';
      const btn = (key: string, l: Lance) =>
        h(
          'button',
          {
            disabled: cs.done || !canPlay(s, cs, playerSide, l),
            onclick: () => play(l),
            title: BEATS[mine][l],
          },
          h('b', {}, `${key} · ${lanceName(cs, playerSide, l)}`),
          h('small', {}, BEATS[mine][l]),
        );
      box.append(
        h(
          'h2',
          {},
          h('span', {}, KIND_TITLE[cs.kind]),
          h('span', { class: 'sub' }, cs.side === 'costas' ? 'pelas costas' : cs.side === 'flanco' ? 'pelo lado' : 'de frente'),
        ),
        stage.el,
        h('div', { class: 'duel' }, fighter(playerSide), h('div', { class: 'vs' }, '×'), fighter(aiSide)),
        h('div', { class: 'tempo-track' }, track),
        h('div', { class: 'notice' }, notice),
        cs.done
          ? h('div', { class: 'lance-buttons' }, h('button', { class: 'primary', onclick: close }, 'Continuar (Z)'))
          : h(
              'div',
              { class: 'lance-buttons four' },
              btn('1', 'golpe'),
              btn('2', 'guarda'),
              btn('3', 'finta'),
              btn('4', 'esperar'),
              cs[playerSide].readsLeft > 0 && order === 'simultaneo'
                ? h('button', { onclick: read, class: 'read-btn' }, `L · Leitura (${cs[playerSide].readsLeft})`)
                : null,
            ),
        h('div', { class: 'rule-line' }, 'Cada tempo vencido vale vantagem. Quem tem a bola fica com ela no empate; quem marca precisa terminar na frente.'),
        h(
          'div',
          { class: 'results' },
          cs.results.map((r) => h('div', {}, r.text)),
        ),
      );
    };

    prepareTempo();
    render();
  });
}
