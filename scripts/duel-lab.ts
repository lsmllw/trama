// Laboratório do Duelo: quanto a escolha dos lances muda o resultado?
// Compara IA (prevê pela memória) × escolha ao acaso, por par de posições, e calcula
// o equilíbrio de cada tempo (jogo de soma zero sobre a vantagem).
// Uso: npx tsx scripts/duel-lab.ts <n> <saida.json>

import {
  applyDuel,
  beginActivation,
  canPlay,
  chooseLance,
  clash,
  createGame,
  LANCES,
  newMemory,
  nextRandom,
  resolveTempo,
  ROLES,
  startDribble,
  startTackle,
} from '../src/core';
import type { DuelState, GameState, Lance, LanceMemory, Role, SideKey, Weight } from '../src/core';
// @ts-expect-error tipos do Node não estão instalados neste projeto
import { writeFileSync } from 'node:fs';

declare const process: { argv: string[] };
type Pol = 'ia' | 'acaso';

function setup(ballRole: Role, markRole: Role, kind: 'drible' | 'desarme', seed: number): { s: GameState; cs: DuelState } {
  const s = createGame({ seed });
  s.players.forEach((p, i) => {
    p.x = -10 - i;
    p.y = -10;
  });
  const ball = s.players.find((p) => p.team === 'azul' && p.role === ballRole)!;
  const mark = s.players.find((p) => p.team === 'vermelho' && p.role === markRole)!;
  ball.x = 8;
  ball.y = 4;
  mark.x = 9;
  mark.y = 4;
  s.holder = ball.id;
  s.drinks = [];
  s.events = [];
  if (kind === 'drible') {
    s.activeTeam = 'azul';
    beginActivation(s, ball.id);
    return { s, cs: startDribble(s, mark.id) };
  }
  s.activeTeam = 'vermelho';
  beginActivation(s, mark.id);
  return { s, cs: startTackle(s, ball.id) };
}

function pickLance(s: GameState, cs: DuelState, k: SideKey, pol: Pol, mem: LanceMemory): Lance {
  if (pol === 'ia') return chooseLance(s, cs, k, mem, null, 'veterano');
  const ok = LANCES.filter((l) => canPlay(s, cs, k, l));
  return ok[Math.floor(nextRandom(s) * ok.length)];
}

const n = Number(process.argv[2] ?? 1000);
const out = process.argv[3] ?? '/tmp/study/duel.json';
const roles: Role[] = ['fixo', 'ala', 'pivo'];
const pols: [Pol, Pol][] = [
  ['ia', 'ia'],
  ['ia', 'acaso'],
  ['acaso', 'ia'],
  ['acaso', 'acaso'],
];
const rows: unknown[] = [];
for (const kind of ['drible', 'desarme'] as const) {
  for (const br of roles) {
    for (const mr of roles) {
      for (const [bp, mp] of pols) {
        const count: Record<string, number> = { passou: 0, manteve: 0, roubou: 0, falta: 0 };
        // Memória que cada lado tem dos lances do outro (aprende ao longo dos duelos, como numa partida).
        const memOfBall = newMemory();
        const memOfMark = newMemory();
        for (let i = 0; i < n; i++) {
          const { s, cs } = setup(br, mr, kind, 1 + i);
          const ballSide = cs.ball;
          const markSide: SideKey = ballSide === 'atk' ? 'def' : 'atk';
          while (!cs.done) {
            const lb = pickLance(s, cs, ballSide, bp, memOfMark);
            const lm = pickLance(s, cs, markSide, mp, memOfBall);
            memOfBall[lb]++;
            memOfMark[lm]++;
            resolveTempo(s, cs, ballSide === 'atk' ? lb : lm, ballSide === 'atk' ? lm : lb);
          }
          count[String(applyDuel(s, cs))]++;
        }
        rows.push({ kind, ball: br, mark: mr, ballPol: bp, markPol: mp, ...Object.fromEntries(Object.entries(count).map(([k, v]) => [k, v / n])) });
      }
    }
  }
}

// Equilíbrio de um tempo isolado (vantagem de quem tem a bola menos a de quem marca; falta conta como -2 para quem marca).
function equilibrium(wBall: Weight, wMark: Weight, ballIsAtk: boolean) {
  const M = LANCES.map((lb) =>
    LANCES.map((lm) => {
      const a = ballIsAtk ? lb : lm;
      const d = ballIsAtk ? lm : lb;
      const c = clash(a, d, ballIsAtk ? wBall : wMark, ballIsAtk ? wMark : wBall);
      const gb = ballIsAtk ? c.aGain : c.bGain;
      const gm = ballIsAtk ? c.bGain : c.aGain;
      let v = gb - gm;
      if (lm === 'golpe' && lb === 'guarda') v += 2;
      return v;
    }),
  );
  // Jogo fictício (converge para o equilíbrio em jogos de soma zero).
  const cb = [0, 0, 0, 0];
  const cm = [0, 0, 0, 0];
  let ib = 0;
  let im = 0;
  for (let t = 0; t < 200000; t++) {
    cb[ib]++;
    cm[im]++;
    const vb = M.map((row) => row.reduce((acc, v, j) => acc + v * cm[j], 0));
    const vm = LANCES.map((_, j) => M.reduce((acc, row, i) => acc + row[j] * cb[i], 0));
    ib = vb.indexOf(Math.max(...vb));
    im = vm.indexOf(Math.min(...vm));
  }
  const sb = cb.reduce((a, b) => a + b, 0);
  const sm = cm.reduce((a, b) => a + b, 0);
  const pb = cb.map((x) => x / sb);
  const pm = cm.map((x) => x / sm);
  let value = 0;
  M.forEach((row, i) => row.forEach((v, j) => (value += v * pb[i] * pm[j])));
  return { matrix: M, ball: Object.fromEntries(LANCES.map((l, i) => [l, +pb[i].toFixed(3)])), mark: Object.fromEntries(LANCES.map((l, i) => [l, +pm[i].toFixed(3)])), value: +value.toFixed(3) };
}

const eq = {
  leveXpesado: equilibrium(ROLES.ala.weight, ROLES.fixo.weight, true),
  pesadoXleve: equilibrium(ROLES.pivo.weight, ROLES.ala.weight, true),
  leveXleve: equilibrium(ROLES.ala.weight, ROLES.ala.weight, true),
  pesadoXpesado: equilibrium(ROLES.pivo.weight, ROLES.fixo.weight, true),
};
writeFileSync(out, JSON.stringify({ n, rows, eq }, null, 1));
console.log('ok', out);
