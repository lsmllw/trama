// Relatório de balanceamento por simulação IA × IA (Veterano × Veterano).
// Uso: npm run balance -- [partidas_aleatorias=1500] [partidas_por_par=30]
//
// Parte 1: times sorteados → taxa de vitória dos times que tinham cada classe.
// Parte 2: arquétipos fixos se enfrentando, trocando de lado → matriz de vitórias.

declare const process: { argv: string[] };

import { CLASS_IDS, CLASSES, createGame, nextRandom, simulateGame } from '../src/core';
import type { ClassId, GameState, Team } from '../src/core';

const randomGames = Number(process.argv[2] ?? 1500);
const perPair = Number(process.argv[3] ?? 30);
const opts = { difficulty: { azul: 'veterano', vermelho: 'veterano' } as const };

const ARCHETYPES: Record<string, ClassId[]> = {
  Blindados: ['blindado', 'blindado', 'atirador', 'medico', 'tank'],
  Cavalaria: ['cavaleiro', 'cavaleiro', 'blindado', 'espadachim', 'medico'],
  Infantaria: ['tank', 'espadachim', 'espadachim', 'atirador', 'atirador'],
  Artilharia: ['canhao', 'morteiro', 'tank', 'atirador', 'medico'],
  Engenharia: ['bombardeiro', 'bombardeiro', 'mecanico', 'construtor', 'tank'],
  Equilibrado: ['tank', 'espadachim', 'cavaleiro', 'atirador', 'medico'],
  Infiltração: ['espiao', 'espiao', 'espadachim', 'cavaleiro', 'medico'],
  Antiblindado: ['bombardeiro', 'bombardeiro', 'atirador', 'tank', 'espadachim'],
};

function randomComp(state: { rng: number }): ClassId[] {
  const comp: ClassId[] = [];
  while (comp.length < 5) {
    const c = CLASS_IDS[Math.floor(nextRandom(state) * CLASS_IDS.length)];
    if (comp.filter((x) => x === c).length < 2) comp.push(c);
  }
  return comp;
}

function play(azul: ClassId[], vermelho: ClassId[], seed: number): GameState {
  return simulateGame(createGame({ azul, vermelho, seed }), opts);
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');

// ---------- Parte 1 ----------
const classGames: Record<string, number> = {};
const classWins: Record<string, number> = {};
let sideWins = { azul: 0, vermelho: 0, empate: 0 };
let rounds = 0;
const picker = { rng: 777 };
for (let i = 0; i < randomGames; i++) {
  const azul = randomComp(picker);
  const vermelho = randomComp(picker);
  const s = play(azul, vermelho, 50_000 + i);
  sideWins[s.winner!]++;
  rounds += s.round;
  for (const team of ['azul', 'vermelho'] as Team[]) {
    for (const c of new Set(team === 'azul' ? azul : vermelho)) {
      classGames[c] = (classGames[c] ?? 0) + 1;
      if (s.winner === team) classWins[c] = (classWins[c] ?? 0) + 1;
      else if (s.winner === 'empate') classWins[c] = (classWins[c] ?? 0) + 0.5;
    }
  }
}
console.log(`\n== Times sorteados: ${randomGames} partidas ==`);
console.log(`Azul ${pct(sideWins.azul, randomGames)} · Vermelho ${pct(sideWins.vermelho, randomGames)} · Empate ${pct(sideWins.empate, randomGames)} · ${(rounds / randomGames).toFixed(1)} rodadas em média`);
const rate = (c: ClassId) => (classWins[c] ?? 0) / classGames[c];
for (const c of [...CLASS_IDS].sort((a, b) => rate(b) - rate(a))) {
  const r = rate(c);
  const flag = r > 0.55 ? '  ▲ forte' : r < 0.45 ? '  ▼ fraca' : '';
  console.log(`  ${CLASSES[c].name.padEnd(12)} ${pct(classWins[c] ?? 0, classGames[c]).padStart(6)}${flag}`);
}

// ---------- Parte 2 ----------
const names = Object.keys(ARCHETYPES);
const total: Record<string, { w: number; n: number }> = Object.fromEntries(names.map((n) => [n, { w: 0, n: 0 }]));
const matrix: Record<string, Record<string, number>> = {};
let seed = 90_000;
for (let i = 0; i < names.length; i++) {
  for (let j = i + 1; j < names.length; j++) {
    const a = names[i];
    const b = names[j];
    let aw = 0;
    for (let k = 0; k < perPair; k++) {
      const aBlue = k % 2 === 0;
      const s = play(aBlue ? ARCHETYPES[a] : ARCHETYPES[b], aBlue ? ARCHETYPES[b] : ARCHETYPES[a], seed++);
      const aTeam: Team = aBlue ? 'azul' : 'vermelho';
      aw += s.winner === aTeam ? 1 : s.winner === 'empate' ? 0.5 : 0;
    }
    (matrix[a] ??= {})[b] = aw / perPair;
    (matrix[b] ??= {})[a] = 1 - aw / perPair;
    total[a].w += aw;
    total[a].n += perPair;
    total[b].w += perPair - aw;
    total[b].n += perPair;
  }
}
console.log(`\n== Arquétipos: ${perPair} partidas por par, trocando de lado ==`);
const short = (n: string) => n.slice(0, 5);
console.log(`${''.padEnd(13)}${names.map((n) => short(n).padStart(7)).join('')}   total`);
for (const a of names) {
  const row = names.map((b) => (a === b ? '·' : `${Math.round(matrix[a][b] * 100)}%`).padStart(7)).join('');
  console.log(`${a.padEnd(13)}${row}   ${pct(total[a].w, total[a].n)}`);
}
console.log('  (linha vence coluna)');
for (const [n, comp] of Object.entries(ARCHETYPES)) console.log(`  ${n}: ${comp.map((c) => CLASSES[c].name).join(', ')}`);
