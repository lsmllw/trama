// IA do futsal: avalia a posição para cada time e simula as jogadas de cada jogador.

import { CHUTE_BASE, COURT_W, ROLES } from './data';
import { center, dist, distToGoal, getPlayer, holderOf, inArea, keeperOf, other, ownGoal, teamPlayers } from './court';
import { LANCES, attrLances, canPlay, clash, markers, otherSide, resolveTempo } from './duelo';
import type { DuelState, Lance, SideKey } from './duelo';
import {
  activatable,
  applyDuel,
  beginActivation,
  canSprint,
  canUseDrink,
  canUseSpecial,
  createGame,
  currentTargets,
  destinations,
  endActivation,
  endPhase,
  moveTo,
  pass,
  passPreview,
  shoot,
  shotPreview,
  shotResult,
  sprint,
  useDrink,
  startDribble,
  startTackle,
  takeDirectKick,
  useSpecial,
} from './game';
import type { ShotPreview } from './game';
import { nextRandom } from './rng';
import type { Corner, GameState, Player, Pos, Team } from './types';

export type Difficulty = 'recruta' | 'veterano';
const CORNERS: Corner[] = ['esq', 'meio', 'dir'];

// ---------- Avaliação ----------

/** Chance de gol de um chute, com os dois lados escolhendo canto ao acaso. */
export function goalChance(pv: ShotPreview): number {
  if (!pv.ok) return 0;
  if (pv.blockerId) return 0.02;
  if (pv.open) return 0.95;
  let total = 0;
  for (const c of CORNERS) for (const d of CORNERS) if (shotResult(pv, c, d) === 'gol') total++;
  let p = total / 9;
  if (pv.shooterReads) p = Math.max(p, 0.85);
  if (pv.keeperReads) p = Math.min(p, 0.1);
  return p;
}

function shotQuality(s: GameState, p: Player): number {
  return goalChance(shotPreview(s, p));
}

/** Quão perigosa é a posse do time `team` neste momento (0 a ~60). */
function possessionValue(s: GameState, team: Team): number {
  const h = holderOf(s);
  let v = 0;
  v += 22 * (1 - Math.min(1, distToGoal(h, team) / COURT_W));
  v += 34 * shotQuality(s, h);
  v -= 7 * markers(s, h).length;
  let best = 0;
  let safe = 0;
  for (const q of teamPlayers(s, team)) {
    if (q.id === h.id) continue;
    for (const alto of [false, true]) {
      const pv = passPreview(s, h, q, alto);
      if (!pv.ok || pv.result !== 'ok') continue;
      safe++;
      best = Math.max(best, 20 * shotQuality(s, q) + 8 * (1 - Math.min(1, distToGoal(q, team) / COURT_W)) - 3 * markers(s, q).length);
      break;
    }
  }
  v += best + 2 * Math.min(3, safe);
  return v;
}

/** Valor da posição para `team` (positivo = bom). */
export function evaluate(s: GameState, team: Team): number {
  if (s.over) return s.winner === team ? 1000 : s.winner === 'empate' ? 0 : -1000;
  const h = holderOf(s);
  const mine = h.team === team;
  let v = (mine ? 1 : -1) * (14 + possessionValue(s, h.team));
  v += 120 * (s.score[team] - s.score[other(team)]);
  // Goleiro em casa: perto do centro do gol e entre a bola e o gol.
  const gk = keeperOf(s, team);
  if (gk) v -= 1.5 * dist(center(gk), ownGoal(team)) + (inArea(team, gk) ? 0 : 25);
  // Energético guardado vale um pouco (a IA desvia para pegar garrafas quando sai barato).
  const keep = s.half === 2 && s.round >= 8 ? 0 : 3; // na última rodada, guardar não vale nada
  for (const p of s.players) if (p.energetico) v += p.team === team ? keep : -keep;
  return v;
}

const clone = (s: GameState): GameState => structuredClone({ ...s, events: [], log: [] });

// ---------- Duelo ----------

