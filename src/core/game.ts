// Regras da partida de futsal: posse, movimento, passe, chute, duelos, faltas e tempos.

import { BLOCO_CUT, CONTRA_EXTRA, CONTRA_STREAK, POSSE_MAX_BONUS, POSSE_SHORT, PRESSAO_FOL, STYLES } from './estilos';
import type { Style } from './estilos';
import { hasSpecial, PULMAO_REGEN, statsOf, TRAITS, traitFits } from './caracteristicas';
import type { Trait } from './caracteristicas';
import {
  CHUTE_BASE,
  COURT_H,
  COURT_W,
  FOL_REGEN,
  FOL_REST,
  FOUL_LIMIT,
  HAB_REGEN,
  ROLES,
  ROSTERS,
  DRINK_CHANCE,
  DRINK_MAX,
  DRINK_MOVE,
  DRINK_ROUNDS,
  ALTO_BONUS,
  ALTO_COST,
  MAX_ACTIVATIONS,
  MAX_ACTIVATIONS_ATK,
  TACKLES_PER_PHASE,
  REBOUND_CHANCE,
  ROUNDS_PER_HALF,
  SPRINT_BONUS,
  SPRINT_COST,
  TEAM_NAME,
  TEN_METER,
} from './data';
import {
  attackGoal,
  center,
  ownGoal,
  chebyshev,
  dirFromTo,
  dist,
  distToGoal,
  getPlayer,
  holderOf,
  inArea,
  inside,
  keeperOf,
  other,
  passLine,
  playerAt,
  same,
  shotLine,
  teamPlayers,
} from './court';
import { duelOutcome, otherSide, startDuel } from './duelo';
import { nextRandom, pick } from './rng';
import type { DuelState } from './duelo';
import type { Activation, Corner, Drink, GameState, Player, Pos, Team } from './types';

// ---------- Criação e saída de bola ----------

/** Formação base no próprio campo (azul ataca para a direita). */
const BASE_FORMATION: Pos[] = [
  { x: 0, y: 4 }, // goleiro
  { x: 3, y: 5 }, // fixo
  { x: 5, y: 1 }, // ala
  { x: 5, y: 8 }, // ala
  { x: 7, y: 4 }, // pivô
];

function formation(team: Team, kicking: boolean): Pos[] {
  const f = BASE_FORMATION.map((p, i) => (i === 4 && kicking ? { x: 9, y: 4 } : { ...p }));
  return team === 'azul' ? f : f.map((p) => ({ x: COURT_W - 1 - p.x, y: COURT_H - 1 - p.y }));
}

export interface NewGameOptions {
  seed?: number;
  firstKick?: Team;
  styles?: Partial<Record<Team, Style>>;
}

export function styleOf(s: GameState, team: Team): Style {
  return s.styles?.[team] ?? 'equilibrio';
}

/** Quantos jogadores o time da vez ativa nesta fase, pelo estilo e pela posse. */
function phaseLimits(s: GameState): void {
  const team = s.activeTeam;
  const withBall = s.phaseWithBall;
  const style = styleOf(s, team);
  s.activationsMax = withBall ? MAX_ACTIVATIONS_ATK : MAX_ACTIVATIONS;
  if (!withBall && style === 'pressao') s.activationsMax = 4;
  if (!withBall && style === 'bloco') s.activationsMax = 2;
  if (withBall && style === 'contra' && s.possStreak[team] > CONTRA_STREAK) s.activationsMax = 4;
  // Bloco baixo: mesmo atacando, o último homem fica de prontidão lá atrás.
  if (withBall && style === 'bloco') s.activationsMax = 4;
}

/** Troca o estilo de um time (no intervalo, ou antes da saída de bola). */
export function setStyle(s: GameState, team: Team, style: Style): void {
  if (s.styles[team] === style) return;
  // A característica extra é do Equilíbrio: sai junto com ele.
  const extra = s.styles[team] === 'equilibrio' ? s.extraTrait[team] : null;
  if (extra) {
    const p = getPlayer(s, extra);
    s.log.push(`${p.name} perde ${TRAITS[p.trait!].name} (era a característica extra do Equilíbrio).`);
    p.trait = null;
    p.fol = Math.min(p.fol, statsOf(p).fol);
    s.extraTrait[team] = null;
  }
  s.styles[team] = style;
  s.log.push(`${TEAM_NAME[team]} muda para ${STYLES[style].name}.`);
  // Trocado antes de alguém jogar na fase: os limites já valem agora.
  if (s.activationsUsed === 0 && !s.activation) phaseLimits(s);
}

/** Quantos desarmes o time da vez pode tentar nesta fase. */
export function tacklesMax(s: GameState): number {
  return styleOf(s, s.activeTeam) === 'pressao' ? 2 : TACKLES_PER_PHASE;
}

/** Distância da linha do passe em que este defensor corta o rasteiro. */
export function cutRange(s: GameState, q: Player): number {
  if (!q.ready) return 1;
  return styleOf(s, q.team) === 'bloco' ? BLOCO_CUT : 2;
}

/** Passe alto livre do Contra-ataque disponível para quem tem a bola agora. */
function counterAltoFree(s: GameState, from: Player): boolean {
  return s.counterPhase && !s.counterAltoUsed && from.team === s.activeTeam && styleOf(s, from.team) === 'contra';
}

export function createGame(opts: NewGameOptions = {}): GameState {
  const players: Player[] = [];
  for (const team of ['azul', 'vermelho'] as const) {
    ROSTERS[team].forEach((r, i) => {
      const def = ROLES[r.role];
      players.push({
        id: `${team}-${i}`,
        team,
        role: r.role,
        name: r.name,
        number: r.number,
        look: r.look,
        x: 0,
        y: 0,
        facing: team === 'azul' ? 'E' : 'W',
        fol: def.fol,
        hab: def.hab,
        activated: false,
        ready: false,
        unbalanced: false,
        specialUsed: false,
        pedalada: false,
        muralha: false,
        goals: 0,
        energetico: false,
        altoRecebido: false,
        toqueCurto: false,
        trait: null,
        escoraPronta: false,
        tabela: false,
        lastPasser: null,
      });
    });
  }
  const first = opts.firstKick ?? 'azul';
  const s: GameState = {
    width: COURT_W,
    height: COURT_H,
    players,
    holder: '',
    score: { azul: 0, vermelho: 0 },
    half: 1,
    round: 1,
    phase: 0,
    activeTeam: first,
    firstKick: first,
    fouls: { azul: 0, vermelho: 0 },
    activation: null,
    keeperMustPass: null,
    pendingDirect: null,
    drinks: [],
    drinkSeq: 0,
    activationsUsed: 0,
    activationsMax: MAX_ACTIVATIONS,
    tacklesUsed: 0,
    pendingReaction: null,
    styles: { azul: opts.styles?.azul ?? 'equilibrio', vermelho: opts.styles?.vermelho ?? 'equilibrio' },
    possStreak: { azul: 0, vermelho: 0 },
    phaseWithBall: false,
    counterPhase: false,
    counterAltoUsed: false,
    escoraUsed: false,
    tabelaUsed: false,
    extraTrait: { azul: null, vermelho: null },
    passChain: 0,
    kickoff: false,
    rng: (opts.seed ?? 1) | 0,
    events: [],
    log: [],
    over: false,
    winner: null,
  };
  placeForKickoff(s, first);
  s.events.push({ kind: 'apito', text: '1º tempo', long: true });
  startPhase(s, first);
  return s;
}

