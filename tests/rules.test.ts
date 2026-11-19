import { describe, expect, it } from 'vitest';
import {
  abilityTargets,
  activatable,
  attackArea,
  attackBaseMelee,
  attackRanged,
  beginActivation,
  checkVictory,
  clash,
  CLASSES,
  collect,
  countLances,
  createGame,
  currentTargets,
  DEPLOY_SLOTS,
  destinations,
  endActivation,
  attackSide,
  endPhase,
  drainEvents,
  roundsToShuffle,
  previewAttacks,
  getUnit,
  grantXp,
  hitDamage,
  key,
  MAP_VAU,
  moveTo,
  parseMap,
  reachable,
  resolveTempo,
  simulateGame,
  startConfronto,
  targetsFrom,
  useAbility,
  useItem,
} from '../src/core';
import type { ClassId, GameState, Unit } from '../src/core';

const TEAM: ClassId[] = ['tank', 'espadachim', 'cavaleiro', 'atirador', 'medico'];

function game(azul: ClassId[] = TEAM, vermelho: ClassId[] = TEAM): GameState {
  const s = createGame({ azul, vermelho, seed: 1 });
  s.activeTeam = 'azul';
  s.startingTeam = 'azul';
  return s;
}

const find = (s: GameState, team: 'azul' | 'vermelho', cls: ClassId) => s.units.find((u) => u.team === team && u.cls === cls)!;

/** Isola duas unidades lado a lado numa planície do lado azul. */
function face(s: GameState, a: Unit, d: Unit, side: 'frente' | 'flanco' | 'costas' = 'frente'): void {
  for (const u of s.units) if (u !== a && u !== d) u.alive = false;
  d.x = 6;
  d.y = 13;
  a.x = 6;
  a.y = 12;
  d.facing = side === 'frente' ? 'N' : side === 'costas' ? 'S' : 'E';
  d.ready = false;
}

