// Partidas de IA contra IA: placar médio, gols, faltas e tempo de cálculo.
import { simulateGame } from '../src/core';

declare const process: { argv: string[] };
const n = Number(process.argv[2] ?? 20);
let goals = 0;
let azul = 0;
let verm = 0;
let emp = 0;
let fouls = 0;
const t0 = Date.now();
const scores: string[] = [];
for (let i = 0; i < n; i++) {
  const s = simulateGame(1000 + i * 7);
  goals += s.score.azul + s.score.vermelho;
  if (s.winner === 'azul') azul++;
  else if (s.winner === 'vermelho') verm++;
  else emp++;
  fouls += s.log.filter((l) => l.startsWith('Falta')).length;
  scores.push(`${s.score.azul}x${s.score.vermelho}`);
}
console.log(`${n} partidas em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`Azul ${azul} · Vermelho ${verm} · Empates ${emp}`);
console.log(`Gols por partida: ${(goals / n).toFixed(2)} · Faltas por partida: ${(fouls / n).toFixed(1)}`);
console.log(scores.join(' '));
