// Fluxo da partida: criação, ativações alternadas, ações, fim de rodada.

import {
  aliveUnits,
  areaDamage,
  checkVictory,
  decideByPoints,
  effectiveArmor,
  healUnit,
  hitBase,
  hitUnit,
  log,
  rangedDamage,
  rawDamage,
  teamName,
  unitName,
} from './combat';
import { BASE_ARMOR, BASE_HP, BASE_MELEE_MULT, CLASSES, MAX_ROUNDS, RUN_BONUS, RUN_COST, STAMINA_REGEN, TURRET_DAMAGE } from './data';
import {
  baseAt,
  canStop,
  crossCells,
  dirFromTo,
  fromKey,
  getUnit,
  inBounds,
  key,
  lineOfSight,
  manhattan,
  neighbors,
  pathTo,
  reachable,
  unitAt,
} from './grid';
import { DEPLOY_SLOTS, MAP_VAU, parseMap } from './map';
import { nextRandom } from './rng';
import { startConfronto } from './confronto';
import type { ConfrontoState } from './confronto';
import { otherTeam, TEAMS } from './types';
import type { Base, ClassId, Dir, GameState, Pos, Team, Unit } from './types';

export interface NewGameOptions {
  azul: ClassId[];
  vermelho: ClassId[];
  seed?: number;
  maxRounds?: number;
}

export function createGame(opts: NewGameOptions): GameState {
  const map = parseMap(MAP_VAU);
  const mkBase = (team: Team): Base => ({ team, ...map.bases[team], hp: BASE_HP, maxHp: BASE_HP, armadura: BASE_ARMOR });
  const s: GameState = {
    width: map.width,
    height: map.height,
    terrain: map.terrain,
    units: [],
    bases: { azul: mkBase('azul'), vermelho: mkBase('vermelho') },
    round: 1,
    maxRounds: opts.maxRounds ?? MAX_ROUNDS,
    startingTeam: 'azul',
    activeTeam: 'azul',
    activation: null,
    completedActivations: 0,
    strikes: [],
    nextStrikeId: 1,
    stats: { azul: { kills: 0, baseDamage: 0 }, vermelho: { kills: 0, baseDamage: 0 } },
    log: [],
    events: [],
    winner: null,
    winReason: '',
    rng: (opts.seed ?? Date.now()) | 0,
  };
  for (const team of TEAMS) {
    const comp = opts[team];
    if (comp.length !== 5) throw new Error(`O time ${team} precisa de 5 unidades`);
    comp.forEach((cls, i) => {
      const slot = DEPLOY_SLOTS[team][i];
      const def = CLASSES[cls];
      s.units.push({
        id: `${team === 'azul' ? 'A' : 'V'}${i + 1}`,
        cls,
        team,
        x: slot.x,
        y: slot.y,
        hp: def.hp,
        stamina: def.stamina,
        facing: team === 'azul' ? 'N' : 'S',
        activated: false,
        ready: false,
        alive: true,
      });
    });
  }
  s.startingTeam = nextRandom(s) < 0.5 ? 'azul' : 'vermelho';
  s.activeTeam = s.startingTeam;
  log(s, `Rodada 1. O ${teamName(s.startingTeam)} começa.`);
  return s;
}

// ---------- Consultas ----------

export function activatable(s: GameState, team: Team = s.activeTeam): Unit[] {
  return aliveUnits(s, team).filter((u) => !u.activated);
}

export function currentUnit(s: GameState): Unit | null {
  return s.activation ? getUnit(s, s.activation.unitId) : null;
}

/** Movimento da unidade no início da ativação (Exausta: −1). */
export function baseMovement(u: Unit): number {
  return Math.max(0, CLASSES[u.cls].mov - (u.stamina <= 0 ? 1 : 0));
}

export function canMoveNow(s: GameState): boolean {
  const a = s.activation;
  if (!a) return false;
  const u = getUnit(s, a.unitId);
  if (a.hasActed && !CLASSES[u.cls].moveAfterAction) return false;
  return a.mpLeft > 0;
}

/** Casas onde a unidade ativa pode parar agora. */
export function destinations(s: GameState): Pos[] {
  const a = s.activation;
  if (!a || !canMoveNow(s)) return [];
  const u = getUnit(s, a.unitId);
  const reach = reachable(s, u, a.mpLeft);
  const out: Pos[] = [];
  for (const k of reach.keys()) {
    const p = fromKey(s, k);
    if ((p.x !== u.x || p.y !== u.y) && canStop(s, u, p.x, p.y)) out.push(p);
  }
  return out;
}

