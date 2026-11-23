// IA do futsal: avalia a posição para cada time e simula as jogadas de cada jogador.

import { CHUTE_BASE, COURT_W, FOUL_LIMIT, ROLES, ROUNDS_PER_HALF } from './data';
import { center, dist, distToGoal, getPlayer, holderOf, inArea, keeperOf, other, ownGoal, teamPlayers } from './court';
import { LANCES, canPlay, clash, diffLances, markers, otherSide, resolveTempo, useRead } from './duelo';
import type { DuelState, Lance, SideKey } from './duelo';
import {
  activatable,
  activationsLeft,
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
  startReaction,
  sprint,
  useDrink,
  startDribble,
  startTackle,
  takeDirectKick,
  useSpecial,
} from './game';
import type { ShotOutcome, ShotPreview } from './game';
import { nextRandom } from './rng';
import type { Corner, GameState, Player, Pos, Team } from './types';

export type Difficulty = 'recruta' | 'veterano' | 'craque';
const CORNERS: Corner[] = ['esq', 'meio', 'dir'];

// ---------- Avaliação ----------

/** Chance de gol de um chute de bola rolando. */
export function goalChance(pv: ShotPreview): number {
  if (!pv.ok) return 0;
  return pv.chance;
}

/** Chance de gol num tiro livre direto (ainda no palpite de canto, os dois ao acaso). */
export function directChance(pv: ShotPreview): number {
  if (pv.open) return 0.95;
  let total = 0;
  for (const c of CORNERS) for (const d of CORNERS) if (shotResult(pv, c, d) === 'gol') total++;
  let p = total / 9;
  if (pv.shooterReads) p = Math.max(p, 0.85);
  if (pv.keeperReads) p = Math.min(p, 0.1);
  return p;
}

/**
 * Chance de gol de quem tem a bola, pesada por quando ele chuta: ainda nesta fase (se pode agir) vale inteira;
 * só na próxima fase do time, depois do adversário jogar, vale a metade.
 */
function shotQuality(s: GameState, p: Player): number {
  const q = goalChance(shotPreview(s, p));
  return canStillAct(s, p) ? q : q * 0.5;
}

/** O jogador ainda age nesta fase do time? (Quem está em ação conta como já usado.) */
function canStillAct(s: GameState, p: Player): boolean {
  if (s.activeTeam !== p.team || p.activated || p.altoRecebido) return false;
  const a = s.activation;
  if (a && a.playerId === p.id) return !a.acted || a.bonus;
  const used = s.activationsUsed + (a ? 1 : 0);
  return used < s.activationsMax;
}

/** Quão perigosa é a posse do time `team` neste momento (0 a ~60). */
function possessionValue(s: GameState, team: Team): number {
  const h = holderOf(s);
  let v = 0;
  v += 36 * (1 - Math.min(1, distToGoal(h, team) / COURT_W));
  v += 34 * shotQuality(s, h);
  v -= 4 * markers(s, h).length;
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
  v += 200 * (s.score[team] - s.score[other(team)]);
  // Goleiro em casa: perto do centro do gol e entre a bola e o gol.
  const gk = keeperOf(s, team);
  if (gk) v -= 1.5 * dist(center(gk), ownGoal(team)) + (inArea(team, gk) ? 0 : 25);
  // Energético guardado vale um pouco (a IA desvia para pegar garrafas quando sai barato).
  const keep = s.half === 2 && s.round >= ROUNDS_PER_HALF ? 0 : 3; // na última rodada, guardar não vale nada
  for (const p of s.players) if (p.energetico) v += p.team === team ? keep : -keep;
  return v;
}

const clone = (s: GameState): GameState => structuredClone({ ...s, events: [], log: [] });

// ---------- Duelo ----------

