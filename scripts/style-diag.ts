// Diagnóstico de um confronto de estilos: posse, recuperações, gols em contra-ataque.
// Uso: npx tsx scripts/style-diag.ts <estiloA> <estiloB> <partidas>
import {
  createGame,
  endPhase,
  newMemory,
  planActivation,
  playActivation,
  takeDirectKick,
  chooseCorner,
  chooseDive,
  shotPreview,
  getPlayer,
  holderOf,
} from '../src/core';
import type { Style, Team } from '../src/core';
declare const process: { argv: string[] };
const [A, B, nStr] = process.argv.slice(2);
const n = Number(nStr ?? 20);
type St = Record<string, number>;
const acc: Record<string, St> = {};
const add = (k: string, f: string, v = 1) => ((acc[k] ??= {}), (acc[k][f] = (acc[k][f] ?? 0) + v));
for (let i = 0; i < n; i++) {
  const swap = i % 2 === 1;
  const st: Record<Team, Style> = { azul: (swap ? B : A) as Style, vermelho: (swap ? A : B) as Style };
  const s = createGame({ seed: 500 + i * 17, styles: st });
  const mem = newMemory();
  let guard = 0;
  let lastPhase = -1;
  while (!s.over && guard++ < 3000) {
    if (s.pendingDirect) {
      add(st[getPlayer(s, s.pendingDirect).team], 'tlDireto');
      takeDirectKick(s, chooseCorner(s, shotPreview(s, getPlayer(s, s.pendingDirect), false, true)), chooseDive(s));
      continue;
    }
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      const k = st[s.activeTeam];
      if (s.phaseWithBall) add(k, 'fasesComBola');
      if (s.counterPhase) add(k, 'fasesContra');
    }
    const team = s.activeTeam;
    const k = st[team];
    const before = { ...s.score };
    const holderBefore = holderOf(s).team;
    const cp = s.counterPhase;
    const plan = planActivation(s, 'veterano');
    if (!plan) {
      endPhase(s);
      continue;
    }
    playActivation(s, plan, mem, () => 'veterano');
    if (plan.action?.kind === 'chute') add(k, 'chutes');
    if (s.score[team] > before[team]) {
      add(k, 'gols');
      if (cp) add(k, 'golsContra');
    }
    const ot: Team = team === 'azul' ? 'vermelho' : 'azul';
    if (s.score[ot] > before[ot]) add(st[ot], 'golsNaFaseDoOutro');
    if (holderBefore !== team && !s.over && holderOf(s).team === team) add(k, 'recuperou');
    if (holderBefore === team && !s.over && holderOf(s).team !== team) add(k, 'perdeu');
  }
  add(st.azul, 'jogos');
  add(st.vermelho, 'jogos');
  add(st.azul, 'pontos', s.winner === 'azul' ? 1 : s.winner === 'empate' ? 0.5 : 0);
  add(st.vermelho, 'pontos', s.winner === 'vermelho' ? 1 : s.winner === 'empate' ? 0.5 : 0);
}
for (const [k, v] of Object.entries(acc)) {
  const g = v.jogos;
  console.log(
    k.padEnd(11),
    Object.entries(v)
      .filter(([f]) => f !== 'jogos')
      .map(([f, x]) => `${f} ${(x / g).toFixed(2)}`)
      .join(' · '),
  );
}