export type Target =
  | { kind: 'melee'; unitId: string; x: number; y: number }
  | { kind: 'meleeBase'; team: Team; x: number; y: number }
  | { kind: 'tiro'; unitId: string; x: number; y: number }
  | { kind: 'tiroBase'; team: Team; x: number; y: number }
  | { kind: 'area'; x: number; y: number }
  | { kind: 'cura'; unitId: string; x: number; y: number };

/** Alvos válidos para a unidade `u` se ela estivesse em `from`. */
export function targetsFrom(s: GameState, u: Unit, from: Pos, opts: { moved: boolean }): Target[] {
  const def = CLASSES[u.cls];
  const out: Target[] = [];
  const enemyBase = s.bases[otherTeam(u.team)];
  const enemies = aliveUnits(s, otherTeam(u.team));

  if (def.melee) {
    for (const e of enemies) if (manhattan(from, e) === 1) out.push({ kind: 'melee', unitId: e.id, x: e.x, y: e.y });
    if (manhattan(from, enemyBase) === 1) out.push({ kind: 'meleeBase', team: enemyBase.team, x: enemyBase.x, y: enemyBase.y });
  }

  const r = def.ranged;
  if (r) {
    if (r.kind === 'tiro' || r.kind === 'canhao') {
      const allowed = !(r.kind === 'canhao' && opts.moved);
      if (allowed) {
        const inLine = (p: Pos) => r.kind !== 'canhao' || p.x === from.x || p.y === from.y;
        for (const e of enemies) {
          const d = manhattan(from, e);
          if (d >= r.min && d <= r.max && inLine(e) && lineOfSight(s, from, e)) {
            out.push({ kind: 'tiro', unitId: e.id, x: e.x, y: e.y });
          }
        }
        const db = manhattan(from, enemyBase);
        if (db >= r.min && db <= r.max && inLine(enemyBase) && lineOfSight(s, from, enemyBase)) {
          out.push({ kind: 'tiroBase', team: enemyBase.team, x: enemyBase.x, y: enemyBase.y });
        }
      }
    } else {
      // Morteiro e granada miram casas, não unidades.
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          const d = manhattan(from, { x, y });
          if (d >= r.min && d <= r.max) out.push({ kind: 'area', x, y });
        }
      }
    }
  }

  if (def.heal && u.stamina >= def.heal.cost) {
    for (const ally of aliveUnits(s, u.team)) {
      if (ally.id !== u.id && manhattan(from, ally) <= def.heal.range && ally.hp < CLASSES[ally.cls].hp) {
        out.push({ kind: 'cura', unitId: ally.id, x: ally.x, y: ally.y });
      }
    }
  }
  return out;
}

export function currentTargets(s: GameState): Target[] {
  const a = s.activation;
  if (!a || a.hasActed) return [];
  const u = getUnit(s, a.unitId);
  return targetsFrom(s, u, u, { moved: a.hasMoved });
}

// ---------- Ativação ----------

export function beginActivation(s: GameState, unitId: string): void {
  if (s.winner) throw new Error('Partida encerrada');
  const u = getUnit(s, unitId);
  if (!u.alive || u.team !== s.activeTeam || u.activated) throw new Error('Esta unidade não pode ser ativada agora');
  const a = s.activation;
  if (a && a.unitId !== unitId) {
    if (a.hasActed || a.hasMoved) throw new Error('Termine a ativação atual antes');
  }
  if (a && a.unitId === unitId) return;
  s.activation = {
    unitId,
    startX: u.x,
    startY: u.y,
    startFacing: u.facing,
    mpLeft: baseMovement(u),
    hasMoved: false,
    hasActed: false,
    ran: false,
  };
}

/** Troca de unidade antes de mexer ou agir. */
export function cancelActivation(s: GameState): void {
  const a = s.activation;
  if (!a || a.hasMoved || a.hasActed) return;
  s.activation = null;
}

export function moveTo(s: GameState, x: number, y: number): Pos[] {
  const a = s.activation;
  if (!a) throw new Error('Nenhuma unidade ativa');
  if (!canMoveNow(s)) throw new Error('Sem movimento disponível');
  const u = getUnit(s, a.unitId);
  const reach = reachable(s, u, a.mpLeft);
  const node = reach.get(key(s, x, y));
  if (!node || !canStop(s, u, x, y) || (x === u.x && y === u.y)) throw new Error('Casa fora do alcance');
  const path = pathTo(s, reach, x, y);
  a.mpLeft -= node.cost;
  a.hasMoved = true;
  if (path.length >= 2) u.facing = dirFromTo(path[path.length - 2], path[path.length - 1]);
  u.x = x;
  u.y = y;
  return path;
}

