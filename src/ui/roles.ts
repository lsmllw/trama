// Símbolo de cada posição: forma e cor próprias (diferentes das cores dos times).

import type { Role } from '../core';
import { h } from './dom';

export type BadgeShape = 'diamond' | 'square' | 'triangle' | 'circle';

export const ROLE_BADGE: Record<Role, { color: string; shape: BadgeShape; glyph: string; short: string }> = {
  goleiro: { color: '#ffd23f', shape: 'diamond', glyph: '◆', short: 'GOL' },
  fixo: { color: '#3fd6c8', shape: 'square', glyph: '■', short: 'FIX' },
  ala: { color: '#8ae65a', shape: 'triangle', glyph: '▲', short: 'ALA' },
  pivo: { color: '#ff8a3d', shape: 'circle', glyph: '●', short: 'PIV' },
};

/** Símbolo em HTML; com `label`, mostra também a sigla da posição. */
export function roleBadge(role: Role, label = false): HTMLElement {
  const b = ROLE_BADGE[role];
  return h('span', { class: `role-badge${label ? ' with-label' : ''}`, style: `--rc:${b.color}`, title: b.short }, h('i', {}, b.glyph), label ? b.short : null);
}

/** Desenha o símbolo na quadra, centrado em (x, y), com contorno escuro. */
export function drawRoleBadge(ctx: CanvasRenderingContext2D, role: Role, x: number, y: number, r: number): void {
  const b = ROLE_BADGE[role];
  ctx.save();
  ctx.beginPath();
  switch (b.shape) {
    case 'diamond':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      break;
    case 'square':
      ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      break;
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
      break;
    case 'circle':
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      break;
  }
  ctx.closePath();
  ctx.fillStyle = b.color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#120e16';
  ctx.stroke();
  ctx.restore();
}
