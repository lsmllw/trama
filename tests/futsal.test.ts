import { describe, expect, it } from 'vitest';
import {
  absRound,
  assignTraits,
  statsOf,
  extraMode,
  hasSpecial,
  sprint,
  ROLES,
  activationsLeft,
  cutRange,
  moveRange,
  setStyle,
  tacklesMax,
  activatable,
  diffLances,
  startReaction,
  applyDuel,
  canUseDrink,
  drainEvents,
  undoMove,
  useDrink,
  beginActivation,
  createGame,
  currentTargets,
  destinations,
  duelOutcome,
  endActivation,
  endPhase,
  getPlayer,
  holderOf,
  inArea,
  moveTo,
  pass,
  passPreview,
  resolveTempo,
  ROSTERS,
  shoot,
  shotPreview,
  shotResult,
  simulateGame,
  startDuel,
  startTackle,
  takeDirectKick,
  teamPlayers,
} from '../src/core';
import type { GameState, Player, Trait } from '../src/core';

const byName = (s: GameState, name: string): Player => s.players.find((p) => p.name === name)!;
/** Tira todos de perto e põe só quem interessa. */
function clearCourt(s: GameState): void {
  s.players.forEach((p, i) => {
    const gk = p.role === 'goleiro';
    p.x = gk ? (p.team === 'azul' ? 0 : 19) : -10 - i;
    p.y = gk ? 4 : -10;
  });
}

describe('elencos e saída de bola', () => {
  it('5 por time, 1 goleiro, todos com nome e visual diferentes', () => {
    for (const team of ['azul', 'vermelho'] as const) {
      expect(ROSTERS[team]).toHaveLength(5);
      expect(ROSTERS[team].filter((r) => r.role === 'goleiro')).toHaveLength(1);
    }
    const all = [...ROSTERS.azul, ...ROSTERS.vermelho];
    expect(new Set(all.map((r) => r.name)).size).toBe(10);
    expect(new Set(all.map((r) => JSON.stringify(r.look))).size).toBe(10);
  });
  it('o Pivô de quem dá a saída começa com a bola, e cada goleiro na sua área', () => {
    const s = createGame({ seed: 1 });
    expect(holderOf(s).name).toBe('Marreta');
    expect(s.activeTeam).toBe('azul');
    expect(inArea('azul', byName(s, 'Gui'))).toBe(true);
    expect(inArea('vermelho', byName(s, 'Biel'))).toBe(true);
  });
});

describe('movimento', () => {
  it('quem tem a bola para ao chegar colado num marcador; o goleiro não sai da área', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const m = byName(s, 'Dudu');
    m.x = 5;
    m.y = 5;
    s.holder = m.id;
    const d = byName(s, 'Tonhão');
    d.x = 8;
    d.y = 5;
    beginActivation(s, m.id);
    const cells = destinations(s);
    expect(cells.some((c) => c.x === 7 && c.y === 5)).toBe(true); // pode chegar colado
    expect(cells.some((c) => c.x === 9 && c.y === 6)).toBe(false); // mas não passar
    s.activation = null;
    const gk = byName(s, 'Gui');
    beginActivation(s, gk.id);
    expect(destinations(s).every((c) => inArea('azul', c))).toBe(true);
  });
});

describe('passe', () => {
  it('zona de corte sempre corta o rasteiro; o alto passa por cima', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const a = byName(s, 'Rafa');
    const b = byName(s, 'Marreta');
    const d = byName(s, 'Pity');
    a.x = 3;
    a.y = 5;
    b.x = 9;
    b.y = 5;
    d.x = 6;
    d.y = 4;
    s.holder = a.id;
    expect(passPreview(s, a, b, false)).toMatchObject({ ok: true, result: 'cortado', otherId: d.id });
    expect(passPreview(s, a, b, true)).toMatchObject({ ok: true, result: 'ok' });
    beginActivation(s, a.id);
    pass(s, b.id, false);
    expect(s.holder).toBe(d.id);
  });
  it('recebedor marcado por quem marca melhor que o seu domínio: bola dividida', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const a = byName(s, 'Rafa');
    const b = byName(s, 'Marreta'); // DOM 4
    const f = byName(s, 'Tonhão'); // MAR 5
    a.x = 5;
    a.y = 5;
    b.x = 8;
    b.y = 5;
    f.x = 9;
    f.y = 5;
    expect(passPreview(s, a, b, false)).toMatchObject({ result: 'dividida', otherId: f.id });
  });
});

