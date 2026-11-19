// O Confronto: duelo corpo a corpo de 3 tempos.
// Velocidade de reação = número de lances (Leve 3, Médio 2, Pesado 1).
// Quem não joga lance num tempo fica em Recuperação ("esperar").

import { BASE_LANCES, CLASH_TIE, CLASSES, FORCA, LANCE_COST, MAX_LANCES, SIDE_BONUS, TEMPOS, WEIGHT_RANK, XP_HIT } from './data';
import { consumeOil, effectiveArmor, grantXp, hitUnit, log, rawDamage, unitAtq, unitName } from './combat';
import { attackSide, dirFromTo, getUnit, terrainAt } from './grid';
import type { Side } from './grid';
import type { GameState, Unit, Weight } from './types';

export type Lance = 'golpe' | 'guarda' | 'finta' | 'esperar';
export const LANCES: readonly Lance[] = ['golpe', 'guarda', 'finta', 'esperar'];
export const LANCE_LABEL: Record<Lance, string> = {
  golpe: 'Golpe',
  guarda: 'Guarda',
  finta: 'Finta',
  esperar: 'Esperar',
};

export type SideKey = 'atk' | 'def';
export const otherSide = (k: SideKey): SideKey => (k === 'atk' ? 'def' : 'atk');

export interface ConfrontoSide {
  unitId: string;
  lances: number;
  lancesLeft: number;
  /** Leituras: lances acima do máximo viram "ver o lance do oponente antes de escolher". */
  readsLeft: number;
  notes: string[];
}

export interface TempoResult {
  tempo: number;
  atk: Lance;
  def: Lance;
  /** Dano que cada lado recebeu neste tempo. */
  atkTook: number;
  defTook: number;
  exposed: SideKey | null;
  text: string;
}

export interface ConfrontoState {
  atk: ConfrontoSide;
  def: ConfrontoSide;
  side: Side;
  /** Tempo atual, de 1 a 3. */
  tempo: number;
  /** Lado Exposto neste tempo: precisa escolher primeiro, e o outro vê. */
  exposed: SideKey | null;
  results: TempoResult[];
  done: boolean;
}

export interface LanceCount {
  lances: number;
  reads: number;
  notes: string[];
}

function cap(n: number, notes: string[]): LanceCount {
  const lances = Math.max(1, Math.min(MAX_LANCES, n));
  const reads = Math.max(0, n - MAX_LANCES);
  if (reads > 0) notes.push(`${reads} lance(s) acima de 3 vira(m) Leitura`);
  return { lances, reads, notes };
}

function mudPenalty(s: GameState, u: Unit, notes: string[]): number {
  const w = CLASSES[u.cls].weight;
  if (terrainAt(s, u.x, u.y) === 'lama' && w !== 'leve') {
    notes.push('Lama −1');
    return -1;
  }
  return 0;
}

/** Quantos lances cada lado terá, com os modificadores do GDD. */
export function countLances(
  s: GameState,
  attacker: Unit,
  defender: Unit,
  bonusLances = 0,
): { atk: LanceCount; def: LanceCount; side: Side } {
  const wa = CLASSES[attacker.cls].weight;
  const wd = CLASSES[defender.cls].weight;
  const side = attackSide(defender, attacker);

  const atkNotes = [`${wa === 'medio' ? 'Médio' : wa === 'leve' ? 'Leve' : 'Pesado'} ${BASE_LANCES[wa]}`];
  let a = BASE_LANCES[wa];
  if (bonusLances) {
    a += bonusLances;
    atkNotes.push(`Habilidade +${bonusLances}`);
  }
  let sideReads = 0;
  const sideBonus = side === 'flanco' ? SIDE_BONUS.flanco : side === 'costas' ? SIDE_BONUS.costas : 0;
  if (sideBonus && SIDE_BONUS.mode === 'lances') {
    a += sideBonus;
    atkNotes.push(`${side === 'flanco' ? 'Flanco' : 'Costas'} +${sideBonus}`);
  } else if (sideBonus) {
    sideReads = sideBonus;
    atkNotes.push(`${side === 'flanco' ? 'Flanco' : 'Costas'}: ${sideBonus} Leitura${sideBonus > 1 ? 's' : ''}`);
  }
  a += mudPenalty(s, attacker, atkNotes);
  if (attacker.focus) {
    a += 1;
    atkNotes.push('Foco +1');
  }

  const defNotes = [`${wd === 'medio' ? 'Médio' : wd === 'leve' ? 'Leve' : 'Pesado'} ${BASE_LANCES[wd]}`];
  let d = BASE_LANCES[wd];
  if (defender.ready) {
    d += 1;
    defNotes.push('Prontidão +1');
  }
  if (terrainAt(s, defender.x, defender.y) === 'colina' && terrainAt(s, attacker.x, attacker.y) !== 'colina') {
    d += 1;
    defNotes.push('Colina +1');
  }
  d += mudPenalty(s, defender, defNotes);
  if (defender.focus) {
    d += 1;
    defNotes.push('Foco +1');
  }

  const atk = cap(a, atkNotes);
  atk.reads += sideReads;
  return { atk, def: cap(d, defNotes), side };
}

