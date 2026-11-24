// Estudo de viabilidade tática: partidas entre agentes de níveis diferentes,
// com métricas de posse, chute, duelo e sorte. Saída em JSON.
// Uso: npx tsx scripts/study.ts <agenteAzul> <agenteVermelho> <partidas> <semente> <saida.json>
// Agentes: veterano, recruta, guloso, aleatorio.

import {
  activatable,
  traitFits,
  assignTraits,
  chooseTraits,
  applyDuel,
  beginActivation,
  bonusAction,
  canPlay,
  canSprint,
  canUseDrink,
  chooseCorner,
  chooseDive,
  chooseLance,
  createGame,
  currentTargets,
  destinations,
  directKickPreview,
  endActivation,
  endPhase,
  executeAction,
  getPlayer,
  holderOf,
  LANCES,
  moveTo,
  newMemory,
  nextRandom,
  obviousPlan,
  planActivation,
  resolveTempo,
  ROLES,
  shotPreview,
  shotResult,
  sprint,
  startReaction,
  takeDirectKick,
  useDrink,
  useRead,
} from '../src/core';
import type { Corner, DuelState, GameState, Lance, LanceMemory, Plan, PlannedAction, ShotPreview, SideKey, Style, Team, Trait } from '../src/core';
// @ts-expect-error tipos do Node não estão instalados neste projeto
import { writeFileSync } from 'node:fs';

declare const process: { argv: string[] };

type AgentName = 'veterano' | 'recruta' | 'craque' | 'aleatorio';
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

interface Agent {
  name: AgentName;
  plan(s: GameState): Plan | null;
  lance(s: GameState, cs: DuelState, k: SideKey, mem: LanceMemory): Lance;
  corner(s: GameState, pv: ShotPreview): Corner;
  style?: Style;
  label?: string;
  traits?: boolean;
  only?: Trait[];
}