/** Chance aproximada de cada resultado do Duelo (ajustada com simulações de duelos). */
export function duelOdds(s: GameState, ball: Player, mark: Player, markInitiates: boolean): { ballWins: number; markWins: number; foul: number } {
  const lb = Math.max(1, attrLances(ROLES[ball.role].dom) - (markers(s, ball).length >= 2 ? 1 : 0)) + (ball.pedalada ? 0.7 : 0);
  const lm = attrLances(ROLES[mark.role].mar) + (!markInitiates && mark.ready ? 1 : 0);
  const d = lb - lm;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (markInitiates) {
    const markWins = lm >= 2 ? clamp(0.19 - 0.09 * d, 0.03, 0.6) : 0.02;
    const foul = lm >= 3 ? 0.15 : 0.05;
    return { ballWins: clamp(0.45 + 0.1 * d, 0.1, 0.85), markWins, foul };
  }
  return { ballWins: clamp(0.17 + 0.25 * d, 0.06, 0.75), markWins: clamp(0.4 - 0.17 * d, 0.05, 0.65), foul: 0.12 };
}

export interface LanceMemory {
  golpe: number;
  guarda: number;
  finta: number;
  esperar: number;
}

export function newMemory(): LanceMemory {
  return { golpe: 1, guarda: 1, finta: 1, esperar: 1 };
}

/** Escolhe um lance para o lado `k`, prevendo o adversário pela memória (ou vendo o lance dele). */
export function chooseLance(s: GameState, cs: DuelState, k: SideKey, mem: LanceMemory, seen: Lance | null, diff: Difficulty = 'veterano'): Lance {
  const options = LANCES.filter((l) => canPlay(s, cs, k, l));
  const theirs = LANCES.filter((l) => canPlay(s, cs, otherSide(k), l));
  const total = theirs.reduce((n, l) => n + mem[l], 0);
  const markSide = otherSide(cs.ball);
  const payoff = (mine: Lance, their: Lance): number => {
    const a = k === 'atk' ? mine : their;
    const d = k === 'atk' ? their : mine;
    const c = clash(a, d, ROLES[getPlayer(s, cs.atk.playerId).role].weight, ROLES[getPlayer(s, cs.def.playerId).role].weight);
    const mineGain = k === 'atk' ? c.aGain : c.bGain;
    const theirGain = k === 'atk' ? c.bGain : c.aGain;
    let v = mineGain - theirGain;
    const markL = markSide === 'atk' ? a : d;
    const ballL = cs.ball === 'atk' ? a : d;
    if (markL === 'golpe' && ballL === 'guarda') v += k === markSide ? -2 : 2; // falta
    if (mine !== 'esperar') v -= 0.08; // fôlego
    if (mine === 'finta') v -= 0.1; // HAB
    return v;
  };
  const ev = options.map((m) => {
    if (seen) return { m, v: payoff(m, seen) };
    return { m, v: theirs.reduce((n, l) => n + (mem[l] / total) * payoff(m, l), 0) };
  });
  const temp = seen ? 0.05 : diff === 'recruta' ? 0.9 : 0.45;
  const mx = Math.max(...ev.map((e) => e.v));
  const w = ev.map((e) => Math.exp((e.v - mx) / temp));
  let r = nextRandom(s) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ev.length; i++) {
    r -= w[i];
    if (r <= 0) return ev[i].m;
  }
  return ev.at(-1)!.m;
}

/** Joga um Duelo inteiro entre duas IAs (ou a IA contra si mesma em simulações). */
export function autoDuel(s: GameState, cs: DuelState, mem: LanceMemory, diff: Difficulty = 'veterano'): void {
  while (!cs.done) {
    const a = chooseLance(s, cs, 'atk', mem, null, diff);
    const d = chooseLance(s, cs, 'def', mem, null, diff);
    resolveTempo(s, cs, a, d);
  }
}

// ---------- Chute ----------

