// Habilidades: uma por classe, liberada no level 2. Usar a habilidade é a ação da unidade.

import {
  aliveUnits,
  checkVictory,
  consumeOil,
  effectiveArmor,
  grantXp,
  healUnit,
  hitUnit,
  log,
  rawDamage,
  teamName,
  unitAtq,
  unitName,
} from './combat';
import { ABILITIES, ABILITY_LEVEL, AREA_HEAL, BARRICADE_HP, MAX_ITEMS, MAX_MINES_PER_OWNER, REPAIR_ANY, RAM_BONUS, REPAIR_AMOUNT, XP_HIT, XP_SUPPORT } from './data';
import { startConfronto } from './confronto';
import type { ConfrontoState } from './confronto';
import {
  baseAt,
  barricadeAt,
  DIR_LIST,
  DIRS,
  dirFromTo,
  getUnit,
  inBounds,
  isOpen,
  lineOfSight,
  manhattan,
  mineAt,
  moveCost,
  squareCells,
  terrainAt,
  unitAt,
} from './grid';
import { requireAction, tauntOf } from './game';
import { otherTeam } from './types';
import type { AbilityId, GameState, Pos, Unit } from './types';

export interface AbilityTarget {
  ability: AbilityId;
  x: number;
  y: number;
  /** Unidade alvo, quando houver. */
  unitId?: string;
  /** Casa onde a unidade termina (Avanço). */
  land?: Pos;
}

export const abilityOf = (u: Unit) => ABILITIES[u.cls];
/** Level em que a habilidade da classe é liberada. */
export const unlockLevel = (u: Unit): number => ABILITIES[u.cls].unlock ?? ABILITY_LEVEL;
export const abilityUnlocked = (u: Unit): boolean => u.level >= unlockLevel(u);

/** Por que a habilidade não pode ser usada agora (null = pode). */
export function abilityBlock(s: GameState, u: Unit): string | null {
  if (!abilityUnlocked(u)) return `Liberada no level ${unlockLevel(u)}`;
  if (u.stamina < abilityOf(u).cost) return `Precisa de ${abilityOf(u).cost} de Stamina`;
  const a = s.activation;
  if (a && a.unitId === u.id && a.hasActed) return 'A unidade já agiu';
  return null;
}

function enemiesFor(s: GameState, u: Unit): Unit[] {
  const taunter = tauntOf(s, u);
  return aliveUnits(s, otherTeam(u.team)).filter((e) => !taunter || e.id === taunter.id);
}

