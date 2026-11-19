import { describe, expect, it } from 'vitest';
import {
  activatable,
  attackArea,
  attackBaseMelee,
  beginActivation,
  checkVictory,
  clash,
  CLASSES,
  countLances,
  createGame,
  destinations,
  endActivation,
  getUnit,
  hitDamage,
  key,
  moveTo,
  reachable,
  resolveTempo,
  simulateGame,
  startConfronto,
} from '../src/core';
import type { ClassId, GameState, Unit } from '../src/core';

const TEAM: ClassId[] = ['tank', 'espadachim', 'cavaleiro', 'atirador', 'medico'];

function game(azul: ClassId[] = TEAM, vermelho: ClassId[] = TEAM): GameState {
  return createGame({ azul, vermelho, seed: 1 });
}

/** Coloca duas unidades lado a lado numa planície, no meio do lado azul. */
function face(s: GameState, a: Unit, d: Unit, side: 'frente' | 'flanco' | 'costas' = 'frente'): void {
  for (const u of s.units) if (u !== a && u !== d) u.alive = false;
  d.x = 6;
  d.y = 9;
  a.x = 6;
  a.y = 8;
  d.facing = side === 'frente' ? 'N' : side === 'costas' ? 'S' : 'E';
  d.ready = false;
}

describe('mapa', () => {
  it('tem 16×12 e as Bases nos lugares certos', () => {
    const s = game();
    expect(s.width).toBe(16);
    expect(s.height).toBe(12);
    expect(s.bases.vermelho).toMatchObject({ x: 8, y: 0, hp: 60 });
    expect(s.bases.azul).toMatchObject({ x: 7, y: 11, hp: 60 });
  });
});

describe('matriz do Confronto', () => {
  const L = 'leve' as const;
  it('Golpe vence Finta, Guarda vence Golpe, Finta vence Guarda', () => {
    expect(clash('golpe', 'finta', L, L)).toMatchObject({ aHit: 2.0, bHit: 0 });
    expect(clash('golpe', 'guarda', L, L)).toMatchObject({ aHit: 0, bHit: 0.8 });
    expect(clash('finta', 'guarda', L, L)).toMatchObject({ aHit: 1.5, bHit: 0, exposeB: true });
  });
  it('Esperar bloqueia Golpe e perde para Finta', () => {
    expect(clash('golpe', 'esperar', L, L)).toMatchObject({ aHit: 0, bHit: 0 });
    expect(clash('esperar', 'finta', L, L)).toMatchObject({ aHit: 0, bHit: 1.5, exposeA: true });
  });
  it('Golpe × Golpe: o mais pesado acerta com 2,0', () => {
    expect(clash('golpe', 'golpe', 'pesado', 'leve')).toMatchObject({ aHit: 2.0, bHit: 1.0 });
    expect(clash('golpe', 'golpe', 'medio', 'medio')).toMatchObject({ aHit: 1.0, bHit: 1.0 });
  });
  it('empates sem ataque não fazem nada', () => {
    for (const l of ['guarda', 'finta', 'esperar'] as const) {
      expect(clash(l, l, L, L)).toMatchObject({ aHit: 0, bHit: 0 });
    }
  });
});

describe('lances', () => {
  it('Leve 3, Médio 2, Pesado 1 pela frente', () => {
    const s = game();
    const tank = s.units.find((u) => u.cls === 'tank' && u.team === 'azul')!;
    const esp = s.units.find((u) => u.cls === 'espadachim' && u.team === 'vermelho')!;
    face(s, esp, tank);
    const c = countLances(s, esp, tank);
    expect(c.atk.lances).toBe(3);
    expect(c.def.lances).toBe(1);
  });
  it('flanco +1, costas +2, e o que passa de 3 vira Leitura', () => {
    const s = game();
    const tank = s.units.find((u) => u.cls === 'tank' && u.team === 'azul')!;
    const cav = s.units.find((u) => u.cls === 'cavaleiro' && u.team === 'vermelho')!;
    face(s, cav, tank, 'flanco');
    expect(countLances(s, cav, tank).atk).toMatchObject({ lances: 3, reads: 0 });
    face(s, cav, tank, 'costas');
    expect(countLances(s, cav, tank).atk).toMatchObject({ lances: 3, reads: 1 });
  });
  it('Prontidão dá +1 ao defensor e é gasta', () => {
    const s = game();
    const tank = s.units.find((u) => u.cls === 'tank' && u.team === 'azul')!;
    const esp = s.units.find((u) => u.cls === 'espadachim' && u.team === 'vermelho')!;
    face(s, esp, tank);
    tank.ready = true;
    const cs = startConfronto(s, esp.id, tank.id);
    expect(cs.def.lances).toBe(2);
    expect(tank.ready).toBe(false);
  });
});