function placeForKickoff(s: GameState, kicking: Team): void {
  const positions: Record<string, Pos> = {};
  for (const team of ['azul', 'vermelho'] as const) {
    const f = formation(team, team === kicking);
    teamPlayers(s, team).forEach((p, i) => {
      p.x = f[i].x;
      p.y = f[i].y;
      p.facing = team === 'azul' ? 'E' : 'W';
      p.unbalanced = false;
      p.pedalada = false;
      positions[p.id] = { x: p.x, y: p.y };
    });
  }
  // Garrafa que ficou embaixo de alguém na volta às posições sai da quadra.
  for (const d of [...s.drinks]) if (playerAt(s, d.x, d.y)) removeDrink(s, d);
  const piv = teamPlayers(s, kicking).find((p) => p.role === 'pivo')!;
  s.holder = piv.id;
  s.kickoff = true;
  s.events.push({ kind: 'reset', positions, holderId: piv.id });
  s.log.push(`Saída de bola do ${TEAM_NAME[kicking]}.`);
}

// ---------- Fases ----------

function startPhase(s: GameState, team: Team): void {
  s.activeTeam = team;
  s.phase++;
  s.activationsUsed = 0;
  const withBall = !!s.holder && holderOf(s).team === team;
  // Quem está sem a bola agora perdeu a sequência de posse (mesmo que tenha sido na fase do outro).
  if (s.holder) s.possStreak[other(holderOf(s).team)] = 0;
  const prevStreak = s.possStreak[team];
  s.possStreak[team] = withBall ? prevStreak + 1 : 0;
  s.phaseWithBall = withBall;
  s.counterPhase = withBall && prevStreak === 0 && !s.kickoff;
  s.counterAltoUsed = false;
  s.passChain = 0;
  s.escoraUsed = false;
  s.tabelaUsed = false;
  s.kickoff = false;
  phaseLimits(s);
  s.tacklesUsed = 0;
  // Bloco baixo cansa quando o adversário fica com a bola: cada fase seguida dele custa mais fôlego.
  if (withBall && styleOf(s, other(team)) === 'bloco' && s.possStreak[team] >= 2) {
    const drain = s.possStreak[team] - 1;
    for (const q of teamPlayers(s, other(team))) if (q.role !== 'goleiro') q.fol = Math.max(0, q.fol - drain);
  }
  s.pendingReaction = null;
  for (const p of s.players) {
    p.altoRecebido = false;
    p.toqueCurto = false;
    p.escoraPronta = false;
    p.tabela = false;
    p.lastPasser = null;
  }
  for (const p of teamPlayers(s, team)) {
    const def = statsOf(p);
    p.activated = false;
    p.unbalanced = false;
    p.muralha = false;
    p.fol = Math.min(def.fol, p.fol + (p.ready ? FOL_REST : FOL_REGEN) + (p.trait === 'pulmao' ? PULMAO_REGEN : 0));
    p.hab = Math.min(def.hab, p.hab + HAB_REGEN);
  }
  const h = holderOf(s);
  s.keeperMustPass = h.team === team && h.role === 'goleiro' && keeperBound(h) ? h.id : null;
  // Começo de rodada: garrafas velhas somem e a torcida pode jogar outra.
  if (team === (s.half === 1 ? s.firstKick : other(s.firstKick))) drinksTick(s);
}

/** Fases jogadas neste tempo (2 por rodada). */
function halfPhases(s: GameState): number {
  return (s.round - 1) * 2 + (s.activeTeam === (s.half === 1 ? s.firstKick : other(s.firstKick)) ? 0 : 1);
}

export function endPhase(s: GameState): void {
  if (s.over) return;
  if (s.activation) finishActivation(s);
  // Regra dos 4 segundos também vale para o goleiro que nem chegou a agir na fase.
  if (s.keeperMustPass && s.holder === s.keeperMustPass) keeperTimeout(s, getPlayer(s, s.keeperMustPass));
  s.keeperMustPass = null;
  for (const p of teamPlayers(s, s.activeTeam)) {
    if (!p.activated) p.ready = true;
    p.activated = true;
  }
  faceAfterPhase(s, s.activeTeam);
  const hp = halfPhases(s) + 1;
  const next = other(s.activeTeam);
  if (hp >= ROUNDS_PER_HALF * 2) {
    if (s.half === 1) {
      s.half = 2;
      s.round = 1;
      s.fouls = { azul: 0, vermelho: 0 };
      for (const p of s.players) {
        p.specialUsed = false;
        p.ready = false;
        p.fol = statsOf(p).fol;
        p.hab = statsOf(p).hab;
      }
      s.events.push({ kind: 'apito', text: 'Intervalo', long: true });
      for (const d of [...s.drinks]) removeDrink(s, d);
      const k = other(s.firstKick);
      placeForKickoff(s, k);
      s.events.push({ kind: 'apito', text: '2º tempo', long: true });
      startPhase(s, k);
      return;
    }
    s.over = true;
    s.winner = s.score.azul === s.score.vermelho ? 'empate' : s.score.azul > s.score.vermelho ? 'azul' : 'vermelho';
    s.events.push({ kind: 'apito', text: 'Fim de jogo', long: true });
    s.log.push(`Fim de jogo: Azul ${s.score.azul} × ${s.score.vermelho} Vermelho.`);
    return;
  }
  s.round = Math.floor(hp / 2) + 1;
  startPhase(s, next);
}

/** No fim da fase: quem está com a bola olha para o gol; os outros olham para a bola. */
function faceAfterPhase(s: GameState, team: Team): void {
  const h = holderOf(s);
  for (const p of teamPlayers(s, team)) {
    if (p.id === h.id) p.facing = p.team === 'azul' ? 'E' : 'W';
    else if (!same(p, h)) p.facing = dirFromTo(p, h);
  }
}

export function activatable(s: GameState): Player[] {
  if (s.over) return [];
  const out = s.activationsUsed >= s.activationsMax ? [] : teamPlayers(s, s.activeTeam).filter((p) => !p.activated);
  // Jogadas extras do Pivô de costas: a escora e a tabela não contam no limite de ativações.
  for (const p of teamPlayers(s, s.activeTeam)) if (extraMode(s, p)) out.push(p);
  return out;
}

/** Ativação extra disponível para quem já jogou: escora do Pivô de costas ou tabela. */
export function extraMode(s: GameState, p: Player): 'escora' | 'tabela' | null {
  if (!p.activated || s.holder !== p.id || p.team !== s.activeTeam) return null;
  if (p.tabela) return 'tabela';
  if (p.escoraPronta && !s.escoraUsed && p.trait === 'pivoCostas') return 'escora';
  return null;
}

/** O goleiro que precisa soltar a bola (regra dos 4 segundos): o Goleiro com os pés, fora da área, não. */
function keeperBound(p: Player): boolean {
  return p.trait !== 'goleiroPes' || inArea(p.team, p);
}

