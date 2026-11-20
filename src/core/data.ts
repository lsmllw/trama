// Números do Trama Futsal: posições (classes), elencos e constantes da partida.

import type { Look, Role, RoleDef, Team, Weight } from './types';

export const COURT_W = 20;
export const COURT_H = 10;
/** Rodadas por tempo (cada rodada = uma fase de cada time). */
export const ROUNDS_PER_HALF = 8;
/** A partir desta falta acumulada no tempo, tiro livre direto do 10 m (2º ponto penal). */
export const FOUL_LIMIT = 6;
/** Distância do 2º ponto penal ao gol, em casas (10 m). */
export const TEN_METER = 5;
/** Raio da área do goleiro, em casas a partir do centro do gol. */
export const AREA_RADIUS = 3.2;
/** O chute alcança até CHUTE_BASE + FIN casas do gol. */
export const CHUTE_BASE = 4;

export const SPRINT_COST = 2;
export const SPRINT_BONUS = 2;
export const FOL_REGEN = 3;
export const HAB_REGEN = 1;

export const TEMPOS = 3;
export const MAX_LANCES = 3;
export const BASE_LANCES: Record<Weight, number> = { leve: 3, medio: 2, pesado: 1 };
/** Fôlego gasto por lance no Duelo. */
export const LANCE_FOL: Record<Weight, number> = { leve: 1, medio: 1, pesado: 2 };
export const WEIGHT_RANK: Record<Weight, number> = { leve: 0, medio: 1, pesado: 2 };
export const WEIGHT_LABEL: Record<Weight, string> = { leve: 'Leve', medio: 'Médio', pesado: 'Pesado' };

export const ROLES: Record<Role, RoleDef> = {
  goleiro: {
    name: 'Goleiro',
    short: 'GOL',
    weight: 'medio',
    mov: 3,
    pas: 6,
    dom: 3,
    hab: 2,
    fin: 1,
    mar: 3,
    fol: 8,
    ref: 5,
    special: 'Muralha',
    specialText: 'Reflexo +2 até a próxima fase do time.',
    blurb: 'Fecha o gol. Só anda dentro da área e precisa soltar a bola na fase em que a pegou.',
  },
  fixo: {
    name: 'Fixo',
    short: 'FIX',
    weight: 'pesado',
    mov: 3,
    pas: 7,
    dom: 3,
    hab: 2,
    fin: 3,
    mar: 5,
    fol: 10,
    ref: 0,
    special: 'Carrinho',
    specialText: 'Desarma a 2 casas, com +1 lance; pela frente, nunca é falta.',
    blurb: 'Último homem. Marca forte, corta passes e sai jogando com passe longo.',
  },
  ala: {
    name: 'Ala',
    short: 'ALA',
    weight: 'leve',
    mov: 5,
    pas: 5,
    dom: 5,
    hab: 6,
    fin: 3,
    mar: 2,
    fol: 10,
    ref: 0,
    special: 'Pedalada',
    specialText: 'No próximo Duelo: +1 Leitura e as Fintas não gastam HAB.',
    blurb: 'Rápido e habilidoso. Ganha o 1 contra 1 e ataca o espaço vazio.',
  },
  pivo: {
    name: 'Pivô',
    short: 'PIV',
    weight: 'pesado',
    mov: 3,
    pas: 4,
    dom: 4,
    hab: 2,
    fin: 5,
    mar: 2,
    fol: 10,
    ref: 0,
    special: 'Bomba',
    specialText: 'Chute com +2 de força.',
    blurb: 'Referência na frente: segura a bola de costas, vence o choque e finaliza.',
  },
};

export const ROLE_ORDER: Role[] = ['goleiro', 'fixo', 'ala', 'ala', 'pivo'];

export interface RosterEntry {
  name: string;
  number: number;
  role: Role;
  look: Look;
}

export const ROSTERS: Record<Team, RosterEntry[]> = {
  azul: [
    { name: 'Gui', number: 1, role: 'goleiro', look: { skin: '#f1c9a5', hair: 'franja', hairColor: '#3a2a1e', build: 'forte' } },
    { name: 'Rafa', number: 4, role: 'fixo', look: { skin: '#c68a5e', hair: 'curto', hairColor: '#1d1a18', acc: 'barba', accColor: '#1d1a18', build: 'forte' } },
    { name: 'Dudu', number: 7, role: 'ala', look: { skin: '#8a5a3c', hair: 'black', hairColor: '#1b1410', acc: 'faixa', accColor: '#ffffff', build: 'magro' } },
    { name: 'Teco', number: 11, role: 'ala', look: { skin: '#f5d3b5', hair: 'espetado', hairColor: '#e8c24a', acc: 'munhequeira', accColor: '#ffffff', build: 'magro' } },
    { name: 'Marreta', number: 9, role: 'pivo', look: { skin: '#a8714a', hair: 'careca', hairColor: '#2a1b12', acc: 'bigode', accColor: '#2a1b12', build: 'forte' } },
  ],
  vermelho: [
    { name: 'Biel', number: 12, role: 'goleiro', look: { skin: '#e8b896', hair: 'rabo', hairColor: '#5a3a22', build: 'forte' } },
    { name: 'Tonhão', number: 3, role: 'fixo', look: { skin: '#6e452c', hair: 'moicano', hairColor: '#151010', build: 'forte' } },
    { name: 'Pity', number: 10, role: 'ala', look: { skin: '#f3cfae', hair: 'cacheado', hairColor: '#b4542a', acc: 'oculos', accColor: '#2b2b33', build: 'magro' } },
    { name: 'Lelo', number: 8, role: 'ala', look: { skin: '#b98058', hair: 'franja', hairColor: '#2b1e16', acc: 'bandana', accColor: '#ffffff', build: 'magro' } },
    { name: 'Bigode', number: 5, role: 'pivo', look: { skin: '#d9a27a', hair: 'curto', hairColor: '#4a3122', acc: 'bigode', accColor: '#4a3122', build: 'forte' } },
  ],
};

export const TEAM_NAME: Record<Team, string> = { azul: 'Azul', vermelho: 'Vermelho' };
