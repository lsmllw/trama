// Sprites em pixel art de cada classe, virados para a direita. Cada letra é uma cor da paleta;
// '.' é transparente. O contorno escuro é gerado em volta de tudo (não é desenhado à mão), e
// 't', 'T' e 'l' são trocados pelas cores do time.

import type { ClassId, Team } from '../core';

export const BASE_PALETTE: Record<string, string> = {
  k: '#1a1418',
  s: '#eab98e',
  S: '#b98058',
  h: '#4a3122',
  m: '#b4bac3',
  M: '#666d78',
  w: '#f4f7fa',
  b: '#dcb052',
  B: '#8e6b27',
  n: '#8b5b39',
  N: '#573721',
  c: '#ece5d3',
  C: '#b4a98f',
  g: '#8fe3f0',
  r: '#d63c2c',
  y: '#ffd85e',
  o: '#f08a2a',
  p: '#2e2a38',
  P: '#4c4659',
  f: '#d2d2d6',
  F: '#9a9aa2',
  x: '#a46c3e',
  X: '#6a4224',
};

export const TEAM_PALETTE: Record<Team, Record<string, string>> = {
  azul: { t: '#3f7fe4', T: '#224a8c', l: '#8ab8f7' },
  vermelho: { t: '#d4483b', T: '#7a2620', l: '#f39385' },
};

export interface SpriteDef {
  /** Coluna do centro dos pés (âncora no chão). */
  ax: number;
  rows: string[];
}

