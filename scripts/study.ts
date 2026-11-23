// Estudo de viabilidade tática: partidas entre agentes de níveis diferentes,
// com métricas de posse, chute, duelo e sorte. Saída em JSON.
// Uso: npx tsx scripts/study.ts <agenteAzul> <agenteVermelho> <partidas> <semente> <saida.json>
// Agentes: veterano, recruta, guloso, aleatorio.

import {
  activatable,
  applyDuel,
  beginActivation,
  bonusAction,
  canPlay,

  chebyshev,
  chooseCorner,
  chooseDive,
  chooseLance,
  createGame,
  currentTargets,
  destinations,
  distToGoal,
  endActivation,
  endPhase,
  executePlan,
  getPlayer,
  goalChance,
  holderOf,
  LANCES,
  moveTo,
  newMemory,
  nextRandom,
  other,
  pass,
  planActivation,
  resolveTempo,
  ROLES,
  shoot,
  shotPreview,
  shotResult,
  takeDirectKick,
  directKickPreview,
} from '../src/core';
import type { Corner, DuelState, GameState, Lance, LanceMemory, Plan, PlannedAction, Pos, ShotPreview, SideKey, Team } from '../src/core';
// @ts-expect-error tipos do Node não estão instalados neste projeto
import { writeFileSync } from 'node:fs';

declare const process: { argv: string[] };

type AgentName = 'veterano' | 'recruta' | 'guloso' | 'aleatorio';
const CORNERS: Corner[] = ['esq', 'meio', 'dir'];
const clone = (s: GameState): GameState => structuredClone({ ...s, events: [], log: [] });
const rnd = (s: GameState, n: number) => Math.floor(nextRandom(s) * n);

function toAction(t: ReturnType<typeof currentTargets>[number]): PlannedAction {
  switch (t.kind) {
    case 'passe':
      return { kind: 'passe', toId: t.toId, alto: t.alto };
    case 'chute':
      return { kind: 'chute', bomba: t.bomba };
    case 'drible':
      return { kind: 'drible', targetId: t.targetId };
    case 'desarme':
      return { kind: 'desarme', targetId: t.targetId };
    case 'carrinho':
      return { kind: 'carrinho', targetId: t.targetId };
  }
}

/** Jogador ao acaso, casa ao acaso, ação ao acaso (entre as válidas). */
function randomPlan(s: GameState): Plan | null {
  const ps = activatable(s);
  if (!ps.length) return null;
  const p = ps[rnd(s, ps.length)];
  const t = clone(s);
  beginActivation(t, p.id);
  const ds = destinations(t);
  const move = ds.length && nextRandom(s) < 0.85 ? ds[rnd(s, ds.length)] : null;
  if (move) moveTo(t, move.x, move.y);
  const acts = currentTargets(t).map(toAction);
  const action = acts.length && nextRandom(s) < 0.7 ? acts[rnd(s, acts.length)] : null;
  return { playerId: p.id, sprint: false, move, action, score: 0 };
}

/** Jogada "óbvia", sem prever nada: ataca o gol, passa para frente, persegue a bola. */
function greedyPlan(s: GameState): Plan | null {
  const ps = activatable(s);
  if (!ps.length) return null;
  const h = holderOf(s);
  const team = s.activeTeam;
  const attacking = h.team === team;
  // Quem não tem a bola joga antes; quem tem a bola, por último.
  const p = ps.find((q) => q.id !== h.id) ?? ps[0];
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
    const me = getPlayer(t, p.id);
    const opps = t.players.filter((q) => q.team !== team);
    const free = opps.every((q) => chebyshev(q, me) > 1);
    let v: number;
    let action: PlannedAction | null = null;
    if (attacking && me.id === h.id) {
      v = -0.3 * distToGoal(me, team);
      for (const tg of currentTargets(t)) {
        if (tg.kind === 'chute' && goalChance(tg.preview) >= 0.3 && 10 * goalChance(tg.preview) > v) {
          v = 10 * goalChance(tg.preview);
          action = toAction(tg);
        } else if (tg.kind === 'passe' && tg.preview.result === 'ok') {
          const q = getPlayer(t, tg.toId);
          const gain = distToGoal(me, team) - distToGoal(q, team);
          if (gain > 0 && 3 + gain * 0.5 > v) {
            v = 3 + gain * 0.5;
            action = toAction(tg);
          }
        } else if (tg.kind === 'drible' && v < 1) {
          v = 1;
          action = toAction(tg);
        }
      }
    } else if (attacking) {
      v = -distToGoal(me, team) + (free ? 3 : 0);
    } else if (me.role === 'goleiro') {
      v = -distToGoal(me, other(team)) * 2;
    } else {
      v = -chebyshev(me, getPlayer(t, h.id));
      const tk = currentTargets(t).find((x) => x.kind === 'desarme' || x.kind === 'carrinho');
      if (tk) {
        v += 5;
        action = toAction(tk);
      }
    }
    if (v > best.score) best = { playerId: p.id, sprint: false, move: c, action, score: v };
  }
  return best;
}