/** Alvos da habilidade de `u` se ela estivesse em `from`. Lista vazia = sem uso possível. */
export function abilityTargets(s: GameState, u: Unit, from: Pos = u, moved = s.activation?.hasMoved ?? false): AbilityTarget[] {
  const ab = abilityOf(u).id;
  const out: AbilityTarget[] = [];
  const enemies = enemiesFor(s, u);
  switch (ab) {
    case 'avanco':
      for (const d of DIR_LIST) {
        for (let dist = 2; dist <= 3; dist++) {
          const tx = from.x + DIRS[d].x * dist;
          const ty = from.y + DIRS[d].y * dist;
          const target = enemies.find((e) => e.x === tx && e.y === ty);
          if (!target) continue;
          let clear = true;
          for (let i = 1; i < dist; i++) {
            const cx = from.x + DIRS[d].x * i;
            const cy = from.y + DIRS[d].y * i;
            if (!inBounds(s, cx, cy) || !Number.isFinite(moveCost(s, u, cx, cy)) || (unitAt(s, cx, cy) && !(cx === u.x && cy === u.y)) || baseAt(s, cx, cy)) clear = false;
          }
          if (clear) out.push({ ability: ab, x: tx, y: ty, unitId: target.id, land: { x: tx - DIRS[d].x, y: ty - DIRS[d].y } });
        }
      }
      break;
    case 'tiroCerteiro':
      for (const e of enemies) {
        const d = manhattan(from, e);
        if (d >= 2 && d <= 5 && lineOfSight(s, from, e)) out.push({ ability: ab, x: e.x, y: e.y, unitId: e.id });
      }
      break;
    case 'provocar':
      if (aliveUnits(s, otherTeam(u.team)).some((e) => manhattan(from, e) <= 2)) out.push({ ability: ab, x: from.x, y: from.y });
      break;
    case 'investida':
      for (const e of enemies) if (manhattan(from, e) === 1) out.push({ ability: ab, x: e.x, y: e.y, unitId: e.id });
      break;
    case 'atropelar':
      for (const e of enemies) if (manhattan(from, e) === 1) out.push({ ability: ab, x: e.x, y: e.y, unitId: e.id });
      break;
    case 'fumaca':
      for (let y = 0; y < s.height; y++)
        for (let x = 0; x < s.width; x++) {
          const d = manhattan(from, { x, y });
          if (d >= 2 && d <= 6) out.push({ ability: ab, x, y });
        }
      break;
    case 'perfurante':
      if (moved) break;
      for (const e of enemies) {
        if (e.x !== from.x && e.y !== from.y) continue;
        const d = manhattan(from, e);
        if (d < 4 || d > 8) continue;
        const between = lineCells(from, e).slice(1, -1);
        if (between.some((c) => baseAt(s, c.x, c.y) || barricadeAt(s, c.x, c.y))) continue;
        if (between.filter((c) => unitAt(s, c.x, c.y)).length > 1) continue;
        out.push({ ability: ab, x: e.x, y: e.y, unitId: e.id });
      }
      break;
    case 'mina':
      if (s.mines.filter((m) => m.ownerId === u.id).length >= MAX_MINES_PER_OWNER) break;
      for (let y = from.y - 2; y <= from.y + 2; y++)
        for (let x = from.x - 2; x <= from.x + 2; x++) {
          const d = manhattan(from, { x, y });
          if (d >= 1 && d <= 2 && isOpen(s, x, y) && !mineAt(s, x, y)) out.push({ ability: ab, x, y });
        }
      break;
    case 'reparo': {
      const base = s.bases[u.team];
      if (manhattan(from, base) === 1 && base.hp < base.maxHp) out.push({ ability: ab, x: base.x, y: base.y });
      for (const b of s.barricades) if (b.team === u.team && manhattan(from, b) === 1 && b.hp < BARRICADE_HP) out.push({ ability: ab, x: b.x, y: b.y });
      for (const ally of aliveUnits(s, u.team)) {
        const fits = REPAIR_ANY.value || ally.cls === 'blindado' || ally.cls === 'canhao';
        if (fits && ally.id !== u.id && manhattan(from, ally) === 1 && ally.hp < ally.maxHp) {
          out.push({ ability: ab, x: ally.x, y: ally.y, unitId: ally.id });
        }
      }
      break;
    }
    case 'barricada':
      for (const d of DIR_LIST) {
        const x = from.x + DIRS[d].x;
        const y = from.y + DIRS[d].y;
        const isNode = s.nodes.some((n) => n.x === x && n.y === y);
        if (isOpen(s, x, y) && !mineAt(s, x, y) && !isNode && terrainAt(s, x, y) !== 'ponte') out.push({ ability: ab, x, y });
      }
      break;
    case 'curaArea':
      if (aliveUnits(s, u.team).some((v) => manhattan(from, v) <= 2 && v.hp < v.maxHp)) out.push({ ability: ab, x: from.x, y: from.y });
      break;
    case 'furtar':
      if (u.items.length < MAX_ITEMS) for (const e of enemies) if (manhattan(from, e) === 1 && e.items.length) out.push({ ability: ab, x: e.x, y: e.y, unitId: e.id });
      break;
  }
  return out;
}

function lineCells(a: Pos, b: Pos): Pos[] {
  const cells: Pos[] = [];
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  cells.push({ x, y });
  while (x !== b.x || y !== b.y) {
    x += dx;
    y += dy;
    cells.push({ x, y });
  }
  return cells;
}

export function currentAbilityTargets(s: GameState): AbilityTarget[] {
  const a = s.activation;
  if (!a || a.hasActed) return [];
  const u = getUnit(s, a.unitId);
  if (abilityBlock(s, u)) return [];
  return abilityTargets(s, u);
}