function agent(name: AgentName): Agent {
  const smartLance = (diff: 'veterano' | 'recruta' | 'craque') => (s: GameState, cs: DuelState, k: SideKey, mem: LanceMemory) =>
    chooseLance(s, cs, k, mem, null, diff);
  const randomLance = (s: GameState, cs: DuelState, k: SideKey) => {
    const ok = LANCES.filter((l) => canPlay(s, cs, k, l));
    return ok[rnd(s, ok.length)];
  };
  const randomCorner = (s: GameState) => CORNERS[rnd(s, 3)];
  switch (name) {
    case 'veterano':
      return { name, plan: (s) => planActivation(s, 'veterano'), lance: smartLance('veterano'), corner: chooseCorner };
    case 'recruta':
      return { name, plan: obviousPlan, lance: smartLance('recruta'), corner: chooseCorner };
    case 'craque':
      return { name, plan: (s) => planActivation(s, 'craque'), lance: smartLance('craque'), corner: chooseCorner };
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
  azul: string;
  vermelho: string;
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
  reactions: number;
  cuts: number;
}

function playMatch(seed: number, azul: Agent, verm: Agent): GameRec {
  const s = createGame({ seed, styles: { azul: azul.style, vermelho: verm.style } });
  // Características escolhidas pela IA do estilo (a não ser com ":sem").
  for (const [t, a] of [
    ['azul', azul],
    ['vermelho', verm],
  ] as const) {
    if (a.only) assignTraits(s, t, placeTraits(s, t, a.only));
    else if (a.traits !== false) assignTraits(s, t, chooseTraits(s, t, 'veterano'));
  }
  const ag = (t: Team) => (t === 'azul' ? azul : verm);
  const mem: Record<Team, LanceMemory> = { azul: newMemory(), vermelho: newMemory() };
  const rec: GameRec = {
    seed,
    azul: azul.label ?? azul.name,
    vermelho: verm.label ?? verm.name,
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
    reactions: 0,
    cuts: 0,
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
      // Leituras: quem lê escolhe depois de ver o outro (aqui, a escolha dele é refeita sabendo a do outro).
      const readsA = cs.exposed === 'def' || (cs.exposed !== 'atk' && cs.atk.readsLeft > 0 && useRead(cs, 'atk'));
      const readsD = !readsA && (cs.exposed === 'atk' || (cs.def.readsLeft > 0 && useRead(cs, 'def')));
      let a: Lance;
      let d: Lance;
      if (readsA) {
        d = ag(pd.team).lance(s, cs, 'def', mem[pa.team]);
        a = ag(pa.team).name === 'aleatorio' ? ag(pa.team).lance(s, cs, 'atk', mem[pd.team]) : chooseLance(s, cs, 'atk', mem[pd.team], d, 'veterano');
      } else if (readsD) {
        a = ag(pa.team).lance(s, cs, 'atk', mem[pd.team]);
        d = ag(pd.team).name === 'aleatorio' ? ag(pd.team).lance(s, cs, 'def', mem[pa.team]) : chooseLance(s, cs, 'def', mem[pa.team], a, 'veterano');
      } else {
        a = ag(pa.team).lance(s, cs, 'atk', mem[pd.team]);
        d = ag(pd.team).lance(s, cs, 'def', mem[pa.team]);
      }
      mem[pa.team][a]++;
      mem[pd.team][d]++;
      resolveTempo(s, cs, a, d);
    }
    const out = applyDuel(s, cs) as unknown as string;
    rec.duels.push({ kind: cs.kind, ballRole: ball.role, markRole: mark.role, outcome: String(out), tempos: cs.results.length });
    turnover('duelo', before);
  };

  const recShot = (shooterId: string, bomba: boolean, direct: boolean, act: () => void) => {
    const p = getPlayer(s, shooterId);
    const pv = direct ? directKickPreview(s)!.preview : shotPreview(s, p, bomba);
    const beforeTeam = p.team;
    const evStart = s.events.length;
    act();
    const ev = s.events.slice(evStart).find((e) => e.kind === 'chute');
    const result = ev && ev.kind === 'chute' ? ev.result : 'nada';
    let n = 0;
    for (const c of CORNERS) for (const d of CORNERS) if (shotResult(pv, c, d) === 'gol') n++;
    rec.shots.push({
      team: p.team,
      role: p.role,
      dist: pv.dist,
      force: pv.force,
      ref: pv.refEff,
      open: pv.open,
      blocked: !!pv.blockerId,
      pUniform: pv.blockerId ? 0 : direct ? n / 9 : pv.chance,
      result,
      direct,
      phasesInPossession: s.phase - possStartPhase,
      counter: possStartedByTurnover && s.phase - possStartPhase <= 1,
    });
    if (result !== 'gol') turnover('chute', beforeTeam);
  };
  const doDirect = () => {
    rec.directKicks++;
    const id = s.pendingDirect!;
    const p = getPlayer(s, id);
    recShot(id, false, true, () => {
      const pv = directKickPreview(s)!.preview;
      let corner = ag(p.team).corner(s, pv);
      let dive = chooseDive(s);
      if (pv.keeperReads) dive = corner;
      else if (pv.shooterReads) corner = CORNERS.find((c) => shotResult(pv, c, dive) === 'gol') ?? corner;
      takeDirectKick(s, corner, dive);
    });
  };
  const doAction = (act: PlannedAction | null) => {
    if (!s.activation) return;
    const beforeTeam = holderOf(s).team;
    let out: ReturnType<typeof executeAction> | null = null;
    if (act?.kind === 'chute') recShot(s.activation.playerId, act.bomba, false, () => (out = executeAction(s, act)));
    else out = executeAction(s, act);
    if (act?.kind === 'passe') turnover('passe', beforeTeam);
    const o = out as ReturnType<typeof executeAction> | null;
    if (o?.duel) runDuel(o.duel);
  };

  let guard = 0;
  while (!s.over && guard++ < 3000) {
    scan();
    if (s.pendingDirect) {
      doDirect();
      continue;
    }
    const a = ag(s.activeTeam);
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
    beginActivation(s, plan.playerId);
    if (plan.drink && canUseDrink(s)) useDrink(s);
    if (plan.sprint && canSprint(s)) sprint(s);
    if (plan.move) moveTo(s, plan.move.x, plan.move.y);
    if (s.pendingReaction) {
      rec.reactions++;
      runDuel(startReaction(s));
      if (s.pendingDirect) continue;
    }
    doAction(plan.action);
    if (s.pendingDirect) continue;
    if (s.activation && s.activation.bonus && a.name !== 'aleatorio') {
      doAction(bonusAction(s, a.name === 'craque' ? 'veterano' : a.name));
      if (s.pendingDirect) continue;
    }
    if (s.activation) endActivation(s);
    scan();
  }
  scan();
  rec.score = { ...s.score };
  rec.winner = s.winner ?? '';
  return rec;
}

const [aName, bName, nStr, seedStr, out, ablation] = process.argv.slice(2);
// "veterano:pressao" = agente Veterano jogando no estilo Pressão alta.
function withStyle(full: string): Agent {
  const [name, style, opt] = full.split(':');
  // ":sem" = sem características; ":t=pivoCostas,pulmao" = só estas.
  const only = opt?.startsWith('t=') ? (opt.slice(2).split(',') as Trait[]) : undefined;
  return { ...agent(name as AgentName), style: (style ?? 'equilibrio') as Style, label: full, traits: opt !== 'sem' && !!style, only };
}

/** Coloca as características pedidas no primeiro atleta livre da posição (o Pulmão vai num ala). */
function placeTraits(s: GameState, team: Team, list: Trait[]): { playerId: string; trait: Trait }[] {
  const out: { playerId: string; trait: Trait }[] = [];
  for (const tr of list) {
    const p = s.players
      .filter((q) => q.team === team && traitFits(tr, q.role) && !out.some((o) => o.playerId === q.id))
      .sort((a, b) => (a.role === 'ala' ? 0 : 1) - (b.role === 'ala' ? 0 : 1))[0];
    if (p) out.push({ playerId: p.id, trait: tr });
  }
  return out;
}
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
  const A = withStyle(swap ? bName : aName);
  const B = withStyle(swap ? aName : bName);
  res.push(playMatch(base + i * 13, A, B));
}
writeFileSync(out, JSON.stringify({ a: aName, b: bName, n, ms: Date.now() - t0, games: res }));
console.log(`${aName} x ${bName}: ${n} partidas em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