interface Agent {
  name: AgentName;
  plan(s: GameState): Plan | null;
  lance(s: GameState, cs: DuelState, k: SideKey, mem: LanceMemory): Lance;
  corner(s: GameState, pv: ShotPreview): Corner;
}

function agent(name: AgentName): Agent {
  const smartLance = (diff: 'veterano' | 'recruta') => (s: GameState, cs: DuelState, k: SideKey, mem: LanceMemory) => chooseLance(s, cs, k, mem, null, diff);
  const randomLance = (s: GameState, cs: DuelState, k: SideKey) => {
    const ok = LANCES.filter((l) => canPlay(s, cs, k, l));
    return ok[rnd(s, ok.length)];
  };
  const randomCorner = (s: GameState) => CORNERS[rnd(s, 3)];
  switch (name) {
    case 'veterano':
      return { name, plan: (s) => planActivation(s, 'veterano'), lance: smartLance('veterano'), corner: chooseCorner };
    case 'recruta':
      return { name, plan: (s) => planActivation(s, 'recruta'), lance: smartLance('recruta'), corner: chooseCorner };
    case 'guloso':
      return { name, plan: greedyPlan, lance: randomLance, corner: randomCorner };
    case 'aleatorio':
      return { name, plan: randomPlan, lance: randomLance, corner: randomCorner };
  }
}

interface ShotRec {
  team: Team;
  role: string;
  dist: number;
  force: number;
  ref: number;
  open: boolean;
  blocked: boolean;
  pUniform: number;
  result: string;
  direct: boolean;
  phasesInPossession: number;
  counter: boolean;
}

interface DuelRec {
  kind: string;
  ballRole: string;
  markRole: string;
  outcome: string;
  tempos: number;
}

interface GameRec {
  seed: number;
  azul: AgentName;
  vermelho: AgentName;
  score: Record<Team, number>;
  winner: string;
  shots: ShotRec[];
  duels: DuelRec[];
  passes: { ok: number; cortado: number; dividida: number; alto: number };
  turnovers: Record<string, number>;
  possessions: number;
  activations: number;
  optionsSum: number;
  optionsN: number;
  fouls: number;
  directKicks: number;
  keeper4s: number;
  drinksPicked: number;
  drinksUsed: number;
  goalsAfterKickoffPhase: number;
}