/** Dá as características escolhidas a um time (antes da saída de bola). A 3ª é a extra do Equilíbrio. */
export function assignTraits(s: GameState, team: Team, picks: { playerId: string; trait: Trait }[]): void {
  const max = styleOf(s, team) === 'equilibrio' ? 3 : 2;
  if (picks.length > max) throw new Error(`No máximo ${max} características`);
  const used = new Set<string>();
  const usedT = new Set<Trait>();
  for (const { playerId, trait } of picks) {
    const p = getPlayer(s, playerId);
    if (p.team !== team || used.has(playerId) || usedT.has(trait) || !traitFits(trait, p.role)) throw new Error('Característica inválida');
    used.add(playerId);
    usedT.add(trait);
  }
  for (const p of teamPlayers(s, team)) p.trait = null;
  for (const { playerId, trait } of picks) {
    const p = getPlayer(s, playerId);
    p.trait = trait;
    p.fol = statsOf(p).fol;
    p.hab = statsOf(p).hab;
  }
  s.extraTrait[team] = picks.length === 3 ? picks[2].playerId : null;
  if (picks.length) s.log.push(`${TEAM_NAME[team]}: ${picks.map((k) => `${TRAITS[k.trait].name} (${getPlayer(s, k.playerId).name})`).join(', ')}.`);
}

export function beginActivation(s: GameState, id: string): void {
  const p = getPlayer(s, id);
  const mode = p.activated ? extraMode(s, p) : 'normal';
  if (p.team !== s.activeTeam || !mode) throw new Error('Este jogador não pode agir agora');
  if (s.activation) {
    if (s.activation.moved || s.activation.acted) endActivation(s);
    else s.activation = null;
  }
  s.activation = {
    playerId: id,
    startX: p.x,
    startY: p.y,
    moved: false,
    acted: false,
    sprinted: false,
    bonus: false,
    energized: false,
    picked: null,
    reacted: false,
    mode,
  };
  if (mode === 'escora') {
    s.escoraUsed = true;
    p.escoraPronta = false;
    s.log.push(`${p.name} escora de primeira.`);
  }
  if (mode === 'tabela') p.tabela = false;
}

export function cancelActivation(s: GameState): void {
  const a = s.activation;
  if (a && !a.moved && !a.acted) s.activation = null;
}

export function current(s: GameState): Player | null {
  return s.activation ? getPlayer(s, s.activation.playerId) : null;
}

function finishActivation(s: GameState): void {
  const a = s.activation;
  if (!a) return;
  const p = getPlayer(s, a.playerId);
  p.activated = true;
  p.ready = false;
  if (a.mode === 'normal') s.activationsUsed++;
  // Pressão alta: correr atrás da bola cansa.
  if (!s.phaseWithBall && p.team === s.activeTeam && styleOf(s, p.team) === 'pressao') p.fol = Math.max(0, p.fol - PRESSAO_FOL);
  if (s.keeperMustPass === p.id && s.holder === p.id && keeperBound(p)) keeperTimeout(s, p);
  if (s.keeperMustPass === p.id) s.keeperMustPass = null;
  s.activation = null;
  s.pendingReaction = null;
  checkCounter(s);
}

/** Contra-ataque: roubou a bola na própria fase, sai na hora — mais 2 jogadores (até 5) e o adversário desarrumado. */
function checkCounter(s: GameState): void {
  if (s.over || s.phaseWithBall || s.counterPhase || !s.holder) return;
  if (holderOf(s).team !== s.activeTeam || styleOf(s, s.activeTeam) !== 'contra') return;
  s.counterPhase = true;
  s.activationsMax = Math.min(MAX_ACTIVATIONS_ATK, s.activationsMax + CONTRA_EXTRA);
  s.events.push({ kind: 'apito', text: 'Contra-ataque!' });
  s.log.push(`${TEAM_NAME[s.activeTeam]} recupera e sai no contra-ataque!`);
}

/** Regra dos 4 segundos: o goleiro segurou demais; a bola vai para o adversário mais perto. */
function keeperTimeout(s: GameState, p: Player): void {
  const opp = teamPlayers(s, other(p.team)).filter((q) => q.role !== 'goleiro');
  const taker = opp.reduce((b, q) => (dist(q, p) < dist(b, p) ? q : b));
  s.holder = taker.id;
  s.events.push({ kind: 'apito', text: '4 segundos! Bola do adversário' });
  s.log.push(`${p.name} segurou a bola demais: tiro livre para o ${TEAM_NAME[taker.team]}.`);
}

/** Quantos jogadores o time ainda pode ativar nesta fase (contando quem está em ação). */
export function activationsLeft(s: GameState): number {
  return Math.max(0, s.activationsMax - s.activationsUsed);
}

export function endActivation(s: GameState): void {
  if (!s.activation) throw new Error('Nenhum jogador em ação');
  finishActivation(s);
  if (!s.over && activatable(s).length === 0) endPhase(s);
}

// ---------- Energético ----------

/** Rodada contada desde o começo da partida (1 a 16). */
export function absRound(s: GameState): number {
  return (s.half - 1) * ROUNDS_PER_HALF + s.round;
}

function removeDrink(s: GameState, d: Drink): void {
  s.drinks = s.drinks.filter((q) => q.id !== d.id);
  s.events.push({ kind: 'garrafa', acao: 'some', drinkId: d.id });
}

function collectDrink(s: GameState, p: Player, d: Drink): void {
  s.drinks = s.drinks.filter((q) => q.id !== d.id);
  p.energetico = true;
  s.events.push({ kind: 'garrafa', acao: 'pega', drinkId: d.id, playerId: p.id });
  s.log.push(`${p.name} pega o energético!`);
}

/** Começo de rodada: tira as garrafas vencidas e, às vezes, a torcida joga uma nova numa casa livre. */
function drinksTick(s: GameState): void {
  const now = absRound(s);
  for (const d of [...s.drinks]) if (now >= d.expires) removeDrink(s, d);
  if (now < 2 || s.drinks.length >= DRINK_MAX || nextRandom(s) >= DRINK_CHANCE) return;
  const cells: Pos[] = [];
  const far: Pos[] = [];
  for (let x = 2; x < COURT_W - 2; x++) {
    for (let y = 0; y < COURT_H; y++) {
      const c = { x, y };
      if (playerAt(s, x, y) || s.drinks.some((d) => same(d, c)) || inArea('azul', c) || inArea('vermelho', c)) continue;
      cells.push(c);
      if (s.players.every((p) => chebyshev(p, c) >= 2)) far.push(c);
    }
  }
  if (!cells.length) return;
  const c = pick(s, far.length ? far : cells);
  const fromTop = c.y < COURT_H / 2;
  const d: Drink = { id: `g${++s.drinkSeq}`, x: c.x, y: c.y, born: now, expires: now + DRINK_ROUNDS };
  s.drinks.push(d);
  s.events.push({ kind: 'garrafa', acao: 'cai', drink: d, from: { x: c.x + 0.5 + (nextRandom(s) - 0.5) * 5, y: fromTop ? -1.8 : COURT_H + 1.8 } });
  s.log.push('A torcida joga um energético na quadra!');
}

export function canUseDrink(s: GameState): boolean {
  const a = s.activation;
  if (!a || a.acted || a.energized) return false;
  return getPlayer(s, a.playerId).energetico;
}