describe('Duelo', () => {
  it('lances vêm da diferença entre o Domínio de quem tem a bola e a Marcação de quem marca', () => {
    expect([diffLances(5, 3), diffLances(5, 4), diffLances(5, 5), diffLances(4, 5), diffLances(3, 5)]).toEqual([3, 2, 2, 2, 1]);
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const ala = byName(s, 'Dudu');
    const fixo = byName(s, 'Tonhão');
    ala.x = 10;
    ala.y = 5;
    fixo.x = 11;
    fixo.y = 5;
    s.holder = ala.id;
    const cs = startDuel(s, 'desarme', fixo.id, ala.id);
    expect(cs.atk.lances).toBe(2); // MAR 5 contra DOM 5
    expect(cs.def.lances).toBe(2);
    expect(cs.def.vantage).toBe(1); // posse
    // O fixo com a bola (DOM 3) contra o fixo que marca (MAR 5): 1 contra 3.
    const rafa = byName(s, 'Rafa');
    rafa.x = 10;
    rafa.y = 4;
    s.holder = rafa.id;
    const cs2 = startDuel(s, 'desarme', fixo.id, rafa.id);
    expect([cs2.atk.lances, cs2.def.lances]).toEqual([3, 1]);
  });
  it('Esperar recupera fôlego e dá uma Leitura para o tempo seguinte', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const ala = byName(s, 'Dudu');
    const lelo = byName(s, 'Lelo');
    ala.x = 10;
    ala.y = 5;
    lelo.x = 11;
    lelo.y = 5;
    s.holder = ala.id;
    ala.fol = 5;
    const cs = startDuel(s, 'drible', ala.id, lelo.id);
    resolveTempo(s, cs, 'esperar', 'golpe');
    expect(ala.fol).toBe(6);
    expect(cs.atk.readsLeft).toBe(1);
  });
  it('Bote contra Proteger é falta; da 4ª falta em diante, tiro livre direto do 10 m', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const ala = byName(s, 'Dudu');
    const fixo = byName(s, 'Tonhão');
    ala.x = 10;
    ala.y = 5;
    fixo.x = 11;
    fixo.y = 5;
    s.holder = ala.id;
    s.fouls.vermelho = 3;
    s.activeTeam = 'vermelho';
    beginActivation(s, fixo.id);
    const cs = startTackle(s, ala.id);
    resolveTempo(s, cs, 'golpe', 'guarda');
    expect(cs.done && cs.foul).toBe(true);
    expect(duelOutcome(cs)).toBe('falta');
    applyDuel(s, cs);
    expect(s.fouls.vermelho).toBe(4);
    expect(s.pendingDirect).toBe(ala.id);
    const r = takeDirectKick(s, 'esq', 'dir');
    expect(r).toBe('gol');
    expect(s.score.azul).toBe(1);
  });
  it('drible vencido: passa para trás do marcador, que fica desequilibrado, e ainda pode passar ou chutar', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const ala = byName(s, 'Dudu');
    const lelo = byName(s, 'Lelo');
    ala.x = 12;
    ala.y = 5;
    lelo.x = 13;
    lelo.y = 5;
    s.holder = ala.id;
    beginActivation(s, ala.id);
    const cs = startDuel(s, 'drible', ala.id, lelo.id);
    s.activation!.acted = true;
    while (!cs.done) resolveTempo(s, cs, 'finta', 'esperar');
    expect(applyDuel(s, cs)).toBe('passou');
    expect([ala.x, ala.y]).toEqual([14, 5]);
    expect(lelo.unbalanced).toBe(true);
    expect(s.activation!.bonus).toBe(true);
    expect(currentTargets(s).some((t) => t.kind === 'chute')).toBe(true);
  });
});