function playMatch(seed: number, azul: Agent, verm: Agent): GameRec {
  const s = createGame({ seed });
  const ag = (t: Team) => (t === 'azul' ? azul : verm);
  const mem: Record<Team, LanceMemory> = { azul: newMemory(), vermelho: newMemory() };
  const rec: GameRec = {
    seed,
    azul: azul.name,
    vermelho: verm.name,
    score: s.score,
    winner: '',
    shots: [],
    duels: [],
    passes: { ok: 0, cortado: 0, dividida: 0, alto: 0 },
    turnovers: {},
    possessions: 1,
    activations: 0,
    optionsSum: 0,
    optionsN: 0,
    fouls: 0,
    directKicks: 0,
    keeper4s: 0,
    drinksPicked: 0,
    drinksUsed: 0,
    goalsAfterKickoffPhase: 0,
  };
  let possTeam: Team = holderOf(s).team;
  let possStartPhase = s.phase;
  let possStartedByTurnover = false;
  let evIdx = 0;
  let lastKickoffPhase = s.phase;

  const scan = () => {
    for (; evIdx < s.events.length; evIdx++) {
      const e = s.events[evIdx];
      if (e.kind === 'passe') {
        rec.passes[e.result]++;
        if (e.alto) rec.passes.alto++;
      } else if (e.kind === 'falta') rec.fouls++;
      else if (e.kind === 'apito' && e.text.startsWith('4 segundos')) rec.keeper4s++;
      else if (e.kind === 'garrafa' && e.acao === 'pega') rec.drinksPicked++;
      else if (e.kind === 'garrafa' && e.acao === 'usa') rec.drinksUsed++;
      else if (e.kind === 'reset') lastKickoffPhase = s.phase;
      else if (e.kind === 'gol' && s.phase - lastKickoffPhase <= 1) rec.goalsAfterKickoffPhase++;
    }
    const t = holderOf(s).team;
    if (t !== possTeam) {
      possTeam = t;
      possStartPhase = s.phase;
      rec.possessions++;
      possStartedByTurnover = true;
    }
  };
  const turnover = (cause: string, before: Team) => {
    if (holderOf(s).team !== before) rec.turnovers[cause] = (rec.turnovers[cause] ?? 0) + 1;
  };

  const runDuel = (cs: DuelState) => {
    const ball = getPlayer(s, cs[cs.ball].playerId);
    const mark = getPlayer(s, cs[cs.ball === 'atk' ? 'def' : 'atk'].playerId);
    const before = holderOf(s).team;
    while (!cs.done) {
      const pa = getPlayer(s, cs.atk.playerId);
      const pd = getPlayer(s, cs.def.playerId);
      const a = ag(pa.team).lance(s, cs, 'atk', mem[pd.team]);
      const d = ag(pd.team).lance(s, cs, 'def', mem[pa.team]);
      mem[pa.team][a]++;
      mem[pd.team][d]++;
      resolveTempo(s, cs, a, d);
    }
    const out = applyDuel(s, cs) as unknown as string;
    rec.duels.push({ kind: cs.kind, ballRole: ball.role, markRole: mark.role, outcome: String(out), tempos: cs.results.length });
    turnover('duelo', before);
  };

  const doShot = (shooterId: string, bomba: boolean, direct: boolean) => {
    const p = getPlayer(s, shooterId);
    const pv = direct ? directKickPreview(s)!.preview : shotPreview(s, p, bomba);
    let corner = ag(p.team).corner(s, pv);
    let dive = chooseDive(s);
    if (pv.keeperReads) dive = corner;
    else if (pv.shooterReads) corner = CORNERS.find((c) => shotResult(pv, c, dive) === 'gol') ?? corner;
    let n = 0;
    for (const c of CORNERS) for (const d of CORNERS) if (shotResult(pv, c, d) === 'gol') n++;
    const before = s.score[p.team];
    const beforeTeam = p.team;
    if (direct) takeDirectKick(s, corner, dive);
    else shoot(s, corner, dive, bomba);
    const result = s.score[beforeTeam] > before ? 'gol' : pv.blockerId ? 'bloqueio' : 'defesa';
    rec.shots.push({
      team: p.team,
      role: p.role,
      dist: pv.dist,
      force: pv.force,
      ref: pv.ref,
      open: pv.open,
      blocked: !!pv.blockerId,
      pUniform: pv.blockerId ? 0 : n / 9,
      result,
      direct,
      phasesInPossession: s.phase - possStartPhase,
      counter: possStartedByTurnover && s.phase - possStartPhase <= 1,
    });
    if (result !== 'gol') turnover('chute', beforeTeam);
  };

  let guard = 0;
  while (!s.over && guard++ < 3000) {
    scan();
    if (s.pendingDirect) {
      rec.directKicks++;
      doShot(s.pendingDirect, false, true);
      continue;
    }
    const a = ag(s.activeTeam);
    // Tamanho do espaço de decisão: casas × ações do jogador que vai agir.
    const plan = a.plan(s);
    if (!plan) {
      endPhase(s);
      continue;
    }
    {
      const t = clone(s);
      beginActivation(t, plan.playerId);
      const cells = destinations(t);
      rec.optionsSum += (cells.length + 1) * (1 + currentTargets(t).length);
      rec.optionsN++;
    }
    rec.activations++;
    const beforeTeam = holderOf(s).team;
    const r = executePlan(s, plan);
    if (plan.action?.kind === 'passe' && !r.duel) turnover('passe', beforeTeam);
    if (r.duel) {
      runDuel(r.duel);
      if (s.pendingDirect) continue;
    }
    if (r.shot) doShot(plan.playerId, plan.action?.kind === 'chute' && plan.action.bomba, false);
    if (s.activation && s.activation.bonus && (a.name === 'veterano' || a.name === 'recruta')) {
      const follow = bonusAction(s, a.name);
      if (follow?.kind === 'passe') {
        const out = pass(s, follow.toId, follow.alto);
        if (out.duel) runDuel(out.duel);
      } else if (follow?.kind === 'chute') doShot(s.activation!.playerId, follow.bomba, false);
    }
    if (s.activation) {
      endActivation(s);
    }
    scan();
  }
  scan();
  rec.score = { ...s.score };
  rec.winner = s.winner ?? '';
  return rec;
}

const [aName, bName, nStr, seedStr, out, ablation] = process.argv.slice(2);
// Variações de regra para testar propostas (sem mexer no jogo).
if (ablation === 'marcacao') {
  // Ala e pivô marcam com 2 lances (MAR 3) em vez de 1: mais gente capaz de roubar a bola.
  ROLES.ala.mar = 3;
  ROLES.pivo.mar = 3;
}
const n = Number(nStr ?? 10);
const base = Number(seedStr ?? 1);
const res: GameRec[] = [];
const t0 = Date.now();
for (let i = 0; i < n; i++) {
  // Metade das partidas com os lados trocados (anula vantagem de lado e de saída).
  const swap = i % 2 === 1;
  const A = agent((swap ? bName : aName) as AgentName);
  const B = agent((swap ? aName : bName) as AgentName);
  res.push(playMatch(base + i * 13, A, B));
}
writeFileSync(out, JSON.stringify({ a: aName, b: bName, n, ms: Date.now() - t0, games: res }));
console.log(`${aName} x ${bName}: ${n} partidas em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