/** Toma o energético: fôlego e HAB cheios e, se ainda não andou, +2 casas nesta ativação. Não gasta a ação. */
export function useDrink(s: GameState): void {
  if (!canUseDrink(s)) throw new Error('Sem energético para tomar agora');
  const a = s.activation!;
  const p = getPlayer(s, a.playerId);
  const def = statsOf(p);
  p.energetico = false;
  p.fol = def.fol;
  p.hab = def.hab;
  a.energized = true;
  s.events.push({ kind: 'garrafa', acao: 'usa', playerId: p.id });
  s.log.push(`${p.name} toma o energético: fôlego cheio${a.moved ? '' : ' e +2 casas'}!`);
}

// ---------- Movimento ----------

/** Casas que o jogador anda nesta fase. */
export function moveRange(s: GameState, p: Player, sprinting = false): number {
  const def = statsOf(p);
  let m = def.mov;
  if (s.holder === p.id) m -= def.dom >= 4 ? 0 : def.dom >= 2 ? 1 : 2;
  if (sprinting) m += sprintBonus(p);
  // Contra-ataque: na fase depois de recuperar a bola, o time inteiro corre +1.
  if (s.counterPhase && p.team === s.activeTeam && styleOf(s, p.team) === 'contra') m += 1;
  return Math.max(1, m);
}

/** O jogador com a bola para ao entrar ao lado de um marcador (só sai driblando). */
/** Contra-ataque: quem não ficou de prontidão está fora de posição na fase da recuperação (não corta nem segura ninguém). */
export function outOfPosition(s: GameState, q: Player): boolean {
  if (!s.counterPhase || q.team === s.activeTeam || q.ready || styleOf(s, s.activeTeam) !== 'contra') return false;
  // O Bloco baixo nunca é pego desarrumado no próprio campo.
  if (styleOf(s, q.team) === 'bloco' && dist(center(q), ownGoal(q.team)) < COURT_W / 2) return false;
  return true;
}

/** Bloco baixo: de prontidão no próprio campo, marca por zona (segura quem tem a bola a 2 casas, não só colado). */
export function zoneMarker(s: GameState, q: Player): boolean {
  return q.ready && !q.unbalanced && styleOf(s, q.team) === 'bloco' && dist(center(q), ownGoal(q.team)) < COURT_W / 2;
}

function marked(s: GameState, p: Player, x: number, y: number): boolean {
  return s.players.some(
    // A troca de passes da Posse de bola desmonta a zona: contra ela, só segura quem está colado.
    (q) =>
      q.team !== p.team &&
      !q.unbalanced &&
      !outOfPosition(s, q) &&
      Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) <= (zoneMarker(s, q) && styleOf(s, p.team) !== 'posse' ? 2 : 1),
  );
}

function canStand(s: GameState, p: Player, x: number, y: number): boolean {
  if (!inside(x, y)) return false;
  const o = playerAt(s, x, y);
  if (o && o.id !== p.id) return false;
  if (p.role === 'goleiro' && p.trait !== 'goleiroPes' && !inArea(p.team, { x, y })) return false;
  return true;
}