export interface ConfrontoBonus {
  lances?: number;
  atq?: number;
}

export function startConfronto(s: GameState, attackerId: string, defenderId: string, bonus: ConfrontoBonus = {}): ConfrontoState {
  const attacker = getUnit(s, attackerId);
  const defender = getUnit(s, defenderId);
  const c = countLances(s, attacker, defender, bonus.lances ?? 0);
  // Prontidão e Foco são gastos no Confronto; o Óleo só vale para quem ataca.
  defender.ready = false;
  attacker.focus = false;
  defender.focus = false;
  attacker.tempAtq = (bonus.atq ?? 0) + consumeOil(attacker);
  defender.tempAtq = 0;
  log(
    s,
    `Confronto: ${unitName(attacker)} (${c.atk.lances} lance${c.atk.lances > 1 ? 's' : ''}) ataca ${unitName(defender)} (${c.def.lances}) pelo ${c.side}.`,
  );
  return {
    atk: { unitId: attackerId, lances: c.atk.lances, lancesLeft: c.atk.lances, readsLeft: c.atk.reads, notes: c.atk.notes },
    def: { unitId: defenderId, lances: c.def.lances, lancesLeft: c.def.lances, readsLeft: c.def.reads, notes: c.def.notes },
    side: c.side,
    tempo: 1,
    exposed: null,
    results: [],
    done: false,
  };
}

export function sideUnit(s: GameState, cs: ConfrontoState, k: SideKey): Unit {
  return getUnit(s, cs[k].unitId);
}

/** O lado ainda pode jogar um lance (tem lance e Stamina)? */
export function canSpend(s: GameState, cs: ConfrontoState, k: SideKey): boolean {
  const u = sideUnit(s, cs, k);
  return u.alive && cs[k].lancesLeft > 0 && u.stamina >= LANCE_COST[CLASSES[u.cls].weight];
}

/** Gasta uma Leitura: neste tempo o oponente escolhe primeiro. */
export function useRead(cs: ConfrontoState, k: SideKey): boolean {
  if (cs[k].readsLeft <= 0) return false;
  cs[k].readsLeft--;
  return true;
}

interface Clash {
  /** Multiplicador do acerto de A em B (0 = não acerta). */
  aHit: number;
  bHit: number;
  exposeA: boolean;
  exposeB: boolean;
  why: string;
}

const NONE = (why: string): Clash => ({ aHit: 0, bHit: 0, exposeA: false, exposeB: false, why });

function ordered(a: Lance, b: Lance, wa: Weight, wb: Weight): Clash | null {
  if (a === 'golpe' && b === 'golpe') {
    const ra = WEIGHT_RANK[wa];
    const rb = WEIGHT_RANK[wb];
    if (ra === rb) return { aHit: CLASH_TIE.even, bHit: CLASH_TIE.even, exposeA: false, exposeB: false, why: 'Golpe contra Golpe: os dois acertam.' };
    return {
      aHit: ra > rb ? CLASH_TIE.heavier : CLASH_TIE.lighter,
      bHit: rb > ra ? CLASH_TIE.heavier : CLASH_TIE.lighter,
      exposeA: false,
      exposeB: false,
      why: 'Golpe contra Golpe: os dois acertam, o mais pesado com mais força.',
    };
  }
  if (a === 'golpe' && b === 'guarda') return { aHit: 0, bHit: 0.8, exposeA: false, exposeB: false, why: 'A Guarda bloqueia o Golpe e contra-ataca.' };
  if (a === 'golpe' && b === 'finta') return { aHit: 2.0, bHit: 0, exposeA: false, exposeB: false, why: 'O Golpe pune a Finta.' };
  if (a === 'golpe' && b === 'esperar') return NONE('A Recuperação bloqueia o Golpe.');
  if (a === 'guarda' && b === 'guarda') return NONE('Guarda contra Guarda: nada acontece.');
  if (a === 'guarda' && b === 'finta') return { aHit: 0, bHit: 1.5, exposeA: true, exposeB: false, why: 'A Finta quebra a Guarda e deixa o oponente Exposto.' };
  if (a === 'guarda' && b === 'esperar') return NONE('Ninguém ataca.');
  if (a === 'finta' && b === 'finta') return NONE('Finta contra Finta: nada acontece.');
  if (a === 'finta' && b === 'esperar') return { aHit: 1.5, bHit: 0, exposeA: false, exposeB: true, why: 'A Finta pega quem está em Recuperação e o deixa Exposto.' };
  if (a === 'esperar' && b === 'esperar') return NONE('Os dois esperam.');
  return null;
}