export function undoMove(s: GameState): void {
  const a = s.activation;
  if (!a || a.hasActed || !a.hasMoved) return;
  const u = getUnit(s, a.unitId);
  if (a.ran) {
    u.stamina += RUN_COST;
    a.ran = false;
  }
  u.x = a.startX;
  u.y = a.startY;
  u.facing = a.startFacing;
  a.mpLeft = baseMovement(u);
  a.hasMoved = false;
}

export function canRun(s: GameState): boolean {
  const a = s.activation;
  if (!a || a.ran || a.hasActed) return false;
  return getUnit(s, a.unitId).stamina >= RUN_COST;
}

/** Correr: +2 casas de movimento por 2 de Stamina, antes de agir. */
export function run(s: GameState): void {
  if (!canRun(s)) throw new Error('Não dá para correr agora');
  const a = s.activation!;
  const u = getUnit(s, a.unitId);
  u.stamina -= RUN_COST;
  a.mpLeft += RUN_BONUS;
  a.ran = true;
}

export function rotate(s: GameState, dir: Dir): void {
  const u = currentUnit(s);
  if (u) u.facing = dir;
}

function requireAction(s: GameState): { a: NonNullable<GameState['activation']>; u: Unit } {
  const a = s.activation;
  if (!a) throw new Error('Nenhuma unidade ativa');
  if (a.hasActed) throw new Error('A unidade já agiu');
  return { a, u: getUnit(s, a.unitId) };
}

function findTarget(s: GameState, pred: (t: Target) => boolean): Target {
  const t = currentTargets(s).find(pred);
  if (!t) throw new Error('Alvo inválido');
  return t;
}

/** Ataque corpo a corpo contra unidade: abre um Confronto que o chamador resolve. */
export function attackMelee(s: GameState, targetId: string): ConfrontoState {
  const { a, u } = requireAction(s);
  findTarget(s, (t) => t.kind === 'melee' && t.unitId === targetId);
  a.hasActed = true;
  const target = getUnit(s, targetId);
  u.facing = dirFromTo(u, target);
  return startConfronto(s, u.id, targetId);
}

/** Ataque corpo a corpo contra a Base: dano direto, sem Confronto. */
export function attackBaseMelee(s: GameState): number {
  const { a, u } = requireAction(s);
  const t = findTarget(s, (x) => x.kind === 'meleeBase');
  a.hasActed = true;
  const b = s.bases[(t as { team: Team }).team];
  const def = CLASSES[u.cls];
  const dmg = rawDamage(def.atq, BASE_MELEE_MULT, b.armadura);
  u.facing = dirFromTo(u, b);
  log(s, `${unitName(u)} ataca a Base ${teamName(b.team)}: ${dmg} de dano.`);
  hitBase(s, b, dmg);
  checkVictory(s);
  return dmg;
}

export function attackRanged(s: GameState, targetId: string): number {
  const { a, u } = requireAction(s);
  findTarget(s, (t) => t.kind === 'tiro' && t.unitId === targetId);
  a.hasActed = true;
  const r = CLASSES[u.cls].ranged!;
  const target = getUnit(s, targetId);
  const dmg = rangedDamage(s, CLASSES[u.cls].atq, r.mult, target);
  u.facing = dirFromTo(u, target);
  s.events.push({ kind: 'tiro', from: { x: u.x, y: u.y }, to: { x: target.x, y: target.y } });
  log(s, `${unitName(u)} atira em ${unitName(target)}: ${dmg} de dano.`);
  hitUnit(s, target, dmg);
  checkVictory(s);
  return dmg;
}

export function attackRangedBase(s: GameState): number {
  const { a, u } = requireAction(s);
  const t = findTarget(s, (x) => x.kind === 'tiroBase');
  a.hasActed = true;
  const b = s.bases[(t as { team: Team }).team];
  const r = CLASSES[u.cls].ranged!;
  const dmg = rawDamage(CLASSES[u.cls].atq, r.mult, b.armadura);
  u.facing = dirFromTo(u, b);
  s.events.push({ kind: 'tiro', from: { x: u.x, y: u.y }, to: { x: b.x, y: b.y } });
  log(s, `${unitName(u)} atira na Base ${teamName(b.team)}: ${dmg} de dano.`);
  hitBase(s, b, dmg);
  checkVictory(s);
  return dmg;
}

