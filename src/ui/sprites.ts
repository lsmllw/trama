// Personagens chibi em pixel art, montados a partir da aparência de cada jogador:
// cabeça grande, corpo pequeno, uniforme do time. Vista de frente (descendo na tela) e de
// costas (subindo, com o número), quadros parado, correndo, chutando e comemorando.

import type { Look, Player, Team } from '../core';

export type Frame = 'idle' | 'run1' | 'run2' | 'kick' | 'arms';
export type View = 'front' | 'back';

const W = 16;

// ---------- Cabeça ----------

const HEAD_FRONT = [
  '................',
  '................',
  '....ssssssss....',
  '...ssssssssss...',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '..sSsssEwssEwss.',
  '..sSsssEEssEEss.',
  '..ssssssssssssS.',
  '...ssssssmmsss..',
  '....ssssssss....',
];

const HEAD_BACK = [
  '................',
  '................',
  '....ssssssss....',
  '...ssssssssss...',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '..ssssssssssss..',
  '..Sssssssssssss.',
  '..Sssssssssssss.',
  '..ssssssssssssS.',
  '...ssssssssss...',
  '....ssssssss....',
];

/** Cabelos: 'h' = cabelo, 'H' = sombra. De frente ('f') e de costas ('b'), linhas 0–11. */
const HAIR: Record<Look['hair'], { f: string[]; b: string[] }> = {
  curto: {
    f: ['................', '................', '....hhhhhhhh....', '...hhhhhhhhhh...', '..Hhhhhhhhhhhh..', '..Hh........h...'],
    b: [
      '................',
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..hhhhhhhhhhhh..',
      '..Hhhhhhhhhhhh..',
      '..HHhhhhhhhhhh..',
      '...HHHhhhhhhH...',
    ],
  },
  espetado: {
    f: ['...h..h..h..h...', '...hh.hh.hh.hh..', '..hhhhhhhhhhhhh.', '..hhhhhhhhhhhhh.', '..Hhhhhhhhhhhhh.', '..Hhh...h...hh..'],
    b: [
      '...h..h..h..h...',
      '...hh.hh.hh.hh..',
      '..hhhhhhhhhhhhh.',
      '..hhhhhhhhhhhhh.',
      '..hhhhhhhhhhhhh.',
      '..hhhhhhhhhhhhh.',
      '..Hhhhhhhhhhhhh.',
      '..HHhhhhhhhhhh..',
      '...HHHhhhhhhH...',
    ],
  },
  black: {
    f: [
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '.hhhhhhhhhhhhhh.',
      '.hhhhhhhhhhhhhh.',
      '.Hhhhhhhhhhhhhh.',
      '.Hhh........hhh.',
      '.HH..........hh.',
      '.H...........h..',
    ],
    b: [
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '.hhhhhhhhhhhhhh.',
      '.hhhhhhhhhhhhhh.',
      '.hhhhhhhhhhhhhh.',
      '.hhhhhhhhhhhhhh.',
      '.Hhhhhhhhhhhhhh.',
      '.HHhhhhhhhhhhhh.',
      '.HHHhhhhhhhhhhH.',
      '..HHHHhhhhhhHH..',
    ],
  },
  franja: {
    f: ['................', '................', '...hhhhhhhhhh...', '..hhhhhhhhhhhh..', '..hhhhhhhhhhhhh.', '..Hhhhhhhhhhhhh.', '..Hh.........h..'],
    b: [
      '................',
      '................',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..hhhhhhhhhhhhh.',
      '..hhhhhhhhhhhhh.',
      '..Hhhhhhhhhhhhh.',
      '..HHhhhhhhhhhhh.',
      '..HHHhhhhhhhhH..',
      '...HHHHhhhhHH...',
    ],
  },
  careca: {
    f: ['................', '................', '....wwww........'],
    b: ['................', '................', '.....www........'],
  },
  rabo: {
    f: [
      '................',
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '.Hhh.........h..',
      'HHh.............',
      'HH..............',
      'H...............',
    ],
    b: [
      '................',
      '................',
      '....hhhhhhhh....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '..hhhhhhhhhhhh..',
      '..Hhhhhhhhhhhh..',
      '..HHhhhhhhhhhh..',
      '...HHhhHhhhhH...',
      '......HHH.......',
      '.......HH.......',
    ],
  },
  moicano: {
    f: ['.......hhh......', '......hhhhh.....', '......hhhhh.....', '.....HhhhhhH....', '.....Hh..hh.....'],
    b: ['.......hhh......', '......hhhhh.....', '......hhhhh.....', '......hhhhh.....', '......Hhhhh.....', '......HHhhH.....', '.......HHH......'],
  },
  cacheado: {
    f: ['....h.hh.hh.....', '...hhhhhhhhhh...', '..hhhhhhhhhhhh..', '.hhhhhhhhhhhhhh.', '.Hhhhhhhhhhhhhh.', '.Hh.h......h.hh.', '.H............h.'],
    b: [
      '....h.hh.hh.....',
      '...hhhhhhhhhh...',
      '..hhhhhhhhhhhh..',
      '.hhhhhhhhhhhhhh.',
      '.hhhhhhhhhhhhhh.',
      '.hhhhhhhhhhhhhh.',
      '.Hhhhhhhhhhhhhh.',
      '.HHhhhhhhhhhhhh.',
      '..HHhHhhhHhhH...',
    ],
  },
};

