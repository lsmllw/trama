// Duelo na própria quadra: a câmera fecha nos dois e os lances aparecem como botões
// ao lado do seu jogador. As animações acontecem ali mesmo, sem trocar de tela.

import { canPlay, chooseLance, lanceName, otherSide, resolveTempo, ROLES, sidePlayer, TEMPOS, useRead } from '../core';
import type { Difficulty, DuelState, GameState, Lance, LanceMemory, SideKey } from '../core';
import { clear, h } from './dom';
import type { Renderer } from './renderer';

export interface InlineDuelContext {
  s: GameState;
  cs: DuelState;
  playerSide: SideKey;
  difficulty: Difficulty;
  memory: LanceMemory;
  renderer: Renderer;
  /** Elemento que envolve a quadra (o menu é posicionado dentro dele). */
  host: HTMLElement;
}

type Order = 'simultaneo' | 'jogadorPrimeiro' | 'iaRevelada';

const KIND_TITLE: Record<DuelState['kind'], string> = {
  drible: 'DRIBLE!',
  desarme: 'DESARME!',
  carrinho: 'CARRINHO!',
  dividida: 'DIVIDIDA!',
};

const ICON: Record<Lance, string> = { golpe: '⚡', guarda: '🛡', finta: '🌀', esperar: '⏳' };
const COLOR: Record<Lance, string> = { golpe: '#ff9a6a', guarda: '#8fc4ff', finta: '#d2a8ff', esperar: '#d8d8e0' };
const ORDER: Lance[] = ['golpe', 'guarda', 'finta', 'esperar'];

