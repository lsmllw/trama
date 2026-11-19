// Fluxo da partida por fases: cada time move todas as suas unidades na sua fase.
// Cada unidade: Mover + 1 ação (atacar, coletar, usar item, habilidade ou curar).

import {
  aliveUnits,
  areaDamage,
  checkVictory,
  consumeOil,
  decideByPoints,
  effectiveArmor,
  grantXp,
  healUnit,
  hitBarricade,
  hitBase,
  hitUnit,
  log,
  rangedDamage,
  rawDamage,
  teamName,
  unitAtq,
  unitName,
} from './combat';
import {
  ANTITANK,
  BASE_ARMOR,
  BASE_HP,
  BASE_MELEE_MULT,
  CLASSES,
  FOCO_STAMINA,
  ITEM_BY_COLOR,
  ITEMS,
  MAX_ITEMS,
  MAX_ROUNDS,
  MINE_DAMAGE,
  MINE_VEHICLE_MULT,
  NODE_CHARGES,
  RUN_BONUS,
  RUN_COST,
  STAMINA_REGEN,
  TONICO_HEAL,
  TURRET_DAMAGE,
  XP_HIT,
  XP_SUPPORT,
} from './data';
import {
  barricadeAt,
  canStop,
  crossCells,
  dirFromTo,
  fromKey,
  getUnit,
  key,
  lineOfSight,
  manhattan,
  mineAt,
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
import type { Base, ClassId, Dir, GameState, ItemId, NodeColor, Pos, Team, Unit } from './types';

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
    phase: 1,
    activation: null,
    strikes: [],
    nextId: 1,
    barricades: [],
    smoke: [],
    mines: [],
    nodes: map.nodes.map((n) => ({ ...n, charges: NODE_CHARGES })),
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
        level: 1,
        xp: 0,
        maxHp: def.hp,
        items: [],
        oil: false,
        focus: false,
        tempAtq: 0,
        tauntBy: null,
        tauntUntil: 0,
        stuckUntil: 0,
        dealt: 0,
        taken: 0,
      });
    });
  }
  s.startingTeam = nextRandom(s) < 0.5 ? 'azul' : 'vermelho';
  s.activeTeam = s.startingTeam;
  log(s, `Rodada 1. Fase do ${teamName(s.startingTeam)}.`);
  return s;
}

// ---------- Consultas ----------

export function activatable(s: GameState, team: Team = s.activeTeam): Unit[] {
  return aliveUnits(s, team).filter((u) => !u.activated);
}

export function currentUnit(s: GameState): Unit | null {
  return s.activation ? getUnit(s, s.activation.unitId) : null;
}