/** Busca em largura das casas alcançáveis; devolve o mapa de origem de cada casa. */
function reach(s: GameState, p: Player, range: number): Map<string, { from: string | null; d: number }> {
  const seen = new Map<string, { from: string | null; d: number }>();
  const key = (x: number, y: number) => `${x},${y}`;
  seen.set(key(p.x, p.y), { from: null, d: 0 });
  const queue: Pos[] = [{ x: p.x, y: p.y }];
  const withBall = s.holder === p.id;
  while (queue.length) {
    const c = queue.shift()!;
    const cd = seen.get(key(c.x, c.y))!.d;
    if (cd >= range) continue;
    if (withBall && cd > 0 && marked(s, p, c.x, c.y)) continue;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (seen.has(key(nx, ny)) || !canStand(s, p, nx, ny)) continue;
      seen.set(key(nx, ny), { from: key(c.x, c.y), d: cd + 1 });
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

export function destinations(s: GameState): Pos[] {
  const a = s.activation;
  if (!a || a.moved || a.acted) return [];
  const p = getPlayer(s, a.playerId);
  const out: Pos[] = [];
  for (const k of reach(s, p, activationRange(s, a, p)).keys()) {
    const [x, y] = k.split(',').map(Number);
    if (x !== p.x || y !== p.y) out.push({ x, y });
  }
  return out;
}

/** Alcance do movimento desta ativação (a escora não anda; a tabela anda 2). */
function activationRange(s: GameState, a: Activation, p: Player): number {
  if (a.mode === 'escora') return 0;
  if (a.mode === 'tabela') return 2;
  return moveRange(s, p, a.sprinted) + (a.energized ? DRINK_MOVE : 0);
}

/** Arrancada: o Ala velocista paga menos e corre mais. */
export function sprintCost(p: Player): number {
  return p.trait === 'alaVelocista' ? 2 : SPRINT_COST;
}
export function sprintBonus(p: Player): number {
  return p.trait === 'alaVelocista' ? 3 : SPRINT_BONUS;
}

export function canSprint(s: GameState): boolean {
  const a = s.activation;
  if (!a || a.moved || a.acted || a.sprinted || a.mode !== 'normal') return false;
  const p = getPlayer(s, a.playerId);
  return p.fol >= sprintCost(p);
}

export function sprint(s: GameState): void {
  if (!canSprint(s)) throw new Error('Não dá para arrancar agora');
  const a = s.activation!;
  a.sprinted = true;
  const p = getPlayer(s, a.playerId);
  p.fol -= sprintCost(p);
}

export function moveTo(s: GameState, x: number, y: number): void {
  const a = s.activation;
  if (!a || a.moved || a.acted) throw new Error('Não dá para andar agora');
  const p = getPlayer(s, a.playerId);
  const r = reach(s, p, activationRange(s, a, p));
  if (!r.has(`${x},${y}`) || (x === p.x && y === p.y)) throw new Error('Casa fora do alcance');
  const path: Pos[] = [];
  let k: string | null = `${x},${y}`;
  while (k) {
    const [px, py] = k.split(',').map(Number);
    path.unshift({ x: px, y: py });
    k = r.get(k)!.from;
  }
  const last = path.at(-2) ?? path[0];
  p.x = x;
  p.y = y;
  p.facing = dirFromTo(last, { x, y });
  a.moved = true;
  // Passou por uma garrafa (e ainda não tem uma): pega no caminho. O movimento é dividido para a tela.
  const at = p.energetico ? -1 : path.findIndex((c, i) => i > 0 && s.drinks.some((d) => same(d, c)));
  if (at > 0) {
    const d = s.drinks.find((q) => same(q, path[at]))!;
    s.events.push({ kind: 'move', id: p.id, path: path.slice(0, at + 1), withBall: s.holder === p.id, sprint: a.sprinted });
    collectDrink(s, p, d);
    a.picked = d;
    if (at < path.length - 1) s.events.push({ kind: 'move', id: p.id, path: path.slice(at), withBall: s.holder === p.id, sprint: a.sprinted });
  } else s.events.push({ kind: 'move', id: p.id, path, withBall: s.holder === p.id, sprint: a.sprinted });
  checkReaction(s, p);
}

/** Defensores de prontidão colados em quem tem a bola (o de melhor marcação primeiro). */
export function reactors(s: GameState, holder: Player): Player[] {
  return s.players
    .filter((q) => q.team !== holder.team && q.ready && !q.unbalanced && chebyshev(q, holder) === 1)
    .sort((a, b) => statsOf(b).mar - statsOf(a).mar);
}

/** Quem tem a bola parou colado num defensor de prontidão: bote automático. */
function checkReaction(s: GameState, p: Player): void {
  if (s.holder !== p.id || s.pendingReaction) return;
  const r = reactors(s, p)[0];
  if (r) s.pendingReaction = r.id;
}

/** Começa o bote automático pendente (Duelo em que o defensor de prontidão é quem ataca a bola). */
export function startReaction(s: GameState): DuelState {
  const id = s.pendingReaction;
  if (!id) throw new Error('Nenhum bote pendente');
  s.pendingReaction = null;
  const d = getPlayer(s, id);
  const h = holderOf(s);
  if (s.activation) s.activation.reacted = true;
  d.facing = dirFromTo(d, h);
  s.events.push({ kind: 'emote', id: d.id, emote: '!' });
  s.log.push(`${d.name} estava de prontidão e dá o bote em ${h.name}!`);
  return startDuel(s, 'bote', d.id, h.id);
}

export function undoMove(s: GameState): void {
  const a = s.activation;
  if (!a || !a.moved || a.acted || a.reacted) throw new Error('Nada para desfazer');
  s.pendingReaction = null;
  const p = getPlayer(s, a.playerId);
  const from = { x: p.x, y: p.y };
  p.x = a.startX;
  p.y = a.startY;
  a.moved = false;
  if (a.picked) {
    // A garrafa volta para onde estava.
    p.energetico = false;
    s.drinks.push(a.picked);
    s.events.push({ kind: 'garrafa', acao: 'volta', drink: a.picked });
    a.picked = null;
  }
  if (a.sprinted) {
    a.sprinted = false;
    p.fol += sprintCost(p);
  }
  s.events.push({ kind: 'move', id: p.id, path: [from, { x: p.x, y: p.y }], withBall: s.holder === p.id, sprint: false });
}

// ---------- Ações ----------

export interface PassPreview {
  ok: boolean;
  result: 'ok' | 'cortado' | 'dividida';
  /** Quem corta o passe ou disputa a bola. */
  otherId?: string;
  dist: number;
}

/** Prévia do passe de `from` para `to`. Sem sorte: a zona de corte sempre corta. */
export function passPreview(s: GameState, from: Player, to: Player, alto: boolean): PassPreview {
  const pas = statsOf(from).pas + (alto ? ALTO_BONUS + (from.trait === 'fixoArmador' ? 1 : 0) : 0);
  const d = dist(center(from), center(to));
  if (to.team !== from.team || to.id === from.id || d > pas + 0.01) return { ok: false, result: 'ok', dist: d };
  const opp = s.players.filter((q) => q.team !== from.team && !q.unbalanced && !outOfPosition(s, q));
  const dom = statsOf(to).dom;
  if (!alto) {
    // Posse de bola: no toque curto, só corta quem estiver em cima da linha.
    const short = styleOf(s, from.team) === 'posse' && d <= POSSE_SHORT + 0.01;
    for (const c of passLine(from, to)) {
      if (short) {
        const on = opp.find((q) => q.x === c.x && q.y === c.y && chebyshev(q, to) > 1);
        if (on) return { ok: true, result: 'cortado', otherId: on.id, dist: d };
        continue;
      }
      // Quem está de prontidão antecipa e corta a até 2 casas da linha; os outros, a 1.
      // Colado em quem passa, só corta se estiver em cima da linha (a tabela sai da pressão).
      const cutter = opp.find((q) => chebyshev(q, c) <= cutRange(s, q) && chebyshev(q, to) > 1 && (chebyshev(q, from) > 1 || (q.x === c.x && q.y === c.y)));
      if (cutter) return { ok: true, result: 'cortado', otherId: cutter.id, dist: d };
    }
    const contest = opp.filter((q) => chebyshev(q, to) === 1 && statsOf(q).mar > dom).sort((a, b) => statsOf(b).mar - statsOf(a).mar)[0];
    if (contest) return { ok: true, result: 'dividida', otherId: contest.id, dist: d };
    return { ok: true, result: 'ok', dist: d };
  }
  // Passe alto: qualquer adversário a até 2 casas disputa a recepção (menos no primeiro do Contra-ataque).
  if (counterAltoFree(s, from)) return { ok: true, result: 'ok', dist: d };
  const reach2 = from.trait === 'alaDriblador' ? 3 : 2;
  const contest = opp.filter((q) => chebyshev(q, to) <= reach2).sort((a, b) => chebyshev(a, to) - chebyshev(b, to) || statsOf(b).mar - statsOf(a).mar)[0];
  if (contest) return { ok: true, result: 'dividida', otherId: contest.id, dist: d };
  return { ok: true, result: 'ok', dist: d };
}

export interface ShotPreview {
  ok: boolean;
  dist: number;
  force: number;
  ref: number;
  /** Defensor parado na linha do chute (bloqueia). */
  blockerId?: string;
  keeperId?: string;
  /** Gol vazio: o goleiro está fora da área. */
  open: boolean;
  /** Quem vê a escolha do outro antes (só no tiro livre direto, que ainda é no palpite). */
  shooterReads: boolean;
  keeperReads: boolean;
  /** Reflexo efetivo, com a posição do goleiro: bem colocado +1, deslocado −1 ou −2. */
  refEff: number;
  /** Posição do goleiro em relação à linha do chute. */
  cover: 'fechado' | 'normal' | 'deslocado' | 'fora';
  /** Ângulo fechado (chute de lado, quase sem gol para mirar): −1 de força. */
  wide: boolean;
  /** Chance de gol (0 a 1), já com bloqueio, gol vazio, posição e ângulo. */
  chance: number;
}

/** Distância de um ponto ao segmento a–b. */
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const L = vx * vx + vy * vy || 1;
  const k = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L));
  return Math.hypot(p.x - (a.x + k * vx), p.y - (a.y + k * vy));
}

/** Chance de gol pela força contra o reflexo efetivo: 40% no empate, ±10% por ponto. */
export function shotChance(force: number, refEff: number): number {
  return Math.max(0.05, Math.min(0.9, 0.4 + 0.1 * (force - refEff)));
}