/** Lances de cada lado num Duelo, como startDuel calcularia (sem iniciar nada). */
export function duelLances(s: GameState, ball: Player, mark: Player, _markInitiates: boolean, extra = 0): { lb: number; lm: number } {
  const rb = ROLES[ball.role];
  const rm = ROLES[mark.role];
  let lb = diffLances(rb.dom, rm.mar) - (markers(s, ball).length >= 3 ? 1 : 0) - (ball.fol < 2 ? 1 : 0) + (ball.pedalada ? 0.7 : 0);
  let lm = diffLances(rm.mar, rb.dom) + (mark.ready ? 1 : 0) - (mark.fol < 2 ? 1 : 0) + extra;
  lb = Math.max(1, Math.min(3.7, lb));
  lm = Math.max(1, Math.min(3, lm));
  return { lb, lm };
}

/** Chance aproximada de cada resultado do Duelo (ajustada com simulações de duelos). */
export function duelOdds(s: GameState, ball: Player, mark: Player, markInitiates: boolean, extra = 0): { ballWins: number; markWins: number; foul: number } {
  const { lb, lm } = duelLances(s, ball, mark, markInitiates, extra);
  const d = lb - lm;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (markInitiates) {
    return { ballWins: clamp(0.5 + 0.12 * d, 0.1, 0.9), markWins: clamp(0.2 - 0.1 * d, 0.03, 0.6), foul: clamp(0.13 - 0.02 * d, 0.04, 0.25) };
  }
  return { ballWins: clamp(0.3 + 0.2 * d, 0.06, 0.8), markWins: clamp(0.3 - 0.15 * d, 0.04, 0.65), foul: 0.12 };
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
  const markTeam = getPlayer(s, cs[markSide].playerId).team;
  const foulCost = s.fouls[markTeam] + 1 >= FOUL_LIMIT ? 2.5 : 0.9;
  const payoff = (mine: Lance, their: Lance): number => {
    const a = k === 'atk' ? mine : their;
    const d = k === 'atk' ? their : mine;
    const c = clash(a, d, ROLES[getPlayer(s, cs.atk.playerId).role].weight, ROLES[getPlayer(s, cs.def.playerId).role].weight);
    const mineGain = k === 'atk' ? c.aGain : c.bGain;
    const theirGain = k === 'atk' ? c.bGain : c.aGain;
    let v = mineGain - theirGain;
    const markL = markSide === 'atk' ? a : d;
    const ballL = cs.ball === 'atk' ? a : d;
    // Falta: barata enquanto não vira tiro livre direto; cara quando a próxima já é direto.
    if (markL === 'golpe' && ballL === 'guarda') v += (k === markSide ? -1 : 1) * foulCost;
    if (mine !== 'esperar')
      v -= 0.08; // fôlego
    else v += 0.35; // esperar recupera fôlego e dá uma Leitura no próximo tempo
    if (mine === 'finta') v -= 0.1; // HAB
    return v;
  };
  // Previsão do lance do outro: pela memória (hábitos) e, no Craque, também pelo que seria melhor para ele.
  const prob = new Map<Lance, number>(theirs.map((l) => [l, mem[l] / total]));
  if (diff === 'craque' && !seen) {
    const theirEv = theirs.map((l) => options.reduce((n, m) => n - payoff(m, l), 0) / options.length);
    const mxT = Math.max(...theirEv);
    const wT = theirEv.map((v) => Math.exp((v - mxT) / 0.45));
    const sT = wT.reduce((x, y) => x + y, 0);
    theirs.forEach((l, i) => prob.set(l, 0.5 * prob.get(l)! + 0.5 * (wT[i] / sT)));
  }
  const ev = options.map((m) => {
    if (seen) return { m, v: payoff(m, seen) };
    return { m, v: theirs.reduce((n, l) => n + prob.get(l)! * payoff(m, l), 0) };
  });
  const temp = seen ? 0.05 : diff === 'recruta' ? 0.9 : diff === 'craque' ? 0.25 : 0.45;
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
    // Quem tem Leitura (e não está desequilibrado) vê a escolha do outro antes; desequilibrado é visto.
    const readsA = cs.exposed === 'def' || (cs.exposed !== 'atk' && cs.atk.readsLeft > 0 && useRead(cs, 'atk'));
    const readsD = !readsA && (cs.exposed === 'atk' || (cs.def.readsLeft > 0 && useRead(cs, 'def')));
    let a: Lance;
    let d: Lance;
    if (readsA) {
      d = chooseLance(s, cs, 'def', mem, null, diff);
      a = chooseLance(s, cs, 'atk', mem, d, diff);
    } else if (readsD) {
      a = chooseLance(s, cs, 'atk', mem, null, diff);
      d = chooseLance(s, cs, 'def', mem, a, diff);
    } else {
      a = chooseLance(s, cs, 'atk', mem, null, diff);
      d = chooseLance(s, cs, 'def', mem, null, diff);
    }
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
      // Parar colado num defensor de prontidão dispara o bote automático: o valor vira uma média com o risco de perder a bola.
      let q = 0;
      let vLose = 0;
      if (t.pendingReaction) {
        const d = getPlayer(t, t.pendingReaction);
        const o = duelOdds(t, getPlayer(t, id), d, true);
        q = o.markWins;
        const lose = clone(t);
        lose.pendingReaction = null;
        lose.holder = d.id;
        vLose = evaluate(lose, team);
        t.pendingReaction = null;
        d.ready = false;
      }
      const risk = (v: number) => (1 - q) * v + q * vLose;
      // Tomar o energético tem custo (perde o bônus guardado), então só vale quando abre jogada.
      const cost = (sp ? 1.5 : 0) - (dr ? refill : 0);
      const stay = risk(evaluate(t, team)) - cost;
      const noise = () => (diff === 'recruta' ? nextRandom(s) * 6 : diff === 'craque' ? nextRandom(s) * 0.1 : nextRandom(s) * 0.5);
      if (stay + noise() > best.score) best = { playerId: id, sprint: sp, move: c, action: null, score: stay, drink: dr };
      for (const act of actionsFor(t)) {
        const v = risk(actionValue(t, team, act)) - cost + noise();
        if (v > best.score) best = { playerId: id, sprint: sp, move: c, action: act, score: v, drink: dr };
      }
    }
  }
  return best;
}

