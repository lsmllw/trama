// IA baseada em utilidade: dá nota a cada (unidade, casa, ação) e escolhe a melhor,
// com ruído conforme a dificuldade. No Confronto, joga uma estratégia mista
// que aprende com o histórico de lances do oponente.

import { aliveUnits, effectiveArmor, rawDamage, rangedDamage, unitAtq } from './combat';
import {
  ANTITANK,
  AREA_HEAL,
  BASE_MELEE_MULT,
  CLASSES,
  LANCE_COST,
  OLEO_ATQ,
  RAM_BONUS,
  REPAIR_AMOUNT,
  RUN_BONUS,
  RUN_COST,
  TERRAIN,
  TONICO_HEAL,
} from './data';
import { baseAt, canStop, crossCells, DIRS, dirFromTo, fromKey, getUnit, inBounds, manhattan, moveCost, reachable, terrainAt, unitAt } from './grid';
import { nextRandom } from './rng';
import {
  attackArea,
  attackBarricade,
  attackBaseMelee,
  attackMelee,
  attackRanged,
  attackRangedBase,
  baseMovement,
  beginActivation,
  canUseItem,
  collect,
  currentTargets,
  endActivation,
  heal,
  moveTo,
  rotate,
  run,
  targetsFrom,
  useItem,
} from './game';
import type { Target } from './game';
import { abilityBlock, abilityOf, abilityTargets, currentAbilityTargets, useAbility } from './abilities';
import type { AbilityTarget } from './abilities';
import { canSpend, clash, countLances, finishConfronto, hitDamage, resolveTempo, sideUnit, useRead } from './confronto';
import type { ConfrontoState, Lance, SideKey } from './confronto';
import { otherTeam } from './types';
import type { GameState, NodeColor, Pos, Team, Unit } from './types';

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

/** Ação planejada: alvo comum, item (pelo índice), habilidade (pela casa) ou nada. */
export type PlannedAction =
  | Target
  | { kind: 'item'; index: number }
  | { kind: 'habilidade'; x: number; y: number }
  | null;

export interface Plan {
  unitId: string;
  run: boolean;
  moveTo: Pos | null;
  action: PlannedAction;
  /** Cor escolhida ao coletar na Fonte Prismática. */
  color?: Exclude<NodeColor, 'prisma'>;
  score: number;
}

// ---------- Avaliação ----------

/** Pesos da avaliação de posição (ajustáveis em scripts/tune.ts). */
export const AI_WEIGHTS = {
  /** Quanto pesa o dano que a casa pode receber na próxima fase inimiga. */
  threat: 0.25,
  /** Penalidade por casa de distância do aliado mais próximo acima de 2 (andar em grupo). */
  cohesion: 0,
  /** Quanto pesa se aproximar do objetivo. */
  advance: 0.8,
  /** Penalidade por terminar numa casa onde pode morrer. */
  deathRisk: 8,
  /** A partir desta rodada a cautela cai, até sobrar `minCaution` no fim da partida. */
  boldFrom: 3,
  minCaution: 0.1,
};

/** Fator de cautela: 1 no começo, caindo até `minCaution` perto da última rodada. */
function caution(s: GameState): number {
  const span = Math.max(1, s.maxRounds - AI_WEIGHTS.boldFrom);
  const t = Math.min(1, Math.max(0, (s.round - AI_WEIGHTS.boldFrom) / span));
  return 1 - t * (1 - AI_WEIGHTS.minCaution);
}

const unitValue = (u: Unit) => CLASSES[u.cls].atq + u.maxHp / 4;

/**
 * Mapa de perigo: para cada casa, quanto ATQ inimigo consegue chegar nela na próxima fase
 * (movimento real pelo terreno + alcance de ataque). Calculado uma vez por decisão.
 */
export type ThreatMap = Float32Array;

export function buildThreatMap(s: GameState, team: Team): ThreatMap {
  const map = new Float32Array(s.width * s.height);
  for (const e of aliveUnits(s, otherTeam(team))) {
    const d = CLASSES[e.cls];
    const mp = baseMovement(s, e) + (e.stamina >= RUN_COST ? RUN_BONUS : 0);
    const reach = reachable(s, e, mp);
    const minR = d.melee ? 1 : d.ranged ? d.ranged.min : 1;
    const maxR = d.ranged ? d.ranged.max : 1;
    const power = unitAtq(e) * (d.melee ? 1.6 : d.ranged ? d.ranged.mult : 1);
    const marked = new Uint8Array(s.width * s.height);
    for (const k of reach.keys()) {
      const p = fromKey(s, k);
      if (!canStop(s, e, p.x, p.y)) continue;
      for (let dy = -maxR; dy <= maxR; dy++)
        for (let dx = -maxR; dx <= maxR; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < minR || dist > maxR) continue;
          const x = p.x + dx;
          const y = p.y + dy;
          if (x < 0 || y < 0 || x >= s.width || y >= s.height) continue;
          marked[y * s.width + x] = 1;
        }
    }
    for (let i = 0; i < marked.length; i++) if (marked[i]) map[i] += power;
  }
  return map;
}

