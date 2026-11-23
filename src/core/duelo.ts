// O Duelo: drible contra desarme, o Confronto do futsal.
// Mesmos lances e mesma regra de quem vence quem; cada tempo vencido dá vantagem,
// e quem terminar com mais vantagem fica com a bola.

import { LANCE_FOL, MAX_LANCES, ROLES, TEMPOS, TIRED_FOL, WEIGHT_RANK } from './data';
import { approachSide, chebyshev, getPlayer } from './court';
import type { GameState, Player, Weight } from './types';

export type Lance = 'golpe' | 'guarda' | 'finta' | 'esperar';
export const LANCES: readonly Lance[] = ['golpe', 'guarda', 'finta', 'esperar'];
export type SideKey = 'atk' | 'def';
export const otherSide = (k: SideKey): SideKey => (k === 'atk' ? 'def' : 'atk');

/** Nome do lance para quem está com a bola e para quem está sem. */
export const LANCE_NAME: Record<'bola' | 'marca', Record<Lance, string>> = {
  bola: { golpe: 'Arrancada', guarda: 'Proteger', finta: 'Finta', esperar: 'Cadenciar' },
  marca: { golpe: 'Bote', guarda: 'Fechar', finta: 'Simular bote', esperar: 'Recuar' },
};

export interface DuelSide {
  playerId: string;
  lances: number;
  lancesLeft: number;
  readsLeft: number;
  vantage: number;
  notes: string[];
}

export interface TempoResult {
  tempo: number;
  atk: Lance;
  def: Lance;
  atkGain: number;
  defGain: number;
  exposed: SideKey | null;
  foul: boolean;
  text: string;
}

/** `bote` = bote automático de um defensor de prontidão, na fase do adversário. */
export type DuelKind = 'drible' | 'desarme' | 'carrinho' | 'dividida' | 'bote';

export interface DuelState {
  kind: DuelKind;
  atk: DuelSide;
  def: DuelSide;
  /** Lado que está com a bola. */
  ball: SideKey;
  /** Por onde quem inicia chega no alvo. */
  side: 'frente' | 'flanco' | 'costas';
  tempo: number;
  exposed: SideKey | null;
  results: TempoResult[];
  foul: boolean;
  done: boolean;
}

export function lanceName(cs: DuelState, k: SideKey, l: Lance): string {
  return LANCE_NAME[cs.ball === k ? 'bola' : 'marca'][l];
}

const weightOf = (p: Player): Weight => ROLES[p.role].weight;

function cap(n: number, reads: number, notes: string[]): { lances: number; reads: number } {
  const lances = Math.max(1, Math.min(MAX_LANCES, n));
  const extra = Math.max(0, n - MAX_LANCES);
  if (extra) notes.push(`${extra} lance(s) acima de 3 vira(m) Leitura`);
  return { lances, reads: reads + extra };
}

/** Marcadores colados (e equilibrados) em volta de um jogador. */
export function markers(s: GameState, p: Player): Player[] {
  return s.players.filter((q) => q.team !== p.team && !q.unbalanced && q.role !== 'goleiro' && chebyshev(q, p) === 1);
}

/** Lances pelo atributo (Domínio com a bola, Marcação sem ela): 5 → 3, 3–4 → 2, 1–2 → 1. */
export const attrLances = (v: number): number => (v >= 5 ? 3 : v >= 3 ? 2 : 1);

/**
 * Lances pela diferença entre o meu atributo e o do outro (Domínio de quem tem a bola contra a
 * Marcação de quem marca): 2 ou mais acima → 3; até 1 de diferença → 2; 2 ou mais abaixo → 1.
 */
export const diffLances = (mine: number, theirs: number): number => {
  const d = mine - theirs;
  return d >= 2 ? 3 : d >= -1 ? 2 : 1;
};

