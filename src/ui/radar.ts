// Gráfico de radar (teia) com os atributos de um jogador, em SVG.

import { statsOf } from '../core';
import type { Player } from '../core';
import { ROLE_BADGE } from './roles';

const NS = 'http://www.w3.org/2000/svg';
const MAX = 7;

export const RADAR_AXES = [
  { key: 'mov', label: 'MOV', tip: 'Movimento' },
  { key: 'pas', label: 'PAS', tip: 'Passe' },
  { key: 'dom', label: 'DOM', tip: 'Domínio' },
  { key: 'hab', label: 'HAB', tip: 'Habilidade' },
  { key: 'fin', label: 'FIN', tip: 'Finalização' },
  { key: 'mar', label: 'MAR', tip: 'Marcação' },
  { key: 'ref', label: 'REF', tip: 'Reflexo' },
] as const;

export function radarValues(p: Player): number[] {
  const d = statsOf(p);
  return RADAR_AXES.map((a) => d[a.key] + (a.key === 'ref' && p.muralha ? 2 : 0));
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * Teia dos atributos (escala 0–7). Com `compare`, desenha também o contorno tracejado
 * de outro jogador por cima, para comparar (ex.: quem vai driblar × quem marca).
 */
export function radarChart(p: Player, teamColor: string, compare?: { player: Player; color: string }): SVGSVGElement {
  const size = 232;
  const c = size / 2;
  const R = 82;
  const n = RADAR_AXES.length;
  const svg = el('svg', { viewBox: `0 0 ${size} ${size - 12}`, width: size, height: size - 12, class: 'radar' });
  const ang = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / n;
  const pt = (i: number, v: number) => {
    const r = (Math.min(MAX, v) / MAX) * R;
    return [c + Math.cos(ang(i)) * r, c - 4 + Math.sin(ang(i)) * r];
  };
  const poly = (vals: number[]) =>
    vals
      .map((v, i) =>
        pt(i, v)
          .map((x) => x.toFixed(1))
          .join(','),
      )
      .join(' ');
  // Teia de fundo: anéis em 1..7 (o 5 mais forte) e os eixos.
  for (let ring = 1; ring <= MAX; ring++) {
    svg.append(el('polygon', { points: poly(Array(n).fill(ring)), class: `ring${ring === 5 ? ' mid' : ''}${ring === MAX ? ' outer' : ''}` }));
  }
  RADAR_AXES.forEach((_, i) => {
    const [x, y] = pt(i, MAX);
    svg.append(el('line', { x1: c, y1: c - 4, x2: x.toFixed(1), y2: y.toFixed(1), class: 'axis' }));
  });
  const vals = radarValues(p);
  const color = ROLE_BADGE[p.role].color;
  const shape = el('g', { class: 'shape', style: `transform-origin:${c}px ${c - 4}px` });
  shape.append(el('polygon', { points: poly(vals), fill: color, 'fill-opacity': 0.32, stroke: teamColor, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  vals.forEach((v, i) => {
    const [x, y] = pt(i, v);
    shape.append(el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 2.6, fill: '#fff', stroke: teamColor, 'stroke-width': 1.5 }));
  });
  svg.append(shape);
  if (compare) {
    svg.append(
      el('polygon', {
        points: poly(radarValues(compare.player)),
        fill: 'none',
        stroke: compare.color,
        'stroke-width': 1.6,
        'stroke-dasharray': '4 3',
        'stroke-linejoin': 'round',
        class: 'compare',
      }),
    );
  }
  // Rótulos com o valor de cada atributo.
  RADAR_AXES.forEach((a, i) => {
    const [x, y] = pt(i, MAX + 1.45);
    const t = el('text', { x: x.toFixed(1), y: y.toFixed(1), class: 'lbl', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    const name = el('tspan', {});
    name.textContent = `${a.label} `;
    const val = el('tspan', { class: 'val' });
    val.textContent = String(vals[i]);
    t.append(name, val);
    const title = el('title', {});
    title.textContent = `${a.tip}: ${vals[i]}${compare ? ` (${compare.player.name}: ${radarValues(compare.player)[i]})` : ''}`;
    t.append(title);
    svg.append(t);
  });
  return svg;
}