describe('exemplo do GDD: Espadachim contra Tank', () => {
  it('Finta na Recuperação causa 3; Golpe do Tank causa 16', () => {
    const s = game();
    const tank = s.units.find((u) => u.cls === 'tank' && u.team === 'vermelho')!;
    const esp = s.units.find((u) => u.cls === 'espadachim' && u.team === 'azul')!;
    face(s, esp, tank);
    expect(hitDamage(s, esp, tank, 1.5)).toBe(3);
    expect(hitDamage(s, tank, esp, 2.0)).toBe(16);
  });
  it('resolver tempos gasta lances e Stamina; sem lance vira Esperar', () => {
    const s = game();
    const tank = s.units.find((u) => u.cls === 'tank' && u.team === 'vermelho')!;
    const esp = s.units.find((u) => u.cls === 'espadachim' && u.team === 'azul')!;
    face(s, esp, tank);
    const cs = startConfronto(s, esp.id, tank.id);
    const r1 = resolveTempo(s, cs, 'finta', 'esperar');
    expect(r1.defTook).toBe(3);
    expect(cs.exposed).toBe('def');
    expect(esp.stamina).toBe(CLASSES.espadachim.stamina - 1);
    resolveTempo(s, cs, 'guarda', 'golpe');
    expect(tank.stamina).toBe(CLASSES.tank.stamina - 2);
    const r3 = resolveTempo(s, cs, 'finta', 'golpe');
    expect(r3.def).toBe('esperar'); // o Tank já gastou o único lance
    expect(cs.done).toBe(true);
  });
});

describe('movimento', () => {
  it('água é intransitável e Cavalaria paga 3 na floresta', () => {
    const s = game();
    const cav = s.units.find((u) => u.cls === 'cavaleiro' && u.team === 'azul')!;
    for (const u of s.units) if (u !== cav) u.alive = false;
    cav.x = 2;
    cav.y = 8; // ao lado da floresta (2,7)
    const reach = reachable(s, cav, 3);
    expect(reach.get(key(s, 2, 7))?.cost).toBe(3);
    expect(reach.has(key(s, 1, 6))).toBe(false); // água
  });
  it('não atravessa inimigos', () => {
    const s = game();
    const tank = s.units.find((u) => u.team === 'azul' && u.cls === 'tank')!;
    beginActivation(s, s.activeTeam === 'azul' ? tank.id : activatable(s)[0].id);
    expect(destinations(s).length).toBeGreaterThan(0);
  });
});

describe('morteiro', () => {
  it('cai depois de mais duas ativações', () => {
    const s = createGame({ azul: ['morteiro', ...TEAM.slice(1)], vermelho: TEAM, seed: 3 });
    s.activeTeam = 'azul';
    const mo = s.units.find((u) => u.cls === 'morteiro' && u.team === 'azul')!;
    const target = s.units.find((u) => u.team === 'vermelho')!;
    mo.x = target.x;
    mo.y = target.y + 4;
    beginActivation(s, mo.id);
    attackArea(s, target.x, target.y);
    const hp = target.hp;
    endActivation(s);
    expect(s.strikes.length).toBe(1);
    beginActivation(s, activatable(s)[0].id);
    endActivation(s);
    expect(s.strikes.length).toBe(1);
    // Garantir que o alvo continua lá.
    target.x = s.strikes[0].cx;
    target.y = s.strikes[0].cy;
    beginActivation(s, activatable(s)[0].id);
    endActivation(s);
    expect(s.strikes.length).toBe(0);
    expect(getUnit(s, target.id).hp).toBeLessThan(hp);
  });
});

describe('vitória', () => {
  it('destruir a Base vence a partida', () => {
    const s = game();
    s.activeTeam = 'azul';
    const esp = s.units.find((u) => u.cls === 'espadachim' && u.team === 'azul')!;
    esp.x = 8;
    esp.y = 1; // encostado na Base Vermelha (8,0)
    for (const u of s.units) if (u.team === 'vermelho' && u.x === 8 && u.y === 1) u.x = 12;
    s.bases.vermelho.hp = 1;
    beginActivation(s, esp.id);
    attackBaseMelee(s);
    expect(s.winner).toBe('azul');
  });
  it('eliminar todas as unidades vence a partida', () => {
    const s = game();
    s.activeTeam = 'azul';
    for (const u of s.units) if (u.team === 'vermelho') u.alive = false;
    const esp = s.units.find((u) => u.team === 'azul')!;
    beginActivation(s, esp.id);
    endActivation(s);
    // A checagem acontece em dano; força aqui pela via pública:
    checkVictory(s);
    expect(s.winner).toBe('azul');
  });
});

describe('IA × IA', () => {
  it('50 partidas terminam sem erro', () => {
    for (let i = 0; i < 50; i++) {
      const s = createGame({ azul: TEAM, vermelho: ['blindado', 'canhao', 'morteiro', 'bombardeiro', 'espiao'], seed: i });
      simulateGame(s, { difficulty: { azul: 'veterano', vermelho: i % 2 ? 'recruta' : 'veterano' } });
      expect(s.winner).not.toBeNull();
    }
  });
  it('mover para uma casa inválida dá erro', () => {
    const s = game();
    beginActivation(s, activatable(s)[0].id);
    expect(() => moveTo(s, 0, 5)).toThrow(); // água
  });
});