/** Movimento da unidade no início da ativação (Exausta: −1; imobilizada por mina: 0). */
export function baseMovement(s: GameState, u: Unit): number {
  if (s.phase <= u.stuckUntil) return 0;
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

/** A unidade está provocada por um Tank vivo? Então só pode atacá-lo. */
export function tauntOf(s: GameState, u: Unit): Unit | null {
  if (!u.tauntBy || s.phase > u.tauntUntil) return null;
  const t = s.units.find((v) => v.id === u.tauntBy && v.alive);
  return t ?? null;
}

export type Target =
  | { kind: 'melee'; unitId: string; x: number; y: number }
  | { kind: 'meleeBase'; team: Team; x: number; y: number }
  | { kind: 'tiro'; unitId: string; x: number; y: number }
  | { kind: 'tiroBase'; team: Team; x: number; y: number }
  | { kind: 'barricada'; x: number; y: number; ranged: boolean }
  | { kind: 'area'; x: number; y: number }
  | { kind: 'cura'; unitId: string; x: number; y: number }
  | { kind: 'coleta'; x: number; y: number; color: NodeColor };

/** Alvos válidos para a unidade `u` se ela estivesse em `from`. */
export function targetsFrom(s: GameState, u: Unit, from: Pos, opts: { moved: boolean }): Target[] {
  const def = CLASSES[u.cls];
  const out: Target[] = [];
  const enemyBase = s.bases[otherTeam(u.team)];
  const taunter = tauntOf(s, u);
  const enemies = aliveUnits(s, otherTeam(u.team)).filter((e) => !taunter || e.id === taunter.id);
  const enemyBarricades = taunter ? [] : s.barricades.filter((b) => b.team !== u.team);
  const canHitBase = !taunter;

  if (def.melee) {
    for (const e of enemies) if (manhattan(from, e) === 1) out.push({ kind: 'melee', unitId: e.id, x: e.x, y: e.y });
    if (canHitBase && manhattan(from, enemyBase) === 1) out.push({ kind: 'meleeBase', team: enemyBase.team, x: enemyBase.x, y: enemyBase.y });
    for (const b of enemyBarricades) if (manhattan(from, b) === 1) out.push({ kind: 'barricada', x: b.x, y: b.y, ranged: false });
  }

  const r = def.ranged;
  if (r) {
    if (r.kind === 'tiro' || r.kind === 'canhao') {
      const allowed = !(r.kind === 'canhao' && opts.moved);
      if (allowed) {
        const inLine = (p: Pos) => r.kind !== 'canhao' || p.x === from.x || p.y === from.y;
        const ok = (p: Pos) => {
          const d = manhattan(from, p);
          return d >= r.min && d <= r.max && inLine(p) && lineOfSight(s, from, p);
        };
        for (const e of enemies) if (ok(e)) out.push({ kind: 'tiro', unitId: e.id, x: e.x, y: e.y });
        if (canHitBase && ok(enemyBase)) out.push({ kind: 'tiroBase', team: enemyBase.team, x: enemyBase.x, y: enemyBase.y });
        for (const b of enemyBarricades) {
          if (!out.some((t) => t.kind === 'barricada' && t.x === b.x && t.y === b.y) && ok(b)) out.push({ kind: 'barricada', x: b.x, y: b.y, ranged: true });
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
      if (ally.id !== u.id && manhattan(from, ally) <= def.heal.range && ally.hp < ally.maxHp) {
        out.push({ kind: 'cura', unitId: ally.id, x: ally.x, y: ally.y });
      }
    }
  }

  if (u.items.length < MAX_ITEMS) {
    for (const n of s.nodes) if (n.charges > 0 && manhattan(from, n) <= 1) out.push({ kind: 'coleta', x: n.x, y: n.y, color: n.color });
  }
  return out;
}

export function currentTargets(s: GameState): Target[] {
  const a = s.activation;
  if (!a || a.hasActed) return [];
  const u = getUnit(s, a.unitId);
  return targetsFrom(s, u, u, { moved: a.hasMoved });
}

// ---------- Ativação de uma unidade ----------

export function beginActivation(s: GameState, unitId: string): void {
  if (s.winner) throw new Error('Partida encerrada');
  const u = getUnit(s, unitId);
  if (!u.alive || u.team !== s.activeTeam || u.activated) throw new Error('Esta unidade não pode ser ativada agora');
  const a = s.activation;
  if (a && a.unitId === unitId) return;
  if (a) {
    // Trocar de unidade: a anterior encerra se já mexeu ou agiu; senão, só é desmarcada.
    if (a.hasMoved || a.hasActed) endActivation(s);
    else s.activation = null;
    if (s.winner || s.activeTeam !== u.team) return;
  }
  s.activation = {
    unitId,
    startX: u.x,
    startY: u.y,
    startFacing: u.facing,
    mpLeft: baseMovement(s, u),
    hasMoved: false,
    hasActed: false,
    ran: false,
    noUndo: false,
  };
}

/** Desmarca a unidade antes de mexer ou agir. */
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
  let path = pathTo(s, reach, x, y);
  // Mina inimiga no caminho: para em cima dela e explode.
  for (let i = 1; i < path.length; i++) {
    const m = mineAt(s, path[i].x, path[i].y);
    if (m && m.team !== u.team && canStop(s, u, path[i].x, path[i].y)) {
      path = path.slice(0, i + 1);
      break;
    }
  }
  const end = path[path.length - 1];
  a.mpLeft -= reach.get(key(s, end.x, end.y))!.cost;
  a.hasMoved = true;
  if (path.length >= 2) u.facing = dirFromTo(path[path.length - 2], path[path.length - 1]);
  u.x = end.x;
  u.y = end.y;
  const mine = mineAt(s, end.x, end.y);
  if (mine && mine.team !== u.team) {
    s.mines = s.mines.filter((m) => m !== mine);
    a.mpLeft = 0;
    a.noUndo = true;
    const vehicle = !!CLASSES[u.cls].vehicle;
    const dmg = MINE_DAMAGE * (vehicle ? MINE_VEHICLE_MULT : 1);
    const owner = s.units.find((v) => v.id === mine.ownerId && v.alive) ?? null;
    log(s, `${unitName(u)} pisou numa mina! ${dmg} de dano${vehicle ? ' e fica imobilizado na próxima fase' : ''}.`);
    s.events.push({ kind: 'impacto', cells: [{ x: end.x, y: end.y }] });
    if (vehicle) u.stuckUntil = s.phase + 2;
    hitUnit(s, u, dmg, owner);
    if (owner) grantXp(s, owner, XP_HIT);
    checkVictory(s);
  }
  return path;
}

export function undoMove(s: GameState): void {
  const a = s.activation;
  if (!a || a.hasActed || !a.hasMoved) return;
  const u = getUnit(s, a.unitId);
  if (!u.alive || a.noUndo) return;
  if (a.ran) {
    u.stamina += RUN_COST;
    a.ran = false;
  }
  u.x = a.startX;
  u.y = a.startY;
  u.facing = a.startFacing;
  a.mpLeft = baseMovement(s, u);
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

export function requireAction(s: GameState): { a: NonNullable<GameState['activation']>; u: Unit } {
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

// ---------- Ações ----------

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
  const dmg = rawDamage(unitAtq(u) + consumeOil(u), BASE_MELEE_MULT, b.armadura);
  u.facing = dirFromTo(u, b);
  log(s, `${unitName(u)} ataca a Base ${teamName(b.team)}: ${dmg} de dano.`);
  hitBase(s, b, dmg);
  grantXp(s, u, XP_HIT);
  checkVictory(s);
  return dmg;
}

export function attackRanged(s: GameState, targetId: string): number {
  const { a, u } = requireAction(s);
  findTarget(s, (t) => t.kind === 'tiro' && t.unitId === targetId);
  a.hasActed = true;
  const r = CLASSES[u.cls].ranged!;
  const target = getUnit(s, targetId);
  const dmg = rangedDamage(s, unitAtq(u) + consumeOil(u), r.mult, target);
  u.facing = dirFromTo(u, target);
  s.events.push({ kind: 'tiro', from: { x: u.x, y: u.y }, to: { x: target.x, y: target.y } });
  log(s, `${unitName(u)} atira em ${unitName(target)}: ${dmg} de dano.`);
  hitUnit(s, target, dmg, u);
  grantXp(s, u, XP_HIT);
  checkVictory(s);
  return dmg;
}

export function attackRangedBase(s: GameState): number {
  const { a, u } = requireAction(s);
  const t = findTarget(s, (x) => x.kind === 'tiroBase');
  a.hasActed = true;
  const b = s.bases[(t as { team: Team }).team];
  const r = CLASSES[u.cls].ranged!;
  const dmg = rawDamage(unitAtq(u) + consumeOil(u), r.mult, b.armadura);
  u.facing = dirFromTo(u, b);
  s.events.push({ kind: 'tiro', from: { x: u.x, y: u.y }, to: { x: b.x, y: b.y } });
  log(s, `${unitName(u)} atira na Base ${teamName(b.team)}: ${dmg} de dano.`);
  hitBase(s, b, dmg);
  grantXp(s, u, XP_HIT);
  checkVictory(s);
  return dmg;
}

export function attackBarricade(s: GameState, x: number, y: number): number {
  const { a, u } = requireAction(s);
  const t = findTarget(s, (v) => v.kind === 'barricada' && v.x === x && v.y === y) as Extract<Target, { kind: 'barricada' }>;
  a.hasActed = true;
  const mult = t.ranged ? CLASSES[u.cls].ranged!.mult : BASE_MELEE_MULT;
  const dmg = Math.max(1, Math.floor((unitAtq(u) + consumeOil(u)) * mult));
  u.facing = dirFromTo(u, { x, y });
  log(s, `${unitName(u)} ataca uma barricada: ${dmg} de dano.`);
  hitBarricade(s, x, y, dmg);
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
  const atq = unitAtq(u) + consumeOil(u);
  if (r.kind === 'morteiro') {
    // Cai no começo da próxima fase de quem atirou: o inimigo tem a fase dele para sair.
    s.strikes.push({ id: s.nextId++, team: u.team, ownerId: u.id, cx: x, cy: y, cells, atq, mult: r.mult, resolveAt: s.phase + 2 });
    log(s, `${unitName(u)} marca disparo de morteiro em (${x + 1},${y + 1}). Cai no começo da próxima fase ${teamName(u.team)}.`);
  } else {
    log(s, `${unitName(u)} arremessa granada em (${x + 1},${y + 1}).`);
    if (areaDamage(s, cells, atq, r.mult, u, ANTITANK.granadaArmorIgnore) > 0) grantXp(s, u, XP_HIT);
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
  if (healed > 0) grantXp(s, u, XP_SUPPORT);
  return healed;
}

/** Coleta um item num nó de cor (em cima ou adjacente). Na Fonte, escolhe a cor. */
export function collect(s: GameState, x: number, y: number, color?: Exclude<NodeColor, 'prisma'>): ItemId {
  const { a, u } = requireAction(s);
  findTarget(s, (t) => t.kind === 'coleta' && t.x === x && t.y === y);
  const node = s.nodes.find((n) => n.x === x && n.y === y)!;
  const c = node.color === 'prisma' ? color : node.color;
  if (!c) throw new Error('Escolha a cor na Fonte Prismática');
  a.hasActed = true;
  node.charges--;
  const item = ITEM_BY_COLOR[c];
  u.items.push(item);
  s.events.push({ kind: 'texto', x: u.x, y: u.y, text: `+${ITEMS[item].name}`, color: '#c9e7ff' });
  log(s, `${unitName(u)} coletou ${ITEMS[item].name}.`);
  grantXp(s, u, XP_SUPPORT);
  return item;
}

/** O item pode ser usado agora? (Tônico com vida cheia, por exemplo, não.) */
export function canUseItem(s: GameState, index: number): boolean {
  const a = s.activation;
  if (!a || a.hasActed) return false;
  const u = getUnit(s, a.unitId);
  const item = u.items[index];
  if (!item) return false;
  if (item === 'tonico') return u.hp < u.maxHp;
  if (item === 'oleo') return !u.oil;
  return !u.focus;
}

export function useItem(s: GameState, index: number): void {
  const { a, u } = requireAction(s);
  if (!canUseItem(s, index)) throw new Error('Item não pode ser usado agora');
  const item = u.items.splice(index, 1)[0];
  a.hasActed = true;
  if (item === 'tonico') healUnit(s, u, TONICO_HEAL);
  else if (item === 'oleo') u.oil = true;
  else {
    u.focus = true;
    u.stamina = Math.min(CLASSES[u.cls].stamina, u.stamina + FOCO_STAMINA);
  }
  s.events.push({ kind: 'texto', x: u.x, y: u.y, text: ITEMS[item].name, color: '#c9e7ff' });
  log(s, `${unitName(u)} usou ${ITEMS[item].name}.`);
}

// ---------- Fim de ativação, de fase e de rodada ----------

export function endActivation(s: GameState): void {
  const a = s.activation;
  if (!a) throw new Error('Nenhuma unidade ativa');
  const u = getUnit(s, a.unitId);
  u.activated = true;
  // Prontidão: quem não agiu fica pronto para defender.
  u.ready = !a.hasActed && u.alive;
  s.activation = null;
  checkVictory(s);
  if (s.winner) return;
  if (!activatable(s).length) endPhase(s);
}

/** Encerra a fase do time ativo. Quem não agiu ganha Prontidão. */
export function endPhase(s: GameState): void {
  if (s.winner) return;
  if (s.activation) {
    const a = s.activation;
    const u = getUnit(s, a.unitId);
    u.activated = true;
    u.ready = !a.hasActed && u.alive;
    s.activation = null;
  }
  for (const u of activatable(s)) {
    u.activated = true;
    u.ready = true;
  }
  s.smoke = s.smoke.filter((sm) => sm.untilPhase > s.phase);

  const endsRound = s.activeTeam !== s.startingTeam;
  if (endsRound) {
    endOfRound(s);
    if (s.winner) return;
  }
  startPhase(s, otherTeam(s.activeTeam));
}

function endOfRound(s: GameState): void {
  // Torretas das Bases: 5 de dano em cada inimigo adjacente.
  for (const b of [s.bases.azul, s.bases.vermelho]) {
    if (b.hp <= 0) continue;
    for (const n of neighbors(s, b)) {
      const e = unitAt(s, n.x, n.y);
      if (e && e.team !== b.team) {
        log(s, `Torreta da Base ${teamName(b.team)} acerta ${unitName(e)}: ${TURRET_DAMAGE}.`);
        hitUnit(s, e, TURRET_DAMAGE);
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
  for (const n of s.nodes) n.charges = Math.min(NODE_CHARGES, n.charges + 1);
}

function startPhase(s: GameState, team: Team): void {
  s.phase++;
  s.activeTeam = team;
  for (const u of aliveUnits(s, team)) {
    u.activated = false;
    u.stamina = Math.min(CLASSES[u.cls].stamina, u.stamina + STAMINA_REGEN);
  }
  log(s, `${team === s.startingTeam ? `Rodada ${s.round}. ` : ''}Fase do ${teamName(team)}.`);
  resolveStrikes(s);
  if (!s.winner && !activatable(s).length) endPhase(s);
}

/** Fases que faltam até um disparo cair (0 = cai no começo da próxima fase). */
export function strikeCountdown(s: GameState, resolveAt: number): number {
  return Math.max(0, resolveAt - s.phase);
}

function resolveStrikes(s: GameState): void {
  const due = s.strikes.filter((st) => st.resolveAt <= s.phase);
  if (!due.length) return;
  s.strikes = s.strikes.filter((st) => st.resolveAt > s.phase);
  for (const st of due) {
    log(s, `Impacto de morteiro ${teamName(st.team)} em (${st.cx + 1},${st.cy + 1})!`);
    const owner = s.units.find((u) => u.id === st.ownerId) ?? null;
    if (areaDamage(s, st.cells, st.atq, st.mult, owner) > 0 && owner) grantXp(s, owner, XP_HIT);
  }
  checkVictory(s);
}

/** Retira e devolve os eventos visuais pendentes. */
export function drainEvents(s: GameState) {
  const ev = s.events;
  s.events = [];
  return ev;
}

export { barricadeAt, effectiveArmor };
