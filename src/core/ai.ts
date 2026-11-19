// IA baseada em utilidade: dá nota a cada (unidade, casa, ação) e escolhe a melhor,
// com ruído conforme a dificuldade. No Confronto, joga uma estratégia mista
// que aprende com o histórico de lances do oponente.

import { aliveUnits, effectiveArmor, rawDamage, rangedDamage } from './combat';
import { BASE_MELEE_MULT, CLASSES, LANCE_COST, RUN_BONUS, RUN_COST, TERRAIN } from './data';
import { canStop, crossCells, dirFromTo, fromKey, getUnit, manhattan, reachable, terrainAt } from './grid';
import { nextRandom } from './rng';
import {
  attackArea,
  attackBaseMelee,
  attackMelee,
  attackRanged,
  attackRangedBase,
  baseMovement,
  beginActivation,
  endActivation,
  heal,
  moveTo,
  rotate,
  run,
  targetsFrom,
} from './game';
import type { Target } from './game';
import { canSpend, clash, countLances, finishConfronto, hitDamage, resolveTempo, sideUnit, useRead } from './confronto';
import type { ConfrontoState, Lance, SideKey } from './confronto';
import { otherTeam } from './types';
import type { GameState, Pos, Team, Unit } from './types';

export type Difficulty = 'recruta' | 'veterano';

interface Profile {
  /** Ruído somado à nota de cada jogada. */
  noise: number;
  /** Temperatura do softmax na escolha de lance. */
  temperature: number;
  /** Usa o histórico de lances do oponente. */
  learns: boolean;
  /** Chance de errar de propósito quando lê o oponente. */
  blunder: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  recruta: { noise: 7, temperature: 4, learns: false, blunder: 0.35 },
  veterano: { noise: 1.5, temperature: 1.2, learns: true, blunder: 0.05 },
};

/** Memória de lances do oponente (o jogador), acumulada na partida. */
export interface LanceMemory {
  golpe: number;
  guarda: number;
  finta: number;
}
export const newMemory = (): LanceMemory => ({ golpe: 0, guarda: 0, finta: 0 });

export interface Plan {
  unitId: string;
  run: boolean;
  moveTo: Pos | null;
  action: Target | null;
  score: number;
}

// ---------- Avaliação ----------

const unitValue = (u: Unit) => CLASSES[u.cls].atq + CLASSES[u.cls].hp / 4;

/** Dano que os inimigos de `team` poderiam causar a quem ficar em `cell` na próxima rodada. */
function threatAt(s: GameState, team: Team, cell: Pos, armor: number): number {
  let threat = 0;
  for (const e of aliveUnits(s, otherTeam(team))) {
    const d = CLASSES[e.cls];
    const reach = d.ranged ? d.ranged.max : 1;
    const dist = manhattan(e, cell);
    if (dist <= d.mov + reach) threat += Math.max(1, d.atq * 1.6 - armor);
  }
  return threat;
}

function strikeDanger(s: GameState, cell: Pos, armor: number): number {
  let danger = 0;
  for (const st of s.strikes) {
    if (st.cells.some((c) => c.x === cell.x && c.y === cell.y)) danger += rawDamage(st.atq, st.mult, armor);
  }
  return danger;
}

/** Estimativa grosseira do saldo de um Confronto iniciado de `from`. */
function estimateMelee(s: GameState, u: Unit, from: Pos, target: Unit): number {
  const ox = u.x;
  const oy = u.y;
  u.x = from.x;
  u.y = from.y;
  const c = countLances(s, u, target);
  const hitA = hitDamage(s, u, target, 1.75);
  const hitD = hitDamage(s, target, u, 1.75);
  u.x = ox;
  u.y = oy;
  const wa = CLASSES[u.cls].weight;
  const wd = CLASSES[target.cls].weight;
  const aL = Math.min(c.atk.lances, Math.floor(u.stamina / LANCE_COST[wa]));
  const dL = Math.min(c.def.lances, Math.floor(target.stamina / LANCE_COST[wd]));
  // Quem tem mais lances acerta mais; quem não tem lance apanha de Finta.
  const dealt = aL * 0.5 * hitA + Math.max(0, aL - dL) * 0.2 * hitA;
  const taken = dL * 0.5 * hitD;
  let score = dealt - taken * 0.8;
  if (dealt >= target.hp) score += 12 + unitValue(target);
  if (taken >= u.hp) score -= 15;
  return score;
}