export function shotPreview(s: GameState, p: Player, bomba = false, direto = false): ShotPreview {
  const def = statsOf(p);
  const d = distToGoal(p, p.team);
  const range = CHUTE_BASE + def.fin + 0.5;
  // Perto do gol o chute ganha força (+2 até 2 casas, +1 a 3); depois de 4 casas, perde 1 por casa.
  const g = attackGoal(p.team);
  const c = center(p);
  const wide = !direto && Math.abs(g.y - c.y) > Math.abs(g.x - c.x) + 0.5;
  // Distância: +2 até 2 casas, +1 a 3, 0 até 5, −1 até 7, −2 mais longe.
  const near = d <= 2.5 ? 2 : d <= 3.5 ? 1 : d <= 5.5 ? 0 : d <= 7.5 ? -1 : -2;
  // Posse de bola: o time não treina o chute de fora.
  const longPosse = !direto && d > 5.5 && styleOf(s, p.team) === 'posse' ? 1 : 0;
  // ...mas trabalhar a bola abre a defesa: +1 de força por fase seguida com a bola e por toque curto na fase (até +3).
  const worked =
    !direto && styleOf(s, p.team) === 'posse' && p.team === s.activeTeam ? Math.min(POSSE_MAX_BONUS, Math.max(0, s.possStreak[p.team] - 1) + s.passChain) : 0;
  const force = def.fin + (bomba ? 2 : 0) + near - (wide ? 1 : 0) - longPosse + worked;
  const keeper = keeperOf(s, other(p.team));
  // Goleiro paredão: reflexo de perto, sofre com o chute de longe.
  const wallMod = keeper?.trait === 'goleiroParedao' && !direto ? (d <= 3 ? 1 : d > 5 ? -1 : 0) : 0;
  const ref = keeper ? statsOf(keeper).ref + (keeper.muralha ? 2 : 0) + wallMod : 0;
  let blockerId: string | undefined;
  if (!direto) {
    // Só bloqueia quem fecha o chute de perto (até 3 casas de quem chuta), em cima da linha.
    for (const c of shotLine(p, p.team)) {
      const b = playerAt(s, c.x, c.y);
      if (b && b.team !== p.team && b.role !== 'goleiro' && !b.unbalanced && chebyshev(b, p) <= 3) {
        blockerId = b.id;
        break;
      }
    }
  }
  const open = !keeper || !inArea(keeper.team, keeper);
  // Goleiro em cima da linha do chute fecha o ângulo; longe dela, deixa o gol aberto.
  let cover: ShotPreview['cover'] = 'fora';
  let refEff = ref;
  if (keeper && !open) {
    const kd = direto ? 0 : segDist(center(keeper), c, g);
    cover = kd <= 0.8 ? 'fechado' : kd >= 1.5 ? 'deslocado' : 'normal';
    refEff = ref + (cover === 'deslocado' ? (kd >= 2.2 ? -2 : -1) : 0);
  }
  // Defensor na linha do chute: a chance cai a 40% do normal (e, se não entrar, metade das vezes ele bloqueia).
  const chance = (open ? 0.95 : shotChance(force, refEff)) * (blockerId ? 0.4 : 1);
  return {
    ok: d <= range || direto,
    dist: d,
    force,
    ref,
    blockerId,
    keeperId: keeper?.id,
    open,
    shooterReads: force - ref >= 3,
    keeperReads: ref - force >= 3,
    refEff,
    cover,
    wide,
    chance,
  };
}

/** Resultado do chute para um canto e um mergulho. */
export function shotResult(pv: ShotPreview, corner: Corner, dive: Corner | null): 'gol' | 'defesa' | 'bloqueio' {
  if (pv.blockerId) return 'bloqueio';
  if (pv.open || !dive) return 'gol';
  // Goleiro no canto certo pega até força REF + 2; no canto vizinho, só chute fraco (força ≤ REF − 1).
  if (corner === dive) return pv.ref + 2 >= pv.force ? 'defesa' : 'gol';
  const adjacent = corner === 'meio' || dive === 'meio';
  if (adjacent) return pv.ref >= pv.force + 1 ? 'defesa' : 'gol';
  return 'gol';
}

export type Target =
  | { kind: 'passe'; toId: string; alto: boolean; preview: PassPreview }
  | { kind: 'chute'; preview: ShotPreview; bomba: boolean }
  | { kind: 'drible'; targetId: string }
  | { kind: 'desarme'; targetId: string }
  | { kind: 'carrinho'; targetId: string };

export function canAct(s: GameState): boolean {
  const a = s.activation;
  return !!a && (!a.acted || a.bonus);
}

/** Ações possíveis do jogador em ação, da casa onde está. */
export function currentTargets(s: GameState): Target[] {
  const a = s.activation;
  if (!a || !canAct(s)) return [];
  const p = getPlayer(s, a.playerId);
  const out: Target[] = [];
  const h = holderOf(s);
  if (h.id === p.id) {
    for (const q of teamPlayers(s, p.team)) {
      if (q.id === p.id) continue;
      for (const alto of [false, true]) {
        if (alto && a.mode === 'escora') continue;
        const pv = passPreview(s, p, q, alto);
        if (pv.ok) out.push({ kind: 'passe', toId: q.id, alto, preview: pv });
      }
    }
    if (a.mode === 'escora') return out;
    // Quem recebeu passe alto nesta fase ainda está dominando: não chuta nem dribla.
    const sp = shotPreview(s, p);
    if (sp.ok && !p.altoRecebido) out.push({ kind: 'chute', preview: sp, bomba: false });
    if (p.role === 'pivo' && hasSpecial(p) && !p.altoRecebido) {
      const bp = shotPreview(s, p, true);
      if (bp.ok) out.push({ kind: 'chute', preview: bp, bomba: true });
    }
    if (!a.bonus && !p.altoRecebido && a.mode === 'normal') {
      for (const q of s.players) if (q.team !== p.team && chebyshev(q, p) === 1) out.push({ kind: 'drible', targetId: q.id });
    }
  } else if (h.team !== p.team && !a.bonus && s.tacklesUsed < tacklesMax(s)) {
    if (chebyshev(h, p) === 1) out.push({ kind: 'desarme', targetId: h.id });
    else if (p.role === 'fixo' && hasSpecial(p) && chebyshev(h, p) === 2) out.push({ kind: 'carrinho', targetId: h.id });
  }
  return out;
}

function requireAction(s: GameState): Activation {
  const a = s.activation;
  if (!a || !canAct(s)) throw new Error('Este jogador não pode agir agora');
  return a;
}

export interface PassOutcome {
  result: 'ok' | 'cortado' | 'dividida';
  duel?: DuelState;
}

export function pass(s: GameState, toId: string, alto: boolean): PassOutcome {
  const a = requireAction(s);
  const p = getPlayer(s, a.playerId);
  if (s.holder !== p.id) throw new Error('Sem a bola');
  const to = getPlayer(s, toId);
  if (alto && a.mode === 'escora') throw new Error('A escora é de primeira, rasteira');
  const pv = passPreview(s, p, to, alto);
  if (!pv.ok) throw new Error('Passe fora do alcance');
  a.acted = true;
  a.bonus = false;
  if (alto) {
    if (counterAltoFree(s, p)) s.counterAltoUsed = true;
    else if (p.trait !== 'fixoArmador') p.fol = Math.max(0, p.fol - (styleOf(s, p.team) === 'posse' ? 2 : ALTO_COST));
  }
  if (pv.result === 'cortado') {
    const cutter = getPlayer(s, pv.otherId!);
    cutter.ready = false;
    s.holder = cutter.id;
    s.events.push({ kind: 'passe', fromId: p.id, toId: cutter.id, from: { x: p.x, y: p.y }, to: { x: cutter.x, y: cutter.y }, alto, result: 'cortado' });
    s.events.push({ kind: 'emote', id: cutter.id, emote: '!' });
    s.log.push(`${cutter.name} corta o passe de ${p.name}.`);
    return { result: 'cortado' };
  }
  s.holder = to.id;
  if (alto) to.altoRecebido = true;
  if (!alto && pv.result === 'ok') {
    // Pivô de costas: devolveu para quem passou para ele = tabela.
    if (p.trait === 'pivoCostas' && p.lastPasser === to.id && !s.tabelaUsed && to.activated) {
      s.tabelaUsed = true;
      to.tabela = true;
      s.events.push({ kind: 'emote', id: to.id, emote: '!' });
      s.log.push(`Tabela! ${to.name} recebe de volta e joga de novo.`);
    }
    if (to.trait === 'pivoCostas' && to.activated && !s.escoraUsed) to.escoraPronta = true;
    to.lastPasser = p.id;
  }
  if (!alto && pv.result === 'ok' && styleOf(s, p.team) === 'posse' && pv.dist <= POSSE_SHORT + 0.01) {
    to.toqueCurto = true;
    s.passChain++;
  }
  s.events.push({ kind: 'passe', fromId: p.id, toId: to.id, from: { x: p.x, y: p.y }, to: { x: to.x, y: to.y }, alto, result: pv.result });
  p.facing = dirFromTo(p, to);
  if (pv.result === 'dividida') {
    s.log.push(`Bola dividida entre ${to.name} e ${getPlayer(s, pv.otherId!).name}.`);
    return { result: 'dividida', duel: startDuel(s, 'dividida', pv.otherId!, to.id) };
  }
  s.log.push(`${p.name} passa para ${to.name}.`);
  return { result: 'ok' };
}