/** Quanto vale deixar este jogador de prontidão para a fase do adversário (ele deixa de valer isso se agir agora). */
function readyValue(s: GameState, p: Player): number {
  const h = holderOf(s);
  if (h.team === p.team) return h.id === p.id ? 1.5 : 0.5;
  const d = Math.max(Math.abs(p.x - h.x), Math.abs(p.y - h.y));
  const toGoal = distToGoal(h, h.team);
  // Perto de quem tem a bola, ou entre ela e o nosso gol, a prontidão vira bote ou corte.
  const between = dist(center(p), ownGoal(p.team)) < toGoal;
  return (d <= 2 ? 5 : d <= 4 ? 3 : 1) + (between ? 1.5 : 0);
}

/** Jogada "óbvia": vai para o gol, passa para frente, persegue a bola. É o nível Recruta. */
export function obviousPlan(s: GameState): Plan | null {
  const ps = activatable(s);
  if (!ps.length) return null;
  const h = holderOf(s);
  const team = s.activeTeam;
  const attacking = h.team === team;
  // Quem não tem a bola joga antes; quem tem a bola, por último.
  const p = ps.find((q) => q.id !== h.id && q.role !== 'goleiro') ?? ps.find((q) => q.id !== h.id) ?? ps[0];
  const cells: (Pos | null)[] = [null];
  {
    const t = clone(s);
    beginActivation(t, p.id);
    cells.push(...destinations(t));
  }
  let best: Plan = { playerId: p.id, sprint: false, move: null, action: null, score: -Infinity };
  for (const c of cells) {
    const t = clone(s);
    beginActivation(t, p.id);
    if (c) moveTo(t, c.x, c.y);
    t.pendingReaction = null;
    const me = getPlayer(t, p.id);
    const free = t.players.every((q) => q.team === team || Math.max(Math.abs(q.x - me.x), Math.abs(q.y - me.y)) > 1);
    let v: number;
    let action: PlannedAction | null = null;
    if (attacking && me.id === h.id) {
      v = -0.3 * distToGoal(me, team);
      for (const tg of currentTargets(t)) {
        if (tg.kind === 'chute' && goalChance(tg.preview) >= 0.35 && 10 * goalChance(tg.preview) > v) {
          v = 10 * goalChance(tg.preview);
          action = { kind: 'chute', bomba: tg.bomba };
        } else if (tg.kind === 'passe' && tg.preview.result === 'ok') {
          const q = getPlayer(t, tg.toId);
          const gain = distToGoal(me, team) - distToGoal(q, team);
          if (gain > 0 && 3 + gain * 0.5 > v) {
            v = 3 + gain * 0.5;
            action = { kind: 'passe', toId: tg.toId, alto: tg.alto };
          }
        } else if (tg.kind === 'drible' && v < 1) {
          v = 1;
          action = { kind: 'drible', targetId: tg.targetId };
        }
      }
    } else if (attacking) {
      v = -distToGoal(me, team) + (free ? 3 : 0);
    } else if (me.role === 'goleiro') {
      v = -distToGoal(me, other(team)) * 2;
    } else {
      v = -Math.max(Math.abs(me.x - h.x), Math.abs(me.y - h.y));
      const tk = currentTargets(t).find((x) => x.kind === 'desarme' || x.kind === 'carrinho');
      if (tk && (tk.kind === 'desarme' || tk.kind === 'carrinho')) {
        v += 5;
        action = { kind: tk.kind, targetId: tk.targetId };
      }
    }
    v += nextRandom(s) * 0.8;
    if (v > best.score) best = { playerId: p.id, sprint: false, move: c, action, score: v };
  }
  return best;
}