export function startDuel(s: GameState, kind: DuelKind, initiatorId: string, targetId: string): DuelState {
  const a = getPlayer(s, initiatorId);
  const d = getPlayer(s, targetId);
  const ball: SideKey = s.holder === a.id ? 'atk' : 'def';
  const side = approachSide(d, a);
  const sides = (['atk', 'def'] as const).map((k) => {
    const p = k === 'atk' ? a : d;
    const q = k === 'atk' ? d : a;
    // Com a bola, os lances vêm do Domínio contra a Marcação de quem marca; sem ela, o contrário.
    const withBall = ball === k;
    const attr = withBall ? ROLES[p.role].dom : ROLES[p.role].mar;
    const vs = withBall ? ROLES[q.role].mar : ROLES[q.role].dom;
    let n = diffLances(attr, vs);
    const notes = [`${withBall ? 'Domínio' : 'Marcação'} ${attr} contra ${withBall ? 'Marcação' : 'Domínio'} ${vs}: ${n} lance${n > 1 ? 's' : ''}`];
    let reads = 0;
    if ((k === 'def' || kind === 'bote') && p.ready) {
      n += 1;
      notes.push(kind === 'bote' && k === 'atk' ? 'Bote de prontidão +1' : 'Prontidão +1');
    }
    if (kind === 'carrinho' && k === 'atk') {
      n += 1;
      notes.push('Carrinho +1');
    }
    if (p.fol < TIRED_FOL) {
      n -= 1;
      notes.push('Cansado −1');
    }
    if (ball === k) {
      const m = markers(s, p).length;
      if (m >= 3) {
        n -= 1;
        notes.push(`Cercado por ${m} −1`);
      }
    }
    if (p.pedalada) {
      reads += 1;
      notes.push('Pedalada: 1 Leitura, Finta sem HAB');
    }
    const c = cap(n, reads, notes);
    return { playerId: p.id, lances: c.lances, lancesLeft: c.lances, readsLeft: c.reads, vantage: 0, notes } satisfies DuelSide;
  });
  d.ready = false;
  if (kind === 'bote') a.ready = false;
  // A posse é de quem está com ela: em desarme, carrinho ou bola dividida, quem tem a bola sai com 1 de vantagem.
  if (kind !== 'drible') {
    sides[ball === 'atk' ? 0 : 1].vantage = 1;
    sides[ball === 'atk' ? 0 : 1].notes.push('Posse: começa com 1 de vantagem');
  }
  return { kind, atk: sides[0], def: sides[1], ball, side, tempo: 1, exposed: null, results: [], foul: false, done: false };
}

export function sidePlayer(s: GameState, cs: DuelState, k: SideKey): Player {
  return getPlayer(s, cs[k].playerId);
}

/** O lado ainda pode gastar um lance (tem lance e fôlego)? */
export function canSpend(s: GameState, cs: DuelState, k: SideKey): boolean {
  const p = sidePlayer(s, cs, k);
  return cs[k].lancesLeft > 0 && p.fol >= LANCE_FOL[weightOf(p)];
}

/** Pode fintar: lance, fôlego e 1 de HAB (ou Pedalada ativa). */
export function canFinta(s: GameState, cs: DuelState, k: SideKey): boolean {
  const p = sidePlayer(s, cs, k);
  return canSpend(s, cs, k) && (p.hab >= 1 || p.pedalada);
}

export function canPlay(s: GameState, cs: DuelState, k: SideKey, l: Lance): boolean {
  if (l === 'esperar') return true;
  if (l === 'finta') return canFinta(s, cs, k);
  return canSpend(s, cs, k);
}

export function useRead(cs: DuelState, k: SideKey): boolean {
  if (cs[k].readsLeft <= 0) return false;
  cs[k].readsLeft--;
  return true;
}

export interface Clash {
  aGain: number;
  bGain: number;
  exposeA: boolean;
  exposeB: boolean;
  why: string;
}

const NONE = (why: string): Clash => ({ aGain: 0, bGain: 0, exposeA: false, exposeB: false, why });

function ordered(a: Lance, b: Lance, wa: Weight, wb: Weight): Clash | null {
  if (a === 'golpe' && b === 'golpe') {
    const ra = WEIGHT_RANK[wa];
    const rb = WEIGHT_RANK[wb];
    if (ra === rb) return { aGain: 1, bGain: 1, exposeA: false, exposeB: false, why: 'Choque: os dois vão com tudo.' };
    return { aGain: ra > rb ? 2 : 1, bGain: rb > ra ? 2 : 1, exposeA: false, exposeB: false, why: 'Choque: o mais pesado leva a melhor.' };
  }
  if (a === 'golpe' && b === 'guarda') return { aGain: 0, bGain: 1, exposeA: false, exposeB: false, why: 'Quem se posicionou absorve a investida.' };
  if (a === 'golpe' && b === 'finta') return { aGain: 1, bGain: 0, exposeA: false, exposeB: false, why: 'A investida direta corta a finta.' };
  if (a === 'golpe' && b === 'esperar') return NONE('Quem espera deixa a investida passar no vazio.');
  if (a === 'guarda' && b === 'guarda') return NONE('Os dois se estudam.');
  if (a === 'guarda' && b === 'finta') return { aGain: 0, bGain: 1, exposeA: true, exposeB: false, why: 'A finta tira quem estava parado do lugar.' };
  if (a === 'guarda' && b === 'esperar') return NONE('Ninguém arrisca.');
  if (a === 'finta' && b === 'finta') return NONE('Finta contra finta: ninguém cai.');
  if (a === 'finta' && b === 'esperar') return { aGain: 1, bGain: 0, exposeA: false, exposeB: true, why: 'A finta pega quem esperava e o desequilibra.' };
  if (a === 'esperar' && b === 'esperar') return NONE('Os dois esperam.');
  return null;
}