export type ShotOutcome = 'gol' | 'defesa' | 'bloqueio' | 'rebote';

/** Chute de bola rolando: sem palpite. A chance vem da força, do reflexo, da posição do goleiro e do ângulo. */
export function shoot(s: GameState, bomba = false): ShotOutcome {
  const a = requireAction(s);
  if (a.mode === 'escora') throw new Error('Na escora, só o passe de primeira');
  const p = getPlayer(s, a.playerId);
  if (s.holder !== p.id) throw new Error('Sem a bola');
  if (bomba) {
    if (p.role !== 'pivo' || p.specialUsed) throw new Error('Sem Bomba');
    p.specialUsed = true;
  }
  const pv = shotPreview(s, p, bomba);
  if (!pv.ok) throw new Error('Longe demais para chutar');
  a.acted = true;
  a.bonus = false;
  const CORN: Corner[] = ['esq', 'meio', 'dir'];
  const corner = CORN[Math.floor(nextRandom(s) * 3)];
  let result: ShotOutcome = nextRandom(s) < pv.chance ? 'gol' : pv.blockerId && (pv.open || nextRandom(s) < 0.5) ? 'bloqueio' : pv.open ? 'gol' : 'defesa';
  // Mergulho só para a animação: no canto certo quando defende, no errado quando é gol.
  const others = CORN.filter((k) => k !== corner);
  const dive = pv.open ? null : result === 'gol' ? others[Math.floor(nextRandom(s) * 2)] : corner;
  let reboundId: string | undefined;
  const wall = pv.keeperId ? getPlayer(s, pv.keeperId).trait === 'goleiroParedao' : false;
  if (result === 'defesa' && !wall && pv.force >= pv.refEff - 1 && nextRandom(s) < REBOUND_CHANCE) {
    // Chute forte espalmado: a bola sobra para quem estiver mais perto da marca do pênalti.
    const g = attackGoal(p.team);
    const spot = { x: g.x + (p.team === 'azul' ? -2 : 2), y: g.y };
    const near = s.players.filter((q) => q.role !== 'goleiro').sort((a2, b2) => dist(center(a2), spot) - dist(center(b2), spot))[0];
    if (near) {
      result = 'rebote';
      reboundId = near.id;
    }
  }
  return resolveShot(s, p, pv, result, corner, dive, reboundId);
}

function resolveShot(s: GameState, p: Player, pv: ShotPreview, result: ShotOutcome, corner: Corner, dive: Corner | null, reboundId?: string): ShotOutcome {
  s.events.push({
    kind: 'chute',
    shooterId: p.id,
    from: { x: p.x, y: p.y },
    corner,
    dive: pv.open ? null : dive,
    keeperId: pv.keeperId ?? null,
    result,
    blockerId: pv.blockerId,
    reboundId,
    team: p.team,
  });
  if (result === 'bloqueio') {
    s.holder = pv.blockerId!;
    s.log.push(`${getPlayer(s, pv.blockerId!).name} bloqueia o chute de ${p.name}.`);
  } else if (result === 'defesa') {
    s.holder = pv.keeperId!;
    s.events.push({ kind: 'emote', id: pv.keeperId!, emote: 'estrela' });
    s.log.push(`${getPlayer(s, pv.keeperId!).name} defende o chute de ${p.name}!`);
  } else if (result === 'rebote') {
    const r = getPlayer(s, reboundId!);
    s.holder = r.id;
    s.events.push({ kind: 'emote', id: r.id, emote: r.team === p.team ? 'estrela' : '!' });
    s.log.push(`${getPlayer(s, pv.keeperId!).name} espalma o chute de ${p.name} e a bola sobra para ${r.name}!`);
  } else {
    goal(s, p);
  }
  return result;
}

function goal(s: GameState, scorer: Player): void {
  s.score[scorer.team]++;
  scorer.goals++;
  s.events.push({ kind: 'gol', team: scorer.team, scorerId: scorer.id });
  s.events.push({ kind: 'emote', id: scorer.id, emote: 'coracao' });
  s.log.push(`GOL! ${scorer.name} marca para o ${TEAM_NAME[scorer.team]}. ${s.score.azul} × ${s.score.vermelho}.`);
  // Fim da fase de quem marcou; quem sofreu dá a saída.
  s.activation = null;
  for (const q of teamPlayers(s, s.activeTeam)) q.activated = true;
  // Quem sofreu o gol fica com a bola no centro, e a fase atual termina.
  placeForKickoff(s, other(scorer.team));
  endPhase(s);
}

export function startDribble(s: GameState, targetId: string): DuelState {
  const a = requireAction(s);
  const p = getPlayer(s, a.playerId);
  if (s.holder !== p.id || a.bonus) throw new Error('Não dá para driblar agora');
  const t = getPlayer(s, targetId);
  if (t.team === p.team || chebyshev(t, p) !== 1) throw new Error('Precisa estar colado no marcador');
  a.acted = true;
  s.log.push(`${p.name} parte para cima de ${t.name}.`);
  return startDuel(s, 'drible', p.id, t.id);
}

export function startTackle(s: GameState, targetId: string, carrinho = false): DuelState {
  const a = requireAction(s);
  const p = getPlayer(s, a.playerId);
  if (targetId !== s.holder) throw new Error('Só se desarma quem está com a bola');
  const t = getPlayer(s, targetId);
  const d = chebyshev(t, p);
  if (carrinho) {
    if (p.role !== 'fixo' || p.specialUsed || d !== 2) throw new Error('Carrinho indisponível');
    p.specialUsed = true;
    // Desliza até ficar colado.
    const step = { x: p.x + Math.sign(t.x - p.x), y: p.y + Math.sign(t.y - p.y) };
    if (canStand(s, p, step.x, step.y) && chebyshev(step, t) === 1) {
      s.events.push({ kind: 'move', id: p.id, path: [{ x: p.x, y: p.y }, step], withBall: false, sprint: true });
      p.x = step.x;
      p.y = step.y;
    }
  } else if (d !== 1) throw new Error('Precisa estar colado em quem tem a bola');
  if (s.tacklesUsed >= tacklesMax(s)) throw new Error('O time já tentou o desarme desta fase');
  s.tacklesUsed++;
  a.acted = true;
  p.facing = dirFromTo(p, t);
  s.log.push(`${p.name} ${carrinho ? 'dá um carrinho em' : 'tenta desarmar'} ${t.name}.`);
  return startDuel(s, carrinho ? 'carrinho' : 'desarme', p.id, t.id);
}

