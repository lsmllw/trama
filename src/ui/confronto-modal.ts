// Janela do Confronto quando o jogador participa (atacando ou defendendo).

import {
  canSpend,
  chooseLance,
  CLASSES,
  finishConfronto,
  confrontoHit,
  LANCE_COST,
  LANCE_LABEL,
  otherSide,
  resolveTempo,
  sideUnit,
  TEMPOS,
  unitName,
  useRead,
  wantsRead,
  WEIGHT_LABEL,
} from '../core';
import type { ConfrontoState, Difficulty, GameState, Lance, LanceMemory, SideKey } from '../core';
import { clear, h } from './dom';
import { DuelStage } from './duel-stage';

export interface ConfrontoContext {
  s: GameState;
  cs: ConfrontoState;
  playerSide: SideKey;
  difficulty: Difficulty;
  memory: LanceMemory;
  /** Chamado depois de cada tempo, para a tela de fundo mostrar o dano. */
  onTempo: () => void;
}

type Order = 'simultaneo' | 'jogadorPrimeiro' | 'iaRevelada';

export function openConfronto(ctx: ConfrontoContext): Promise<void> {
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
      notice = 'Você está Exposto: o inimigo verá a sua escolha antes de decidir.';
    } else if (cs.exposed === aiSide) {
      aiChoice = chooseLance(s, cs, aiSide, null, difficulty, memory);
      order = 'iaRevelada';
      notice = `O inimigo está Exposto: ele escolheu ${LANCE_LABEL[aiChoice]}.`;
    } else if (wantsRead(s, cs, aiSide) && useRead(cs, aiSide)) {
      order = 'jogadorPrimeiro';
      notice = 'O inimigo usou uma Leitura: ele verá a sua escolha.';
    } else {
      order = 'simultaneo';
      notice = 'Escolham ao mesmo tempo.';
    }
  };

  return new Promise<void>((resolve) => {
    const close = () => {
      if (stage.busy) return;
      stage.destroy();
      finishConfronto(s, cs);
      bg.remove();
      document.removeEventListener('keydown', onKey);
      resolve();
    };

    const play = (mine: Lance) => {
      if (cs.done || stage.busy) return;
      if (mine !== 'esperar' && !canSpend(s, cs, playerSide)) return;
      if (order === 'jogadorPrimeiro') aiChoice = chooseLance(s, cs, aiSide, mine, difficulty, memory);
      else if (aiChoice === null) aiChoice = chooseLance(s, cs, aiSide, null, difficulty, memory);
      if (mine !== 'esperar') memory[mine]++;
      const atk = playerSide === 'atk' ? mine : aiChoice;
      const def = playerSide === 'def' ? mine : aiChoice;
      const r = resolveTempo(s, cs, atk, def);
      // Enquanto os dois lutam no palco, os botões ficam travados; o placar muda no fim.
      box.querySelectorAll<HTMLButtonElement>('.lance-buttons button').forEach((b) => (b.disabled = true));
      stage.play(r, () => {
        last = { atk: r.atk, def: r.def };
        ctx.onTempo();
        if (!cs.done) {
          const keep = last;
          prepareTempo();
          last = keep;
        } else {
          notice = 'Fim do Confronto.';
        }
        render();
      });
    };

    const read = () => {
      if (stage.busy) return;
      if (order !== 'simultaneo' || !useRead(cs, playerSide)) return;
      aiChoice = chooseLance(s, cs, aiSide, null, difficulty, memory);
      order = 'iaRevelada';
      notice = `Leitura: o inimigo escolheu ${LANCE_LABEL[aiChoice]}.`;
      render();
    };

    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Lance> = { '1': 'golpe', '2': 'guarda', '3': 'finta', '4': 'esperar' };
      if (map[e.key]) play(map[e.key]);
      else if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'x') && cs.done) close();
      else if (e.key.toLowerCase() === 'l') read();
    };
    document.addEventListener('keydown', onKey);

    const fighter = (k: SideKey) => {
      const u = sideUnit(s, cs, k);
      const d = CLASSES[u.cls];
      const side = cs[k];
      const pips = [];
      for (let i = 0; i < side.lances; i++) pips.push(h('div', { class: `pip${i >= side.lancesLeft ? ' used' : ''}` }));
      for (let i = 0; i < side.readsLeft; i++) pips.push(h('div', { class: 'pip read', title: 'Leitura' }));
      let shown = '';
      if (last) shown = LANCE_LABEL[k === 'atk' ? last.atk : last.def];
      else if (k === aiSide && order === 'iaRevelada' && aiChoice) shown = `${LANCE_LABEL[aiChoice]}`;
      else if (k === aiSide && !cs.done) shown = '?';
      return h(
        'div',
        { class: `fighter ${u.team}` },
        h('div', { class: 'nm' }, `${unitName(u)}${k === playerSide ? ' (você)' : ''}`),
        h('div', { class: 'sub' }, `${k === 'atk' ? 'Atacante' : 'Defensor'} · ${WEIGHT_LABEL[d.weight]} · lance custa ${LANCE_COST[d.weight]} ST`),
        h('div', { class: 'hpbar', style: 'width:100%;margin-top:6px' }, h('div', { style: `width:${(100 * u.hp) / d.hp}%` })),
        h('div', { class: 'sub' }, `HP ${u.hp}/${d.hp} · Stamina ${u.stamina}/${d.stamina}`),
        h('div', { class: 'pips', title: 'Lances restantes' }, pips),
        h('div', { class: 'sub' }, side.notes.join(' · ')),
        h('div', { class: 'choice' }, shown),
      );
    };

    const render = () => {
      clear(box);
      const me = sideUnit(s, cs, playerSide);
      const them = sideUnit(s, cs, aiSide);
      const can = canSpend(s, cs, playerSide) && !cs.done;
      const dmg = (m: number) => confrontoHit(s, cs, me, them, m);
      const track = [];
      for (let t = 1; t <= TEMPOS; t++) track.push(h('span', { class: t === cs.tempo && !cs.done ? 'on' : '' }, `Tempo ${t}`));

      box.append(
        h('h2', {}, h('span', {}, 'Confronto'), h('span', { class: 'sub', style: 'font-size:13px;color:var(--muted)' }, `ataque pelo ${cs.side}`)),
        stage.el,
        h('div', { class: 'duel' }, fighter(playerSide), h('div', { class: 'vs' }, '×'), fighter(aiSide)),
        h('div', { class: 'tempo-track' }, track),
        h('div', { class: 'notice' }, notice),
        cs.done
          ? h('div', { class: 'lance-buttons' }, h('button', { class: 'primary', onclick: close }, 'Fechar (Z)'))
          : h(
              'div',
              { class: 'lance-buttons' },
              h('button', { disabled: !can, onclick: () => play('golpe'), title: 'Vence Finta' }, `1 · Golpe (${dmg(2.0)})`),
              h('button', { disabled: !can, onclick: () => play('guarda'), title: 'Vence Golpe e contra-ataca' }, `2 · Guarda (${dmg(0.8)})`),
              h('button', { disabled: !can, onclick: () => play('finta'), title: 'Vence Guarda e Esperar; deixa Exposto' }, `3 · Finta (${dmg(1.5)})`),
              h('button', { onclick: () => play('esperar'), title: 'Não gasta lance. Bloqueia Golpe, perde para Finta' }, '4 · Esperar'),
              cs[playerSide].readsLeft > 0 && order === 'simultaneo'
                ? h('button', { onclick: read, title: 'Ver o lance do inimigo antes de escolher' }, `L · Leitura (${cs[playerSide].readsLeft})`)
                : null,
            ),
        h('div', { class: 'rule-line' }, 'Golpe vence Finta · Guarda vence Golpe · Finta vence Guarda e quem espera · Esperar bloqueia Golpe sem gastar lance. Números = dano se vencer.'),
        h('div', { class: 'results' }, cs.results.map((r) => h('div', {}, r.text))),
      );
    };

    prepareTempo();
    render();
  });
}