export const SPRITES: Record<ClassId, SpriteDef> = {
  espadachim: {
    ax: 9,
    rows: [
      '....................',
      '.......tttl.........',
      '.......bbbb.........',
      '.....TTTTTTTT.......',
      '......hhsss.........',
      '......hsskss.......w',
      '......hssssss.....wm',
      '.......Ssss......wm.',
      '........SS......wm..',
      '......ttlltt...wm...',
      '.....tTtllttT.wm....',
      '.....TttlltttTb.....',
      '.....TtbbBbbtss.....',
      '.....sTtTttTt.......',
      '......TtTttTt.......',
      '......TTt.tTT.......',
      '.......nn..nN.......',
      '.......nn..nN.......',
      '.......nn..nN.......',
      '......NNN..NNN......',
    ],
  },
  atirador: {
    ax: 9,
    rows: [
      '......................',
      '.......TTTT...........',
      '.......gbbg...........',
      '.....TTTTTTTT.........',
      '......hhsss...........',
      '......hsskss..........',
      '......hssssss.........',
      '.......Ssss...........',
      '...bb...SS............',
      '..bBBb.ttltt..........',
      '..bBBbtTtlttT.........',
      '..bBBbTttlltMMMMMMMMMw',
      '..bBBbTnnnnnnsM.......',
      '...bb.TtttttTs........',
      '......TtTttTt.........',
      '......TTt.tTT.........',
      '.......nn..nN.........',
      '.......nn..nN.........',
      '.......nn..nN.........',
      '......NNN..NNN........',
    ],
  },
  tank: {
    ax: 8,
    rows: [
      '.....................',
      '......mmmmm..........',
      '.....mmwmmmm.........',
      '.....MmkkkkM.........',
      '.....mmmmmmm.........',
      '.....MMmmmMM.........',
      '...mmmtttttmm.bbbbb..',
      '..mmwtTtlltTmbtttttb.',
      '..mMMtTtlltTmbtllltb.',
      '..mMMTTtlltTTbtlbltb.',
      '..mmsTTtlltTTbtbbbtb.',
      '...mssbbBbbTTbtlbltb.',
      '....TTTtttTTTbtllltb.',
      '....TTTttTTTTbtttttb.',
      '....MMM...MMM.bbbbb..',
      '....mmm...mmm........',
      '....mMm...mMm........',
      '...MMMM..MMMM........',
    ],
  },
  cavaleiro: {
    ax: 10,
    rows: [
      '.........lt...............',
      '........mmm...............',
      '.......mmwmm..............',
      '.......MkkkM..............',
      '.......mmmmm..............',
      '......tTtltT..............',
      '......tTtltTsbmmmmmmmmmmw.',
      '......tTtltT.......XX.....',
      '.....bbBbbbb......XXxxx...',
      '.....ttTTTtt.....XXxxkxx..',
      '...xxxnTTTnxxxxXXxxxxxxx..',
      '..xxxxxNxxNxxxxxXx...xxxX.',
      '.XXxxxxxxxxxxxxxxX........',
      '.X.xxxxxxxxxxxxxxX........',
      '.X..XxxxxxxxxxxxX.........',
      '....Xx.Xx...xX.xX.........',
      '....Xx.Xx...xX.xX.........',
      '....Xx.Xx...xX.xX.........',
      '....NN.NN...NN.NN.........',
    ],
  },
  blindado: {
    ax: 12,
    rows: [
      '..ff......................',
      '.ffff.....................',
      '..fFff....................',
      '....fMM...................',
      '.....mM...tttttt..........',
      '.....mM..tTttttlt.........',
      '.....mM.tTTtgttlt.MMMMMw..',
      '....bbbbbTTTttttbmmmmmmw..',
      '..bbtttttttttttttttbb.....',
      '.bTTttllllttttllltttTb....',
      '.bTTtbttbttbttbttbtTTb....',
      '.bTTTTTTTTTTTTTTTTTTTb....',
      '.MMmMMmMMmMMmMMmMMmMMMM...',
      'MmwMmwMmwMmwMmwMmwMmwMmM..',
      '.MMMMMMMMMMMMMMMMMMMMMM...',
    ],
  },
  morteiro: {
    ax: 9,
    rows: [
      '.................MkkkM.',
      '................MbwmbM.',
      '...............MmwmmM..',
      '..............MmwmmM...',
      '......TTT....MbwmbM....',
      '.....TTTTT..MmwmmM.....',
      '......hhss.MmmmmM......',
      '......hsks..MMMs.......',
      '......hsss....s........',
      '.......SS....ts........',
      '......ttbBlttt.........',
      '.....tTtbBttT..........',
      '.....TrtrtrtT..........',
      '.....TtbbBbbtT.........',
      '.....sTtTttTts.........',
      '......TtTttTt..........',
      '......TTt.tTT..........',
      '.......nn..nN..........',
      '.......nn..nN..........',
      '.......nn..nN..........',
      '......NNN..NNN.........',
    ],
  },
  canhao: {
    ax: 11,
    rows: [
      '..........................',
      '...TTT....................',
      '..TTTTT...................',
      '...hss..............bb....',
      '...hsks.........bbbbBBbb..',
      '...Sss.....bbbbbBBBBBBBBbw',
      '..ttlt...bbBBBBBBBBBBBBbbw',
      '.tTtltt.bBBBBBBBBBbbbbbb..',
      '.TttltTsnBBBBBbbbbb.......',
      '.TtttTT.nnttttttn.........',
      '.TTtTT..nTnnnxnnTn........',
      '..Tt.T....xNbNx...........',
      '..nn.n...xNbbbNx..........',
      '..nn.n...xbbBbbx..........',
      '..nn.n...xNbbbNx..........',
      '.NNN.NN...xNbNx...........',
    ],
  },
  bombardeiro: {
    ax: 9,
    rows: [
      '..............y.....',
      '.............y.y....',
      '..............b.....',
      '.......nnn...ppp....',
      '......nnnnn.ppppp...',
      '......gggg..pppPp...',
      '......hsskss.ppp....',
      '......hssssss.s.....',
      '.......Ssss..ts.....',
      '........SS..tt......',
      '......ttltttt.......',
      '..nn.tTtllttT.......',
      '.nNNnTttlltT........',
      '.nNNnTtbbBbtT.......',
      '..nn.sTtTttTt.......',
      '......TtTttTt.......',
      '......TTt.tTT.......',
      '.......nn..nN.......',
      '.......nn..nN.......',
      '.......nn..nN.......',
      '......NNN..NNN......',
    ],
  },
  mecanico: {
    ax: 9,
    rows: [
      '................m..m',
      '................m..m',
      '.......TTTT.....mmmm',
      '.....TTTTTT....Mm...',
      '......gggg.....Mm...',
      '......hsskss..Mm....',
      '......hssssss.Mm....',
      '.......Ssss..Mm.....',
      '........SS...Mm.....',
      '......ttlltt.ss.....',
      '.....tTlttltTs......',
      '.....TtbttbtT.......',
      '.....TtlttltT.......',
      '.....sTbbBbbT.......',
      '.....MtTtTtTt.......',
      '......tTt.tTt.......',
      '......tTt.tTt.......',
      '.......nn..nN.......',
      '.......nn..nN.......',
      '......NNN..NNN......',
    ],
  },
  construtor: {
    ax: 9,
    rows: [
      '......................',
      '.......bbbb...........',
      '......bbybbb..........',
      '.....BBBBBBBB.........',
      '......hhsss...MMMMMMM.',
      '......hsskss..MbmmmbM.',
      '......hssssss.MMMMMMM.',
      '.......Ssss......n....',
      '...ttttlltt......n....',
      '..tTTtlllttT.....n....',
      '..tTTtlllttTT....n....',
      '..TTTtlllttTTttsn.....',
      '..TTTnbbBbbnTs...n....',
      '..sTTnmnmnmnT....n....',
      '...TTTtttttTT.........',
      '...TTTt..tTTT.........',
      '....nnn..nnN..........',
      '....nnn..nnN..........',
      '...NNNN..NNNN.........',
    ],
  },
  medico: {
    ax: 9,
    rows: [
      '....................',
      '.......cccc.........',
      '.......rrrr.........',
      '......ccccccc.......',
      '......hhsss.........',
      '......hsskss........',
      '......hssssss.......',
      '.......Ssss.........',
      '........SS..........',
      '......ccccc.........',
      '.....cCccrcc........',
      '.....CccrrrcS.......',
      '.....CCccrccsS......',
      '.....Cccccccs.......',
      '.....sCcccccc.nnn...',
      '......CccCcc.nrn....',
      '......CCc.cC.nnn....',
      '.......tt..tT.......',
      '.......nn..nN.......',
      '......NNN..NNN......',
    ],
  },
  espiao: {
    ax: 9,
    rows: [
      '....................',
      '.......pppp.........',
      '.......tttt.........',
      '.....pppppppp.......',
      '......hsppps........',
      '......hspkps........',
      '......hssssss.......',
      '.......Ssss.........',
      '......tttts.........',
      '.....PtTttlP........',
      '.....PPpppPP........',
      '.....PppppppPsmmw...',
      '.....PpppppppS......',
      '.....PpppppppP......',
      '.....PppPpPpp.......',
      '......pp.pPpP.......',
      '......pP..pPP.......',
      '.......pp..pP.......',
      '.......pp..pP.......',
      '......NNN..NNN......',
    ],
  },
};