/** Aplica o resultado de um Duelo terminado. */
export function applyDuel(s: GameState, cs: DuelState): ReturnType<typeof duelOutcome> {
  const out = duelOutcome(cs);
  const ballP = getPlayer(s, cs[cs.ball].playerId);
  const markP = getPlayer(s, cs[otherSide(cs.ball)].playerId);
  ballP.pedalada = false;
  markP.pedalada = false;
  const a = s.activation;
  const holderActing = !!a && a.playerId === ballP.id;
  if (out === 'falta') {
    const team = markP.team;
    s.fouls[team] += markP.trait === 'fixoXerife' ? 2 : 1;
    const direto = s.fouls[team] >= FOUL_LIMIT;
    s.events.push({ kind: 'falta', at: { x: ballP.x, y: ballP.y }, byId: markP.id, onId: ballP.id, count: s.fouls[team], direto });
    s.events.push({ kind: 'emote', id: markP.id, emote: 'raiva' });
    s.log.push(`Falta de ${markP.name} (${s.fouls[team]}ª do ${TEAM_NAME[team]} no tempo).`);
    s.holder = ballP.id;
    markP.unbalanced = true;
    s.events.push({ kind: 'duelo', holderId: ballP.id, otherId: markP.id, result: 'falta' });
    if (direto) {
      s.pendingDirect = ballP.id;
    } else {
      pushAway(s, ballP);
      if (holderActing) a!.bonus = true;
    }
    return out;
  }
  if (out === 'roubou') {
    s.holder = markP.id;
    if (holderActing) {
      a!.acted = true;
      a!.bonus = false;
    }
    s.events.push({ kind: 'duelo', holderId: ballP.id, otherId: markP.id, result: 'roubou' });
    s.events.push({ kind: 'emote', id: markP.id, emote: '!' });
    s.events.push({ kind: 'emote', id: ballP.id, emote: 'suor' });
    s.log.push(`${markP.name} rouba a bola de ${ballP.name}.`);
    return out;
  }
  if (out === 'passou') {
    const to = { x: markP.x + Math.sign(markP.x - ballP.x), y: markP.y + Math.sign(markP.y - ballP.y) };
    const free = canStand(s, ballP, to.x, to.y);
    const from = { x: ballP.x, y: ballP.y };
    if (free) {
      ballP.x = to.x;
      ballP.y = to.y;
      ballP.facing = dirFromTo(from, to);
    }
    markP.unbalanced = true;
    s.events.push({ kind: 'duelo', holderId: ballP.id, otherId: markP.id, result: 'passou', to: free ? to : undefined });
    const d = free && !ballP.energetico ? s.drinks.find((q) => same(q, to)) : undefined;
    if (d) collectDrink(s, ballP, d);
    s.events.push({ kind: 'emote', id: ballP.id, emote: 'musica' });
    s.log.push(`${ballP.name} passa por ${markP.name}!`);
    if (holderActing) a!.bonus = true;
    return out;
  }
  // Manteve a bola.
  if (cs[cs.ball].vantage > cs[otherSide(cs.ball)].vantage) markP.unbalanced = true;
  s.events.push({ kind: 'duelo', holderId: ballP.id, otherId: markP.id, result: 'manteve' });
  s.log.push(`${ballP.name} protege a bola de ${markP.name}.`);
  return out;
}

/** Tiro livre: quem está colado no cobrador é afastado. */
function pushAway(s: GameState, p: Player): void {
  for (const q of s.players) {
    if (q.team === p.team || chebyshev(q, p) > 1) continue;
    const to = { x: q.x + Math.sign(q.x - p.x || (q.team === 'azul' ? -1 : 1)), y: q.y + Math.sign(q.y - p.y) };
    if (canStand(s, q, to.x, to.y)) {
      s.events.push({ kind: 'move', id: q.id, path: [{ x: q.x, y: q.y }, to], withBall: false, sprint: false });
      q.x = to.x;
      q.y = to.y;
    }
  }
}

/** Tiro livre direto do 10 m (a partir da 6ª falta): sem barreira, contra o goleiro. */
export function directKickPreview(s: GameState): { shooter: Player; preview: ShotPreview } | null {
  if (!s.pendingDirect) return null;
  const p = getPlayer(s, s.pendingDirect);
  return { shooter: p, preview: shotPreview(s, p, false, true) };
}

export function takeDirectKick(s: GameState, corner: Corner, dive: Corner | null): ShotOutcome {
  if (!s.pendingDirect) throw new Error('Sem tiro livre direto');
  const p = getPlayer(s, s.pendingDirect);
  s.pendingDirect = null;
  // Coloca o cobrador no 2º ponto penal.
  const g = attackGoal(p.team);
  const spot = { x: p.team === 'azul' ? COURT_W - TEN_METER : TEN_METER - 1, y: Math.floor(g.y) };
  const occ = playerAt(s, spot.x, spot.y);
  if (occ && occ.id !== p.id) {
    occ.x = p.x;
    occ.y = p.y;
  }
  s.events.push({ kind: 'move', id: p.id, path: [{ x: p.x, y: p.y }, spot], withBall: true, sprint: false });
  p.x = spot.x;
  p.y = spot.y;
  p.facing = p.team === 'azul' ? 'E' : 'W';
  const pv = shotPreview(s, p, false, true);
  const r = resolveShot(s, p, pv, shotResult(pv, corner, pv.open ? null : dive), corner, dive);
  if (s.activation && s.activation.playerId === p.id) s.activation.bonus = false;
  return r;
}

// ---------- Especiais ----------

export function canUseSpecial(s: GameState): 'muralha' | 'pedalada' | null {
  const p = current(s);
  if (!p || !hasSpecial(p) || !canAct(s) || s.activation!.bonus || s.activation!.mode !== 'normal') return null;
  if (p.role === 'goleiro') return 'muralha';
  if (p.role === 'ala' && !p.pedalada) return 'pedalada';
  return null;
}

export function useSpecial(s: GameState): void {
  const kind = canUseSpecial(s);
  const p = current(s);
  if (!kind || !p) throw new Error('Especial indisponível');
  p.specialUsed = true;
  if (kind === 'muralha') {
    p.muralha = true;
    s.activation!.acted = true;
    s.events.push({ kind: 'emote', id: p.id, emote: 'estrela' });
    s.log.push(`${p.name} usa Muralha: reflexo +2.`);
  } else {
    p.pedalada = true;
    s.events.push({ kind: 'emote', id: p.id, emote: 'musica' });
    s.log.push(`${p.name} prepara a Pedalada.`);
  }
}

export function drainEvents(s: GameState) {
  const ev = s.events;
  s.events = [];
  return ev;
}
