import type { ColorNode, NodeColor, Pos, Team, Terrain } from './types';

// Mapa "Vau do Prisma", 20×20, com simetria rotacional de 180°.
// Base Azul num canto, Vermelha no canto oposto; rio atravessando o meio (fileiras 9 e 10)
// com duas pontes e a Fonte Prismática no centro. Gerado por tools/genmap.py.
export const MAP_VAU: readonly string[] = [
  '....................',
  '.B....FF....#.......',
  '......F..CC...FF....',
  '...C.......#...L..F.',
  '....VFF.#...........',
  '.FF......C.FF...C...',
  '.....C......F....FF.',
  '.CR....FF.MM..CC....',
  '.#MMFF..M..M.F.MM#.C',
  '~~~=~~~~~PP~~~~~=~~~',
  '~~~=~~~~~PP~~~~~=~~~',
  'C.#MM.F.M..M..FFMM#.',
  '....CC..MM.FF....RC.',
  '.FF....F......C.....',
  '...C...FF.C......FF.',
  '...........#.FFV....',
  '.F..L...#.......C...',
  '....FF...CC..F......',
  '.......#....FF....B.',
  '....................',
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
  // A Base mais perto do canto superior esquerdo é do Azul.
  basePositions.sort((a, b) => a.x + a.y - (b.x + b.y));
  return { width, height, terrain, bases: { azul: basePositions[0], vermelho: basePositions[1] }, nodes };
}

const BLUE_SLOTS: Pos[] = [
  { x: 3, y: 1 },
  { x: 1, y: 3 },
  { x: 3, y: 2 },
  { x: 4, y: 2 },
  { x: 2, y: 4 },
];

/** Casas iniciais de cada time, na ordem em que as unidades escolhidas são colocadas. */
export const DEPLOY_SLOTS: Record<Team, Pos[]> = {
  azul: BLUE_SLOTS,
  // Espelho rotacional das casas azuis.
  vermelho: BLUE_SLOTS.map((p) => ({ x: 19 - p.x, y: 19 - p.y })),
};
