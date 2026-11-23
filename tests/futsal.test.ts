import { describe, expect, it } from 'vitest';
import {
  absRound,
  applyDuel,
  canUseDrink,
  drainEvents,
  undoMove,
  useDrink,
  attrLances,
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
import type { GameState, Player } from '../src/core';

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
  it('lances vêm do Domínio (com bola) e da Marcação (sem bola)', () => {
    expect([attrLances(5), attrLances(4), attrLances(3), attrLances(2)]).toEqual([3, 2, 2, 1]);
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
    expect(cs.atk.lances).toBe(3);
    expect(cs.def.lances).toBe(3);
    expect(cs.def.vantage).toBe(1); // posse
  });
  it('Bote contra Proteger é falta; a 6ª falta dá tiro livre direto do 10 m', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const ala = byName(s, 'Dudu');
    const fixo = byName(s, 'Tonhão');
    ala.x = 10;
    ala.y = 5;
    fixo.x = 11;
    fixo.y = 5;
    s.holder = ala.id;
    s.fouls.vermelho = 5;
    s.activeTeam = 'vermelho';
    beginActivation(s, fixo.id);
    const cs = startTackle(s, ala.id);
    resolveTempo(s, cs, 'golpe', 'guarda');
    expect(cs.done && cs.foul).toBe(true);
    expect(duelOutcome(cs)).toBe('falta');
    applyDuel(s, cs);
    expect(s.fouls.vermelho).toBe(6);
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
  it('canto certo pega até força REF+2; canto oposto é gol; perto do gol o chute é mais forte', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const piv = byName(s, 'Marreta');
    piv.x = 18;
    piv.y = 5;
    s.holder = piv.id;
    const pv = shotPreview(s, piv);
    expect(pv.force).toBe(7);
    expect(shotResult(pv, 'esq', 'esq')).toBe('defesa');
    expect(shotResult(pv, 'esq', 'dir')).toBe('gol');
    expect(shotResult(pv, 'esq', 'meio')).toBe('gol');
    piv.x = 11;
    expect(shotPreview(s, piv).force).toBeLessThan(5);
  });
  it('defensor na linha bloqueia; gol faz quem sofreu dar a saída', () => {
    const s = createGame({ seed: 1 });
    clearCourt(s);
    const piv = byName(s, 'Marreta');
    piv.x = 16;
    piv.y = 5;
    s.holder = piv.id;
    const blocker = byName(s, 'Tonhão');
    blocker.x = 17;
    blocker.y = 5;
    expect(shotPreview(s, piv).blockerId).toBe(blocker.id);
    blocker.x = -5;
    beginActivation(s, piv.id);
    expect(shoot(s, 'esq', 'dir')).toBe('gol');
    expect(s.score.azul).toBe(1);
    expect(holderOf(s).team).toBe('vermelho');
    expect(s.activeTeam).toBe('vermelho');
  });
});

describe('tempos', () => {
  it('8 rodadas por tempo, intervalo zera faltas, depois fim de jogo', () => {
    const s = createGame({ seed: 2 });
    s.fouls.azul = 3;
    let phases = 0;
    while (s.half === 1 && phases < 40) {
      endPhase(s);
      phases++;
    }
    expect(phases).toBe(16);
    expect(s.fouls.azul).toBe(0);
    expect(s.activeTeam).toBe('vermelho');
    while (!s.over && phases < 80) {
      endPhase(s);
      phases++;
    }
    expect(phases).toBe(32);
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
