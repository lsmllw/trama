// Características: o jeito de jogar de um atleta, escolhido antes da partida junto com o estilo.
// Cada uma ganha algo e paga algo; elas combinam com os estilos de jogo (os "combos").

import { ROLES } from './data';
import type { Player, Role, RoleDef } from './types';

export type Trait = 'pivoCostas' | 'alaVelocista' | 'alaDriblador' | 'fixoArmador' | 'fixoXerife' | 'goleiroPes' | 'goleiroParedao' | 'pulmao';

export interface TraitDef {
  name: string;
  /** Posições que podem ter esta característica. */
  roles: Role[];
  plus: string;
  minus: string;
  /** Mudanças nos atributos da posição. */
  mods: Partial<Record<'mov' | 'pas' | 'dom' | 'hab' | 'fin' | 'mar' | 'fol' | 'ref', number>>;
}

export const TRAIT_LIST: Trait[] = ['pivoCostas', 'alaVelocista', 'alaDriblador', 'fixoArmador', 'fixoXerife', 'goleiroPes', 'goleiroParedao', 'pulmao'];

export const TRAITS: Record<Trait, TraitDef> = {
  pivoCostas: {
    name: 'Pivô de costas',
    roles: ['pivo'],
    plus: 'Escora: mesmo já tendo jogado, devolve de primeira (rasteiro, sem andar) um passe que recebeu. Se devolver para quem passou, é tabela: o colega joga de novo (anda 2 e chuta ou passa).',
    minus: 'Marcação 3 → 2: não volta para defender.',
    mods: { mar: -1 },
  },
  alaVelocista: {
    name: 'Ala velocista',
    roles: ['ala'],
    plus: 'Arrancada custa 2 de fôlego (em vez de 3) e dá +3 casas (em vez de +2).',
    minus: 'Domínio 5 → 4: um lance a menos contra o fixo.',
    mods: { dom: -1 },
  },
  alaDriblador: {
    name: 'Ala driblador',
    roles: ['ala'],
    plus: 'Começa todo Duelo com a bola com 1 Leitura.',
    minus: 'Passe 5 → 4, e o passe alto dele é disputado por quem estiver a até 3 casas.',
    mods: { pas: -1 },
  },
  fixoArmador: {
    name: 'Fixo armador',
    roles: ['fixo'],
    plus: 'Passe alto sem custo de fôlego e com alcance PAS + 2.',
    minus: 'Domínio 3 → 2: com a bola, perde mais Duelos.',
    mods: { dom: -1 },
  },
  fixoXerife: {
    name: 'Fixo xerife',
    roles: ['fixo'],
    plus: 'O bote de prontidão dele ganha +2 lances (em vez de +1).',
    minus: 'Cada falta dele conta em dobro para o tiro livre direto.',
    mods: {},
  },
  goleiroPes: {
    name: 'Goleiro com os pés',
    roles: ['goleiro'],
    plus: 'Sai da área como jogador de linha (Domínio 4), e a regra dos 4 segundos não vale com ele fora da área.',
    minus: 'Não tem a Muralha (e, fora da área, o gol fica vazio).',
    mods: { dom: 1 },
  },
  goleiroParedao: {
    name: 'Goleiro paredão',
    roles: ['goleiro'],
    plus: 'Reflexo +1 contra chute de perto (até 3 casas), e o rebote das defesas dele sempre sobra para o próprio time.',
    minus: 'Não tem a Muralha.',
    mods: {},
  },
  pulmao: {
    name: 'Pulmão',
    roles: ['fixo', 'ala', 'pivo'],
    plus: 'Fôlego máximo +3, recupera +1 a mais por fase e nunca fica cansado nos Duelos.',
    minus: 'Perde o especial da posição.',
    mods: { fol: 3 },
  },
};

/** Fôlego a mais que o Pulmão recupera por fase. */
export const PULMAO_REGEN = 1;

const cache = new Map<string, RoleDef>();

/** Atributos do jogador: os da posição, com os ajustes da característica. */
export function statsOf(p: Pick<Player, 'role' | 'trait'>): RoleDef {
  const base = ROLES[p.role];
  if (!p.trait) return base;
  const key = `${p.role}:${p.trait}`;
  let d = cache.get(key);
  if (!d) {
    d = { ...base };
    for (const [k, v] of Object.entries(TRAITS[p.trait].mods)) (d as unknown as Record<string, number>)[k] += v!;
    cache.set(key, d);
  }
  return d;
}

/** O jogador ainda tem o especial da posição (o Pulmão e o Goleiro paredão não têm). */
export function hasSpecial(p: Player): boolean {
  return !p.specialUsed && p.trait !== 'pulmao' && p.trait !== 'goleiroPes' && p.trait !== 'goleiroParedao';
}

export function traitFits(t: Trait, role: Role): boolean {
  return TRAITS[t].roles.includes(role);
}