describe('chute', () => {
  it('chance gradual: força contra reflexo, perto do gol mais forte, longe mais fraco', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const piv = byName(s, 'Marreta');
    piv.x = 18;
    piv.y = 5;
    s.holder = piv.id;
    const pv = shotPreview(s, piv);
    expect(pv.force).toBe(7);
    expect(pv.chance).toBeCloseTo(0.6);
    piv.x = 12;
    const far = shotPreview(s, piv);
    expect(far.force).toBeLessThan(5);
    expect(far.chance).toBeLessThan(pv.chance);
    // Goleiro fora da linha do chute: o reflexo efetivo cai.
    piv.x = 16;
    piv.y = 1;
    const keeper = byName(s, 'Biel');
    keeper.x = 19;
    keeper.y = 7;
    const off = shotPreview(s, piv);
    expect(off.cover).toBe('deslocado');
    expect(off.refEff).toBeLessThan(off.ref);
  });
  it('defensor colado na linha atrapalha; gol faz quem sofreu dar a saída', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const piv = byName(s, 'Marreta');
    piv.x = 16;
    piv.y = 5;
    s.holder = piv.id;
    const blocker = byName(s, 'Tonhão');
    blocker.x = 17;
    blocker.y = 5;
    const free = shotPreview(s, { ...piv, x: 16, y: 4 } as typeof piv);
    expect(shotPreview(s, piv).blockerId).toBe(blocker.id);
    expect(shotPreview(s, piv).chance).toBeLessThan(free.chance);
    blocker.x = -5;
    // Goleiro fora da área: gol vazio.
    byName(s, 'Biel').x = 12;
    beginActivation(s, piv.id);
    expect(shoot(s)).toBe('gol');
    expect(s.score.azul).toBe(1);
    expect(holderOf(s).team).toBe('vermelho');
    expect(s.activeTeam).toBe('vermelho');
  });
  it('tiro livre direto ainda é no palpite: canto certo pega até força REF+2', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const piv = byName(s, 'Marreta');
    piv.x = 18;
    piv.y = 5;
    s.holder = piv.id;
    const pv = shotPreview(s, piv, false, true);
    expect(shotResult(pv, 'esq', 'esq')).toBe('defesa');
    expect(shotResult(pv, 'esq', 'dir')).toBe('gol');
  });
});