/** Acessórios por cima da cabeça/corpo: 'f' = cor do acessório, 'G' = armação escura, 'g' = lente. */
const ACC: Record<NonNullable<Look['acc']>, { f: (string | null)[]; b: (string | null)[] }> = {
  bigode: {
    f: [null, null, null, null, null, null, null, null, null, '.......ffffff...', '......f......f..'],
    b: [],
  },
  barba: {
    f: [null, null, null, null, null, null, null, null, '..f..........f..', '..ff.......fff..', '...fffffffffff..', '....ffffffff....'],
    b: [],
  },
  oculos: {
    f: [null, null, null, null, null, null, '......GGGGGGGG..', '..GGGGggGGggG...'],
    b: [null, null, null, null, null, null, '..GGGGGGGGGGGG..'],
  },
  faixa: {
    f: [null, null, null, '..ffffffffffff..'],
    b: [null, null, null, '..ffffffffffff..', '.ff.............'],
  },
  bandana: {
    f: [null, '....ffffffff....', '...ffffffffff...', '..ffffffffffff..', '.ff.............', 'ff..............'],
    b: [null, '....ffffffff....', '...ffffffffff...', '..ffffffffffff..', '..ffffffffffff..', '..f.f...........'],
  },
  munhequeira: { f: [], b: [] },
};

// ---------- Corpo ----------

type Build = Look['build'];

const BODY: Record<Build, string[]> = {
  magro: ['......ssss......', '.....cjjjc......', '....jjjjjjj.....', '...sjjjNNjjs....', '...sjjjNNjjs....', '...s.JjjjJ.s....'],
  normal: ['......ssss......', '....cjjjjjc.....', '...jjjjjjjjj....', '..sjjjjNNjjjs...', '..sjjjjNNjjjs...', '..s.JjjjjjJ.s...'],
  forte: ['......ssss......', '...cjjjjjjjc....', '..jjjjjjjjjjj...', '.ssjjjjNNjjjss..', '.ssjjjjNNjjjss..', '.ss.JjjjjjjJ.ss.'],
};

const LEGS: Record<Frame, string[]> = {
  idle: ['....pppppppp....', '....pppppppp....', '....ooo..ooo....', '....ooo..ooo....', '....bbb..bbb....', '...bbbb..bbbb...'],
  run1: ['....pppppppp....', '...pppp..pppp...', '..ooo......ooo..', '..oo........oo..', '.bbb........bbb.', '................'],
  run2: ['....pppppppp....', '.....pppppp.....', '......oooo......', '......oooo......', '.....bbbbbb.....', '......bbbb......'],
  kick: ['....pppppppp....', '....ppppppppp...', '....ooo...oooo..', '....ooo.....oobb', '....bbb......bbb', '...bbbb.........'],
  arms: ['....pppppppp....', '....pppppppp....', '....ooo..ooo....', '....ooo..ooo....', '....bbb..bbb....', '...bbbb..bbbb...'],
};

/** Algarismos 3×5 para o número nas costas. */
const DIGITS: Record<string, string[]> = {
  '0': ['NNN', 'N.N', 'N.N', 'N.N', 'NNN'],
  '1': ['.N.', 'NN.', '.N.', '.N.', 'NNN'],
  '2': ['NNN', '..N', 'NNN', 'N..', 'NNN'],
  '3': ['NNN', '..N', '.NN', '..N', 'NNN'],
  '4': ['N.N', 'N.N', 'NNN', '..N', '..N'],
  '5': ['NNN', 'N..', 'NNN', '..N', 'NNN'],
  '6': ['NNN', 'N..', 'NNN', 'N.N', 'NNN'],
  '7': ['NNN', '..N', '..N', '.N.', '.N.'],
  '8': ['NNN', 'N.N', 'NNN', 'N.N', 'NNN'],
  '9': ['NNN', 'N.N', 'NNN', '..N', 'NNN'],
};