function areaScore(s: GameState, u: Unit, from: Pos, x: number, y: number): number {
  const def = CLASSES[u.cls];
  const r = def.ranged!;
  const delayed = r.kind === 'morteiro';
  let score = 0;
  for (const c of crossCells(s, x, y)) {
    // A própria unidade estará em `from`.
    const isSelf = c.x === from.x && c.y === from.y;
    const occ = isSelf ? u : s.units.find((v) => v.alive && v.id !== u.id && v.x === c.x && v.y === c.y);
    if (occ) {
      const dmg = rawDamage(def.atq, r.mult, effectiveArmor(s, occ));
      if (occ.team === u.team) score -= dmg * (delayed ? 0.8 : 1.5);
      else score += (dmg + (dmg >= occ.hp ? 10 : 0)) * (delayed ? 0.55 : 1);
    }
    const eb = s.bases[otherTeam(u.team)];
    if (eb.x === c.x && eb.y === c.y) score += rawDamage(def.atq, r.mult, eb.armadura) * 1.6;
    const ob = s.bases[u.team];
    if (ob.x === c.x && ob.y === c.y) score -= 20;
  }
  return score;
}

function actionScore(s: GameState, u: Unit, from: Pos, t: Target): number {
  const def = CLASSES[u.cls];
  switch (t.kind) {
    case 'melee':
      return estimateMelee(s, u, from, getUnit(s, t.unitId));
    case 'meleeBase':
    case 'tiroBase': {
      const b = s.bases[t.team];
      const mult = t.kind === 'meleeBase' ? BASE_MELEE_MULT : def.ranged!.mult;
      const dmg = rawDamage(def.atq, mult, b.armadura);
      return dmg * 1.6 + (dmg >= b.hp ? 1000 : 0);
    }
    case 'tiro': {
      const target = getUnit(s, t.unitId);
      const dmg = rangedDamage(s, def.atq, def.ranged!.mult, target);
      return dmg * 1.1 + (dmg >= target.hp ? 12 + unitValue(target) : 0);
    }
    case 'area':
      return areaScore(s, u, from, t.x, t.y);
    case 'cura': {
      const target = getUnit(s, t.unitId);
      const missing = CLASSES[target.cls].hp - target.hp;
      return missing >= 4 ? Math.min(def.heal!.amount, missing) * 1.3 : 0;
    }
  }
}

function positionScore(s: GameState, u: Unit, c: Pos): number {
  const def = CLASSES[u.cls];
  const enemies = aliveUnits(s, otherTeam(u.team));
  const enemyBase = s.bases[otherTeam(u.team)];
  const ownBase = s.bases[u.team];
  let score = 0;

  const dEnemy = enemies.length ? Math.min(...enemies.map((e) => manhattan(c, e))) : 99;
  const dBase = manhattan(c, enemyBase);
  if (def.heal) {
    const allies = aliveUnits(s, u.team).filter((a) => a.id !== u.id);
    const dAlly = allies.length ? Math.min(...allies.map((a) => manhattan(c, a))) : 0;
    score -= Math.abs(dAlly - 2) * 0.6;
  } else if (def.ranged && !def.melee) {
    const ideal = def.ranged.kind === 'morteiro' ? 5 : def.ranged.kind === 'canhao' ? 6 : def.ranged.max - 1;
    score -= Math.abs(Math.min(dEnemy, dBase) - ideal) * 0.6;
  } else {
    score -= Math.min(dEnemy, dBase * 0.85) * 0.8;
  }

  // Defender a própria Base se houver inimigo perto dela.
  const raider = enemies.find((e) => manhattan(e, ownBase) <= 4);
  if (raider && def.melee) score -= manhattan(c, raider) * 0.5;

  const armor = CLASSES[u.cls].armadura + TERRAIN[terrainAt(s, c.x, c.y)].armorBonus;
  const fragility = 1 + (1 - u.hp / def.hp);
  score -= threatAt(s, u.team, c, armor) * 0.12 * fragility;
  score -= strikeDanger(s, c, armor) * 1.2;
  const terr = TERRAIN[terrainAt(s, c.x, c.y)];
  if (terr.cover) score += 0.8;
  if (terrainAt(s, c.x, c.y) === 'colina' && def.ranged) score += 0.6;
  // Encostar na Base inimiga custa a torreta.
  if (manhattan(c, enemyBase) === 1) score -= 3;
  return score;
}