/** Dano estimado que quem ficar em `cell` pode levar na próxima fase inimiga. */
function threatAt(s: GameState, threat: ThreatMap, cell: Pos, armor: number): number {
  const raw = threat[cell.y * s.width + cell.x];
  return raw > 0 ? Math.max(1, raw - armor * 1.5) : 0;
}

function strikeDanger(s: GameState, cell: Pos, armor: number): number {
  let danger = 0;
  for (const st of s.strikes) {
    if (st.cells.some((c) => c.x === cell.x && c.y === cell.y)) danger += rawDamage(st.atq, st.mult, armor);
  }
  return danger;
}

/** Estimativa grosseira do saldo de um Confronto iniciado de `from`. */
function estimateMelee(s: GameState, u: Unit, from: Pos, target: Unit, bonusLances = 0, bonusAtq = 0): number {
  const ox = u.x;
  const oy = u.y;
  u.x = from.x;
  u.y = from.y;
  const c = countLances(s, u, target, bonusLances);
  u.tempAtq = bonusAtq + (u.oil ? OLEO_ATQ : 0);
  const hitA = hitDamage(s, u, target, 1.75);
  u.tempAtq = 0;
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
  const atq = unitAtq(u);
  let score = 0;
  for (const c of crossCells(s, x, y)) {
    const isSelf = c.x === from.x && c.y === from.y;
    const occ = isSelf ? u : s.units.find((v) => v.alive && v.id !== u.id && v.x === c.x && v.y === c.y);
    if (occ) {
      const ignore = !delayed && CLASSES[occ.cls].vehicle ? ANTITANK.granadaArmorIgnore : 0;
      const dmg = rawDamage(atq, r.mult, effectiveArmor(s, occ) * (1 - ignore));
      if (occ.team === u.team) score -= dmg * (delayed ? 0.8 : 1.5);
      else score += (dmg + (dmg >= occ.hp ? 10 : 0)) * (delayed ? 0.55 : 1);
    }
    const eb = s.bases[otherTeam(u.team)];
    if (eb.x === c.x && eb.y === c.y) score += rawDamage(atq, r.mult, eb.armadura) * 1.6;
    const ob = s.bases[u.team];
    if (ob.x === c.x && ob.y === c.y) score -= 20;
  }
  return score;
}

function actionScore(s: GameState, u: Unit, from: Pos, t: Target): number {
  const def = CLASSES[u.cls];
  const atq = unitAtq(u) + (u.oil ? OLEO_ATQ : 0);
  switch (t.kind) {
    case 'melee':
      return estimateMelee(s, u, from, getUnit(s, t.unitId));
    case 'meleeBase':
    case 'tiroBase': {
      const b = s.bases[t.team];
      const mult = t.kind === 'meleeBase' ? BASE_MELEE_MULT : def.ranged!.mult;
      const dmg = rawDamage(atq, mult, b.armadura);
      return dmg * 1.6 + (dmg >= b.hp ? 1000 : 0);
    }
    case 'tiro': {
      const target = getUnit(s, t.unitId);
      const dmg = rangedDamage(s, atq, def.ranged!.mult, target);
      return dmg * 1.1 + (dmg >= target.hp ? 12 + unitValue(target) : 0);
    }
    case 'barricada':
      return 1;
    case 'area':
      return areaScore(s, u, from, t.x, t.y);
    case 'cura': {
      const target = getUnit(s, t.unitId);
      const missing = target.maxHp - target.hp;
      return missing >= 4 ? Math.min(def.heal!.amount, missing) * 1.3 : 0;
    }
    case 'coleta':
      return u.items.length >= 2 ? 0 : 3.5 + (u.items.length === 0 ? 1 : 0);
  }
}

function nearestEnemyDist(s: GameState, u: Unit, from: Pos): number {
  const enemies = aliveUnits(s, otherTeam(u.team));
  return enemies.length ? Math.min(...enemies.map((e) => manhattan(from, e))) : 99;
}

function itemScore(s: GameState, u: Unit, from: Pos, index: number): number {
  const item = u.items[index];
  const near = nearestEnemyDist(s, u, from);
  if (item === 'tonico') {
    const missing = u.maxHp - u.hp;
    return missing >= 8 ? Math.min(TONICO_HEAL, missing) * 1.2 : 0;
  }
  if (item === 'oleo') return !u.oil && near <= 6 ? 3 : 0;
  return !u.focus && near <= 5 ? 2.5 + (CLASSES[u.cls].stamina - u.stamina) * 0.3 : 0;
}