/** Canto do chute da IA (melhor contra um goleiro que escolhe ao acaso, com um pouco de sorte). */
export function chooseCorner(s: GameState, pv: ShotPreview): Corner {
  const score = CORNERS.map((c) => CORNERS.filter((d) => shotResult(pv, c, d) === 'gol').length + nextRandom(s) * 0.9);
  return CORNERS[score.indexOf(Math.max(...score))];
}

/** Mergulho da IA: cantos um pouco mais prováveis que o meio. */
export function chooseDive(s: GameState): Corner {
  const r = nextRandom(s);
  return r < 0.37 ? 'esq' : r < 0.74 ? 'dir' : 'meio';
}

// ---------- Planejamento ----------

export type PlannedAction =
  | { kind: 'passe'; toId: string; alto: boolean }
  | { kind: 'chute'; bomba: boolean }
  | { kind: 'drible'; targetId: string }
  | { kind: 'desarme'; targetId: string }
  | { kind: 'carrinho'; targetId: string }
  | { kind: 'muralha' }
  | { kind: 'pedalada-drible'; targetId: string };

export interface Plan {
  playerId: string;
  sprint: boolean;
  move: Pos | null;
  action: PlannedAction | null;
  score: number;
  /** Toma o energético antes de andar. */
  drink?: boolean;
}

/** Valor esperado de uma ação, simulando o resultado (os sorteios viram médias). */
function actionValue(s: GameState, team: Team, act: PlannedAction): number {
  const p = getPlayer(s, s.activation!.playerId);
  if (act.kind === 'passe') {
    const t = clone(s);
    const out = pass(t, act.toId, act.alto);
    if (out.duel) {
      const ball = getPlayer(t, out.duel[out.duel.ball].playerId);
      const mark = getPlayer(t, out.duel[otherSide(out.duel.ball)].playerId);
      const o = duelOdds(t, ball, mark, true);
      const vKeep = evaluate(t, team);
      t.holder = mark.id;
      const vLose = evaluate(t, team);
      return (1 - o.markWins) * vKeep + o.markWins * vLose;
    }
    return evaluate(t, team);
  }
  if (act.kind === 'chute') {
    const pv = shotPreview(s, p, act.bomba);
    const q = goalChance(pv);
    const tg = clone(s);
    tg.score[team]++;
    const vGoal = evaluate(tg, team) - 40; // o adversário sai com a bola
    const tm = clone(s);
    tm.holder = pv.blockerId ?? pv.keeperId ?? tm.holder;
    const vMiss = evaluate(tm, team);
    return q * vGoal + (1 - q) * vMiss + (act.bomba ? -4 : 0);
  }
  if (act.kind === 'drible' || act.kind === 'pedalada-drible') {
    const t = clone(s);
    if (act.kind === 'pedalada-drible') getPlayer(t, p.id).pedalada = true;
    const mark = getPlayer(t, act.targetId);
    const o = duelOdds(t, getPlayer(t, p.id), mark, false);
    const win = clone(t);
    const wp = getPlayer(win, p.id);
    const wm = getPlayer(win, mark.id);
    const to = { x: wm.x + Math.sign(wm.x - wp.x), y: wm.y + Math.sign(wm.y - wp.y) };
    if (to.x >= 0 && to.y >= 0 && to.x < win.width && to.y < win.height && !win.players.some((q) => q.x === to.x && q.y === to.y)) {
      wp.x = to.x;
      wp.y = to.y;
    }
    wm.unbalanced = true;
    const vWin = evaluate(win, team) + 6;
    const lose = clone(t);
    lose.holder = mark.id;
    const vLose = evaluate(lose, team);
    const vKeep = evaluate(t, team) - 3;
    return o.ballWins * vWin + o.markWins * vLose + (1 - o.ballWins - o.markWins) * vKeep - (act.kind === 'pedalada-drible' ? 2 : 0);
  }
  if (act.kind === 'desarme' || act.kind === 'carrinho') {
    const h = holderOf(s);
    const t = clone(s);
    const o = duelOdds(t, getPlayer(t, h.id), getPlayer(t, p.id), true);
    const steal = clone(t);
    steal.holder = p.id;
    const vSteal = evaluate(steal, team);
    const fail = clone(t);
    getPlayer(fail, p.id).unbalanced = true;
    const vFail = evaluate(fail, team);
    const foulV = vFail - (t.fouls[team] >= 4 ? 25 : 6);
    return (
      o.markWins * vSteal + o.ballWins * vFail + o.foul * foulV + (1 - o.markWins - o.ballWins - o.foul) * evaluate(t, team) - (act.kind === 'carrinho' ? 3 : 0)
    );
  }
  if (act.kind === 'muralha') {
    const h = holderOf(s);
    const danger = h.team !== team && distToGoal(h, h.team) <= CHUTE_BASE + 4 ? 10 : -5;
    return evaluate(s, team) + danger;
  }
  return evaluate(s, team);
}

