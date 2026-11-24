import type { Style } from './estilos';
import type { Trait } from './caracteristicas';
// Tipos do Trama Futsal.

export type Team = 'azul' | 'vermelho';
export type Role = 'goleiro' | 'fixo' | 'ala' | 'pivo';
export type Weight = 'leve' | 'medio' | 'pesado';
export type Dir = 'N' | 'S' | 'E' | 'W';

export interface Pos {
  x: number;
  y: number;
}

export type HairStyle = 'curto' | 'espetado' | 'black' | 'franja' | 'careca' | 'rabo' | 'moicano' | 'cacheado';
export type Accessory = 'bigode' | 'oculos' | 'faixa' | 'barba' | 'munhequeira' | 'bandana';

/** Aparência de um personagem (o sprite é gerado a partir disto). */
export interface Look {
  skin: string;
  hair: HairStyle;
  hairColor: string;
  acc?: Accessory;
  accColor?: string;
  build: 'magro' | 'normal' | 'forte';
}

export interface RoleDef {
  name: string;
  short: string;
  weight: Weight;
  /** Movimento (casas por fase sem a bola). */
  mov: number;
  /** Alcance do passe rasteiro. */
  pas: number;
  /** Domínio de bola (1–5). */
  dom: number;
  /** Pontos de habilidade (reserva para dribles). */
  hab: number;
  /** Finalização (1–5). */
  fin: number;
  /** Marcação (1–5). */
  mar: number;
  /** Fôlego. */
  fol: number;
  /** Reflexo (só o goleiro usa). */
  ref: number;
  special: string;
  specialText: string;
  blurb: string;
}

export interface Player {
  id: string;
  team: Team;
  role: Role;
  name: string;
  number: number;
  look: Look;
  x: number;
  y: number;
  facing: Dir;
  fol: number;
  hab: number;
  /** Já agiu nesta fase. */
  activated: boolean;
  /** Prontidão: não agiu na fase do time. Na fase do adversário corta passes a 2 casas, dá bote automático em quem
   * chegar colado com a bola e tem +1 lance ao defender. Gasta ao reagir. */
  ready: boolean;
  /** Recebeu passe alto nesta fase: não chuta nem dribla até a próxima. */
  altoRecebido: boolean;
  /** Recebeu um toque curto da Posse de bola nesta fase: o bote de prontidão não ganha bônus contra ele. */
  toqueCurto: boolean;
  /** Característica do atleta (escolhida antes da partida). */
  trait: Trait | null;
  /** Pivô de costas: recebeu passe já tendo jogado e pode escorar de primeira. */
  escoraPronta: boolean;
  /** Recebeu a devolução da tabela: pode jogar mais uma vez nesta fase. */
  tabela: boolean;
  /** Quem passou a bola para ele nesta fase (para reconhecer a tabela). */
  lastPasser: string | null;
  /** Perdeu um duelo: sem zona de corte até a próxima fase do seu time. */
  unbalanced: boolean;
  /** Especial da posição já usado neste tempo. */
  specialUsed: boolean;
  /** Efeitos do especial ativos. */
  pedalada: boolean;
  muralha: boolean;
  goals: number;
  /** Guardou uma garrafa de energético (usa quando quiser, numa ativação dele). */
  energetico: boolean;
}

export interface Activation {
  playerId: string;
  startX: number;
  startY: number;
  moved: boolean;
  acted: boolean;
  sprinted: boolean;
  /** Depois de um drible vencido: ainda pode passar ou chutar (sem andar). */
  bonus: boolean;
  /** Tomou energético nesta ativação: +2 casas de movimento. */
  energized: boolean;
  /** Garrafa pega no caminho deste movimento (volta para a quadra se o movimento for desfeito). */
  picked: Drink | null;
  /** Já sofreu o bote automático depois de andar (não dá mais para desfazer o movimento). */
  reacted: boolean;
  /** Ativação extra: escora do Pivô de costas (só passe rasteiro, sem andar) ou tabela (anda 2 e chuta ou passa). */
  mode: 'normal' | 'escora' | 'tabela';
}

/** Garrafa de energético jogada pela torcida: fica na quadra algumas rodadas. */
export interface Drink {
  id: string;
  x: number;
  y: number;
  /** Rodada (contada desde o início da partida) em que caiu. */
  born: number;
  /** Some no começo desta rodada; pisca na rodada anterior. */
  expires: number;
}

