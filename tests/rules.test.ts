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
  endPhase,
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
  d.y = 11;
  a.x = 6;
  a.y = 10;
  d.facing = side === 'frente' ? 'N' : side === 'costas' ? 'S' : 'E';
  d.ready = false;
}

describe('mapa 24×16', () => {
  it('tem o tamanho certo, Bases nos lugares e casas iniciais livres', () => {
    const m = parseMap(MAP_VAU);
    expect([m.width, m.height]).toEqual([24, 16]);
    expect(m.bases.vermelho).toEqual({ x: 12, y: 0 });
    expect(m.bases.azul).toEqual({ x: 11, y: 15 });
    for (const t of ['azul', 'vermelho'] as const) for (const p of DEPLOY_SLOTS[t]) expect(m.terrain[p.y][p.x]).toBe('planicie');
  });
  it('é simétrico por rotação de 180°', () => {
    for (let y = 0; y < 16; y++) expect(MAP_VAU[y]).toBe([...MAP_VAU[15 - y]].reverse().join(''));
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
  it('Leve 3, Pesado 1 pela frente; flanco +1, costas +2 vira Leitura', () => {
    const s = game();
    const tank = find(s, 'azul', 'tank');
    const cav = find(s, 'vermelho', 'cavaleiro');
    face(s, cav, tank);
    expect(countLances(s, cav, tank).def.lances).toBe(1);
    face(s, cav, tank, 'flanco');
    expect(countLances(s, cav, tank).atk).toMatchObject({ lances: 3, reads: 0 });
    face(s, cav, tank, 'costas');
    expect(countLances(s, cav, tank).atk).toMatchObject({ lances: 3, reads: 1 });
  });
  it('exemplo do GDD: Finta na Recuperação causa 3, Golpe do Tank causa 16', () => {
    const s = game();
    const tank = find(s, 'vermelho', 'tank');
    const esp = find(s, 'azul', 'espadachim');
    face(s, esp, tank);
    expect(hitDamage(s, esp, tank, 1.5)).toBe(3);
    expect(hitDamage(s, tank, esp, 2.0)).toBe(16);
    const cs = startConfronto(s, esp.id, tank.id);
    expect(resolveTempo(s, cs, 'finta', 'esperar').defTook).toBe(3);
    resolveTempo(s, cs, 'guarda', 'golpe');
    expect(tank.stamina).toBe(CLASSES.tank.stamina - 2);
    expect(resolveTempo(s, cs, 'finta', 'golpe').def).toBe('esperar');
    expect(cs.done).toBe(true);
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
    cav.x = 4;
    cav.y = 10; // floresta em (4,9), água em (4,8)
    const reach = reachable(s, cav, 4);
    expect(reach.get(key(s, 4, 9))?.cost).toBe(3);
    expect(reach.has(key(s, 4, 8))).toBe(false);
  });
  it('mina inimiga para o movimento e causa 8', () => {
    const s = game();
    const esp = find(s, 'azul', 'espadachim');
    for (const u of s.units) if (u !== esp) u.alive = false;
    s.units.find((u) => u.team === 'vermelho')!.alive = true; // evita vitória imediata
    s.units.find((u) => u.team === 'vermelho')!.x = 0;
    s.units.find((u) => u.team === 'vermelho')!.y = 0;
    esp.x = 6;
    esp.y = 11;
    s.mines.push({ id: 99, team: 'vermelho', x: 6, y: 10 });
    beginActivation(s, esp.id);
    expect(destinations(s).some((p) => p.x === 6 && p.y === 9)).toBe(true);
    moveTo(s, 6, 9);
    expect([esp.x, esp.y]).toEqual([6, 10]);
    expect(esp.hp).toBe(CLASSES.espadachim.hp - 8);
    expect(s.mines.length).toBe(0);
  });
});

describe('itens', () => {
  it('coletar no nó verde dá Tônico e gasta uma carga; Tônico cura 12', () => {
    const s = game();
    const tank = find(s, 'azul', 'tank');
    tank.x = 11;
    tank.y = 12; // nó verde em (11,13)
    beginActivation(s, tank.id);
    collect(s, 11, 13);
    expect(tank.items).toEqual(['tonico']);
    expect(s.nodes.find((n) => n.x === 11 && n.y === 13)!.charges).toBe(2);
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
    esp.x = 11;
    esp.y = 9; // ao lado da Fonte (11,8)
    beginActivation(s, esp.id);
    expect(() => collect(s, 11, 8)).toThrow();
    collect(s, 11, 8, 'roxo');
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
    expect([tank.x, tank.y]).toEqual([6, 12]);
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
    for (const u of s.units) if (u.team === 'vermelho' && u.x === 12 && u.y === 1) u.x = 20;
    esp.x = 12;
    esp.y = 1;
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
  });
});
