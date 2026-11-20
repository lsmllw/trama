// Geometria da quadra: gols, áreas, linhas de passe e de chute.

import { AREA_RADIUS, COURT_H, COURT_W } from './data';
import type { Dir, GameState, Player, Pos, Team } from './types';

export const other = (t: Team): Team => (t === 'azul' ? 'vermelho' : 'azul');
export const center = (p: Pos): Pos => ({ x: p.x + 0.5, y: p.y + 0.5 });
export const same = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;
export const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < COURT_W && y < COURT_H;
export const manhattan = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const chebyshev = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
export const dist = (a: Pos, b: Pos): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Centro do gol que o time ataca (ponto na linha de fundo). */
export function attackGoal(team: Team): Pos {
  return team === 'azul' ? { x: COURT_W, y: COURT_H / 2 } : { x: 0, y: COURT_H / 2 };
}

/** Centro do gol que o time defende. */
export function ownGoal(team: Team): Pos {
  return attackGoal(other(team));
}

/** Distância (em casas) do centro da casa ao gol que o time ataca. */
export function distToGoal(p: Pos, team: Team): number {
  return dist(center(p), attackGoal(team));
}

/** A casa está dentro da área do goleiro do time `defending`? */
export function inArea(defending: Team, p: Pos): boolean {
  return dist(center(p), ownGoal(defending)) <= AREA_RADIUS;
}

export const DIRS: Record<Dir, Pos> = { N: { x: 0, y: -1 }, S: { x: 0, y: 1 }, E: { x: 1, y: 0 }, W: { x: -1, y: 0 } };

export function dirFromTo(a: Pos, b: Pos): Dir {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

/** Casas atravessadas pela reta entre dois pontos (sem a casa de partida nem a de chegada). */
function cellsAlong(from: Pos, to: Pos, startCell: Pos, endCell: Pos | null): Pos[] {
  const out: Pos[] = [];
  const seen = new Set<string>([`${startCell.x},${startCell.y}`]);
  if (endCell) seen.add(`${endCell.x},${endCell.y}`);
  const d = dist(from, to);
  const steps = Math.max(1, Math.ceil(d / 0.1));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(from.x + (to.x - from.x) * t);
    const y = Math.floor(from.y + (to.y - from.y) * t);
    if (!inside(x, y)) continue;
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x, y });
  }
  return out;
}

/** Casas entre dois jogadores (linha do passe). */
export function passLine(a: Pos, b: Pos): Pos[] {
  return cellsAlong(center(a), center(b), a, b);
}

/** Casas entre o chutador e o gol. */
export function shotLine(p: Pos, team: Team): Pos[] {
  return cellsAlong(center(p), attackGoal(team), p, null);
}

/** Lado por onde `from` chega em `target`, pela direção em que o alvo está virado. */
export function approachSide(target: Player, from: Pos): 'frente' | 'flanco' | 'costas' {
  const f = DIRS[target.facing];
  const dx = from.x - target.x;
  const dy = from.y - target.y;
  const dot = dx * f.x + dy * f.y;
  if (dot > 0) return 'frente';
  if (dot < 0) return 'costas';
  return 'flanco';
}

export function playerAt(s: GameState, x: number, y: number): Player | undefined {
  return s.players.find((p) => p.x === x && p.y === y);
}

export function getPlayer(s: GameState, id: string): Player {
  const p = s.players.find((q) => q.id === id);
  if (!p) throw new Error(`Jogador ${id} não existe`);
  return p;
}

export function teamPlayers(s: GameState, team: Team): Player[] {
  return s.players.filter((p) => p.team === team);
}

export function holderOf(s: GameState): Player {
  return getPlayer(s, s.holder);
}

export function keeperOf(s: GameState, team: Team): Player | undefined {
  return s.players.find((p) => p.team === team && p.role === 'goleiro');
}
