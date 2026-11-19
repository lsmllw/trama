// Simulação IA × IA sem tela, para balancear.
// Uso: npm run sim -- [partidas=500] [dificuldade=veterano]

declare const process: { argv: string[] };

import { CLASS_IDS, CLASSES, createGame, nextRandom, simulateGame } from '../src/core';
import type { ClassId, Difficulty, Team } from '../src/core';

const games = Number(process.argv[2] ?? 500);
const difficulty = (process.argv[3] ?? 'veterano') as Difficulty;

function randomComp(state: { rng: number }): ClassId[] {
  const comp: ClassId[] = [];
  while (comp.length < 5) {
    const c = CLASS_IDS[Math.floor(nextRandom(state) * CLASS_IDS.length)];
    if (comp.filter((x) => x === c).length < 2) comp.push(c);
  }
  return comp;
}

const wins: Record<string, number> = { azul: 0, vermelho: 0, empate: 0 };
const reasons: Record<string, number> = {};
const classGames: Record<string, number> = {};
const classWins: Record<string, number> = {};
let rounds = 0;
const picker = { rng: 12345 };

for (let i = 0; i < games; i++) {
  const azul = randomComp(picker);
  const vermelho = randomComp(picker);
  const s = createGame({ azul, vermelho, seed: 1000 + i });
  simulateGame(s, { difficulty: { azul: difficulty, vermelho: difficulty } });
  wins[s.winner!]++;
  const reason = s.winReason.startsWith('Fim da rodada') ? 'Pontos na rodada 20' : s.winReason;
  reasons[reason] = (reasons[reason] ?? 0) + 1;
  rounds += s.round;
  for (const team of ['azul', 'vermelho'] as Team[]) {
    const comp = team === 'azul' ? azul : vermelho;
    for (const c of new Set(comp)) {
      classGames[c] = (classGames[c] ?? 0) + 1;
      if (s.winner === team) classWins[c] = (classWins[c] ?? 0) + 1;
    }
  }
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
console.log(`Partidas: ${games} (${difficulty} × ${difficulty})`);
console.log(`Azul ${pct(wins.azul, games)} · Vermelho ${pct(wins.vermelho, games)} · Empate ${pct(wins.empate, games)}`);
console.log(`Rodadas em média: ${(rounds / games).toFixed(1)}`);
console.log('Como terminou:');
for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${pct(n, games).padStart(6)}  ${r}`);
console.log('Vitória dos times que tinham a classe:');
for (const c of [...CLASS_IDS].sort((a, b) => (classWins[b] ?? 0) / classGames[b] - (classWins[a] ?? 0) / classGames[a])) {
  console.log(`  ${CLASSES[c].name.padEnd(12)} ${pct(classWins[c] ?? 0, classGames[c]).padStart(6)}  (${classGames[c]} times)`);
}