export function clash(a: Lance, b: Lance, wa: Weight, wb: Weight): Clash {
  const direct = ordered(a, b, wa, wb);
  if (direct) return direct;
  const r = ordered(b, a, wb, wa)!;
  return { aHit: r.bHit, bHit: r.aHit, exposeA: r.exposeB, exposeB: r.exposeA, why: r.why };
}

/** Dano que um acerto com este multiplicador causaria. */
export function hitDamage(s: GameState, from: Unit, to: Unit, mult: number): number {
  return rawDamage(unitAtq(from), mult * FORCA[CLASSES[from.cls].weight], effectiveArmor(s, to));
}

/** Resolve o tempo atual com as duas escolhas. Escolhas impossíveis viram "esperar". */
export function resolveTempo(s: GameState, cs: ConfrontoState, atkChoice: Lance, defChoice: Lance): TempoResult {
  if (cs.done) throw new Error('Confronto já terminou');
  const atkU = sideUnit(s, cs, 'atk');
  const defU = sideUnit(s, cs, 'def');
  const a: Lance = atkChoice !== 'esperar' && !canSpend(s, cs, 'atk') ? 'esperar' : atkChoice;
  const d: Lance = defChoice !== 'esperar' && !canSpend(s, cs, 'def') ? 'esperar' : defChoice;

  for (const [k, choice, u] of [
    ['atk', a, atkU],
    ['def', d, defU],
  ] as const) {
    if (choice !== 'esperar') {
      cs[k].lancesLeft--;
      u.stamina -= LANCE_COST[CLASSES[u.cls].weight];
    }
  }

  const c = clash(a, d, CLASSES[atkU.cls].weight, CLASSES[defU.cls].weight);
  const toDef = c.aHit > 0 ? hitDamage(s, atkU, defU, c.aHit) : 0;
  const toAtk = c.bHit > 0 ? hitDamage(s, defU, atkU, c.bHit) : 0;
  hitUnit(s, defU, toDef, atkU);
  hitUnit(s, atkU, toAtk, defU);

  const exposed: SideKey | null = c.exposeA ? 'atk' : c.exposeB ? 'def' : null;
  const parts = [`Tempo ${cs.tempo}: ${LANCE_LABEL[a]} × ${LANCE_LABEL[d]}. ${c.why}`];
  if (toDef) parts.push(`${unitName(defU)} leva ${toDef}.`);
  if (toAtk) parts.push(`${unitName(atkU)} leva ${toAtk}.`);
  const result: TempoResult = { tempo: cs.tempo, atk: a, def: d, atkTook: toAtk, defTook: toDef, exposed, text: parts.join(' ') };
  cs.results.push(result);
  log(s, `  ${result.text}`);

  cs.exposed = exposed;
  cs.tempo++;
  if (cs.tempo > TEMPOS || !atkU.alive || !defU.alive) cs.done = true;
  return result;
}

/** Fecha o Confronto: os dois ficam virados um para o outro. */
export function finishConfronto(s: GameState, cs: ConfrontoState): void {
  const atkU = sideUnit(s, cs, 'atk');
  const defU = sideUnit(s, cs, 'def');
  if (atkU.alive) atkU.facing = dirFromTo(atkU, defU);
  if (defU.alive) defU.facing = dirFromTo(defU, atkU);
  const dealt = cs.results.reduce((n, r) => n + r.defTook, 0);
  const taken = cs.results.reduce((n, r) => n + r.atkTook, 0);
  atkU.tempAtq = 0;
  defU.tempAtq = 0;
  log(s, `Fim do Confronto: atacante causou ${dealt}, levou ${taken}.`);
  // Vencer o Confronto (causar mais dano do que levou) dá XP.
  if (dealt > taken) grantXp(s, atkU, XP_HIT);
  else if (taken > dealt) grantXp(s, defU, XP_HIT);
}
