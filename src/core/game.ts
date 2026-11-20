// Regras da partida de futsal: posse, movimento, passe, chute, duelos, faltas e tempos.

import {
  CHUTE_BASE,
  COURT_H,
  COURT_W,
  FOL_REGEN,
  FOUL_LIMIT,
  HAB_REGEN,
  ROLES,
  ROSTERS,
  ROUNDS_PER_HALF,
  SPRINT_BONUS,
  SPRINT_COST,
  TEAM_NAME,
  TEN_METER,
} from './data';
import {
  attackGoal,
  center,
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
import type { DuelState } from './duelo';
import type { Activation, Corner, GameState, Player, Pos, Team } from './types';

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
  const piv = teamPlayers(s, kicking).find((p) => p.role === 'pivo')!;
  s.holder = piv.id;
  s.events.push({ kind: 'reset', positions, holderId: piv.id });
  s.log.push(`Saída de bola do ${TEAM_NAME[kicking]}.`);
}

// ---------- Fases ----------

function startPhase(s: GameState, team: Team): void {
  s.activeTeam = team;
  s.phase++;
  for (const p of teamPlayers(s, team)) {
    const def = ROLES[p.role];
    p.activated = false;
    p.unbalanced = false;
    p.muralha = false;
    p.fol = Math.min(def.fol, p.fol + FOL_REGEN);
    p.hab = Math.min(def.hab, p.hab + HAB_REGEN);
  }
  const h = holderOf(s);
  s.keeperMustPass = h.team === team && h.role === 'goleiro' ? h.id : null;
}

/** Fases jogadas neste tempo (2 por rodada). */
function halfPhases(s: GameState): number {
  return (s.round - 1) * 2 + (s.activeTeam === (s.half === 1 ? s.firstKick : other(s.firstKick)) ? 0 : 1);
}

export function endPhase(s: GameState): void {
  if (s.over) return;
  if (s.activation) finishActivation(s);
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
        p.fol = ROLES[p.role].fol;
        p.hab = ROLES[p.role].hab;
      }
      s.events.push({ kind: 'apito', text: 'Intervalo', long: true });
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
  return teamPlayers(s, s.activeTeam).filter((p) => !p.activated);
}

export function beginActivation(s: GameState, id: string): void {
  const p = getPlayer(s, id);
  if (p.team !== s.activeTeam || p.activated) throw new Error('Este jogador não pode agir agora');
  if (s.activation) {
    if (s.activation.moved || s.activation.acted) endActivation(s);
    else s.activation = null;
  }
  s.activation = { playerId: id, startX: p.x, startY: p.y, moved: false, acted: false, sprinted: false, bonus: false };
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
  if (s.keeperMustPass === p.id && s.holder === p.id) {
    // Regra dos 4 segundos: o goleiro segurou demais; a bola vai para o adversário.
    const opp = teamPlayers(s, other(p.team)).filter((q) => q.role !== 'goleiro');
    const taker = opp.reduce((b, q) => (dist(q, p) < dist(b, p) ? q : b));
    s.holder = taker.id;
    s.events.push({ kind: 'apito', text: '4 segundos! Bola do adversário' });
    s.log.push(`${p.name} segurou a bola demais: tiro livre para o ${TEAM_NAME[taker.team]}.`);
  }
  if (s.keeperMustPass === p.id) s.keeperMustPass = null;
  s.activation = null;
}

export function endActivation(s: GameState): void {
  if (!s.activation) throw new Error('Nenhum jogador em ação');
  finishActivation(s);
  if (!s.over && activatable(s).length === 0) endPhase(s);
}

// ---------- Movimento ----------

/** Casas que o jogador anda nesta fase. */
export function moveRange(s: GameState, p: Player, sprinting = false): number {
  const def = ROLES[p.role];
  let m = def.mov;
  if (s.holder === p.id) m -= def.dom >= 4 ? 0 : def.dom >= 2 ? 1 : 2;
  if (sprinting) m += SPRINT_BONUS;
  return Math.max(1, m);
}

/** O jogador com a bola para ao entrar ao lado de um marcador (só sai driblando). */
function marked(s: GameState, p: Player, x: number, y: number): boolean {
  return s.players.some((q) => q.team !== p.team && !q.unbalanced && Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) === 1);
}