describe('mapa 20×20', () => {
  it('tem o tamanho certo, Bases em cantos opostos e casas iniciais livres', () => {
    const m = parseMap(MAP_VAU);
    expect([m.width, m.height]).toEqual([20, 20]);
    expect(m.bases.azul).toEqual({ x: 1, y: 1 });
    expect(m.bases.vermelho).toEqual({ x: 18, y: 18 });
    for (const t of ['azul', 'vermelho'] as const) for (const p of DEPLOY_SLOTS[t]) expect(m.terrain[p.y][p.x]).toBe('planicie');
  });
  it('é simétrico por rotação de 180°', () => {
    for (let y = 0; y < 20; y++) expect(MAP_VAU[y]).toBe([...MAP_VAU[19 - y]].reverse().join(''));
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
});

describe('lances', () => {
  it('o peso define os lances; o lado muda o dano, não os lances', () => {
    const s = game();
    const tank = find(s, 'azul', 'tank');
    const cav = find(s, 'vermelho', 'cavaleiro');
    for (const side of ['frente', 'flanco', 'costas'] as const) {
      face(s, cav, tank, side);
      expect(countLances(s, cav, tank).def.lances).toBe(1);
      expect(countLances(s, cav, tank).atk).toMatchObject({ lances: 2, reads: 0 });
    }
  });
  it('flanco e costas multiplicam o dano, com especialidades por classe', () => {
    const s = game();
    const tank = find(s, 'azul', 'tank');
    const cav = find(s, 'vermelho', 'cavaleiro');
    const esp = find(s, 'vermelho', 'espadachim');
    const spy = find(s, 'vermelho', 'espiao') ?? esp;
    const mult = (a: Unit, side: 'frente' | 'flanco' | 'costas') => {
      face(s, a, tank, side);
      return startConfronto(s, a.id, tank.id).sideMult;
    };
    expect(mult(esp, 'frente')).toBeCloseTo(0.75); // escudo do Tank
    expect(mult(esp, 'flanco')).toBeCloseTo(1.25);
    expect(mult(esp, 'costas')).toBeCloseTo(1.5);
    expect(mult(cav, 'flanco')).toBeCloseTo(1.6);
    expect(mult(cav, 'costas')).toBeCloseTo(1.7);
    if (spy.cls === 'espiao') expect(mult(spy, 'costas')).toBeCloseTo(2);
    // A prévia mostra o mesmo número que o Confronto aplica num acerto ×1.
    face(s, cav, tank, 'flanco');
    const pv = previewAttacks(s, cav, cav, false).find((p) => p.kind === 'melee')!;
    expect(pv).toMatchObject({ side: 'flanco', dmg: hitDamage(s, cav, tank, 1, 1.6) });
  });
  it('no fim da fase cada unidade encara o inimigo mais próximo', () => {
    const s = game();
    const tank = find(s, 'azul', 'tank');
    const cav = find(s, 'vermelho', 'cavaleiro');
    face(s, cav, tank, 'costas');
    expect(attackSide(tank, cav)).toBe('costas');
    s.activeTeam = 'azul';
    s.activation = null;
    endPhase(s);
    expect(attackSide(tank, cav)).toBe('frente');
  });
  it('exemplo do GDD: Finta na Recuperação causa 3, Golpe do Tank causa 16', () => {
    const s = game();
    const tank = find(s, 'vermelho', 'tank');
    const esp = find(s, 'azul', 'espadachim');
    face(s, esp, tank);
    expect(hitDamage(s, esp, tank, 1.5)).toBe(3);
    expect(hitDamage(s, tank, esp, 2.0)).toBe(16);
    const cs = startConfronto(s, esp.id, tank.id);
    // De frente, o escudo do Tank corta 25%: 3,5 × 0,75 → 2.
    expect(resolveTempo(s, cs, 'finta', 'esperar').defTook).toBe(2);
    resolveTempo(s, cs, 'guarda', 'golpe');
    expect(tank.stamina).toBe(CLASSES.tank.stamina - 2);
    expect(resolveTempo(s, cs, 'finta', 'golpe').def).toBe('esperar');
    expect(cs.done).toBe(true);
  });
});

describe('cristais', () => {
  it('a cada 3 rodadas trocam de lugar, espelhados e em casas livres, com as cargas', () => {
    const s = game();
    const before = s.nodes.map((n) => ({ ...n }));
    s.nodes[0].charges = 1;
    expect(roundsToShuffle(s)).toBe(3);
    while (s.round < 3) endPhase(s);
    expect(roundsToShuffle(s)).toBe(1);
    expect(s.nodes.map((n) => [n.x, n.y])).toEqual(before.map((n) => [n.x, n.y]));
    drainEvents(s);
    endPhase(s);
    endPhase(s);
    expect(s.round).toBe(4);
    const portals = drainEvents(s).filter((e) => e.kind === 'portal');
    expect(portals.length).toBe(s.nodes.length);
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      expect([n.x, n.y]).not.toEqual([before[i].x, before[i].y]);
      expect(['planicie', 'no_verde', 'no_roxo', 'no_laranja']).toContain(s.terrain[n.y][n.x]);
      // O par espelhado continua espelhado.
      expect(s.nodes.some((m) => m.color === n.color && m.x === s.width - 1 - n.x && m.y === s.height - 1 - n.y)).toBe(true);
    }
    expect(new Set(s.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(s.nodes.length);
    expect(Math.min(...s.nodes.map((n) => n.charges))).toBeGreaterThanOrEqual(1);
    expect(roundsToShuffle(s)).toBe(3);
  });
});

describe('turno por fase', () => {
  it('o jogador move todas as unidades e só então a fase passa', () => {
    const s = game();
    for (let i = 0; i < 5; i++) {
      expect(s.activeTeam).toBe('azul');
      beginActivation(s, activatable(s)[0].id);
      endActivation(s);
    }
    expect(s.activeTeam).toBe('vermelho');
    expect(activatable(s, 'vermelho').length).toBe(5);
  });
  it('encerrar a fase dá Prontidão a quem não agiu', () => {
    const s = game();
    endPhase(s);
    expect(s.activeTeam).toBe('vermelho');
    expect(s.units.filter((u) => u.team === 'azul').every((u) => u.ready)).toBe(true);
  });
  it('cada unidade: mover e depois 1 ação só', () => {
    const s = game();
    const at = find(s, 'azul', 'atirador');
    const enemy = find(s, 'vermelho', 'tank');
    at.x = 5;
    at.y = 11;
    enemy.x = 5;
    enemy.y = 9;
    at.items = ['tonico'];
    at.hp = 10;
    beginActivation(s, at.id);
    attackRanged(s, enemy.id);
    expect(() => useItem(s, 0)).toThrow();
    expect(currentTargets(s)).toEqual([]);
  });
});

describe('movimento', () => {
  it('água é intransitável e Cavalaria paga 3 na floresta', () => {
    const s = game();
    const cav = find(s, 'azul', 'cavaleiro');
    for (const u of s.units) if (u !== cav) u.alive = false;
    cav.x = 1;
    cav.y = 4; // floresta em (1,5)
    expect(reachable(s, cav, 4).get(key(s, 1, 5))?.cost).toBe(3);
    cav.x = 0;
    cav.y = 8; // água em (0,9)
    expect(reachable(s, cav, 4).has(key(s, 0, 9))).toBe(false);
  });
  it('mina inimiga para o movimento e causa 8', () => {
    const s = game();
    const esp = find(s, 'azul', 'espadachim');
    for (const u of s.units) if (u !== esp) u.alive = false;
    s.units.find((u) => u.team === 'vermelho')!.alive = true; // evita vitória imediata
    s.units.find((u) => u.team === 'vermelho')!.x = 0;
    s.units.find((u) => u.team === 'vermelho')!.y = 0;
    esp.x = 5;
    esp.y = 13;
    s.mines.push({ id: 99, team: 'vermelho', ownerId: 'V5', x: 5, y: 14 });
    beginActivation(s, esp.id);
    expect(destinations(s).some((p) => p.x === 5 && p.y === 15)).toBe(true);
    moveTo(s, 5, 15);
    expect([esp.x, esp.y]).toEqual([5, 14]);
    expect(esp.hp).toBe(CLASSES.espadachim.hp - 8);
    expect(s.mines.length).toBe(0);
  });
});

describe('Blindado e Bombardeiro', () => {
  it('Blindado anda 3 e só em terreno liso', () => {
    const s = game(['blindado', ...TEAM.slice(1)]);
    const bl = find(s, 'azul', 'blindado');
    for (const u of s.units) if (u !== bl) u.alive = false;
    bl.x = 3;
    bl.y = 12; // perto de colina (3,10) e de floresta (7,12)
    const reach = reachable(s, bl, CLASSES.blindado.mov);
    for (const k of reach.keys()) {
      const t = s.terrain[Math.floor(k / s.width)][k % s.width];
      expect(['floresta', 'colina', 'ruina', 'lama']).not.toContain(t);
    }
    expect(CLASSES.blindado.mov).toBe(3);
  });
  it('mina num Blindado causa 16 e imobiliza na fase seguinte dele', () => {
    const s = game(['blindado', ...TEAM.slice(1)]);
    const bl = find(s, 'azul', 'blindado');
    bl.x = 9;
    bl.y = 12;
    s.mines.push({ id: 98, team: 'vermelho', ownerId: 'V1', x: 9, y: 11 });
    beginActivation(s, bl.id);
    moveTo(s, 9, 10);
    expect([bl.x, bl.y]).toEqual([9, 11]);
    expect(bl.hp).toBe(CLASSES.blindado.hp - 16);
    endPhase(s); // fase do Vermelho
    endPhase(s); // fase do Azul: o Blindado está imobilizado
    beginActivation(s, bl.id);
    expect(destinations(s)).toEqual([]);
  });
  it('Bombardeiro planta mina desde o level 1, no máximo 3', () => {
    const s = game(['bombardeiro', ...TEAM.slice(1)]);
    const bo = find(s, 'azul', 'bombardeiro');
    bo.x = 9;
    bo.y = 12;
    for (let i = 0; i < 3; i++) {
      s.activeTeam = 'azul';
      bo.activated = false;
      beginActivation(s, bo.id);
      const t = abilityTargets(s, bo)[i];
      useAbility(s, t.x, t.y);
      endActivation(s);
    }
    expect(s.mines.filter((m) => m.ownerId === bo.id).length).toBe(3);
    expect(abilityTargets(s, bo)).toEqual([]);
  });
});

describe('itens', () => {
  it('coletar no nó verde dá Tônico e gasta uma carga; Tônico cura 12', () => {
    const s = game();
    const tank = find(s, 'azul', 'tank');
    tank.x = 4;
    tank.y = 3; // nó verde em (4,4)
    beginActivation(s, tank.id);
    collect(s, 4, 4);
    expect(tank.items).toEqual(['tonico']);
    expect(s.nodes.find((n) => n.x === 4 && n.y === 4)!.charges).toBe(2);
    endActivation(s);
    s.activeTeam = 'azul';
    tank.activated = false;
    tank.hp = 10;
    beginActivation(s, tank.id);
    useItem(s, 0);
    expect(tank.hp).toBe(22);
  });
  it('na Fonte Prismática é preciso escolher a cor', () => {
    const s = game();
    const esp = find(s, 'azul', 'espadachim');
    esp.x = 9;
    esp.y = 8; // ao lado da Fonte (9,9)
    beginActivation(s, esp.id);
    expect(() => collect(s, 9, 9)).toThrow();
    collect(s, 9, 9, 'roxo');
    expect(esp.items).toEqual(['foco']);
  });
});

describe('level e habilidades', () => {
  it('3 de XP levam ao level 2: +3 HP máximo, +1 ATQ e habilidade liberada', () => {
    const s = game();
    const blind = createGame({ azul: ['blindado', ...TEAM.slice(1)], vermelho: TEAM, seed: 2 }).units[0];
    grantXp(s, blind, 3);
    expect(blind.level).toBe(2);
    expect(blind.maxHp).toBe(CLASSES.blindado.hp + 3);
  });
  it('Atropelar empurra o alvo; contra obstáculo causa +6', () => {
    const s = game(['blindado', ...TEAM.slice(1)]);
    const bl = find(s, 'azul', 'blindado');
    const tank = find(s, 'vermelho', 'tank');
    face(s, bl, tank);
    bl.level = 2;
    beginActivation(s, bl.id);
    expect(abilityTargets(s, bl).length).toBe(1);
    useAbility(s, tank.x, tank.y);
    expect([tank.x, tank.y]).toEqual([6, 14]);
  });
  it('Provocar obriga os inimigos próximos a atacar só o Tank', () => {
    const s = game();
    const tank = find(s, 'azul', 'tank');
    const esp = find(s, 'vermelho', 'espadachim');
    const med = find(s, 'azul', 'medico');
    tank.level = 2;
    tank.x = 6;
    tank.y = 11;
    esp.x = 7;
    esp.y = 10;
    med.x = 7;
    med.y = 9;
    beginActivation(s, tank.id);
    useAbility(s, tank.x, tank.y);
    expect(esp.tauntBy).toBe(tank.id);
    s.phase++; // fase do Vermelho
    const targets = targetsFrom(s, esp, esp, { moved: false }).filter((t) => t.kind === 'melee');
    expect(targets.map((t) => (t as { unitId: string }).unitId)).toEqual([]);
    const fromNextToTank = targetsFrom(s, esp, { x: 7, y: 11 }, { moved: true }).filter((t) => t.kind === 'melee');
    expect(fromNextToTank.map((t) => (t as { unitId: string }).unitId)).toEqual([tank.id]);
  });
});

describe('morteiro', () => {
  it('cai no começo da próxima fase de quem atirou', () => {
    const s = game(['morteiro', ...TEAM.slice(1)]);
    const mo = find(s, 'azul', 'morteiro');
    const target = find(s, 'vermelho', 'tank');
    target.x = 6;
    target.y = 6;
    mo.x = 6;
    mo.y = 10;
    beginActivation(s, mo.id);
    attackArea(s, 6, 6);
    const hp = target.hp;
    endPhase(s); // fase do Vermelho
    expect(s.strikes.length).toBe(1);
    target.x = 6;
    target.y = 6;
    endPhase(s); // volta ao Azul: o disparo cai
    expect(s.strikes.length).toBe(0);
    expect(getUnit(s, target.id).hp).toBeLessThan(hp);
  });
});

describe('vitória', () => {
  it('destruir a Base vence a partida', () => {
    const s = game();
    const esp = find(s, 'azul', 'espadachim');
    for (const u of s.units) if (u.team === 'vermelho' && u.x === 18 && u.y === 17) u.x = 10;
    esp.x = 18;
    esp.y = 17; // encostado na Base Vermelha (18,18)
    s.bases.vermelho.hp = 1;
    beginActivation(s, esp.id);
    attackBaseMelee(s);
    expect(s.winner).toBe('azul');
  });
  it('eliminar todas as unidades vence a partida', () => {
    const s = game();
    for (const u of s.units) if (u.team === 'vermelho') u.alive = false;
    checkVictory(s);
    expect(s.winner).toBe('azul');
  });
});

describe('IA × IA', () => {
  it('40 partidas terminam sem erro', () => {
    for (let i = 0; i < 40; i++) {
      const s = createGame({ azul: TEAM, vermelho: ['blindado', 'canhao', 'morteiro', 'bombardeiro', 'espiao'], seed: i });
      simulateGame(s, { difficulty: { azul: 'veterano', vermelho: i % 2 ? 'recruta' : 'veterano' } });
      expect(s.winner).not.toBeNull();
    }
  }, 120_000);
});