function abilityScore(s: GameState, u: Unit, from: Pos, t: AbilityTarget): number {
  const target = t.unitId ? getUnit(s, t.unitId) : null;
  const atq = unitAtq(u) + (u.oil ? OLEO_ATQ : 0);
  switch (t.ability) {
    case 'avanco':
      return estimateMelee(s, u, t.land!, target!, 1) + 3;
    case 'investida':
      return estimateMelee(s, u, from, target!, 1, 2) + 4;
    case 'tiroCerteiro': {
      const dmg = rawDamage(atq, 2.0, effectiveArmor(s, target!));
      return dmg * 1.1 + (dmg >= target!.hp ? 12 + unitValue(target!) : 0);
    }
    case 'provocar': {
      const n = aliveUnits(s, otherTeam(u.team)).filter((e) => manhattan(from, e) <= 2).length;
      return u.hp > u.maxHp * 0.5 ? n * 3 : 0;
    }
    case 'atropelar': {
      const tgt = target!;
      const dir = dirFromTo(from, tgt);
      const nx = tgt.x + DIRS[dir].x;
      const ny = tgt.y + DIRS[dir].y;
      const blocked = !inBounds(s, nx, ny) || !Number.isFinite(moveCost(s, tgt, nx, ny)) || !!unitAt(s, nx, ny) || !!baseAt(s, nx, ny);
      const dmg = rawDamage(atq, 1.0, effectiveArmor(s, tgt)) + (blocked ? RAM_BONUS : 0);
      return dmg + (dmg >= tgt.hp ? 12 + unitValue(tgt) : 0);
    }
    case 'perfurante': {
      const dmg = rawDamage(atq, 1.5, effectiveArmor(s, target!));
      return dmg * 1.4;
    }
    case 'mina': {
      // Minas valem onde o inimigo vai passar; contra Blindado, muito mais.
      let sc = 0;
      for (const e of aliveUnits(s, otherTeam(u.team))) {
        const d = manhattan(e, t);
        const reach = CLASSES[e.cls].mov + 2;
        if (d > reach || d === 0) continue;
        const w = CLASSES[e.cls].vehicle ? 7 : 1.2;
        sc += w * (1 - d / (reach + 1));
      }
      const ownBase = s.bases[u.team];
      if (manhattan(t, ownBase) <= 4) sc += 1;
      if (terrainAt(s, t.x, t.y) === 'ponte') sc += 1.5;
      if (s.mines.some((m) => m.team === u.team && manhattan(m, t) <= 1)) sc -= 2;
      return sc;
    }
    case 'reparo': {
      const base = s.bases[u.team];
      if (base.x === t.x && base.y === t.y) return Math.min(REPAIR_AMOUNT, base.maxHp - base.hp) * 1.5;
      if (target) return Math.min(REPAIR_AMOUNT, target.maxHp - target.hp) * 1.2;
      return 0.5;
    }
    case 'curaArea': {
      let total = 0;
      for (const v of aliveUnits(s, u.team)) if (manhattan(from, v) <= 2) total += Math.min(AREA_HEAL, v.maxHp - v.hp);
      return total * 1.1;
    }
    case 'furtar':
      return 4;
    case 'fumaca':
    case 'barricada':
      return 0;
  }
}

function positionScore(s: GameState, u: Unit, c: Pos, threat: ThreatMap): number {
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
    // Quanto menos cautela, mais vontade de avançar.
    score -= Math.min(dEnemy, dBase * 0.85) * AI_WEIGHTS.advance * (2 - caution(s));
  }
  if (AI_WEIGHTS.cohesion) {
    const allies = aliveUnits(s, u.team).filter((a) => a.id !== u.id);
    if (allies.length) {
      const dAlly = Math.min(...allies.map((a) => manhattan(c, a)));
      score -= Math.max(0, dAlly - 2) * AI_WEIGHTS.cohesion;
    }
  }

  // Defender a própria Base se houver inimigo perto dela.
  const raider = enemies.find((e) => manhattan(e, ownBase) <= 5);
  if (raider && def.melee) score -= manhattan(c, raider) * 0.5;

  const armor = CLASSES[u.cls].armadura + TERRAIN[terrainAt(s, c.x, c.y)].armorBonus;
  const fragility = 1 + (1 - u.hp / u.maxHp);
  const danger = threatAt(s, threat, c, armor);
  const careful = caution(s);
  score -= danger * AI_WEIGHTS.threat * fragility * careful;
  // Risco de morrer na próxima fase pesa muito mais.
  if (danger >= u.hp) score -= AI_WEIGHTS.deathRisk * careful;
  score -= strikeDanger(s, c, armor) * 1.2;
  if (TERRAIN[terrainAt(s, c.x, c.y)].cover) score += 0.8;
  if (terrainAt(s, c.x, c.y) === 'colina' && def.ranged) score += 0.6;
  // Encostar na Base inimiga custa a torreta.
  if (manhattan(c, enemyBase) === 1) score -= 3;
  return score;
}