/** Usa a habilidade. Avanço e Investida devolvem um Confronto para o chamador resolver. */
export function useAbility(s: GameState, x: number, y: number): ConfrontoState | null {
  const { a, u } = requireAction(s);
  const block = abilityBlock(s, u);
  if (block) throw new Error(block);
  const t = currentAbilityTargets(s).find((v) => v.x === x && v.y === y);
  if (!t) throw new Error('Alvo inválido para a habilidade');
  const def = abilityOf(u);
  a.hasActed = true;
  u.stamina -= def.cost;
  log(s, `${unitName(u)} usa ${def.name}.`);
  s.events.push({ kind: 'texto', x: u.x, y: u.y, text: def.name, color: '#d7b8ff' });
  const target = t.unitId ? getUnit(s, t.unitId) : null;

  switch (def.id) {
    case 'avanco': {
      u.x = t.land!.x;
      u.y = t.land!.y;
      a.mpLeft = 0;
      a.hasMoved = true;
      u.facing = dirFromTo(u, target!);
      return startConfronto(s, u.id, target!.id, { lances: 1 });
    }
    case 'investida':
      u.facing = dirFromTo(u, target!);
      return startConfronto(s, u.id, target!.id, { lances: 1, atq: 2 });
    case 'tiroCerteiro': {
      const dmg = rawDamage(unitAtq(u) + consumeOil(u), 2.0, effectiveArmor(s, target!));
      u.facing = dirFromTo(u, target!);
      s.events.push({ kind: 'tiro', from: { x: u.x, y: u.y }, to: { x: target!.x, y: target!.y } });
      log(s, `  Acerta ${unitName(target!)}: ${dmg} de dano.`);
      hitUnit(s, target!, dmg, u);
      grantXp(s, u, XP_HIT);
      break;
    }
    case 'provocar':
      for (const e of aliveUnits(s, otherTeam(u.team))) {
        if (manhattan(u, e) <= 2) {
          e.tauntBy = u.id;
          e.tauntUntil = s.phase + 1;
          log(s, `  ${unitName(e)} está provocado.`);
        }
      }
      grantXp(s, u, XP_SUPPORT);
      break;
    case 'atropelar': {
      const tgt = target!;
      const dir = dirFromTo(u, tgt);
      const nx = tgt.x + DIRS[dir].x;
      const ny = tgt.y + DIRS[dir].y;
      let dmg = rawDamage(unitAtq(u) + consumeOil(u), 1.0, effectiveArmor(s, tgt));
      const blocked = !inBounds(s, nx, ny) || !Number.isFinite(moveCost(s, tgt, nx, ny)) || !!unitAt(s, nx, ny) || !!baseAt(s, nx, ny);
      u.facing = dir;
      if (blocked) {
        dmg += RAM_BONUS;
        log(s, `  ${unitName(tgt)} bate no obstáculo: ${dmg} de dano.`);
      } else {
        tgt.x = nx;
        tgt.y = ny;
        log(s, `  ${unitName(tgt)} é empurrado: ${dmg} de dano.`);
      }
      hitUnit(s, tgt, dmg, u);
      grantXp(s, u, XP_HIT);
      break;
    }
    case 'fumaca':
      s.smoke.push({ cells: squareCells(s, x, y, 1), untilPhase: s.phase + 1 });
      log(s, `  Fumaça em (${x + 1},${y + 1}) bloqueia tiros até o fim da próxima fase.`);
      break;
    case 'perfurante': {
      u.facing = dirFromTo(u, target!);
      s.events.push({ kind: 'tiro', from: { x: u.x, y: u.y }, to: { x: target!.x, y: target!.y } });
      const hit = lineCells(u, target!)
        .slice(1)
        .map((c) => unitAt(s, c.x, c.y))
        .filter((v): v is Unit => !!v);
      const atq = unitAtq(u) + consumeOil(u);
      for (const v of hit.slice(0, 2)) {
        const dmg = rawDamage(atq, 1.5, effectiveArmor(s, v));
        log(s, `  Atravessa ${unitName(v)}: ${dmg} de dano.`);
        hitUnit(s, v, dmg, u);
      }
      grantXp(s, u, XP_HIT);
      break;
    }
    case 'mina':
      s.mines.push({ id: s.nextId++, team: u.team, ownerId: u.id, x, y });
      log(s, '  Mina armada.');
      break;
    case 'reparo': {
      const base = s.bases[u.team];
      if (base.x === x && base.y === y) {
        const healed = Math.min(REPAIR_AMOUNT, base.maxHp - base.hp);
        base.hp += healed;
        s.events.push({ kind: 'cura', x, y, amount: healed });
        log(s, `  Base ${teamName(u.team)} reparada em ${healed}.`);
      } else if (target) {
        const healed = healUnit(s, target, REPAIR_AMOUNT);
        log(s, `  ${unitName(target)} reparado em ${healed}.`);
      } else {
        const b = s.barricades.find((v) => v.x === x && v.y === y)!;
        b.hp = Math.min(BARRICADE_HP, b.hp + REPAIR_AMOUNT);
      }
      grantXp(s, u, XP_SUPPORT);
      break;
    }
    case 'barricada':
      s.barricades.push({ id: s.nextId++, team: u.team, x, y, hp: BARRICADE_HP });
      log(s, `  Barricada erguida em (${x + 1},${y + 1}).`);
      break;
    case 'curaArea': {
      let total = 0;
      for (const v of aliveUnits(s, u.team)) if (manhattan(u, v) <= 2) total += healUnit(s, v, AREA_HEAL);
      log(s, `  Curou ${total} no total.`);
      if (total > 0) grantXp(s, u, XP_SUPPORT);
      break;
    }
    case 'furtar': {
      const item = target!.items.shift()!;
      u.items.push(item);
      log(s, `  Roubou um item de ${unitName(target!)}.`);
      grantXp(s, u, XP_SUPPORT);
      break;
    }
  }
  checkVictory(s);
  return null;
}


