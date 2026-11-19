// Símbolos das classes: um desenho vetorial por classe, numa caixa de 24×24.
// A mesma definição serve ao canvas (Path2D) e aos cards e janelas (SVG).

import type { ClassId } from '../core';

export interface IconDef {
  /** Partes preenchidas. */
  fill?: string;
  /** Partes em traço (linha de 2,2 com pontas redondas). */
  stroke?: string;
}

export const CLASS_ICONS: Record<ClassId, IconDef> = {
  // Espada na diagonal com guarda e punho.
  espadachim: { stroke: 'M7.5 16.5 L20 4 M5.5 12.5 L11.5 18.5 M3.5 20.5 L7.5 16.5', fill: 'M20.8 3.2 L21 7 L17.5 6.5 Z' },
  // Mira.
  atirador: { stroke: 'M18.5 12 A6.5 6.5 0 1 1 5.5 12 A6.5 6.5 0 1 1 18.5 12 Z M12 2.5 V8 M12 16 V21.5 M2.5 12 H8 M16 12 H21.5' },
  // Escudo.
  tank: { fill: 'M12 2.5 L19.5 5.5 V11 C19.5 16 16.3 19.6 12 21.5 C7.7 19.6 4.5 16 4.5 11 V5.5 Z' },
  // Ferradura.
  cavaleiro: { stroke: 'M6.5 20 V11 A5.5 5.5 0 0 1 17.5 11 V20 M4.5 20 H8.5 M15.5 20 H19.5' },
  // Blindado: casco, torre e esteira.
  blindado: { fill: 'M3 13 H21 V16.5 H3 Z M7 9 H15 V13 H7 Z M15 10 H21.5 V11.6 H15 Z M4 17.5 H20 A2 2 0 0 1 20 21 H4 A2 2 0 0 1 4 17.5 Z' },
  // Morteiro: tubo inclinado, base e a trajetória em arco.
  morteiro: { fill: 'M6 16.5 L12.5 7.5 L16 10 L9.5 19 Z M3 19.5 H14 V21.5 H3 Z M19 4 A2 2 0 1 1 23 4 A2 2 0 1 1 19 4 Z', stroke: 'M14.5 6 Q16 3 18.5 3.5' },
  // Canhão: cano sobre a roda.
  canhao: { fill: 'M3.5 12.5 L17.5 7 L19 10.8 L5 16.3 Z', stroke: 'M12.5 17.5 A3.2 3.2 0 1 1 6.1 17.5 A3.2 3.2 0 1 1 12.5 17.5 Z' },
  // Bomba com pavio aceso.
  bombardeiro: { fill: 'M16 14.5 A6 6 0 1 1 4 14.5 A6 6 0 1 1 16 14.5 Z', stroke: 'M13.5 9.5 Q15.5 5.5 18.5 5 M19.5 2.5 V3.8 M21.5 5 H20.2 M21 3 L20 4' },
  // Chave inglesa.
  mecanico: { fill: 'M15 2.5 A5.5 5.5 0 0 0 10 10 L3.5 16.5 A2.3 2.3 0 0 0 7 20 L13.5 13.5 A5.5 5.5 0 0 0 21 8.5 L17.6 11 L14.6 10.3 L13.6 7.4 L16.6 3 A5.5 5.5 0 0 0 15 2.5 Z' },
  // Muro de tijolos.
  construtor: { stroke: 'M3.5 6.5 H20.5 V19.5 H3.5 Z M3.5 13 H20.5 M9.5 6.5 V13 M15.5 6.5 V13 M6.5 13 V19.5 M12.5 13 V19.5 M18 13 V19.5' },
  // Cruz.
  medico: { fill: 'M9.5 3.5 H14.5 V9.5 H20.5 V14.5 H14.5 V20.5 H9.5 V14.5 H3.5 V9.5 H9.5 Z' },
  // Olho.
  espiao: { stroke: 'M2.5 12 Q12 3.5 21.5 12 Q12 20.5 2.5 12 Z', fill: 'M14.8 12 A2.8 2.8 0 1 1 9.2 12 A2.8 2.8 0 1 1 14.8 12 Z' },
};

const cache = new Map<string, Path2D>();
const path = (d: string) => {
  let p = cache.get(d);
  if (!p) {
    p = new Path2D(d);
    cache.set(d, p);
  }
  return p;
};

/** Desenha o símbolo centrado em (cx, cy), com `size` pixels de lado. */
export function drawClassIcon(ctx: CanvasRenderingContext2D, cls: ClassId, cx: number, cy: number, size: number, color: string): void {
  const icon = CLASS_ICONS[cls];
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (icon.fill) ctx.fill(path(icon.fill));
  if (icon.stroke) ctx.stroke(path(icon.stroke));
  ctx.restore();
}

/** O mesmo símbolo como SVG, para os elementos da página. */
export function classIconSvg(cls: ClassId, size = 16, color = 'currentColor'): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  const icon = CLASS_ICONS[cls];
  if (icon.fill) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', icon.fill);
    p.setAttribute('fill', color);
    svg.append(p);
  }
  if (icon.stroke) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', icon.stroke);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', '2.3');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.append(p);
  }
  return svg;
}
