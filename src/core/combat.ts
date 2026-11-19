import { CLASSES, ESQUIVA, TERRAIN } from './data';
import { terrainAt } from './grid';
import { otherTeam } from './types';
import type { Base, GameState, Pos, Team, Unit } from './types';

export const unitName = (u: Unit): string => `${CLASSES[u.cls].name} ${u.team === 'azul' ? 'Azul' : 'Vermelho'}`;
export const teamName = (t: Team): string => (t === 'azul' ? 'Azul' : 'Vermelho');

export function log(s: GameState, msg: string): void {
  s.log.push(msg);
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}

/** Armadura somando o bônus do terreno onde a unidade está. */
export function effectiveArmor(s: GameState, u: Unit): number {
  return CLASSES[u.cls].armadura + TERRAIN[terrainAt(s, u.x, u.y)].armorBonus;
}

/** Dano bruto: ATQ × multiplicador − Armadura, mínimo 1. */
export function rawDamage(atq: number, mult: number, armor: number): number {
  return Math.max(1, Math.floor(atq * mult - armor));
}

/** Tiro direto: esquiva passiva pelo peso do alvo e −40% com cobertura. */
export function rangedDamage(s: GameState, atq: number, mult: number, target: Unit): number {
  const base = atq * mult - effectiveArmor(s, target);
  const dodge = ESQUIVA[CLASSES[target.cls].weight];
  const cover = TERRAIN[terrainAt(s, target.x, target.y)].cover ? 0.4 : 0;
  return Math.max(1, Math.floor(base * (1 - dodge) * (1 - cover)));
}

export function hitUnit(s: GameState, u: Unit, amount: number): void {
  if (!u.alive || amount <= 0) return;
  u.hp = Math.max(0, u.hp - amount);
  s.events.push({ kind: 'dano', x: u.x, y: u.y, amount });
  if (u.hp === 0) {
    u.alive = false;
    s.stats[otherTeam(u.team)].kills++;
    s.events.push({ kind: 'abate', x: u.x, y: u.y });
    log(s, `${unitName(u)} foi abatido.`);
  }
}

export function hitBase(s: GameState, b: Base, amount: number): void {
  if (b.hp <= 0 || amount <= 0) return;
  const dealt = Math.min(b.hp, amount);
  b.hp -= dealt;
  s.stats[otherTeam(b.team)].baseDamage += dealt;
  s.events.push({ kind: 'dano', x: b.x, y: b.y, amount });
  if (b.hp === 0) log(s, `A Base ${teamName(b.team)} foi destruída!`);
}

export function healUnit(s: GameState, u: Unit, amount: number): number {
  const max = CLASSES[u.cls].hp;
  const healed = Math.min(amount, max - u.hp);
  u.hp += healed;
  if (healed > 0) s.events.push({ kind: 'cura', x: u.x, y: u.y, amount: healed });
  return healed;
}

/** Dano em área (morteiro, granada). Atinge aliados, inimigos e Bases. */
export function areaDamage(s: GameState, cells: Pos[], atq: number, mult: number): void {
  s.events.push({ kind: 'impacto', cells });
  for (const c of cells) {
    const u = s.units.find((v) => v.alive && v.x === c.x && v.y === c.y);
    if (u) {
      const dmg = rawDamage(atq, mult, effectiveArmor(s, u));
      log(s, `  ${unitName(u)} leva ${dmg} de dano.`);
      hitUnit(s, u, dmg);
    }
    for (const b of [s.bases.azul, s.bases.vermelho]) {
      if (b.x === c.x && b.y === c.y) {
        const dmg = rawDamage(atq, mult, b.armadura);
        log(s, `  Base ${teamName(b.team)} leva ${dmg} de dano.`);
        hitBase(s, b, dmg);
      }
    }
  }
}

export const aliveUnits = (s: GameState, team: Team): Unit[] => s.units.filter((u) => u.alive && u.team === team);

/** Vitória: destruir a Base inimiga ou eliminar todas as unidades. */
export function checkVictory(s: GameState): void {
  if (s.winner) return;
  const azulBase = s.bases.azul.hp <= 0;
  const vermBase = s.bases.vermelho.hp <= 0;
  if (azulBase || vermBase) {
    if (azulBase && vermBase) setWinner(s, 'empate', 'As duas Bases caíram ao mesmo tempo.');
    else setWinner(s, azulBase ? 'vermelho' : 'azul', 'Base inimiga destruída.');
    return;
  }
  const azulAlive = aliveUnits(s, 'azul').length;
  const vermAlive = aliveUnits(s, 'vermelho').length;
  if (azulAlive === 0 || vermAlive === 0) {
    if (azulAlive === 0 && vermAlive === 0) setWinner(s, 'empate', 'Os dois exércitos foram eliminados.');
    else setWinner(s, azulAlive === 0 ? 'vermelho' : 'azul', 'Todas as unidades inimigas eliminadas.');
  }
}

export function points(s: GameState, t: Team): number {
  return s.stats[t].kills * 3 + Math.floor(s.stats[t].baseDamage / 10);
}

/** Desempate por pontos ao fim da última rodada. */
export function decideByPoints(s: GameState): void {
  const a = points(s, 'azul');
  const v = points(s, 'vermelho');
  const detail = `Pontos: Azul ${a} × ${v} Vermelho.`;
  if (a === v) setWinner(s, 'empate', `Fim da rodada ${s.maxRounds}. ${detail}`);
  else setWinner(s, a > v ? 'azul' : 'vermelho', `Fim da rodada ${s.maxRounds}. ${detail}`);
}

function setWinner(s: GameState, w: Team | 'empate', reason: string): void {
  s.winner = w;
  s.winReason = reason;
  s.activation = null;
  log(s, w === 'empate' ? `Empate. ${reason}` : `Vitória do ${teamName(w)}! ${reason}`);
}
