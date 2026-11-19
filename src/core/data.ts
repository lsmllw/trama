import type { AbilityId, ClassDef, ClassId, ItemId, NodeColor, Terrain, Weight } from './types';

// Valores de level 1 do GDD. Tudo aqui é ponto de partida para balancear.
export const CLASSES: Record<ClassId, ClassDef> = {
  espadachim: {
    id: 'espadachim', name: 'Espadachim', abbr: 'Es', arm: 'infantaria', weight: 'leve',
    mov: 5, hp: 22, atq: 7, armadura: 3, stamina: 10, melee: true, moveAfterAction: false,
    role: 'Duelista, vence Confrontos',
  },
  atirador: {
    id: 'atirador', name: 'Atirador', abbr: 'At', arm: 'infantaria', weight: 'medio',
    mov: 4, hp: 20, atq: 5, armadura: 3, stamina: 8, melee: false, moveAfterAction: false,
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
    mov: 6, hp: 26, atq: 7, armadura: 4, stamina: 9, melee: true, moveAfterAction: true,
    role: 'Flanqueador',
  },
  blindado: {
    id: 'blindado', name: 'Blindado', abbr: 'Bl', arm: 'cavalaria', weight: 'pesado',
    mov: 3, hp: 32, atq: 9, armadura: 6, stamina: 7, melee: true, moveAfterAction: false,
    ranged: { kind: 'tiro', min: 2, max: 2, mult: 1.5 },
    forbidden: ['floresta', 'colina', 'ruina', 'lama'],
    vehicle: true,
    role: 'Rompedor; só anda em terreno liso',
  },
  morteiro: {
    id: 'morteiro', name: 'Morteiro', abbr: 'Mo', arm: 'artilharia', weight: 'leve',
    mov: 4, hp: 18, atq: 8, armadura: 2, stamina: 8, melee: false, moveAfterAction: false,
    ranged: { kind: 'morteiro', min: 3, max: 6, mult: 2.2 },
    role: 'Área telegrafada',
  },
  canhao: {
    id: 'canhao', name: 'Canhão', abbr: 'Ca', arm: 'artilharia', weight: 'pesado',
    mov: 2, hp: 24, atq: 9, armadura: 4, stamina: 6, melee: false, moveAfterAction: false,
    ranged: { kind: 'canhao', min: 4, max: 8, mult: 1.5 },
    role: 'Dano pesado, cerco à Base',
  },
  bombardeiro: {
    id: 'bombardeiro', name: 'Bombardeiro', abbr: 'Bo', arm: 'engenharia', weight: 'leve',
    mov: 5, hp: 18, atq: 6, armadura: 2, stamina: 9, melee: false, moveAfterAction: false,
    ranged: { kind: 'granada', min: 1, max: 3, mult: 1.5 },
    role: 'Minas e granadas antitanque',
  },
  mecanico: {
    id: 'mecanico', name: 'Mecânico', abbr: 'Me', arm: 'engenharia', weight: 'medio',
    mov: 4, hp: 22, atq: 6, armadura: 4, stamina: 8, melee: true, moveAfterAction: false,
    role: 'Reparo, suporte a máquinas',
  },
  construtor: {
    id: 'construtor', name: 'Construtor', abbr: 'Co', arm: 'engenharia', weight: 'pesado',
    mov: 3, hp: 30, atq: 7, armadura: 6, stamina: 7, melee: true, moveAfterAction: false,
    role: 'Barricadas',
  },
  medico: {
    id: 'medico', name: 'Médico', abbr: 'Md', arm: 'suporte', weight: 'leve',
    mov: 6, hp: 18, atq: 3, armadura: 2, stamina: 10, melee: true, moveAfterAction: false,
    heal: { range: 2, amount: 10, cost: 1 },
    role: 'Cura',
  },
  espiao: {
    id: 'espiao', name: 'Espião', abbr: 'Ep', arm: 'suporte', weight: 'leve',
    mov: 6, hp: 20, atq: 8, armadura: 2, stamina: 10, melee: true, moveAfterAction: true,
    role: 'Infiltração',
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

export const WEIGHT_LABEL: Record<Weight, string> = { leve: 'Leve', medio: 'Médio', pesado: 'Pesado' };
/** Lances por Confronto, antes dos modificadores. */
export const BASE_LANCES: Record<Weight, number> = { leve: 3, medio: 2, pesado: 1 };
/** Força de cada lance. */
export const FORCA: Record<Weight, number> = { leve: 1.0, medio: 1.3, pesado: 1.6 };
/** Golpe × Golpe: multiplicador do mais pesado e do mais leve (iguais: os dois usam `even`). */
export const CLASH_TIE = { heavier: 2.0, lighter: 1.0, even: 1.0 };
/**
 * Bônus por atacar pelo flanco e pelas costas. `mode: 'leitura'` dá Leituras (ver o lance do
 * inimigo antes de escolher) em vez de lances: o peso define os lances, a posição define a informação.
 */
export const SIDE_BONUS: { flanco: number; costas: number; mode: 'lances' | 'leitura' } = { flanco: 1, costas: 2, mode: 'leitura' };
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
  no_verde: { label: 'Nó verde', cost: 1, armorBonus: 0, cover: false },
  no_roxo: { label: 'Nó roxo', cost: 1, armorBonus: 0, cover: false },
  no_laranja: { label: 'Nó laranja', cost: 1, armorBonus: 0, cover: false },
  fonte: { label: 'Fonte Prismática', cost: 1, armorBonus: 0, cover: false },
  base: { label: 'Base', cost: Infinity, armorBonus: 0, cover: false },
};

// ---------- Progressão ----------

/** XP total para chegar a cada level (índice = level − 1). */
export const LEVEL_XP = [0, 3, 6, 10, 15];
export const MAX_LEVEL = LEVEL_XP.length;
/** Level em que a habilidade da classe é liberada. */
export const ABILITY_LEVEL = 2;
export const LEVEL_HP = 3;
export const LEVEL_ATQ = 1;
export const XP_HIT = 1;
export const XP_KILL = 2;
export const XP_SUPPORT = 1;

// ---------- Itens ----------

export const MAX_ITEMS = 2;
export const NODE_CHARGES = 3;

export interface ItemDef {
  id: ItemId;
  name: string;
  color: Exclude<NodeColor, 'prisma'>;
  desc: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  tonico: { id: 'tonico', name: 'Tônico', color: 'verde', desc: 'Recupera 12 HP.' },
  oleo: { id: 'oleo', name: 'Óleo de combate', color: 'laranja', desc: '+3 ATQ no próximo ataque.' },
  foco: { id: 'foco', name: 'Elixir de foco', color: 'roxo', desc: '+1 lance no próximo Confronto e +4 Stamina.' },
};
export const ITEM_BY_COLOR: Record<Exclude<NodeColor, 'prisma'>, ItemId> = { verde: 'tonico', laranja: 'oleo', roxo: 'foco' };
export const TONICO_HEAL = 12;
export const OLEO_ATQ = 3;
export const FOCO_STAMINA = 4;

// ---------- Habilidades (uma por classe, liberada no level 2) ----------

export interface AbilityDef {
  id: AbilityId;
  name: string;
  cost: number;
  desc: string;
  /** Level em que é liberada (padrão: ABILITY_LEVEL). */
  unlock?: number;
}

export const ABILITIES: Record<ClassId, AbilityDef> = {
  espadachim: { id: 'avanco', name: 'Avanço', cost: 2, desc: 'Avança em linha reta até um inimigo a 2–3 casas e abre Confronto com +1 lance.' },
  atirador: { id: 'tiroCerteiro', name: 'Tiro certeiro', cost: 2, desc: 'Tiro a 2–5 casas que ignora esquiva e cobertura.' },
  tank: { id: 'provocar', name: 'Provocar', cost: 3, desc: 'Inimigos a até 2 casas só podem atacar o Tank na próxima fase deles.' },
  cavaleiro: { id: 'investida', name: 'Investida', cost: 2, desc: 'Ataque corpo a corpo com +1 lance e +2 ATQ.' },
  blindado: { id: 'atropelar', name: 'Atropelar', cost: 2, desc: 'Empurra um inimigo adjacente 1 casa (ATQ − ARM). Se ele bater em algo, +6 de dano.' },
  morteiro: { id: 'fumaca', name: 'Fumaça', cost: 3, desc: 'Área 3×3 a 2–6 casas que bloqueia tiros até o fim da próxima rodada.' },
  canhao: { id: 'perfurante', name: 'Perfurante', cost: 3, desc: 'Tiro em linha (4–8) que atravessa e atinge até 2 unidades. Não pode ter andado.' },
  bombardeiro: {
    id: 'mina',
    name: 'Mina terrestre',
    cost: 1,
    unlock: 1,
    desc: 'Desde o level 1. Arma uma mina escondida a até 2 casas (no máximo 3 por Bombardeiro). 8 de dano em quem pisar; num Blindado, 16 e ele fica imobilizado na fase seguinte dele.',
  },
  mecanico: { id: 'reparo', name: 'Reparo', cost: 1, desc: 'Recupera 8 HP de um aliado adjacente, de uma barricada sua ou da sua Base.' },
  construtor: { id: 'barricada', name: 'Barricada', cost: 2, desc: 'Ergue uma barricada (15 HP) numa casa adjacente: bloqueia passagem e tiros.' },
  medico: { id: 'curaArea', name: 'Cura em área', cost: 2, desc: 'Cura 6 HP de todos os aliados a até 2 casas, inclusive ele.' },
  espiao: { id: 'furtar', name: 'Furtar', cost: 1, desc: 'Rouba um item de um inimigo adjacente.' },
};

export const MINE_DAMAGE = 8;
/** Multiplicador da mina contra veículos (Blindado). */
export const MINE_VEHICLE_MULT = 2;
export const MAX_MINES_PER_OWNER = 3;
/** Granada do Bombardeiro ignora esta fração da armadura de veículos (antitanque). */
export const ANTITANK = { granadaArmorIgnore: 1 };
export const BARRICADE_HP = 15;
export const REPAIR_AMOUNT = 8;
export const AREA_HEAL = 6;
export const RAM_BONUS = 6;
/** Reparo do Mecânico vale para qualquer aliado (não só Blindado/Canhão). */
export const REPAIR_ANY = { value: true };