// ---------- Cores ----------

export interface Kit {
  j: string;
  J: string;
  N: string;
  c: string;
  p: string;
  o: string;
  b: string;
  g: string;
}

export const KITS: Record<Team, { field: Kit; keeper: Kit }> = {
  azul: {
    field: {
      j: '#2f6fd8',
      J: '#1d4590',
      N: '#ffffff',
      c: '#ffffff',
      p: '#ffffff',
      o: '#2f6fd8',
      b: '#20232c',
      g: '#ffffff',
    },
    keeper: {
      j: '#f2c531',
      J: '#b8901c',
      N: '#1d4590',
      c: '#1d4590',
      p: '#1d4590',
      o: '#f2c531',
      b: '#20232c',
      g: '#ffffff',
    },
  },
  vermelho: {
    field: {
      j: '#d63a2f',
      J: '#8a2019',
      N: '#ffffff',
      c: '#ffffff',
      p: '#202128',
      o: '#d63a2f',
      b: '#f2f2f2',
      g: '#ffffff',
    },
    keeper: {
      j: '#2fbf6a',
      J: '#1d7f45',
      N: '#ffffff',
      c: '#ffffff',
      p: '#202128',
      o: '#2fbf6a',
      b: '#f2f2f2',
      g: '#ffe14d',
    },
  },
};

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amt))));
  return `#${((1 << 24) | (f((n >> 16) & 255) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).slice(1)}`;
}

// ---------- Montagem ----------

function overlay(grid: string[][], rows: (string | null)[], top: number, flip = false): void {
  rows.forEach((r, i) => {
    if (!r) return;
    const y = top + i;
    if (!grid[y]) return;
    for (let x = 0; x < W; x++) {
      const ch = r[flip ? W - 1 - x : x];
      if (ch && ch !== '.') grid[y][x] = ch;
    }
  });
}

/** Grade de cores (uma letra por pixel) de um jogador, num quadro e numa vista. */
export function playerGrid(p: Player, frame: Frame, view: View): string[][] {
  const grid: string[][] = Array.from({ length: 24 }, () => Array.from({ length: W }, () => '.'));
  const head = view === 'front' ? HEAD_FRONT : HEAD_BACK;
  overlay(grid, head, 0);
  const hair = HAIR[p.look.hair][view === 'front' ? 'f' : 'b'];
  overlay(grid, hair, 0);
  if (view === 'back') {
    // Atrás, a cabeça fica coberta onde o cabelo cobre; as orelhas aparecem.
    if (p.look.hair !== 'careca' && p.look.hair !== 'moicano') overlay(grid, ['', '', '', '', '', '', '', '.S............S.'], 0);
  }
  const acc = p.look.acc ? ACC[p.look.acc][view === 'front' ? 'f' : 'b'] : [];
  overlay(grid, acc, 0);
  const body = BODY[p.look.build].map((r) => r);
  if (p.role === 'goleiro') {
    // Mangas compridas e luvas.
    for (let i = 3; i < 6; i++) body[i] = body[i].replace(/s/g, i === 5 ? 'g' : 'J');
  }
  if (view === 'back') for (let i = 0; i < body.length; i++) body[i] = body[i].replace(/N/g, 'j');
  if (frame === 'arms') {
    // Braços para cima comemorando.
    for (let i = 3; i < 6; i++) body[i] = body[i].replace(/s|g/g, '.');
    // Do ombro para cima e para fora, em diagonal; a mão (ou a luva) na ponta.
    const sh = p.look.build === 'forte' ? 2 : p.look.build === 'normal' ? 3 : 4;
    const arm = p.role === 'goleiro' ? 'J' : 's';
    const hand = p.role === 'goleiro' ? 'g' : 's';
    for (let k = 0; k < 5; k++) {
      const y = 14 - k;
      const off = Math.floor(k / 2);
      const ch = k >= 3 ? hand : arm;
      grid[y][Math.max(0, sh - off)] = ch;
      grid[y][Math.min(W - 1, W - 1 - sh + off)] = ch;
    }
  }
  overlay(grid, body, 12);
  if (p.look.acc === 'munhequeira') {
    for (let x = 0; x < W; x++) if (grid[17][x] === 's') grid[17][x] = 'f';
  }
  overlay(grid, LEGS[frame], 18);
  if (view === 'back') {
    // Número nas costas.
    const digits = String(p.number).split('');
    const wTot = digits.length * 4 - 1;
    let x0 = Math.floor((W - wTot) / 2);
    for (const d of digits) {
      DIGITS[d].forEach((row, i) => {
        for (let k = 0; k < 3; k++) if (row[k] === 'N') grid[13 + i][x0 + k] = 'N';
      });
      x0 += 4;
    }
  }
  return grid;
}