/** Grade com contorno: cada casa transparente vizinha (4 lados) de uma pintada vira 'k'. */
export function outlined(rows: string[]): string[] {
  const H = rows.length + 2;
  const W = Math.max(...rows.map((r) => r.length)) + 2;
  const at = (x: number, y: number) => {
    const r = rows[y - 1];
    if (!r) return '.';
    return r[x - 1] ?? '.';
  };
  const out: string[] = [];
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const c = at(x, y);
      if (c !== '.') line += c;
      else line += [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].some((n) => n !== '.' && n !== 'k') ? 'k' : '.';
    }
    out.push(line);
  }
  return out;
}

const cache = new Map<string, HTMLCanvasElement>();

/** Canvas do sprite (1 pixel por casa), já com contorno e cores do time. */
export function spriteCanvas(cls: ClassId, team: Team): HTMLCanvasElement {
  const key = `${cls}:${team}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = outlined(SPRITES[cls].rows);
  const pal = { ...BASE_PALETTE, ...TEAM_PALETTE[team] };
  const c = document.createElement('canvas');
  c.width = rows[0].length;
  c.height = rows.length;
  const ctx = c.getContext('2d')!;
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const ch = r[x];
      if (ch === '.') continue;
      ctx.fillStyle = pal[ch] ?? '#ff00ff';
      ctx.fillRect(x, y, 1, 1);
    }
  });
  cache.set(key, c);
  return c;
}

/** Âncora (coluna dos pés) já contando a borda de 1 pixel do contorno. */
export function spriteAnchor(cls: ClassId): number {
  return SPRITES[cls].ax + 1.5;
}

/** Imagem do sprite (data URL), ampliada sem borrar, para usar no HTML (cards). */
export function spriteDataUrl(cls: ClassId, team: Team, scale = 3): string {
  const src = spriteCanvas(cls, team);
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
}
