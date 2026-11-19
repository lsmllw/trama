import type { ColorNode, NodeColor, Pos, Team, Terrain } from './types';

// Mapa "Vau do Prisma", 24×16, com simetria rotacional de 180°.
// Só a metade de cima (Vermelho) é escrita; a de baixo (Azul) é gerada girando.
const TOP_HALF: readonly string[] = [
  '....FF......B.....C.....',
  '...FF...#.........CCC...',
  '............V...........',
  '..L...C........FF....R..',
  '........#..MM...#.......',
  '.FF.................C...',
  '..........C.......FF....',
  '~~~=~~~~~~~PP~~~~~~~=~~~',
];

const rotate = (row: string) => [...row].reverse().join('');

export const MAP_VAU: readonly string[] = [...TOP_HALF, ...[...TOP_HALF].reverse().map(rotate)];

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

const NODE_COLOR: Partial<Record<Terrain, NodeColor>> = {
  no_verde: 'verde',
  no_roxo: 'roxo',
  no_laranja: 'laranja',
  fonte: 'prisma',
};

export interface ParsedMap {
  width: number;
  height: number;
  terrain: Terrain[][];
  bases: Record<Team, Pos>;
  nodes: Omit<ColorNode, 'charges'>[];
}

export function parseMap(rows: readonly string[]): ParsedMap {
  const height = rows.length;
  const width = rows[0].length;
  const terrain: Terrain[][] = [];
  const basePositions: Pos[] = [];
  const nodes: Omit<ColorNode, 'charges'>[] = [];
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`Linha ${y} do mapa tem largura ${row.length}, esperado ${width}`);
    const line: Terrain[] = [];
    for (let x = 0; x < width; x++) {
      const t = CHAR_TO_TERRAIN[row[x]];
      if (!t) throw new Error(`Caractere desconhecido '${row[x]}' em (${x},${y})`);
      if (t === 'base') basePositions.push({ x, y });
      const color = NODE_COLOR[t];
      if (color) nodes.push({ x, y, color });
      line.push(t);
    }
    terrain.push(line);
  });
  if (basePositions.length !== 2) throw new Error('O mapa precisa de exatamente 2 bases');
  // A base de cima é do Vermelho.
  basePositions.sort((a, b) => a.y - b.y);
  return { width, height, terrain, bases: { vermelho: basePositions[0], azul: basePositions[1] }, nodes };
}

const BLUE_SLOTS: Pos[] = [
  { x: 11, y: 14 },
  { x: 9, y: 14 },
  { x: 13, y: 14 },
  { x: 7, y: 13 },
  { x: 15, y: 13 },
];

/** Casas iniciais de cada time, na ordem em que as unidades escolhidas são colocadas. */
export const DEPLOY_SLOTS: Record<Team, Pos[]> = {
  azul: BLUE_SLOTS,
  // Espelho rotacional das casas azuis.
  vermelho: BLUE_SLOTS.map((p) => ({ x: 23 - p.x, y: 15 - p.y })),
};