function actionsFor(s: GameState): PlannedAction[] {
  const out: PlannedAction[] = [];
  for (const t of currentTargets(s)) {
    if (t.kind === 'passe') out.push({ kind: 'passe', toId: t.toId, alto: t.alto });
    else if (t.kind === 'chute') out.push({ kind: 'chute', bomba: t.bomba });
    else if (t.kind === 'drible') {
      out.push({ kind: 'drible', targetId: t.targetId });
      if (canUseSpecial(s) === 'pedalada') out.push({ kind: 'pedalada-drible', targetId: t.targetId });
    } else if (t.kind === 'desarme') out.push({ kind: 'desarme', targetId: t.targetId });
    else if (t.kind === 'carrinho') out.push({ kind: 'carrinho', targetId: t.targetId });
  }
  if (canUseSpecial(s) === 'muralha') out.push({ kind: 'muralha' });
  return out;
}

/** Melhor jogada de um jogador (andar + ação), simulando cada casa alcançável. */
function planFor(s: GameState, id: string, diff: Difficulty): Plan {
  const team = getPlayer(s, id).team;
  let best: Plan = { playerId: id, sprint: false, move: null, action: null, score: -Infinity };
  for (const [dr, sp] of [
    [false, false],
    [false, true],
    [true, false],
  ] as const) {
    const base = clone(s);
    beginActivation(base, id);
    const me = getPlayer(base, id);
    // Fôlego recuperado conta a favor (mais lances no Duelo e arrancadas).
    const refill = dr ? (ROLES[me.role].fol - me.fol) * 0.6 + (ROLES[me.role].hab - me.hab) * 0.4 : 0;
    if (dr) {
      if (!canUseDrink(base)) continue;
      useDrink(base);
    }
    if (sp) {
      if (!canSprint(base)) continue;
      sprint(base);
    }
    const cells: (Pos | null)[] = [null, ...destinations(base)];
    for (const c of cells) {
      if (sp && !c) continue;
      const t = clone(base);
      if (c) moveTo(t, c.x, c.y);
      // Tomar o energético tem custo (perde o bônus guardado), então só vale quando abre jogada.
      const cost = (sp ? 1.5 : 0) - (dr ? refill : 0);
      const stay = evaluate(t, team) - cost;
      const noise = () => (diff === 'recruta' ? nextRandom(s) * 6 : nextRandom(s) * 0.5);
      if (stay + noise() > best.score) best = { playerId: id, sprint: sp, move: c, action: null, score: stay, drink: dr };
      for (const act of actionsFor(t)) {
        const v = actionValue(t, team, act) - cost + noise();
        if (v > best.score) best = { playerId: id, sprint: sp, move: c, action: act, score: v, drink: dr };
      }
    }
  }
  return best;
}

/** Próximo jogador da IA a agir e o que fazer (o mais valioso primeiro). */
export function planActivation(s: GameState, diff: Difficulty = 'veterano'): Plan | null {
  const ids = activatable(s).map((p) => p.id);
  if (!ids.length) return null;
  // Quem está com a bola age por último, depois que os colegas se mexeram (exceto se puder chutar).
  const h = holderOf(s);
  let best: Plan | null = null;
  for (const id of ids) {
    const p = planFor(s, id, diff);
    const bonus = id === h.id && ids.length > 1 && p.action?.kind !== 'chute' ? -2 : 0;
    if (!best || p.score + bonus > best.score) best = { ...p, score: p.score + bonus };
  }
  return best;
}