/** O que cada lance vence, para quem está com a bola e para quem marca. */
const BEATS: Record<'bola' | 'marca', Record<Lance, string>> = {
  bola: {
    golpe: 'vence Simular bote',
    guarda: 'vence o Bote (e o Bote vira falta)',
    finta: 'vence Fechar e Recuar · 1 HAB',
    esperar: 'segura o Bote sem gastar',
  },
  marca: {
    golpe: 'vence a Finta · contra Proteger é falta',
    guarda: 'vence a Arrancada',
    finta: 'vence Proteger e Cadenciar · 1 HAB',
    esperar: 'deixa a Arrancada no vazio',
  },
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runInlineDuel(ctx: InlineDuelContext): Promise<void> {
  const { s, cs, playerSide, difficulty, memory, renderer, host } = ctx;
  const aiSide = otherSide(playerSide);
  const me = sidePlayer(s, cs, playerSide);
  const foe = sidePlayer(s, cs, aiSide);
  const atk = sidePlayer(s, cs, 'atk');
  const def = sidePlayer(s, cs, 'def');
  const sideText = cs.side === 'costas' ? 'pelas costas' : cs.side === 'flanco' ? 'pelo lado' : 'de frente';

  const hud = h('div', { class: 'duel-hud' });
  const top = h('div', { class: 'duel-top' });
  const menu = h('div', { class: 'duel-menu' });
  const chip = h('div', { class: `duel-foe ${foe.team}` });
  hud.append(top, chip, menu);

  let order: Order = 'simultaneo';
  let aiChoice: Lance | null = null;
  let notice = '';
  let focus = 0;
  let locked = true;
  let shownFoe: Lance | null = null;
  let raf = 0;

  // O menu e a ficha do adversário acompanham os jogadores na tela (a câmera continua viva).
  const place = () => {
    const box = host.getBoundingClientRect();
    const mp = renderer.playerScreen(me.id, 28);
    const fp = renderer.playerScreen(foe.id, 84);
    const left = mp.x < fp.x; // menu do lado de fora, longe do adversário
    const mw = menu.offsetWidth || 240;
    const mh = menu.offsetHeight || 200;
    let x = left ? mp.x - box.left - mw - 38 : mp.x - box.left + 38;
    x = Math.max(8, Math.min(box.width - mw - 8, x));
    const y = Math.max(54, Math.min(box.height - mh - 50, mp.y - box.top - mh / 2));
    menu.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    menu.classList.toggle('from-left', left);
    const cw = chip.offsetWidth || 120;
    const ch = chip.offsetHeight || 50;
    const topEdge = top.offsetTop + top.offsetHeight + 6;
    let cx = fp.x - box.left - cw / 2;
    let cy = fp.y - box.top - ch - 6;
    if (cy < topEdge) {
      // Sem espaço acima da cabeça (barra do Duelo): a ficha vai para o lado do adversário, longe do menu.
      const side = renderer.playerScreen(foe.id, 34);
      cx = left ? side.x - box.left + 34 : side.x - box.left - cw - 34;
      cy = Math.max(topEdge, side.y - box.top - ch / 2);
    }
    cx = Math.max(8, Math.min(box.width - cw - 8, cx));
    chip.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
    raf = requestAnimationFrame(place);
  };

  const prepareTempo = () => {
    aiChoice = null;
    shownFoe = null;
    if (cs.exposed === playerSide) {
      order = 'jogadorPrimeiro';
      notice = 'Você está desequilibrado: o adversário vai ver a sua escolha.';
    } else if (cs.exposed === aiSide) {
      aiChoice = chooseLance(s, cs, aiSide, memory, null, difficulty);
      order = 'iaRevelada';
      shownFoe = aiChoice;
      notice = `${foe.name} está desequilibrado: vai de ${lanceName(cs, aiSide, aiChoice)}.`;
    } else if (cs[aiSide].readsLeft > 0 && useRead(cs, aiSide)) {
      order = 'jogadorPrimeiro';
      notice = `${foe.name} leu o lance: vai ver a sua escolha.`;
    } else {
      order = 'simultaneo';
      notice = 'Escolham ao mesmo tempo.';
    }
  };

  const options = (): (Lance | 'ler')[] => {
    const list: (Lance | 'ler')[] = [...ORDER];
    if (cs[playerSide].readsLeft > 0 && order === 'simultaneo') list.push('ler');
    return list;
  };
  const enabled = (o: Lance | 'ler') => (o === 'ler' ? true : canPlay(s, cs, playerSide, o));

  const renderTop = () => {
    clear(top);
    const track = [];
    for (let t = 1; t <= TEMPOS; t++) track.push(h('i', { class: t < cs.tempo || cs.done ? 'past' : t === cs.tempo ? 'on' : '' }, String(t)));
    const v = (k: SideKey) => {
      const p = sidePlayer(s, cs, k);
      return h('span', { class: `dv ${p.team}` }, `${p.name}${cs.ball === k ? ' ⚽' : ''} `, h('b', {}, `★${cs[k].vantage}`));
    };
    top.append(
      h('div', { class: 'dt-head' }, h('b', {}, KIND_TITLE[cs.kind].replace('!', '')), h('span', {}, sideText), h('div', { class: 'dt-track' }, track)),
      h('div', { class: 'dt-score' }, v('atk'), h('span', { class: 'x' }, '×'), v('def')),
      h('div', { class: 'dt-notice' }, notice),
    );
  };

  const renderChip = () => {
    clear(chip);
    const side = cs[aiSide];
    const pips = [];
    for (let i = 0; i < side.lances; i++) pips.push(h('i', { class: i >= side.lancesLeft ? 'used' : '' }));
    for (let i = 0; i < side.readsLeft; i++) pips.push(h('i', { class: 'read' }));
    chip.append(
      h('div', { class: 'fc-name' }, `${foe.name} · ${ROLES[foe.role].name}`),
      h('div', { class: 'fc-pips' }, pips),
      h(
        'div',
        { class: `fc-choice${shownFoe ? ' shown' : ''}`, style: shownFoe ? `--c:${COLOR[shownFoe]}` : '' },
        shownFoe ? `${ICON[shownFoe]} ${lanceName(cs, aiSide, shownFoe)}` : cs.done ? '' : locked ? '…' : '?',
      ),
    );
  };

  const renderMenu = () => {
    clear(menu);
    if (cs.done || locked) {
      menu.classList.add('hidden');
      return;
    }
    menu.classList.remove('hidden');
    const mine = cs.ball === playerSide ? 'bola' : 'marca';
    const list = options();
    if (!enabled(list[focus])) focus = list.findIndex(enabled);
    const side = cs[playerSide];
    menu.append(
      ...[
        h(
          'div',
          { class: 'dm-head' },
          h('b', {}, me.name),
          h('span', {}, ` · ${cs.ball === playerSide ? 'com a bola' : 'marcando'} · ${side.lancesLeft} lance${side.lancesLeft === 1 ? '' : 's'}`),
        ),
        list.map((o, i) =>
          h(
            'button',
            {
              class: `lance-btn${i === focus ? ' focus' : ''}`,
              style: `--i:${i};--c:${o === 'ler' ? '#7dff9a' : COLOR[o]}`,
              disabled: !enabled(o),
              'data-opt': o,
              onmouseenter: () => {
                if (focus === i) return;
                focus = i;
                menu.querySelectorAll('.lance-btn').forEach((b, j) => b.classList.toggle('focus', j === i));
              },
              onclick: () => choose(o),
            },
            h('span', { class: 'ic' }, o === 'ler' ? '👁' : ICON[o]),
            h(
              'span',
              { class: 'tx' },
              h('b', {}, h('kbd', {}, o === 'ler' ? 'L' : String(i + 1)), o === 'ler' ? `Leitura (${side.readsLeft})` : lanceName(cs, playerSide, o)),
              h('small', {}, o === 'ler' ? 'veja o lance dele antes de escolher' : BEATS[mine][o]),
            ),
          ),
        ),
      ].flat(),
    );
  };

  const render = () => {
    renderTop();
    renderChip();
    renderMenu();
  };

  let finish: () => void = () => {};
  const finished = new Promise<void>((r) => (finish = r));

  const resultText = (): [string, string] => {
    if (cs.foul) return ['FALTA!', '#ffe14d'];
    const b = cs[cs.ball].vantage;
    const m = cs[otherSide(cs.ball)].vantage;
    if (m > b) return [`${sidePlayer(s, cs, otherSide(cs.ball)).name.toUpperCase()} ROUBA!`, '#ff9a6a'];
    if (b > m && cs.ball === 'atk') return [`${sidePlayer(s, cs, cs.ball).name.toUpperCase()} PASSA!`, '#7dff9a'];
    return [`${sidePlayer(s, cs, cs.ball).name.toUpperCase()} SEGURA`, '#8fc4ff'];
  };

  const read = () => {
    if (locked || order !== 'simultaneo' || !useRead(cs, playerSide)) return;
    aiChoice = chooseLance(s, cs, aiSide, memory, null, difficulty);
    order = 'iaRevelada';
    shownFoe = aiChoice;
    notice = `Leitura: ${foe.name} vai de ${lanceName(cs, aiSide, aiChoice)}.`;
    focus = 0;
    render();
  };

  const choose = async (o: Lance | 'ler') => {
    if (locked || cs.done || !enabled(o)) return;
    if (o === 'ler') return read();
    locked = true;
    // O botão escolhido pulsa e voa na direção do adversário; os outros somem.
    menu.querySelectorAll<HTMLButtonElement>('.lance-btn').forEach((b) => {
      b.disabled = true;
      b.classList.add(b.dataset.opt === o ? 'chosen' : 'gone');
    });
    if (order === 'jogadorPrimeiro') aiChoice = chooseLance(s, cs, aiSide, memory, o, difficulty);
    else if (aiChoice === null) aiChoice = chooseLance(s, cs, aiSide, memory, null, difficulty);
    memory[o]++;
    await sleep(300);
    shownFoe = aiChoice;
    renderChip();
    menu.classList.add('hidden');
    const a = playerSide === 'atk' ? o : aiChoice;
    const d = playerSide === 'def' ? o : aiChoice;
    const r = resolveTempo(s, cs, a, d);
    await renderer.duelTempo(r, atk.id, def.id, cs.ball, { atk: lanceName(cs, 'atk', r.atk), def: lanceName(cs, 'def', r.def) });
    notice = r.text;
    renderTop();
    if (cs.done) {
      const [text, color] = resultText();
      renderer.duelResult(text, color);
      notice = '';
      renderTop();
      renderChip();
      await sleep(850);
      finish();
      return;
    }
    await sleep(250);
    prepareTempo();
    locked = false;
    focus = 0;
    render();
  };

  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('.modal-bg')) return;
    const list = options();
    const keys: Record<string, Lance> = { '1': 'golpe', '2': 'guarda', '3': 'finta', '4': 'esperar' };
    if (keys[e.key]) {
      e.preventDefault();
      void choose(keys[e.key]);
    } else if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      read();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (locked) return;
      const step = e.key === 'ArrowUp' ? -1 : 1;
      for (let k = 1; k <= list.length; k++) {
        const j = (focus + step * k + list.length * 4) % list.length;
        if (enabled(list[j])) {
          focus = j;
          break;
        }
      }
      menu.querySelectorAll('.lance-btn').forEach((b, j) => b.classList.toggle('focus', j === focus));
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      void choose(list[focus]);
    }
  };

  host.append(hud);
  document.addEventListener('keydown', onKey);
  render();
  raf = requestAnimationFrame(place);
  // Efeito de início: clarão, linhas de velocidade e zoom nos dois.
  await renderer.startDuel(atk.id, def.id, KIND_TITLE[cs.kind], `${atk.name} × ${def.name} · ${sideText}`);
  prepareTempo();
  locked = false;
  render();
  await finished;
  document.removeEventListener('keydown', onKey);
  cancelAnimationFrame(raf);
  hud.classList.add('out');
  await sleep(180);
  hud.remove();
}
