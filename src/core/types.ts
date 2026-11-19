// Tipos do núcleo de regras. Nada aqui sabe que existe tela.

export type Team = 'azul' | 'vermelho';
export const TEAMS: readonly Team[] = ['azul', 'vermelho'];
export const otherTeam = (t: Team): Team => (t === 'azul' ? 'vermelho' : 'azul');

export type Weight = 'leve' | 'medio' | 'pesado';
export type Arm = 'infantaria' | 'cavalaria' | 'artilharia' | 'engenharia' | 'suporte';

export type ClassId =
  | 'espadachim'
  | 'atirador'
  | 'tank'
  | 'cavaleiro'
  | 'blindado'
  | 'morteiro'
  | 'canhao'
  | 'bombardeiro'
  | 'mecanico'
  | 'construtor'
  | 'medico'
  | 'espiao';

export type RangedKind = 'tiro' | 'canhao' | 'morteiro' | 'granada';

export interface RangedProfile {
  kind: RangedKind;
  min: number;
  max: number;
  /** Multiplicador sobre o ATQ. */
  mult: number;
}

export interface HealProfile {
  range: number;
  amount: number;
  cost: number;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  abbr: string;
  arm: Arm;
  weight: Weight;
  mov: number;
  hp: number;
  atq: number;
  armadura: number;
  stamina: number;
  /** Pode iniciar ataque corpo a corpo (abre Confronto). */
  melee: boolean;
  ranged?: RangedProfile;
  heal?: HealProfile;
  /** Pode usar o movimento que sobrou depois de agir (Cavaleiro, Espião). */
  moveAfterAction: boolean;
  role: string;
}

export type Terrain =
  | 'planicie'
  | 'floresta'
  | 'colina'
  | 'ruina'
  | 'lama'
  | 'agua'
  | 'ponte'
  | 'no_verde'
  | 'no_roxo'
  | 'no_laranja'
  | 'fonte'
  | 'base';

export type Dir = 'N' | 'S' | 'E' | 'W';

export type ItemId = 'tonico' | 'oleo' | 'foco';
export type NodeColor = 'verde' | 'roxo' | 'laranja' | 'prisma';

export type AbilityId =
  | 'avanco'
  | 'tiroCerteiro'
  | 'provocar'
  | 'investida'
  | 'atropelar'
  | 'fumaca'
  | 'perfurante'
  | 'mina'
  | 'reparo'
  | 'barricada'
  | 'curaArea'
  | 'furtar';

export interface Pos {
  x: number;
  y: number;
}

export interface Unit {
  id: string;
  cls: ClassId;
  team: Team;
  x: number;
  y: number;
  hp: number;
  stamina: number;
  facing: Dir;
  /** Já agiu nesta rodada. */
  activated: boolean;
  /** Prontidão: não fez ação na última ativação; +1 lance ao defender. */
  ready: boolean;
  alive: boolean;
  level: number;
  xp: number;
  maxHp: number;
  items: ItemId[];
  /** Óleo de combate ativo: +3 ATQ no próximo ataque. */
  oil: boolean;
  /** Elixir de foco ativo: +1 lance no próximo Confronto. */
  focus: boolean;
  /** Bônus de ATQ que dura só o Confronto atual (Investida). */
  tempAtq: number;
  /** Provocada por este Tank até o fim da fase `tauntUntil`. */
  tauntBy: string | null;
  tauntUntil: number;
}

export interface Barricade {
  id: number;
  team: Team;
  x: number;
  y: number;
  hp: number;
}

export interface Smoke {
  cells: Pos[];
  /** Some quando a fase `untilPhase` terminar. */
  untilPhase: number;
}

export interface Mine {
  id: number;
  team: Team;
  x: number;
  y: number;
}

export interface ColorNode {
  x: number;
  y: number;
  color: NodeColor;
  charges: number;
}

export interface Base {
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  armadura: number;
}

export interface MortarStrike {
  id: number;
  team: Team;
  ownerId: string;
  cx: number;
  cy: number;
  cells: Pos[];
  atq: number;
  mult: number;
  /** Cai no começo da fase de número `resolveAt` (a próxima fase de quem atirou). */
  resolveAt: number;
}

export interface Activation {
  unitId: string;
  startX: number;
  startY: number;
  startFacing: Dir;
  mpLeft: number;
  hasMoved: boolean;
  hasActed: boolean;
  ran: boolean;
  /** Pisou numa mina: o movimento não pode ser desfeito. */
  noUndo: boolean;
}

export interface TeamStats {
  kills: number;
  baseDamage: number;
}

export type GameEvent =
  | { kind: 'dano'; x: number; y: number; amount: number }
  | { kind: 'cura'; x: number; y: number; amount: number }
  | { kind: 'abate'; x: number; y: number }
  | { kind: 'impacto'; cells: Pos[] }
  | { kind: 'tiro'; from: Pos; to: Pos }
  | { kind: 'texto'; x: number; y: number; text: string; color: string };

export type Winner = Team | 'empate' | null;

export interface GameState {
  width: number;
  height: number;
  terrain: Terrain[][];
  units: Unit[];
  bases: Record<Team, Base>;
  round: number;
  maxRounds: number;
  /** Time que abre cada rodada (sorteado no início). */
  startingTeam: Team;
  /** Time cuja fase está acontecendo. */
  activeTeam: Team;
  /** Contador de fases desde o início (1, 2, 3…). Cada rodada tem duas. */
  phase: number;
  activation: Activation | null;
  strikes: MortarStrike[];
  nextId: number;
  barricades: Barricade[];
  smoke: Smoke[];
  mines: Mine[];
  nodes: ColorNode[];
  stats: Record<Team, TeamStats>;
  log: string[];
  events: GameEvent[];
  winner: Winner;
  winReason: string;
  /** Estado do gerador pseudoaleatório (determinístico). */
  rng: number;
}