export function planActivation(s: GameState, team: Team, difficulty: Difficulty): Plan | null {
  const prof = PROFILES[difficulty];
  let best: Plan | null = null;
  for (const u of aliveUnits(s, team).filter((v) => !v.activated)) {
    const mp = baseMovement(u);
    const canRunNow = u.stamina >= RUN_COST + 2;
    const reach = reachable(s, u, mp + (canRunNow ? RUN_BONUS : 0));
    for (const [k, node] of reach) {
      const c = fromKey(s, k);
      if (!canStop(s, u, c.x, c.y)) continue;
      const needsRun = node.cost > mp;
      const moved = c.x !== u.x || c.y !== u.y;
      const pos = positionScore(s, u, c) - (needsRun ? 1.5 : 0);
      const targets = targetsFrom(s, u, c, { moved });
      // Para alvos em área, avaliar só casas com alguém ou a Base (o resto vale 0).
      const options: (Target | null)[] = [null];
      for (const t of targets) {
        if (t.kind === 'area') {
          const near = s.units.some((v) => v.alive && manhattan(v, t) <= 1) || manhattan(s.bases[otherTeam(team)], t) <= 1;
          if (!near) continue;
        }
        options.push(t);
      }
      for (const t of options) {
        const act = t ? actionScore(s, u, c, t) : 0;
        if (t && act <= 0) continue;
        const score = act + pos + (nextRandom(s) - 0.5) * prof.noise;
        if (!best || score > best.score) {
          best = { unitId: u.id, run: needsRun, moveTo: moved ? c : null, action: t, score };
        }
      }
    }
  }
  return best;
}

// ---------- Confronto ----------

const BEATS: Record<Lance, Lance> = { golpe: 'guarda', guarda: 'finta', finta: 'golpe', esperar: 'finta' };

/** Lances que o lado ainda consegue pagar. */
function effectiveLances(s: GameState, cs: ConfrontoState, k: SideKey): number {
  const u = sideUnit(s, cs, k);
  return Math.min(cs[k].lancesLeft, Math.floor(u.stamina / LANCE_COST[CLASSES[u.cls].weight]));
}

export function chooseLance(
  s: GameState,
  cs: ConfrontoState,
  k: SideKey,
  seen: Lance | null,
  difficulty: Difficulty,
  memory: LanceMemory | null,
): Lance {
  const prof = PROFILES[difficulty];
  if (!canSpend(s, cs, k)) return 'esperar';
  const opp: SideKey = k === 'atk' ? 'def' : 'atk';

  if (seen) {
    if (nextRandom(s) >= prof.blunder) {
      const answer = BEATS[seen];
      // Contra Golpe, Esperar também bloqueia e economiza o lance.
      if (seen === 'golpe' && effectiveLances(s, cs, k) < 4 - cs.tempo) return 'esperar';
      return answer;
    }
  }

  const me = sideUnit(s, cs, k);
  const them = sideUnit(s, cs, opp);
  const temposLeft = 4 - cs.tempo;
  const myL = effectiveLances(s, cs, k);
  const oppL = effectiveLances(s, cs, opp);
  const pOppSpend = Math.min(1, oppL / temposLeft);

  const prior: LanceMemory = { golpe: 1, guarda: 1, finta: 1 };
  if (prof.learns && memory) {
    prior.golpe += memory.golpe;
    prior.guarda += memory.guarda;
    prior.finta += memory.finta;
  }
  const total = prior.golpe + prior.guarda + prior.finta;
  const dist: [Lance, number][] = [
    ['golpe', (prior.golpe / total) * pOppSpend],
    ['guarda', (prior.guarda / total) * pOppSpend],
    ['finta', (prior.finta / total) * pOppSpend],
    ['esperar', 1 - pOppSpend],
  ];

  const wMe = CLASSES[me.cls].weight;
  const wThem = CLASSES[them.cls].weight;
  const ev = (mine: Lance): number => {
    let v = 0;
    for (const [o, p] of dist) {
      if (p <= 0) continue;
      const c = clash(mine, o, wMe, wThem);
      const dealt = c.aHit ? hitDamage(s, me, them, c.aHit) : 0;
      const taken = c.bHit ? hitDamage(s, them, me, c.bHit) : 0;
      v += p * (dealt - taken * 0.9);
    }
    return v;
  };

  const lances: Lance[] = ['golpe', 'guarda', 'finta'];
  const evs = lances.map(ev);
  const evWait = ev('esperar');
  const bestEv = Math.max(...evs);

  let spend = myL >= temposLeft;
  if (!spend) {
    const p = Math.max(0.1, Math.min(0.95, myL / temposLeft + (bestEv - evWait) / 12));
    spend = nextRandom(s) < p;
  }
  if (!spend) return 'esperar';

  // Softmax sobre o valor esperado.
  const weights = evs.map((v) => Math.exp((v - bestEv) / prof.temperature));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = nextRandom(s) * sum;
  for (let i = 0; i < lances.length; i++) {
    r -= weights[i];
    if (r <= 0) return lances[i];
  }
  return lances[lances.length - 1];
}