function canStand(s: GameState, p: Player, x: number, y: number): boolean {
  if (!inside(x, y)) return false;
  const o = playerAt(s, x, y);
  if (o && o.id !== p.id) return false;
  if (p.role === 'goleiro' && !inArea(p.team, { x, y })) return false;
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
  for (const k of reach(s, p, moveRange(s, p, a.sprinted)).keys()) {
    const [x, y] = k.split(',').map(Number);
    if (x !== p.x || y !== p.y) out.push({ x, y });
  }
  return out;
}

export function canSprint(s: GameState): boolean {
  const a = s.activation;
  if (!a || a.moved || a.acted || a.sprinted) return false;
  return getPlayer(s, a.playerId).fol >= SPRINT_COST;
}

export function sprint(s: GameState): void {
  if (!canSprint(s)) throw new Error('Não dá para arrancar agora');
  const a = s.activation!;
  a.sprinted = true;
  getPlayer(s, a.playerId).fol -= SPRINT_COST;
}

export function moveTo(s: GameState, x: number, y: number): void {
  const a = s.activation;
  if (!a || a.moved || a.acted) throw new Error('Não dá para andar agora');
  const p = getPlayer(s, a.playerId);
  const r = reach(s, p, moveRange(s, p, a.sprinted));
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
  s.events.push({ kind: 'move', id: p.id, path, withBall: s.holder === p.id, sprint: a.sprinted });
}

export function undoMove(s: GameState): void {
  const a = s.activation;
  if (!a || !a.moved || a.acted) throw new Error('Nada para desfazer');
  const p = getPlayer(s, a.playerId);
  const from = { x: p.x, y: p.y };
  p.x = a.startX;
  p.y = a.startY;
  a.moved = false;
  if (a.sprinted) {
    a.sprinted = false;
    p.fol += SPRINT_COST;
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
  const pas = ROLES[from.role].pas + (alto ? 2 : 0);
  const d = dist(center(from), center(to));
  if (to.team !== from.team || to.id === from.id || d > pas + 0.01) return { ok: false, result: 'ok', dist: d };
  const opp = s.players.filter((q) => q.team !== from.team && !q.unbalanced);
  const dom = ROLES[to.role].dom;
  if (!alto) {
    for (const c of passLine(from, to)) {
      const cutter = opp.find((q) => chebyshev(q, c) <= 1 && chebyshev(q, to) > 1);
      if (cutter) return { ok: true, result: 'cortado', otherId: cutter.id, dist: d };
    }
    const contest = opp.filter((q) => chebyshev(q, to) === 1 && ROLES[q.role].mar > dom).sort((a, b) => ROLES[b.role].mar - ROLES[a.role].mar)[0];
    if (contest) return { ok: true, result: 'dividida', otherId: contest.id, dist: d };
    return { ok: true, result: 'ok', dist: d };
  }
  const contest = opp
    .filter((q) => chebyshev(q, to) <= 2 && ROLES[q.role].mar >= dom)
    .sort((a, b) => chebyshev(a, to) - chebyshev(b, to) || ROLES[b.role].mar - ROLES[a.role].mar)[0];
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
  /** Quem vê a escolha do outro antes. */
  shooterReads: boolean;
  keeperReads: boolean;
}

export function shotPreview(s: GameState, p: Player, bomba = false, direto = false): ShotPreview {
  const def = ROLES[p.role];
  const d = distToGoal(p, p.team);
  const range = CHUTE_BASE + def.fin + 0.5;
  // Perto do gol o chute ganha força (+2 até 2 casas, +1 a 3); depois de 4 casas, perde 1 por casa.
  const force = def.fin + (bomba ? 2 : 0) + Math.min(2, CHUTE_BASE - Math.ceil(d - 0.5));
  const keeper = keeperOf(s, other(p.team));
  const ref = keeper ? ROLES.goleiro.ref + (keeper.muralha ? 2 : 0) : 0;
  let blockerId: string | undefined;
  if (!direto) {
    for (const c of shotLine(p, p.team)) {
      const b = playerAt(s, c.x, c.y);
      if (b && b.team !== p.team && b.role !== 'goleiro' && !b.unbalanced) {
        blockerId = b.id;
        break;
      }
    }
  }
  const open = !keeper || !inArea(keeper.team, keeper);
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
        const pv = passPreview(s, p, q, alto);
        if (pv.ok) out.push({ kind: 'passe', toId: q.id, alto, preview: pv });
      }
    }
    const sp = shotPreview(s, p);
    if (sp.ok) out.push({ kind: 'chute', preview: sp, bomba: false });
    if (p.role === 'pivo' && !p.specialUsed) {
      const bp = shotPreview(s, p, true);
      if (bp.ok) out.push({ kind: 'chute', preview: bp, bomba: true });
    }
    if (!a.bonus) {
      for (const q of s.players) if (q.team !== p.team && chebyshev(q, p) === 1) out.push({ kind: 'drible', targetId: q.id });
    }
  } else if (h.team !== p.team && !a.bonus) {
    if (chebyshev(h, p) === 1) out.push({ kind: 'desarme', targetId: h.id });
    else if (p.role === 'fixo' && !p.specialUsed && chebyshev(h, p) === 2) out.push({ kind: 'carrinho', targetId: h.id });
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
  const pv = passPreview(s, p, to, alto);
  if (!pv.ok) throw new Error('Passe fora do alcance');
  a.acted = true;
  a.bonus = false;
  if (pv.result === 'cortado') {
    const cutter = getPlayer(s, pv.otherId!);
    s.holder = cutter.id;
    s.events.push({ kind: 'passe', fromId: p.id, toId: cutter.id, from: { x: p.x, y: p.y }, to: { x: cutter.x, y: cutter.y }, alto, result: 'cortado' });
    s.events.push({ kind: 'emote', id: cutter.id, emote: '!' });
    s.log.push(`${cutter.name} corta o passe de ${p.name}.`);
    return { result: 'cortado' };
  }
  s.holder = to.id;
  s.events.push({ kind: 'passe', fromId: p.id, toId: to.id, from: { x: p.x, y: p.y }, to: { x: to.x, y: to.y }, alto, result: pv.result });
  p.facing = dirFromTo(p, to);
  if (pv.result === 'dividida') {
    s.log.push(`Bola dividida entre ${to.name} e ${getPlayer(s, pv.otherId!).name}.`);
    return { result: 'dividida', duel: startDuel(s, 'dividida', pv.otherId!, to.id) };
  }
  s.log.push(`${p.name} passa para ${to.name}.`);
  return { result: 'ok' };
}