export type Corner = 'esq' | 'meio' | 'dir';

export type GameEvent =
  | { kind: 'move'; id: string; path: Pos[]; withBall: boolean; sprint: boolean }
  | { kind: 'passe'; fromId: string; toId: string; from: Pos; to: Pos; alto: boolean; result: 'ok' | 'cortado' | 'dividida' }
  | {
      kind: 'chute';
      shooterId: string;
      from: Pos;
      corner: Corner;
      dive: Corner | null;
      keeperId: string | null;
      result: 'gol' | 'defesa' | 'bloqueio' | 'rebote';
      blockerId?: string;
      /** Rebote: quem ficou com a bola. */
      reboundId?: string;
      team: Team;
    }
  | { kind: 'duelo'; holderId: string; otherId: string; result: 'passou' | 'roubou' | 'manteve' | 'falta'; to?: Pos }
  | { kind: 'gol'; team: Team; scorerId: string }
  | { kind: 'falta'; at: Pos; byId: string; onId: string; count: number; direto: boolean }
  | { kind: 'reset'; positions: Record<string, Pos>; holderId: string }
  | { kind: 'apito'; text: string; long?: boolean }
  | { kind: 'emote'; id: string; emote: Emote }
  | { kind: 'texto'; x: number; y: number; text: string; color: string }
  | { kind: 'garrafa'; acao: 'cai'; drink: Drink; from: { x: number; y: number } }
  | { kind: 'garrafa'; acao: 'pega'; drinkId: string; playerId: string }
  | { kind: 'garrafa'; acao: 'some'; drinkId: string }
  | { kind: 'garrafa'; acao: 'volta'; drink: Drink }
  | { kind: 'garrafa'; acao: 'usa'; playerId: string };

export type Emote = '!' | '?' | 'suor' | 'coracao' | 'raiva' | 'estrela' | 'musica';

export interface GameState {
  width: number;
  height: number;
  players: Player[];
  /** Quem está com a bola (sempre alguém: não há bola solta). */
  holder: string;
  score: Record<Team, number>;
  half: 1 | 2;
  /** Rodada dentro do tempo (1 a ROUNDS_PER_HALF). */
  round: number;
  /** Contador de fases desde o início. */
  phase: number;
  activeTeam: Team;
  /** Quem deu a saída no 1º tempo. */
  firstKick: Team;
  /** Faltas acumuladas no tempo. */
  fouls: Record<Team, number>;
  activation: Activation | null;
  /** O goleiro começou a fase com a bola: tem de soltá-la nesta fase (4 segundos). */
  keeperMustPass: string | null;
  /** 6ª falta em diante: este jogador cobra um tiro livre direto do 10 m antes de seguir. */
  pendingDirect: string | null;
  /** Jogadores que já agiram nesta fase (máximo MAX_ACTIVATIONS). */
  activationsUsed: number;
  /** Quantos o time pode ativar nesta fase (4 com a bola no começo da fase, 3 sem). */
  activationsMax: number;
  /** Desarmes tentados pelo time nesta fase. */
  tacklesUsed: number;
  /** Bote automático de um defensor de prontidão, esperando o Duelo (quem chama resolve com startReaction). */
  pendingReaction: string | null;
  /** Estilo de jogo de cada time. */
  styles: Record<Team, Style>;
  /** Fases seguidas que cada time começou com a bola. */
  possStreak: Record<Team, number>;
  /** O time da vez começou a fase com a bola (fase de ataque). */
  phaseWithBall: boolean;
  /** Fase logo depois de recuperar a bola (vale para o Contra-ataque). */
  counterPhase: boolean;
  /** Escora e tabela do Pivô de costas já usadas nesta fase. */
  escoraUsed: boolean;
  tabelaUsed: boolean;
  /** Jogador com a característica extra do Equilíbrio (perde se o time sair do Equilíbrio). */
  extraTrait: Record<Team, string | null>;
  /** Toques curtos completos da Posse de bola nesta fase. */
  passChain: number;
  /** O passe alto livre do Contra-ataque já foi usado nesta fase. */
  counterAltoUsed: boolean;
  /** A próxima fase começa numa saída de bola (não conta como recuperação). */
  kickoff: boolean;
  /** Garrafas de energético na quadra. */
  drinks: Drink[];
  drinkSeq: number;
  rng: number;
  events: GameEvent[];
  log: string[];
  over: boolean;
  winner: Team | 'empate' | null;
}