/** A IA quer gastar uma Leitura neste tempo? */
export function wantsRead(s: GameState, cs: ConfrontoState, k: SideKey): boolean {
  return cs[k].readsLeft > 0 && canSpend(s, cs, k);
}

export type LanceChooser = (cs: ConfrontoState, k: SideKey, seen: Lance | null) => Lance;

/**
 * Resolve um tempo com dois "escolhedores", respeitando Exposição e Leituras:
 * quem está Exposto (ou foi lido) escolhe primeiro e o outro vê.
 */
export function playTempo(s: GameState, cs: ConfrontoState, choose: Record<SideKey, LanceChooser>): void {
  let first: SideKey | null = cs.exposed;
  if (!first) {
    const atkReads = wantsRead(s, cs, 'atk');
    const defReads = wantsRead(s, cs, 'def');
    if (atkReads && !defReads && useRead(cs, 'atk')) first = 'def';
    else if (defReads && !atkReads && useRead(cs, 'def')) first = 'atk';
  }
  let atk: Lance;
  let def: Lance;
  if (first === 'atk') {
    atk = choose.atk(cs, 'atk', null);
    def = choose.def(cs, 'def', atk);
  } else if (first === 'def') {
    def = choose.def(cs, 'def', null);
    atk = choose.atk(cs, 'atk', def);
  } else {
    atk = choose.atk(cs, 'atk', null);
    def = choose.def(cs, 'def', null);
  }
  resolveTempo(s, cs, atk, def);
}

export function aiChooser(s: GameState, difficulty: Difficulty, memory: LanceMemory | null): LanceChooser {
  return (cs, k, seen) => chooseLance(s, cs, k, seen, difficulty, memory);
}

// ---------- Execução sem tela (simulação e testes) ----------

export interface HeadlessOptions {
  difficulty: Record<Team, Difficulty>;
}

/** Joga uma ativação inteira da IA do time ativo, resolvendo Confrontos com IA dos dois lados. */
export function playAiActivation(s: GameState, opts: HeadlessOptions): void {
  const team = s.activeTeam;
  const plan = planActivation(s, team, opts.difficulty[team]);
  if (!plan) throw new Error('IA sem jogada possível');
  executePlan(s, plan, (cs) => {
    const atkTeam = sideUnit(s, cs, 'atk').team;
    const choosers: Record<SideKey, LanceChooser> = {
      atk: aiChooser(s, opts.difficulty[atkTeam], null),
      def: aiChooser(s, opts.difficulty[otherTeam(atkTeam)], null),
    };
    while (!cs.done) playTempo(s, cs, choosers);
    finishConfronto(s, cs);
  });
}

/** Executa um plano; `onConfronto` resolve o Confronto (com tela ou sem). */
export function executePlan(s: GameState, plan: Plan, onConfronto: (cs: ConfrontoState) => void): void {
  beginActivation(s, plan.unitId);
  if (plan.run) run(s);
  if (plan.moveTo) moveTo(s, plan.moveTo.x, plan.moveTo.y);
  const t = plan.action;
  if (t) {
    switch (t.kind) {
      case 'melee':
        onConfronto(attackMelee(s, t.unitId));
        break;
      case 'meleeBase':
        attackBaseMelee(s);
        break;
      case 'tiro':
        attackRanged(s, t.unitId);
        break;
      case 'tiroBase':
        attackRangedBase(s);
        break;
      case 'area':
        attackArea(s, t.x, t.y);
        break;
      case 'cura':
        heal(s, t.unitId);
        break;
    }
  }
  if (s.winner) return;
  faceNearestEnemy(s, plan.unitId);
  endActivation(s);
}

/** Antes de encerrar, vira para o inimigo mais próximo (não dar as costas). */
export function faceNearestEnemy(s: GameState, unitId: string): void {
  const u = getUnit(s, unitId);
  if (!u.alive) return;
  const enemies = aliveUnits(s, otherTeam(u.team));
  if (!enemies.length) return;
  const nearest = enemies.reduce((a, b) => (manhattan(u, a) <= manhattan(u, b) ? a : b));
  if (s.activation?.unitId === unitId) rotate(s, dirFromTo(u, nearest));
}

/** Partida inteira IA × IA. Devolve o estado final. */
export function simulateGame(s: GameState, opts: HeadlessOptions, maxSteps = 5000): GameState {
  let steps = 0;
  while (!s.winner) {
    if (++steps > maxSteps) throw new Error('Simulação não terminou');
    playAiActivation(s, opts);
  }
  return s;
}