/** Próximo jogador da IA a agir e o que fazer (o mais valioso primeiro). */
export function planActivation(s: GameState, diff: Difficulty = 'veterano'): Plan | null {
  if (diff === 'recruta') return obviousPlan(s);
  const ids = activatable(s).map((p) => p.id);
  if (!ids.length) return null;
  // Quem está com a bola age por último, depois que os colegas se mexeram (exceto se puder chutar).
  const h = holderOf(s);
  const plans: Plan[] = [];
  for (const id of ids) {
    const p = planFor(s, id, diff);
    const bonus = id === h.id && ids.length > 1 && p.action?.kind !== 'chute' ? -2 : 0;
    // Agir custa a prontidão desse jogador na fase do adversário.
    const keep = readyValue(s, getPlayer(s, id));
    plans.push({ ...p, score: p.score + bonus - keep });
  }
  plans.sort((a, b) => b.score - a.score);
  // Última ativação da fase com a bola no nosso time: quem está com ela joga (senão a bola fica parada).
  if (activationsLeft(s) === 1 && h.team === s.activeTeam && ids.includes(h.id)) {
    return plans.find((p) => p.playerId === h.id)!;
  }
  if (diff !== 'craque') return plans[0];
  // Craque: testa as melhores jogadas até o fim da fase (com os colegas jogando como Veterano)
  // e fica com a que deixa o time em melhor situação para a fase do adversário.
  const team = s.activeTeam;
  let best = plans[0];
  let bestV = -Infinity;
  for (const p of plans.slice(0, 3)) {
    let v = 0;
    for (let k = 0; k < 2; k++) {
      const t = clone(s);
      // Sorteios diferentes dos da partida de verdade: o Craque não vê o futuro.
      for (let i = 0; i < 13 + k * 7; i++) nextRandom(t);
      const mem = newMemory();
      playActivation(t, p, mem, () => 'veterano');
      let guard = 0;
      while (!t.over && t.activeTeam === team && !t.pendingDirect && guard++ < 6) {
        const q = planActivation(t, 'veterano');
        if (!q) {
          endPhase(t);
          break;
        }
        playActivation(t, q, mem, () => 'veterano');
      }
      v += evaluate(t, team);
    }
    if (v > bestV) {
      best = p;
      bestV = v;
    }
  }
  return best;
}

export interface ExecResult {
  /** Duelo aberto pela ação (quem chamou resolve com applyDuel). */
  duel: DuelState | null;
  /** Bote automático disparado pelo movimento: resolva o Duelo e depois chame executeAction. */
  reaction: DuelState | null;
  shot: ShotOutcome | null;
}