function pickColor(u: Unit): Exclude<NodeColor, 'prisma'> {
  if (u.hp < u.maxHp * 0.6) return 'verde';
  return u.items.includes('oleo') ? 'roxo' : 'laranja';
}

export function planActivation(s: GameState, team: Team, difficulty: Difficulty): Plan | null {
  const prof = PROFILES[difficulty];
  const threat = buildThreatMap(s, team);
  let best: Plan | null = null;
  const consider = (plan: Omit<Plan, 'score'>, score: number) => {
    const total = score + (nextRandom(s) - 0.5) * prof.noise;
    if (!best || total > best.score) best = { ...plan, score: total };
  };
  for (const u of aliveUnits(s, team).filter((v) => !v.activated)) {
    const mp = baseMovement(s, u);
    const canRunNow = u.stamina >= RUN_COST + 2;
    const reach = reachable(s, u, mp + (canRunNow ? RUN_BONUS : 0));
    const abilityReady = !abilityBlock(s, u) && abilityOf(u).id !== 'fumaca' && abilityOf(u).id !== 'barricada';
    for (const [k, node] of reach) {
      const c = fromKey(s, k);
      if (!canStop(s, u, c.x, c.y)) continue;
      const needsRun = node.cost > mp;
      const moved = c.x !== u.x || c.y !== u.y;
      const base = { unitId: u.id, run: needsRun, moveTo: moved ? c : null };
      const pos = positionScore(s, u, c, threat) - (needsRun ? 1.5 : 0);
      consider({ ...base, action: null }, pos);

      for (const t of targetsFrom(s, u, c, { moved })) {
        if (t.kind === 'area') {
          const near = s.units.some((v) => v.alive && manhattan(v, t) <= 1) || manhattan(s.bases[otherTeam(team)], t) <= 1;
          if (!near) continue;
        }
        const act = actionScore(s, u, c, t);
        if (act <= 0) continue;
        consider({ ...base, action: t, color: t.kind === 'coleta' && t.color === 'prisma' ? pickColor(u) : undefined }, act + pos);
      }
      u.items.forEach((_, i) => {
        const sc = itemScore(s, u, c, i);
        if (sc > 0) consider({ ...base, action: { kind: 'item', index: i } }, sc + pos);
      });
      if (abilityReady) {
        for (const t of abilityTargets(s, u, c, moved)) {
          const sc = abilityScore(s, u, c, t);
          if (sc > 0) consider({ ...base, action: { kind: 'habilidade', x: t.x, y: t.y } }, sc + pos);
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
// ---------- Execução ----------

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

/** A ação planejada ainda é válida (uma mina pode ter interrompido o movimento)? */
export function actionStillValid(s: GameState, action: PlannedAction): boolean {
  if (!action || !s.activation) return false;
  if (action.kind === 'item') return canUseItem(s, action.index);
  if (action.kind === 'habilidade') return currentAbilityTargets(s).some((t) => t.x === action.x && t.y === action.y);
  return currentTargets(s).some((t) => t.kind === action.kind && t.x === action.x && t.y === action.y);
}

/** Executa só a ação (a parte que não abre Confronto é imediata). Devolve o Confronto, se houver. */
export function performAction(s: GameState, plan: Plan): ConfrontoState | null {
  const t = plan.action;
  if (!t || !actionStillValid(s, t)) return null;
  switch (t.kind) {
    case 'melee':
      return attackMelee(s, t.unitId);
    case 'meleeBase':
      attackBaseMelee(s);
      return null;
    case 'tiro':
      attackRanged(s, t.unitId);
      return null;
    case 'tiroBase':
      attackRangedBase(s);
      return null;
    case 'barricada':
      attackBarricade(s, t.x, t.y);
      return null;
    case 'area':
      attackArea(s, t.x, t.y);
      return null;
    case 'cura':
      heal(s, t.unitId);
      return null;
    case 'coleta':
      collect(s, t.x, t.y, plan.color);
      return null;
    case 'item':
      useItem(s, t.index);
      return null;
    case 'habilidade':
      return useAbility(s, t.x, t.y);
  }
}

/** Executa um plano; `onConfronto` resolve o Confronto (com tela ou sem). */
export function executePlan(s: GameState, plan: Plan, onConfronto: (cs: ConfrontoState) => void): void {
  beginActivation(s, plan.unitId);
  if (plan.run) run(s);
  if (plan.moveTo) moveTo(s, plan.moveTo.x, plan.moveTo.y);
  if (s.winner) return;
  const cs = getUnit(s, plan.unitId).alive ? performAction(s, plan) : null;
  if (cs) onConfronto(cs);
  if (s.winner || !s.activation) return;
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