describe('prontidão e fases', () => {
  it('com a bola o time age com os 5; sem ela, com 3, e os outros ficam de prontidão', () => {
    const s = createGame({ seed: 1 });
    expect(s.activationsMax).toBe(5);
    endPhase(s); // vermelho, sem a bola
    expect(s.activeTeam).toBe('vermelho');
    expect(s.activationsMax).toBe(3);
    for (let i = 0; i < 3; i++) {
      const p = activatable(s)[0];
      beginActivation(s, p.id);
      endActivation(s);
    }
    expect(s.activeTeam).toBe('azul'); // a fase acabou sozinha depois do 3º
    expect(s.players.filter((p) => p.team === 'vermelho' && p.ready)).toHaveLength(2);
  });
  it('de prontidão, o defensor corta o rasteiro a 2 casas da linha e dá bote em quem para colado', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const ala = byName(s, 'Dudu');
    const teco = byName(s, 'Teco');
    const lelo = byName(s, 'Lelo');
    ala.x = 6;
    ala.y = 5;
    teco.x = 11;
    teco.y = 5;
    lelo.x = 8;
    lelo.y = 7; // 2 casas da linha
    s.holder = ala.id;
    expect(passPreview(s, ala, teco, false).result).toBe('ok');
    lelo.ready = true;
    expect(passPreview(s, ala, teco, false).result).toBe('cortado');
    // Bote automático: Dudu anda e para colado em Lelo.
    lelo.x = 9;
    lelo.y = 3;
    beginActivation(s, ala.id);
    moveTo(s, 8, 3);
    expect(s.pendingReaction).toBe(lelo.id);
    const cs = startReaction(s);
    expect(cs.kind).toBe('bote');
    expect(lelo.ready).toBe(false);
    expect(cs.atk.notes.some((n) => n.includes('prontidão'))).toBe(true);
  });
  it('passe alto custa fôlego, a recepção é disputada a 2 casas e quem recebe não chuta na mesma fase', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const ala = byName(s, 'Dudu');
    const piv = byName(s, 'Marreta');
    const tonhao = byName(s, 'Tonhão');
    ala.x = 10;
    ala.y = 5;
    piv.x = 15;
    piv.y = 5;
    tonhao.x = 13;
    tonhao.y = 3;
    s.holder = ala.id;
    expect(passPreview(s, ala, piv, true).result).toBe('dividida');
    tonhao.x = -5;
    beginActivation(s, ala.id);
    const fol = ala.fol;
    pass(s, piv.id, true);
    expect(ala.fol).toBe(fol - 1);
    endActivation(s);
    beginActivation(s, piv.id);
    expect(currentTargets(s).some((t) => t.kind === 'chute' || t.kind === 'drible')).toBe(false);
  });
  it('só um desarme por fase para o time', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const ala = byName(s, 'Dudu');
    const tonhao = byName(s, 'Tonhão');
    const lelo = byName(s, 'Lelo');
    ala.x = 10;
    ala.y = 5;
    tonhao.x = 11;
    tonhao.y = 5;
    lelo.x = 10;
    lelo.y = 6;
    s.holder = ala.id;
    s.activeTeam = 'vermelho';
    beginActivation(s, tonhao.id);
    const cs = startTackle(s, ala.id);
    while (!cs.done) resolveTempo(s, cs, 'esperar', 'esperar');
    applyDuel(s, cs);
    endActivation(s);
    beginActivation(s, lelo.id);
    expect(currentTargets(s).some((t) => t.kind === 'desarme')).toBe(false);
  });
});

describe('tempos', () => {
  it('6 rodadas por tempo, intervalo zera faltas, depois fim de jogo', () => {
    const s = createGame({ seed: 2 });
    s.fouls.azul = 3;
    let phases = 0;
    while (s.half === 1 && phases < 40) {
      endPhase(s);
      phases++;
    }
    expect(phases).toBe(12);
    expect(s.fouls.azul).toBe(0);
    expect(s.activeTeam).toBe('vermelho');
    while (!s.over && phases < 80) {
      endPhase(s);
      phases++;
    }
    expect(phases).toBe(24);
    expect(s.winner).toBe('empate');
  });
  it('goleiro que pega a bola tem de soltá-la na fase seguinte (4 segundos)', () => {
    const s = createGame({ seed: 1 });
    const gk = byName(s, 'Gui');
    s.holder = gk.id;
    endPhase(s); // azul → vermelho
    endPhase(s); // vermelho → azul: Gui começa com a bola
    expect(s.keeperMustPass).toBe(gk.id);
    beginActivation(s, gk.id);
    endActivation(s);
    expect(holderOf(s).team).toBe('vermelho');
  });
});

describe('IA', () => {
  it('joga partidas inteiras sem travar, com gols', () => {
    let goals = 0;
    for (let i = 0; i < 3; i++) {
      const s = simulateGame(40 + i);
      expect(s.over).toBe(true);
      goals += s.score.azul + s.score.vermelho;
      expect(teamPlayers(s, 'azul')).toHaveLength(5);
    }
    expect(goals).toBeGreaterThan(0);
  }, 120_000);
});

void getPlayer;
void moveTo;

