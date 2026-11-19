import { CLASSES, TERRAIN } from './data';
import type { Base, Dir, GameState, Pos, Terrain, Unit } from './types';

export const DIRS: Record<Dir, Pos> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};
export const DIR_LIST: readonly Dir[] = ['N', 'E', 'S', 'W'];

export const key = (s: GameState, x: number, y: number): number => y * s.width + x;
export const fromKey = (s: GameState, k: number): Pos => ({ x: k % s.width, y: Math.floor(k / s.width) });

export const inBounds = (s: GameState, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < s.width && y < s.height;

export const terrainAt = (s: GameState, x: number, y: number): Terrain => s.terrain[y][x];

export const manhattan = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function unitAt(s: GameState, x: number, y: number): Unit | undefined {
  return s.units.find((u) => u.alive && u.x === x && u.y === y);
}

export function baseAt(s: GameState, x: number, y: number): Base | undefined {
  const { azul, vermelho } = s.bases;
  if (azul.x === x && azul.y === y) return azul;
  if (vermelho.x === x && vermelho.y === y) return vermelho;
  return undefined;
}

export function getUnit(s: GameState, id: string): Unit {
  const u = s.units.find((v) => v.id === id);
  if (!u) throw new Error(`Unidade inexistente: ${id}`);
  return u;
}

export function neighbors(s: GameState, p: Pos): Pos[] {
  const out: Pos[] = [];
  for (const d of DIR_LIST) {
    const x = p.x + DIRS[d].x;
    const y = p.y + DIRS[d].y;
    if (inBounds(s, x, y)) out.push({ x, y });
  }
  return out;
}

/** Custo para a unidade entrar na casa (Infinity = intransitável). */
export function moveCost(s: GameState, unit: Unit, x: number, y: number): number {
  const def = TERRAIN[terrainAt(s, x, y)];
  if (CLASSES[unit.cls].arm === 'cavalaria' && def.cavalryCost !== undefined) return def.cavalryCost;
  return def.cost;
}

export interface ReachNode {
  cost: number;
  prev: number | null;
}

/**
 * Casas alcançáveis com `mp` pontos de movimento (Dijkstra, só ortogonal).
 * Passa por aliados, não por inimigos. Casas ocupadas aparecem no resultado
 * (servem de passagem); use `canStop` para saber onde dá para parar.
 */
export function reachable(s: GameState, unit: Unit, mp: number, from: Pos = unit): Map<number, ReachNode> {
  const dist = new Map<number, ReachNode>();
  const startKey = key(s, from.x, from.y);
  dist.set(startKey, { cost: 0, prev: null });
  // Fila simples: o grid é pequeno (192 casas).
  const open: number[] = [startKey];
  while (open.length) {
    open.sort((a, b) => dist.get(a)!.cost - dist.get(b)!.cost);
    const cur = open.shift()!;
    const curNode = dist.get(cur)!;
    const p = fromKey(s, cur);
    for (const n of neighbors(s, p)) {
      const c = moveCost(s, unit, n.x, n.y);
      if (!Number.isFinite(c)) continue;
      const occupant = unitAt(s, n.x, n.y);
      if (occupant && occupant.team !== unit.team) continue;
      const total = curNode.cost + c;
      if (total > mp) continue;
      const k = key(s, n.x, n.y);
      const known = dist.get(k);
      if (!known || total < known.cost) {
        dist.set(k, { cost: total, prev: cur });
        if (!open.includes(k)) open.push(k);
      }
    }
  }
  return dist;
}

export function canStop(s: GameState, unit: Unit, x: number, y: number): boolean {
  const occupant = unitAt(s, x, y);
  return !occupant || occupant.id === unit.id;
}

export function pathTo(s: GameState, reach: Map<number, ReachNode>, x: number, y: number): Pos[] {
  const path: Pos[] = [];
  let k: number | null = key(s, x, y);
  while (k !== null) {
    const node = reach.get(k);
    if (!node) return [];
    path.unshift(fromKey(s, k));
    k = node.prev;
  }
  return path;
}

/** Linha de visão por Bresenham; unidades e Bases no caminho bloqueiam. */
export function lineOfSight(s: GameState, a: Pos, b: Pos): boolean {
  let x0 = a.x;
  let y0 = a.y;
  const dx = Math.abs(b.x - x0);
  const dy = -Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1;
  const sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  while (!(x0 === b.x && y0 === b.y)) {
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    if (x0 === b.x && y0 === b.y) break;
    if (unitAt(s, x0, y0) || baseAt(s, x0, y0)) return false;
  }
  return true;
}

/** Direção dominante de a para b. */
export function dirFromTo(a: Pos, b: Pos): Dir {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

export type Side = 'frente' | 'flanco' | 'costas';

/** De que lado do defensor está quem ataca, considerando para onde ele está virado. */
export function attackSide(defender: Unit, attacker: Pos): Side {
  const f = DIRS[defender.facing];
  const dx = attacker.x - defender.x;
  const dy = attacker.y - defender.y;
  const dot = dx * f.x + dy * f.y;
  if (dot > 0) return 'frente';
  if (dot < 0) return 'costas';
  return 'flanco';
}

export function crossCells(s: GameState, cx: number, cy: number): Pos[] {
  const cells: Pos[] = [{ x: cx, y: cy }];
  for (const d of DIR_LIST) {
    const x = cx + DIRS[d].x;
    const y = cy + DIRS[d].y;
    if (inBounds(s, x, y)) cells.push({ x, y });
  }
  return cells;
}
