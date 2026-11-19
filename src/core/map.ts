import type { Pos, Team, Terrain } from './types';

// Mapa "Vau do Prisma", 16×12, simetria rotacional de 180°.
// Vermelho em cima, Azul embaixo.
export const MAP_VAU: readonly string[] = [
  '..F.....B....C..',
  '.FF..........CC.',
  '........V.......',
  '.L....#....#..R.',
  '...C........FF..',
  '~~=~~~~PP~~~~=~~',
  '~~=~~~~PP~~~~=~~',
  '..FF........C...',
  '.R..#....#....L.',
  '.......V........',
  '.CC..........FF.',
  '..C....B.....F..',
];

const CHAR_TO_TERRAIN: Record<string, Terrain> = {
  '.': 'planicie',
  F: 'floresta',
  C: 'colina',
  '#': 'ruina',
  M: 'lama',
  '~': 'agua',
  '=': 'ponte',
  V: 'no_verde',
  R: 'no_roxo',
  L: 'no_laranja',
  P: 'fonte',
  B: 'base',
};

export interface ParsedMap {
  width: number;
  height: number;
  terrain: Terrain[][];
  bases: Record<Team, Pos>;
}

export function parseMap(rows: readonly string[]): ParsedMap {
  const height = rows.length;
  const width = rows[0].length;
  const terrain: Terrain[][] = [];
  const basePositions: Pos[] = [];
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`Linha ${y} do mapa tem largura ${row.length}, esperado ${width}`);
    const line: Terrain[] = [];
    for (let x = 0; x < width; x++) {
      const t = CHAR_TO_TERRAIN[row[x]];
      if (!t) throw new Error(`Caractere desconhecido '${row[x]}' em (${x},${y})`);
      if (t === 'base') basePositions.push({ x, y });
      line.push(t);
    }
    terrain.push(line);
  });
  if (basePositions.length !== 2) throw new Error('O mapa precisa de exatamente 2 bases');
  // A base de cima é do Vermelho.
  basePositions.sort((a, b) => a.y - b.y);
  return { width, height, terrain, bases: { vermelho: basePositions[0], azul: basePositions[1] } };
}

/** Casas iniciais de cada time, na ordem em que as unidades escolhidas são colocadas. */
export const DEPLOY_SLOTS: Record<Team, Pos[]> = {
  azul: [
    { x: 7, y: 10 },
    { x: 5, y: 10 },
    { x: 9, y: 10 },
    { x: 4, y: 9 },
    { x: 10, y: 9 },
  ],
  // Espelho rotacional das casas azuis.
  vermelho: [
    { x: 8, y: 1 },
    { x: 10, y: 1 },
    { x: 6, y: 1 },
    { x: 11, y: 2 },
    { x: 5, y: 2 },
  ],
};