describe('energético', () => {
  it('a torcida joga garrafas em casas livres, que somem depois de 3 rodadas', () => {
    let spawned = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = createGame({ seed });
      const seen = new Map<string, number>();
      while (!s.over) {
        for (const d of s.drinks) {
          expect(s.players.some((p) => p.x === d.x && p.y === d.y && p.id)).toBe(false);
          expect(inArea('azul', d) || inArea('vermelho', d)).toBe(false);
          seen.set(d.id, d.born);
          expect(absRound(s)).toBeLessThan(d.expires);
          expect(d.expires - d.born).toBe(3);
        }
        expect(s.drinks.length).toBeLessThanOrEqual(2);
        endPhase(s);
      }
      spawned += seen.size;
    }
    expect(spawned).toBeGreaterThan(6);
  });

  it('pega a garrafa no caminho, desfazer devolve, e tomar dá fôlego cheio e +2 casas', () => {
    const s = createGame({ seed: 3 });
    clearCourt(s);
    const dudu = byName(s, 'Dudu');
    dudu.x = 5;
    dudu.y = 2;
    dudu.fol = 3;
    s.holder = byName(s, 'Gui').id;
    s.drinks = [{ id: 'g9', x: 7, y: 2, born: 1, expires: 4 }];
    drainEvents(s);
    beginActivation(s, dudu.id);
    const range = destinations(s).length;
    moveTo(s, 9, 2);
    expect(dudu.energetico).toBe(true);
    expect(s.drinks).toHaveLength(0);
    const ev = drainEvents(s);
    expect(ev.map((e) => e.kind)).toEqual(['move', 'garrafa', 'move']);
    undoMove(s);
    expect(dudu.energetico).toBe(false);
    expect(s.drinks).toHaveLength(1);
    moveTo(s, 7, 2);
    expect(dudu.energetico).toBe(true);
    endActivation(s);
    // Na próxima ativação dele, o energético rende.
    s.activeTeam = 'azul';
    dudu.activated = false;
    beginActivation(s, dudu.id);
    const before = destinations(s).length;
    expect(canUseDrink(s)).toBe(true);
    useDrink(s);
    expect(dudu.fol).toBe(10);
    expect(dudu.energetico).toBe(false);
    expect(destinations(s).length).toBeGreaterThan(before);
    expect(range).toBeGreaterThan(0);
  });
});