/** Executa uma jogada planejada. Devolve o Duelo aberto (se houver) para quem chamou resolver. */
export function executePlan(s: GameState, plan: Plan): { duel: DuelState | null; shot: boolean } {
  beginActivation(s, plan.playerId);
  if (plan.drink && canUseDrink(s)) useDrink(s);
  if (plan.sprint && canSprint(s)) sprint(s);
  if (plan.move) moveTo(s, plan.move.x, plan.move.y);
  const act = plan.action;
  if (!act) return { duel: null, shot: false };
  switch (act.kind) {
    case 'passe':
      return { duel: pass(s, act.toId, act.alto).duel ?? null, shot: false };
    case 'chute':
      return { duel: null, shot: true };
    case 'drible':
      return { duel: startDribble(s, act.targetId), shot: false };
    case 'pedalada-drible':
      useSpecial(s);
      return { duel: startDribble(s, act.targetId), shot: false };
    case 'desarme':
      return { duel: startTackle(s, act.targetId), shot: false };
    case 'carrinho':
      return { duel: startTackle(s, act.targetId, true), shot: false };
    case 'muralha':
      useSpecial(s);
      return { duel: null, shot: false };
  }
}

/** Partida inteira de IA contra IA (testes e balanceamento). */
export function simulateGame(seed: number, diff: Difficulty = 'veterano'): GameState {
  const s = createGame({ seed });
  const mem = newMemory();
  let guard = 0;
  while (!s.over && guard++ < 2000) {
    if (s.pendingDirect) {
      takeDirectKick(s, chooseCorner(s, shotPreview(s, getPlayer(s, s.pendingDirect), false, true)), chooseDive(s));
      continue;
    }
    const plan = planActivation(s, diff);
    if (!plan) {
      endPhase(s);
      continue;
    }
    const r = executePlan(s, plan);
    if (r.duel) {
      autoDuel(s, r.duel, mem, diff);
      applyDuel(s, r.duel);
      if (s.pendingDirect) continue;
    }
    if (r.shot) {
      const p = getPlayer(s, plan.playerId);
      const pv = shotPreview(s, p, plan.action?.kind === 'chute' && plan.action.bomba);
      shoot(s, chooseCorner(s, pv), chooseDive(s), plan.action?.kind === 'chute' && plan.action.bomba);
    }
    if (s.activation) {
      // Depois de um drible vencido, ainda pode passar ou chutar.
      if (s.activation.bonus) {
        const follow = bonusAction(s, diff);
        if (follow?.kind === 'passe') {
          const out = pass(s, follow.toId, follow.alto);
          if (out.duel) {
            autoDuel(s, out.duel, mem, diff);
            applyDuel(s, out.duel);
          }
        } else if (follow?.kind === 'chute') {
          const p = getPlayer(s, s.activation.playerId);
          shoot(s, chooseCorner(s, shotPreview(s, p, follow.bomba)), chooseDive(s), follow.bomba);
        }
      }
      if (s.activation) endActivation(s);
    }
  }
  return s;
}

/** Depois de um drible vencido: passar, chutar ou segurar. */
export function bonusAction(s: GameState, diff: Difficulty = 'veterano'): PlannedAction | null {
  const team = getPlayer(s, s.activation!.playerId).team;
  let best: { a: PlannedAction | null; v: number } = { a: null, v: evaluate(s, team) };
  for (const act of actionsFor(s)) {
    if (act.kind !== 'passe' && act.kind !== 'chute') continue;
    const v = actionValue(s, team, act) + (diff === 'recruta' ? nextRandom(s) * 5 : 0);
    if (v > best.v) best = { a: act, v };
  }
  return best.a;
}
