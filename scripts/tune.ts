// Busca de balanceamento: aplica variações nos números e mede a dispersão.
// Uso: npm run tune  (lento: alguns minutos)
declare const process: { argv: string[] };
import { AI_WEIGHTS, ANTITANK, SIDE_BONUS, CLASH_TIE, CLASS_IDS, CLASSES, createGame, FORCA, nextRandom, simulateGame } from '../src/core';
import type { ClassId, Team } from '../src/core';

const ARCH: Record<string, ClassId[]> = {
  Blindados: ['blindado', 'blindado', 'atirador', 'medico', 'tank'],
  Cavalaria: ['cavaleiro', 'cavaleiro', 'blindado', 'espadachim', 'medico'],
  Infantaria: ['tank', 'espadachim', 'espadachim', 'atirador', 'atirador'],
  Artilharia: ['canhao', 'morteiro', 'tank', 'atirador', 'medico'],
  Engenharia: ['bombardeiro', 'bombardeiro', 'mecanico', 'construtor', 'tank'],
  Equilibrado: ['tank', 'espadachim', 'cavaleiro', 'atirador', 'medico'],
  Infiltração: ['espiao', 'espiao', 'espadachim', 'cavaleiro', 'medico'],
  Antiblindado: ['bombardeiro', 'bombardeiro', 'atirador', 'tank', 'espadachim'],
};
const opts = { difficulty: { azul: 'veterano', vermelho: 'veterano' } as const };

export function evaluate(randomGames = 500, perPair = 12) {
  const cg: Record<string, number> = {};
  const cw: Record<string, number> = {};
  const picker = { rng: 4242 };
  const comp = () => {
    const c: ClassId[] = [];
    while (c.length < 5) {
      const x = CLASS_IDS[Math.floor(nextRandom(picker) * CLASS_IDS.length)];
      if (c.filter((y) => y === x).length < 2) c.push(x);
    }
    return c;
  };
  let rounds = 0;
  for (let i = 0; i < randomGames; i++) {
    const a = comp();
    const b = comp();
    const s = simulateGame(createGame({ azul: a, vermelho: b, seed: 1e5 + i }), opts);
    rounds += s.round;
    for (const t of ['azul', 'vermelho'] as Team[])
      for (const c of new Set(t === 'azul' ? a : b)) {
        cg[c] = (cg[c] ?? 0) + 1;
        cw[c] = (cw[c] ?? 0) + (s.winner === t ? 1 : s.winner === 'empate' ? 0.5 : 0);
      }
  }
  const classRates = Object.fromEntries(CLASS_IDS.map((c) => [c, cw[c] / cg[c]]));
  const names = Object.keys(ARCH);
  const tot: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  let seed = 2e5;
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (let k = 0; k < perPair; k++) {
        const aBlue = k % 2 === 0;
        const s = simulateGame(createGame({ azul: ARCH[aBlue ? names[i] : names[j]], vermelho: ARCH[aBlue ? names[j] : names[i]], seed: seed++ }), opts);
        const aw = s.winner === (aBlue ? 'azul' : 'vermelho') ? 1 : s.winner === 'empate' ? 0.5 : 0;
        tot[names[i]] += aw;
        tot[names[j]] += 1 - aw;
      }
  const archRates = Object.fromEntries(names.map((n) => [n, tot[n] / ((names.length - 1) * perPair)]));
  const dev = (xs: number[]) => Math.max(...xs.map((x) => Math.abs(x - 0.5)));
  return { classRates, archRates, classDev: dev(Object.values(classRates)), archDev: dev(Object.values(archRates)), rounds: rounds / randomGames };
}

type Tweak = { name: string; apply: () => void };
const base = {
  forca: { ...FORCA },
  tie: { ...CLASH_TIE },
  antitank: { ...ANTITANK },
  side: { ...SIDE_BONUS },
  ai: { ...AI_WEIGHTS },
  stats: Object.fromEntries(CLASS_IDS.map((c) => [c, { ...CLASSES[c] }])),
};
function reset() {
  Object.assign(FORCA, base.forca);
  Object.assign(CLASH_TIE, base.tie);
  Object.assign(ANTITANK, base.antitank);
  Object.assign(SIDE_BONUS, base.side);
  Object.assign(AI_WEIGHTS, base.ai);
  for (const c of CLASS_IDS) Object.assign(CLASSES[c], base.stats[c]);
}

const C = CLASSES;
// Cada variação é aplicada sobre os valores atuais do jogo e depois desfeita.
// Edite a lista para testar ideias; a primeira linha é a referência.
const tweaks: Tweak[] = [
  { name: 'atual', apply: () => {} },
  { name: 'exemplo: Canhão ATQ 10', apply: () => { C.canhao.atq = 10; } },
  { name: 'exemplo: lados dão lances (regra antiga)', apply: () => { SIDE_BONUS.mode = 'lances'; } },
  { name: 'exemplo: IA sem medo de morrer', apply: () => { AI_WEIGHTS.deathRisk = 0; } },
];
const only = process.argv[2];
for (const t of tweaks) {
  if (only && !t.name.includes(only)) continue;
  reset();
  t.apply();
  const r = evaluate();
  const fmt = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}`).join(' · ');
  console.log(`\n## ${t.name}: desvio máx. classes ${(r.classDev * 100).toFixed(1)} pp, arquétipos ${(r.archDev * 100).toFixed(1)} pp, ${r.rounds.toFixed(1)} rodadas`);
  console.log('  classes:   ' + fmt(r.classRates));
  console.log('  arquétipos: ' + fmt(r.archRates));
}