describe('estilos de jogo', () => {
  it('Pressão alta: sem a bola ativa 4, desarma 2 vezes e cansa mais', () => {
    const s = createGame({ seed: 1, styles: { vermelho: 'pressao' } });
    endPhase(s);
    expect(s.activationsMax).toBe(4);
    expect(tacklesMax(s)).toBe(2);
    const p = activatable(s)[0];
    const fol = p.fol;
    beginActivation(s, p.id);
    endActivation(s);
    expect(p.fol).toBe(fol - 2);
  });
  it('Bloco baixo: sem a bola ativa só 2, mas a prontidão corta a 3 casas', () => {
    const s = createGame({ seed: 1, styles: { vermelho: 'bloco' } });
    endPhase(s);
    expect(s.activationsMax).toBe(2);
    const lelo = byName(s, 'Lelo');
    lelo.ready = true;
    expect(cutRange(s, lelo)).toBe(3);
    const s2 = createGame({ seed: 1 });
    const lelo2 = byName(s2, 'Lelo');
    lelo2.ready = true;
    expect(cutRange(s2, lelo2)).toBe(2);
  });
  it('Posse de bola: toque curto só é cortado por quem está em cima da linha', () => {
    for (const style of ['equilibrio', 'posse'] as const) {
      const s = createGame({ seed: 1, styles: { azul: style } });
      clearCourt(s);
      const ala = byName(s, 'Dudu');
      const teco = byName(s, 'Teco');
      const lelo = byName(s, 'Lelo');
      ala.x = 6;
      ala.y = 5;
      teco.x = 9;
      teco.y = 5;
      lelo.x = 7;
      lelo.y = 7;
      lelo.ready = true;
      s.holder = ala.id;
      expect(passPreview(s, ala, teco, false).result).toBe(style === 'posse' ? 'ok' : 'cortado');
      lelo.x = 7;
      lelo.y = 5;
      expect(passPreview(s, ala, teco, false).result).toBe('cortado');
    }
  });
  it('Contra-ataque: depois de recuperar a bola, corre +1 e o 1º passe alto é livre; posse longa ativa só 4', () => {
    const s = createGame({ seed: 1, styles: { azul: 'contra' } });
    const dudu = byName(s, 'Dudu');
    expect(s.counterPhase).toBe(false); // saída de bola não é recuperação
    s.holder = byName(s, 'Bigode').id;
    endPhase(s);
    s.holder = dudu.id; // roubou na fase do Vermelho
    endPhase(s);
    expect(s.counterPhase).toBe(true);
    expect(moveRange(s, byName(s, 'Teco'))).toBe(6); // ala: MOV 5 + 1
    clearCourt(s);
    const piv = byName(s, 'Marreta');
    dudu.x = 6;
    dudu.y = 5;
    piv.x = 11;
    piv.y = 5;
    const tonhao = byName(s, 'Tonhão');
    tonhao.x = 12;
    tonhao.y = 6;
    expect(passPreview(s, dudu, piv, true).result).toBe('ok');
    beginActivation(s, dudu.id);
    const fol = dudu.fol;
    pass(s, piv.id, true);
    expect(dudu.fol).toBe(fol);
    expect(passPreview(s, dudu, piv, true).result).toBe('dividida'); // só o primeiro é livre
    // Mais de 3 fases seguidas com a bola: o time ativa só 4.
    const s2 = createGame({ seed: 1, styles: { azul: 'contra' } });
    for (let i = 0; i < 4; i++) endPhase(s2);
    expect(s2.activationsMax).toBe(5);
    endPhase(s2);
    endPhase(s2);
    expect(s2.activationsMax).toBe(4);
  });
  it('Contra-ataque: roubou na própria fase, ganha mais 2 jogadores na hora', () => {
    const s = createGame({ seed: 1, styles: { vermelho: 'contra' } });
    endPhase(s); // Vermelho, sem a bola: ativa 3
    expect(s.activationsMax).toBe(3);
    const p = activatable(s)[0];
    beginActivation(s, p.id);
    s.holder = p.id; // como se tivesse roubado
    endActivation(s);
    expect(s.counterPhase).toBe(true);
    expect(s.activationsMax).toBe(5);
    expect(activationsLeft(s)).toBe(4);
  });
  it('Bloco baixo: mesmo com a bola, ativa só 4 (o último homem fica de prontidão)', () => {
    const s = createGame({ seed: 1, styles: { azul: 'bloco' } });
    expect(s.activationsMax).toBe(4);
  });
  it('Bloco baixo marca por zona no próprio campo (segura a 2 casas), mas não contra a Posse de bola', () => {
    for (const style of ['equilibrio', 'posse'] as const) {
      const s = createGame({ seed: 1, styles: { azul: style, vermelho: 'bloco' } });
      clearCourt(s);
      const dudu = byName(s, 'Dudu');
      const tonhao = byName(s, 'Tonhão');
      dudu.x = 10;
      dudu.y = 5;
      tonhao.x = 15;
      tonhao.y = 5;
      tonhao.ready = true;
      s.holder = dudu.id;
      beginActivation(s, dudu.id);
      const far = destinations(s).filter((c) => c.x >= 14);
      // Pela zona, ninguém passa de x = 13 (a 2 casas do Tonhão) na linha dele.
      if (style === 'equilibrio') expect(far.some((c) => c.y === 5)).toBe(false);
      else expect(far.length).toBeGreaterThan(0);
    }
  });
  it('Bloco baixo cansa quando o adversário segura a bola', () => {
    const s = createGame({ seed: 1, styles: { vermelho: 'bloco' } });
    const tonhao = byName(s, 'Tonhão');
    endPhase(s); // Vermelho
    const before = tonhao.fol;
    endPhase(s); // Azul, 2ª fase seguida com a bola: o bloco perde 1
    expect(tonhao.fol).toBe(before - 1);
  });
  it('Posse de bola: cada toque curto na fase dá +1 de força no chute', () => {
    const s = createGame({ seed: 1, styles: { azul: 'posse' } });
    clearCourt(s);
    const dudu = byName(s, 'Dudu');
    const piv = byName(s, 'Marreta');
    dudu.x = 14;
    dudu.y = 5;
    piv.x = 16;
    piv.y = 5;
    s.holder = dudu.id;
    const f0 = shotPreview(s, piv).force;
    beginActivation(s, dudu.id);
    pass(s, piv.id, false);
    expect(s.passChain).toBe(1);
    expect(shotPreview(s, piv).force).toBe(f0 + 1);
  });
  it('troca de estilo no começo da fase já muda os limites', () => {
    const s = createGame({ seed: 1 });
    endPhase(s);
    expect(s.activationsMax).toBe(3);
    setStyle(s, 'vermelho', 'bloco');
    expect(s.activationsMax).toBe(2);
  });
});