/** Executa uma jogada planejada: ativa, toma energético, arranca, anda e age. */
export function executePlan(s: GameState, plan: Plan): ExecResult {
  beginActivation(s, plan.playerId);
  if (plan.drink && canUseDrink(s)) useDrink(s);
  if (plan.sprint && canSprint(s)) sprint(s);
  if (plan.move) moveTo(s, plan.move.x, plan.move.y);
  if (s.pendingReaction) return { duel: null, reaction: startReaction(s), shot: null };
  return executeAction(s, plan.action);
}

/** Faz a ação planejada, se ela ainda for possível (depois de um bote, por exemplo, pode não ser). */
export function executeAction(s: GameState, act: PlannedAction | null): ExecResult {
  const none: ExecResult = { duel: null, reaction: null, shot: null };
  if (!act || !s.activation || s.over) return none;
  const ok = (kind: string, id?: string) =>
    currentTargets(s).some((t) => t.kind === kind && (!id || ('toId' in t ? t.toId === id : 'targetId' in t ? t.targetId === id : true)));
  switch (act.kind) {
    case 'passe':
      if (!ok('passe', act.toId)) return none;
      return { ...none, duel: pass(s, act.toId, act.alto).duel ?? null };
    case 'chute':
      if (!currentTargets(s).some((t) => t.kind === 'chute' && t.bomba === act.bomba)) return none;
      return { ...none, shot: shoot(s, act.bomba) };
    case 'drible':
      if (!ok('drible', act.targetId)) return none;
      return { ...none, duel: startDribble(s, act.targetId) };
    case 'pedalada-drible':
      if (!ok('drible', act.targetId) || canUseSpecial(s) !== 'pedalada') return none;
      useSpecial(s);
      return { ...none, duel: startDribble(s, act.targetId) };
    case 'desarme':
      if (!ok('desarme', act.targetId)) return none;
      return { ...none, duel: startTackle(s, act.targetId) };
    case 'carrinho':
      if (!ok('carrinho', act.targetId)) return none;
      return { ...none, duel: startTackle(s, act.targetId, true) };
    case 'muralha':
      if (canUseSpecial(s) !== 'muralha') return none;
      useSpecial(s);
      return none;
  }
}

/** Joga uma ativação planejada até o fim, com os Duelos resolvidos automaticamente. */
export function playActivation(s: GameState, plan: Plan, mem: LanceMemory, level: (t: Team) => Difficulty): void {
  const duel = (cs: DuelState) => {
    autoDuel(s, cs, mem, level(s.activeTeam));
    applyDuel(s, cs);
  };
  let r = executePlan(s, plan);
  if (r.reaction) {
    duel(r.reaction);
    if (s.pendingDirect) return;
    r = executeAction(s, plan.action);
  }
  if (r.duel) {
    duel(r.duel);
    if (s.pendingDirect) return;
  }
  if (s.activation) {
    // Depois de um drible vencido, ainda pode passar ou chutar.
    if (s.activation.bonus) {
      const follow = bonusAction(s, level(s.activeTeam));
      const out = executeAction(s, follow);
      if (out.duel) duel(out.duel);
      if (s.pendingDirect) return;
    }
    if (s.activation) endActivation(s);
  }
}

/** Partida inteira de IA contra IA (testes e balanceamento). */
export function simulateGame(seed: number, diff: Difficulty = 'veterano', diffB: Difficulty = diff): GameState {
  const s = createGame({ seed });
  const mem = newMemory();
  const level = (t: Team) => (t === 'azul' ? diff : diffB);
  let guard = 0;
  while (!s.over && guard++ < 2000) {
    if (s.pendingDirect) {
      takeDirectKick(s, chooseCorner(s, shotPreview(s, getPlayer(s, s.pendingDirect), false, true)), chooseDive(s));
      continue;
    }
    const plan = planActivation(s, level(s.activeTeam));
    if (!plan) {
      endPhase(s);
      continue;
    }
    playActivation(s, plan, mem, level);
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