/** Contorno escuro em volta de tudo (casas transparentes vizinhas de uma pintada). */
export function outline(grid: string[][]): string[][] {
  const H = grid.length + 2;
  const Wd = W + 2;
  const at = (x: number, y: number) => grid[y - 1]?.[x - 1] ?? '.';
  const out: string[][] = [];
  for (let y = 0; y < H; y++) {
    const row: string[] = [];
    for (let x = 0; x < Wd; x++) {
      const c = at(x, y);
      if (c !== '.') row.push(c);
      else row.push([at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n !== '.' && n !== 'k') ? 'k' : '.');
    }
    out.push(row);
  }
  return out;
}

export function palette(p: Player): Record<string, string> {
  const kit = p.role === 'goleiro' ? KITS[p.team].keeper : KITS[p.team].field;
  return {
    k: '#1a1418',
    s: p.look.skin,
    S: shade(p.look.skin, 0.18),
    E: '#1a1418',
    w: '#ffffff',
    m: '#9a4a3a',
    h: p.look.hairColor,
    H: shade(p.look.hairColor, 0.35),
    f: p.look.accColor ?? '#ffffff',
    G: '#22222a',
    ...kit,
  };
}

const cache = new Map<string, HTMLCanvasElement>();

/** Canvas do sprite (1 pixel por casa), com contorno. */
export function playerSprite(p: Player, frame: Frame = 'idle', view: View = 'front'): HTMLCanvasElement {
  const key = `${p.id}:${frame}:${view}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const grid = outline(playerGrid(p, frame, view));
  const pal = palette(p);
  const c = document.createElement('canvas');
  c.width = grid[0].length;
  c.height = grid.length;
  const ctx = c.getContext('2d')!;
  grid.forEach((row, y) =>
    row.forEach((ch, x) => {
      if (ch === '.') return;
      ctx.fillStyle = pal[ch] ?? '#ff00ff';
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  cache.set(key, c);
  return c;
}

/** Silhueta branca do sprite (piscar ao levar um drible ou um desarme). */
export function whiteSprite(p: Player, frame: Frame = 'idle', view: View = 'front'): HTMLCanvasElement {
  const key = `w:${p.id}:${frame}:${view}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const src = playerSprite(p, frame, view);
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  cache.set(key, c);
  return c;
}

/** Retrato ampliado (data URL) para os cards e a janela de informações. */
export function portraitUrl(p: Player, scale = 3): string {
  const src = playerSprite(p, 'idle', 'front');
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
}

/** A bola (7×7, com gomos), desenhada por cima de tudo. */
export const BALL = ['..kkk..', '.kwwwk.', 'kwkkwwk', 'kwkkwkk', 'kwwwwwk', '.kwkwk.', '..kkk..'];

// ---------- Garrafa de energético ----------

const DRINK = [
  '..kkk..',
  '..kSk..',
  '..kkk..',
  '..kGk..',
  '.kGGGk.',
  'kGwGGGk',
  'kGwGGdk',
  'kkkykkk',
  'kkyykkk',
  'kkkyykk',
  'kkkykkk',
  'kGwGGdk',
  'kGGGGdk',
  '.kkkkk.',
];
const DRINK_COLORS: Record<string, string> = { k: '#10141a', S: '#d8dde6', G: '#2ee86a', d: '#17a34a', w: '#c9ffd9', y: '#ffe14d' };

/** Garrafa de energético em pixel art (7×14), guardada em cache. */
export function drinkSprite(white = false): HTMLCanvasElement {
  const key = `drink:${white}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 7;
  c.height = DRINK.length;
  const ctx = c.getContext('2d')!;
  DRINK.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      ctx.fillStyle = white ? '#ffffff' : DRINK_COLORS[ch];
      ctx.fillRect(x, y, 1, 1);
    }
  });
  cache.set(key, c);
  return c;
}

export function drinkIconUrl(scale = 2): string {
  const src = drinkSprite();
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
}