export function shoot(s: GameState, corner: Corner, dive: Corner | null, bomba = false): 'gol' | 'defesa' | 'bloqueio' {
  const a = requireAction(s);
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
  return resolveShot(s, p, pv, corner, dive);
}

function resolveShot(s: GameState, p: Player, pv: ShotPreview, corner: Corner, dive: Corner | null): 'gol' | 'defesa' | 'bloqueio' {
  const result = shotResult(pv, corner, pv.open ? null : dive);
  s.events.push({
    kind: 'chute',
    shooterId: p.id,
    from: { x: p.x, y: p.y },
    corner,
    dive: pv.open ? null : dive,
    keeperId: pv.keeperId ?? null,
    result,
    blockerId: pv.blockerId,
    team: p.team,
  });
  if (result === 'bloqueio') {
    s.holder = pv.blockerId!;
    s.log.push(`${getPlayer(s, pv.blockerId!).name} bloqueia o chute de ${p.name}.`);
  } else if (result === 'defesa') {
    s.holder = pv.keeperId!;
    s.events.push({ kind: 'emote', id: pv.keeperId!, emote: 'estrela' });
    s.log.push(`${getPlayer(s, pv.keeperId!).name} defende o chute de ${p.name}!`);
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
    s.fouls[team]++;
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

export function takeDirectKick(s: GameState, corner: Corner, dive: Corner | null): 'gol' | 'defesa' | 'bloqueio' {
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
  const r = resolveShot(s, p, pv, corner, dive);
  if (s.activation && s.activation.playerId === p.id) s.activation.bonus = false;
  return r;
}

// ---------- Especiais ----------

export function canUseSpecial(s: GameState): 'muralha' | 'pedalada' | null {
  const p = current(s);
  if (!p || p.specialUsed || !canAct(s) || s.activation!.bonus) return null;
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
