import type { ClassDef, ClassId, Terrain, Weight } from './types';

// Valores de level 1 do GDD. Tudo aqui é ponto de partida para balancear.
export const CLASSES: Record<ClassId, ClassDef> = {
  espadachim: {
    id: 'espadachim', name: 'Espadachim', abbr: 'Es', arm: 'infantaria', weight: 'leve',
    mov: 5, hp: 22, atq: 7, armadura: 3, stamina: 10, melee: true, moveAfterAction: false,
    role: 'Duelista, vence Confrontos',
  },
  atirador: {
    id: 'atirador', name: 'Atirador', abbr: 'At', arm: 'infantaria', weight: 'medio',
    mov: 4, hp: 20, atq: 6, armadura: 3, stamina: 8, melee: false, moveAfterAction: false,
    ranged: { kind: 'tiro', min: 2, max: 4, mult: 2.0 },
    role: 'Dano à distância',
  },
  tank: {
    id: 'tank', name: 'Tank', abbr: 'Tk', arm: 'infantaria', weight: 'pesado',
    mov: 3, hp: 34, atq: 6, armadura: 7, stamina: 6, melee: true, moveAfterAction: false,
    role: 'Linha de frente',
  },
  cavaleiro: {
    id: 'cavaleiro', name: 'Cavaleiro', abbr: 'Cv', arm: 'cavalaria', weight: 'medio',
    mov: 6, hp: 26, atq: 8, armadura: 4, stamina: 9, melee: true, moveAfterAction: true,
    role: 'Flanqueador',
  },
  blindado: {
    id: 'blindado', name: 'Blindado', abbr: 'Bl', arm: 'cavalaria', weight: 'pesado',
    mov: 5, hp: 32, atq: 9, armadura: 6, stamina: 7, melee: true, moveAfterAction: false,
    ranged: { kind: 'tiro', min: 2, max: 2, mult: 1.5 },
    role: 'Rompedor',
  },
  morteiro: {
    id: 'morteiro', name: 'Morteiro', abbr: 'Mo', arm: 'artilharia', weight: 'leve',
    mov: 4, hp: 18, atq: 7, armadura: 2, stamina: 8, melee: false, moveAfterAction: false,
    ranged: { kind: 'morteiro', min: 3, max: 6, mult: 2.0 },
    role: 'Área telegrafada',
  },
  canhao: {
    id: 'canhao', name: 'Canhão', abbr: 'Ca', arm: 'artilharia', weight: 'pesado',
    mov: 2, hp: 24, atq: 12, armadura: 4, stamina: 6, melee: false, moveAfterAction: false,
    ranged: { kind: 'canhao', min: 4, max: 8, mult: 1.5 },
    role: 'Dano pesado, cerco à Base',
  },
  bombardeiro: {
    id: 'bombardeiro', name: 'Bombardeiro', abbr: 'Bo', arm: 'engenharia', weight: 'leve',
    mov: 5, hp: 18, atq: 6, armadura: 2, stamina: 9, melee: false, moveAfterAction: false,
    ranged: { kind: 'granada', min: 1, max: 3, mult: 1.5 },
    role: 'Granadas em área',
  },
  mecanico: {
    id: 'mecanico', name: 'Mecânico', abbr: 'Me', arm: 'engenharia', weight: 'medio',
    mov: 4, hp: 22, atq: 5, armadura: 4, stamina: 8, melee: true, moveAfterAction: false,
    role: 'Reparo (Fase 2)',
  },
  construtor: {
    id: 'construtor', name: 'Construtor', abbr: 'Co', arm: 'engenharia', weight: 'pesado',
    mov: 3, hp: 30, atq: 5, armadura: 6, stamina: 7, melee: true, moveAfterAction: false,
    role: 'Terreno (Fase 2)',
  },
  medico: {
    id: 'medico', name: 'Médico', abbr: 'Md', arm: 'suporte', weight: 'leve',
    mov: 6, hp: 18, atq: 3, armadura: 2, stamina: 10, melee: true, moveAfterAction: false,
    heal: { range: 2, amount: 10, cost: 1 },
    role: 'Cura',
  },
  espiao: {
    id: 'espiao', name: 'Espião', abbr: 'Ep', arm: 'suporte', weight: 'leve',
    mov: 6, hp: 18, atq: 6, armadura: 2, stamina: 10, melee: true, moveAfterAction: true,
    role: 'Infiltração',
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

export const WEIGHT_LABEL: Record<Weight, string> = { leve: 'Leve', medio: 'Médio', pesado: 'Pesado' };
/** Lances por Confronto, antes dos modificadores. */
export const BASE_LANCES: Record<Weight, number> = { leve: 3, medio: 2, pesado: 1 };
/** Força de cada lance. */
export const FORCA: Record<Weight, number> = { leve: 1.0, medio: 1.3, pesado: 1.6 };
/** Stamina gasta por lance. */
export const LANCE_COST: Record<Weight, number> = { leve: 1, medio: 1, pesado: 2 };
/** Esquiva passiva contra tiro direto. */
export const ESQUIVA: Record<Weight, number> = { leve: 0.3, medio: 0.15, pesado: 0 };
export const WEIGHT_RANK: Record<Weight, number> = { leve: 1, medio: 2, pesado: 3 };

export const MAX_LANCES = 3;
export const TEMPOS = 3;
export const STAMINA_REGEN = 3;
export const RUN_COST = 2;
export const RUN_BONUS = 2;

export const BASE_HP = 60;
export const BASE_ARMOR = 4;
export const TURRET_DAMAGE = 5;
/** Ataque corpo a corpo contra a Base: ATQ × 1,5 − Armadura (sem a força do peso). */
export const BASE_MELEE_MULT = 1.5;
export const MAX_ROUNDS = 20;

export interface TerrainDef {
  label: string;
  cost: number;
  /** Custo para Cavalaria, se diferente. */
  cavalryCost?: number;
  armorBonus: number;
  cover: boolean;
}

export const TERRAIN: Record<Terrain, TerrainDef> = {
  planicie: { label: 'Planície', cost: 1, armorBonus: 0, cover: false },
  floresta: { label: 'Floresta', cost: 2, cavalryCost: 3, armorBonus: 1, cover: true },
  colina: { label: 'Colina', cost: 2, armorBonus: 0, cover: false },
  ruina: { label: 'Ruína', cost: 1, armorBonus: 0, cover: true },
  lama: { label: 'Lama', cost: 2, armorBonus: 0, cover: false },
  agua: { label: 'Água', cost: Infinity, armorBonus: 0, cover: false },
  ponte: { label: 'Ponte', cost: 1, armorBonus: 0, cover: false },
  no_verde: { label: 'Nó verde (Fase 2)', cost: 1, armorBonus: 0, cover: false },
  no_roxo: { label: 'Nó roxo (Fase 2)', cost: 1, armorBonus: 0, cover: false },
  no_laranja: { label: 'Nó laranja (Fase 2)', cost: 1, armorBonus: 0, cover: false },
  fonte: { label: 'Fonte Prismática (Fase 2)', cost: 1, armorBonus: 0, cover: false },
  base: { label: 'Base', cost: Infinity, armorBonus: 0, cover: false },
};