/** Morteiro (telegrafado) ou granada (imediata), em cruz. */
export function attackArea(s: GameState, x: number, y: number): void {
  const { a, u } = requireAction(s);
  findTarget(s, (t) => t.kind === 'area' && t.x === x && t.y === y);
  a.hasActed = true;
  const def = CLASSES[u.cls];
  const r = def.ranged!;
  const cells = crossCells(s, x, y);
  u.facing = dirFromTo(u, { x, y });
  if (r.kind === 'morteiro') {
    // Cai depois de mais duas ativações (a atual conta quando terminar).
    s.strikes.push({
      id: s.nextStrikeId++,
      team: u.team,
      ownerId: u.id,
      cx: x,
      cy: y,
      cells,
      atq: def.atq,
      mult: r.mult,
      resolveAt: s.completedActivations + 3,
    });
    log(s, `${unitName(u)} marca disparo de morteiro em (${x + 1},${y + 1}). Cai em 2 ativações.`);
  } else {
    log(s, `${unitName(u)} arremessa granada em (${x + 1},${y + 1}).`);
    areaDamage(s, cells, def.atq, r.mult);
    checkVictory(s);
  }
}

export function heal(s: GameState, targetId: string): number {
  const { a, u } = requireAction(s);
  findTarget(s, (t) => t.kind === 'cura' && t.unitId === targetId);
  a.hasActed = true;
  const h = CLASSES[u.cls].heal!;
  u.stamina -= h.cost;
  const target = getUnit(s, targetId);
  const healed = healUnit(s, target, h.amount);
  log(s, `${unitName(u)} cura ${unitName(target)} em ${healed}.`);
  return healed;
}

/** Ativações que ainda faltam até um disparo cair. */
export function strikeCountdown(s: GameState, resolveAt: number): number {
  return Math.max(0, resolveAt - s.completedActivations);
}

function resolveStrikes(s: GameState): void {
  const due = s.strikes.filter((st) => st.resolveAt <= s.completedActivations);
  if (!due.length) return;
  s.strikes = s.strikes.filter((st) => st.resolveAt > s.completedActivations);
  for (const st of due) {
    log(s, `Impacto de morteiro ${teamName(st.team)} em (${st.cx + 1},${st.cy + 1})!`);
    areaDamage(s, st.cells, st.atq, st.mult);
  }
  checkVictory(s);
}

export function endActivation(s: GameState): void {
  const a = s.activation;
  if (!a) throw new Error('Nenhuma unidade ativa');
  const u = getUnit(s, a.unitId);
  u.activated = true;
  // Prontidão: quem não agiu fica pronto para defender.
  u.ready = !a.hasActed && u.alive;
  s.activation = null;
  s.completedActivations++;
  resolveStrikes(s);
  if (s.winner) return;
  advanceTurn(s);
}

function advanceTurn(s: GameState): void {
  const next = otherTeam(s.activeTeam);
  if (activatable(s, next).length) {
    s.activeTeam = next;
    return;
  }
  if (activatable(s, s.activeTeam).length) return;
  endRound(s);
}

function endRound(s: GameState): void {
  // Torretas das Bases: 5 de dano em cada inimigo adjacente.
  for (const b of [s.bases.azul, s.bases.vermelho]) {
    if (b.hp <= 0) continue;
    for (const n of neighbors(s, b)) {
      const e = unitAt(s, n.x, n.y);
      if (e && e.team !== b.team) {
        const dmg = Math.max(1, TURRET_DAMAGE);
        log(s, `Torreta da Base ${teamName(b.team)} acerta ${unitName(e)}: ${dmg}.`);
        hitUnit(s, e, dmg);
      }
    }
  }
  checkVictory(s);
  if (s.winner) return;
  if (s.round >= s.maxRounds) {
    decideByPoints(s);
    return;
  }
  s.round++;
  for (const u of s.units) {
    if (!u.alive) continue;
    u.activated = false;
    u.stamina = Math.min(CLASSES[u.cls].stamina, u.stamina + STAMINA_REGEN);
  }
  s.startingTeam = otherTeam(s.startingTeam);
  s.activeTeam = activatable(s, s.startingTeam).length ? s.startingTeam : otherTeam(s.startingTeam);
  log(s, `Rodada ${s.round}. O ${teamName(s.activeTeam)} começa.`);
}

/** Retira e devolve os eventos visuais pendentes. */
export function drainEvents(s: GameState) {
  const ev = s.events;
  s.events = [];
  return ev;
}

export function isInside(s: GameState, p: Pos): boolean {
  return inBounds(s, p.x, p.y);
}

export { baseAt, effectiveArmor };