describe('características', () => {
  const give = (s: GameState, name: string, trait: Trait) => {
    const p = byName(s, name);
    const others = s.players.filter((q) => q.team === p.team && q.trait && q.id !== p.id).map((q) => ({ playerId: q.id, trait: q.trait! }));
    assignTraits(s, p.team, [...others, { playerId: p.id, trait }]);
    return p;
  };
  it('mudam os atributos e só valem na posição certa', () => {
    const s = createGame({ seed: 1, styles: { azul: 'posse' } });
    const dudu = give(s, 'Dudu', 'alaVelocista');
    expect(statsOf(dudu).dom).toBe(4);
    expect(() => assignTraits(s, 'azul', [{ playerId: byName(s, 'Marreta').id, trait: 'fixoXerife' }])).toThrow();
    expect(() =>
      assignTraits(
        s,
        'azul',
        ['Dudu', 'Teco', 'Rafa'].map((n, i) => ({ playerId: byName(s, n).id, trait: (['alaDriblador', 'alaVelocista', 'fixoArmador'] as Trait[])[i] })),
      ),
    ).toThrow(); // 3 só no Equilíbrio
  });
  it('Ala velocista: arrancada mais barata e mais longa', () => {
    const s = createGame({ seed: 1 });
    const dudu = give(s, 'Dudu', 'alaVelocista');
    beginActivation(s, dudu.id);
    const fol = dudu.fol;
    expect(moveRange(s, dudu, true) - moveRange(s, dudu, false)).toBe(3);
    sprint(s);
    expect(dudu.fol).toBe(fol - 2);
  });
  it('Equilíbrio leva 3, e a 3ª sai se o time trocar de estilo', () => {
    const s = createGame({ seed: 1 });
    const picks = (['Dudu', 'Rafa', 'Marreta'] as const).map((n, i) => ({
      playerId: byName(s, n).id,
      trait: (['alaDriblador', 'fixoArmador', 'pulmao'] as Trait[])[i],
    }));
    assignTraits(s, 'azul', picks);
    expect(byName(s, 'Marreta').trait).toBe('pulmao');
    expect(statsOf(byName(s, 'Marreta')).fol).toBe(ROLES.pivo.fol + 3);
    setStyle(s, 'azul', 'posse');
    expect(byName(s, 'Marreta').trait).toBe(null);
    expect(byName(s, 'Dudu').trait).toBe('alaDriblador');
  });
  it('Pivô de costas: escora de primeira e tabela com quem passou', () => {
    const s = createGame({ seed: 1, styles: { azul: 'posse' } });
    clearCourt(s);
    const piv = give(s, 'Marreta', 'pivoCostas');
    const dudu = byName(s, 'Dudu');
    piv.x = 15;
    piv.y = 5;
    dudu.x = 13;
    dudu.y = 5;
    s.holder = piv.id;
    // O pivô joga primeiro (passa para o Dudu)...
    beginActivation(s, piv.id);
    pass(s, dudu.id, false);
    endActivation(s);
    // ...o Dudu devolve: o pivô já jogou, mas pode escorar.
    beginActivation(s, dudu.id);
    pass(s, piv.id, false);
    endActivation(s);
    expect(extraMode(s, piv)).toBe('escora');
    const used = s.activationsUsed;
    beginActivation(s, piv.id);
    expect(destinations(s)).toHaveLength(0);
    expect(currentTargets(s).every((t) => t.kind === 'passe' && !t.alto)).toBe(true);
    pass(s, dudu.id, false);
    endActivation(s);
    expect(s.activationsUsed).toBe(used); // a escora não conta
    // Devolveu para quem passou: tabela!
    expect(extraMode(s, dudu)).toBe('tabela');
    beginActivation(s, dudu.id);
    expect(Math.max(...destinations(s).map((c) => Math.abs(c.x - dudu.x) + Math.abs(c.y - dudu.y)))).toBe(2);
    expect(currentTargets(s).some((t) => t.kind === 'chute')).toBe(true);
    expect(currentTargets(s).some((t) => t.kind === 'drible')).toBe(false);
  });
  it('Fixo xerife: bote +2, e a falta dele conta dobrado', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const tonhao = give(s, 'Tonhão', 'fixoXerife');
    tonhao.ready = true;
    expect(cutRange(s, tonhao)).toBe(2);
    const dudu = byName(s, 'Dudu');
    dudu.x = 10;
    dudu.y = 5;
    tonhao.x = 11;
    tonhao.y = 5;
    s.holder = dudu.id;
    s.pendingReaction = tonhao.id;
    const cs = startReaction(s);
    expect(cs.atk.notes.some((n) => n.includes('xerife +2'))).toBe(true);
    // Bote contra Proteger é falta.
    while (!cs.done) resolveTempo(s, cs, 'golpe', 'guarda');
    applyDuel(s, cs);
    expect(s.fouls.vermelho).toBe(2);
  });
  it('Fixo armador: passe alto mais longo e sem custo', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const rafa = give(s, 'Rafa', 'fixoArmador');
    const piv = byName(s, 'Marreta');
    rafa.x = 4;
    rafa.y = 5;
    piv.x = 13; // 9 casas: PAS 7 + 2 (o alto normal vai até 8)
    piv.y = 5;
    s.holder = rafa.id;
    expect(passPreview(s, rafa, piv, true).ok).toBe(true);
    const [tonhao, bigode] = [byName(s, 'Tonhão'), byName(s, 'Bigode')];
    Object.assign(tonhao, { x: 4, y: 8 });
    Object.assign(bigode, { x: 13, y: 8 });
    expect(passPreview(s, tonhao, bigode, true).ok).toBe(false);
    beginActivation(s, rafa.id);
    const fol = rafa.fol;
    pass(s, piv.id, true);
    expect(rafa.fol).toBe(fol);
  });
  it('Goleiro com os pés sai da área sem a regra dos 4 segundos; o paredão é forte de perto e fraco de longe', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const gui = give(s, 'Gui', 'goleiroPes');
    gui.x = 6;
    gui.y = 5;
    s.holder = gui.id;
    endPhase(s);
    endPhase(s);
    expect(s.keeperMustPass).toBe(null);
    expect(hasSpecial(gui)).toBe(false);
    const s2 = createGame({ seed: 1 });
    const biel = give(s2, 'Biel', 'goleiroParedao');
    expect(hasSpecial(biel)).toBe(true);
    clearCourt(s2);
    const piv = byName(s2, 'Marreta');
    Object.assign(piv, { x: 17, y: 4 });
    s2.holder = piv.id;
    const near = shotPreview(s2, piv);
    Object.assign(piv, { x: 12, y: 4 });
    const far = shotPreview(s2, piv);
    expect(near.ref).toBe(ROLES.goleiro.ref + 1);
    expect(far.ref).toBe(ROLES.goleiro.ref - 1);
  });
  it('Ala driblador começa o Duelo com a bola com 1 Leitura', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const dudu = give(s, 'Dudu', 'alaDriblador');
    const lelo = byName(s, 'Lelo');
    dudu.x = 10;
    dudu.y = 5;
    lelo.x = 11;
    lelo.y = 5;
    s.holder = dudu.id;
    const cs = startDuel(s, 'drible', dudu.id, lelo.id);
    expect(cs.atk.readsLeft).toBe(1);
  });
});