export function clash(a: Lance, b: Lance, wa: Weight, wb: Weight): Clash {
  const direct = ordered(a, b, wa, wb);
  if (direct) return direct;
  const r = ordered(b, a, wb, wa)!;
  return { aGain: r.bGain, bGain: r.aGain, exposeA: r.exposeB, exposeB: r.exposeA, why: r.why };
}

/**
 * Bônus por tempo vencido: o pesado que protege a bola com o corpo vale o dobro.
 */
export function duelBonus(cs: DuelState, k: SideKey, p: Player, l: Lance): number {
  const def = ROLES[p.role];
  let b = 0;
  if (cs.ball === k && l === 'guarda' && def.weight === 'pesado') b++;
  return b;
}

/** Resolve o tempo. Lances impossíveis viram "esperar". */
export function resolveTempo(s: GameState, cs: DuelState, atkChoice: Lance, defChoice: Lance): TempoResult {
  if (cs.done) throw new Error('Duelo já terminou');
  const pa = sidePlayer(s, cs, 'atk');
  const pd = sidePlayer(s, cs, 'def');
  const a: Lance = canPlay(s, cs, 'atk', atkChoice) ? atkChoice : 'esperar';
  const d: Lance = canPlay(s, cs, 'def', defChoice) ? defChoice : 'esperar';
  for (const [k, l, p] of [
    ['atk', a, pa],
    ['def', d, pd],
  ] as const) {
    if (l === 'esperar') {
      // Esperar recupera 1 de fôlego e dá uma Leitura para o próximo tempo.
      p.fol = Math.min(ROLES[p.role].fol, p.fol + 1);
      if (cs[k].readsLeft < 2) cs[k].readsLeft++;
      continue;
    }
    cs[k].lancesLeft--;
    p.fol -= LANCE_FOL[weightOf(p)];
    if (l === 'finta' && !p.pedalada) p.hab -= 1;
  }
  const c = clash(a, d, weightOf(pa), weightOf(pd));
  let atkGain = c.aGain + (c.aGain > 0 ? duelBonus(cs, 'atk', pa, a) : 0);
  const defGain = c.bGain + (c.bGain > 0 ? duelBonus(cs, 'def', pd, d) : 0);
  // Bote pelas costas: vale 1 a mais se der certo, e é falta se não der.
  const markSide = otherSide(cs.ball);
  const markLance = markSide === 'atk' ? a : d;
  const ballLance = cs.ball === 'atk' ? a : d;
  const markGain = markSide === 'atk' ? atkGain : defGain;
  let foul = false;
  if (markLance === 'golpe') {
    if (markSide === 'atk' && cs.side === 'costas') {
      if (markGain > 0) atkGain += 1;
      else foul = true;
    }
    if (ballLance === 'guarda' && !(cs.kind === 'carrinho' && cs.side !== 'costas')) foul = true;
  }
  cs.atk.vantage += atkGain;
  cs.def.vantage += defGain;
  const exposed: SideKey | null = c.exposeA ? 'atk' : c.exposeB ? 'def' : null;
  const text = `Tempo ${cs.tempo}: ${lanceName(cs, 'atk', a)} × ${lanceName(cs, 'def', d)}. ${foul ? 'Falta!' : c.why}`;
  const r: TempoResult = { tempo: cs.tempo, atk: a, def: d, atkGain, defGain, exposed, foul, text };
  cs.results.push(r);
  s.log.push(`  ${text}`);
  cs.exposed = exposed;
  cs.tempo++;
  if (foul) cs.foul = true;
  if (foul || cs.tempo > TEMPOS || (cs.atk.lancesLeft <= 0 && cs.def.lancesLeft <= 0)) cs.done = true;
  return r;
}

export type DuelOutcome = 'passou' | 'roubou' | 'manteve' | 'falta';

/** Quem ficou com a bola, do ponto de vista de quem a tinha. */
export function duelOutcome(cs: DuelState): DuelOutcome {
  if (cs.foul) return 'falta';
  const ballV = cs[cs.ball].vantage;
  const markV = cs[otherSide(cs.ball)].vantage;
  if (markV > ballV) return 'roubou';
  if (ballV > markV && cs.ball === 'atk') return 'passou';
  return 'manteve';
}
