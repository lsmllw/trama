// Desenho do tabuleiro em canvas. Protótipo cinza: formas simples, sem sprites.

import { CLASSES, strikeCountdown } from '../core';
import type { GameEvent, GameState, Pos, Terrain, Unit } from '../core';

export const TILE = 48;

const TEAM_COLOR = { azul: '#3d7be0', vermelho: '#d4483b' } as const;
const TEAM_DARK = { azul: '#1f3f73', vermelho: '#6e231c' } as const;

const TERRAIN_FILL: Record<Terrain, string> = {
  planicie: '#3a3d44',
  floresta: '#2e3f34',
  colina: '#4a463f',
  ruina: '#3f3f42',
  lama: '#463d33',
  agua: '#1f3247',
  ponte: '#55473a',
  no_verde: '#3a3d44',
  no_roxo: '#3a3d44',
  no_laranja: '#3a3d44',
  fonte: '#3d4148',
  base: '#3a3d44',
};

export interface Highlights {
  moves: Pos[];
  targets: Pos[];
  heals: Pos[];
  areaRange: Pos[];
  areaPreview: Pos[];
  selectedId: string | null;
  activeId: string | null;
  hover: Pos | null;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
}
interface Flash {
  cells: Pos[];
  t0: number;
}
interface Shot {
  from: Pos;
  to: Pos;
  t0: number;
}

export interface MoveAnim {
  unitId: string;
  path: Pos[];
  t0: number;
  stepMs: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private floats: FloatText[] = [];
  private flashes: Flash[] = [];
  private shots: Shot[] = [];
  anim: MoveAnim | null = null;

  constructor(readonly canvas: HTMLCanvasElement, s: GameState) {
    canvas.width = s.width * TILE;
    canvas.height = s.height * TILE;
    this.ctx = canvas.getContext('2d')!;
  }

  pushEvents(events: GameEvent[], now: number): void {
    for (const e of events) {
      if (e.kind === 'dano') this.floats.push({ x: e.x, y: e.y, text: `-${e.amount}`, color: '#ffb4a8', t0: now });
      else if (e.kind === 'cura') this.floats.push({ x: e.x, y: e.y, text: `+${e.amount}`, color: '#9ff0a8', t0: now });
      else if (e.kind === 'abate') this.floats.push({ x: e.x, y: e.y, text: 'abatido', color: '#ffffff', t0: now + 150 });
      else if (e.kind === 'impacto') this.flashes.push({ cells: e.cells, t0: now });
      else if (e.kind === 'tiro') this.shots.push({ from: e.from, to: e.to, t0: now });
    }
  }

  /** Posição desenhada da unidade (interpolada durante a animação de movimento). */
  private drawPos(u: Unit, now: number): { x: number; y: number } {
    const a = this.anim;
    if (!a || a.unitId !== u.id || a.path.length < 2) return { x: u.x, y: u.y };
    const t = Math.max(0, (now - a.t0) / a.stepMs);
    const i = Math.floor(t);
    if (i >= a.path.length - 1) return { x: u.x, y: u.y };
    const f = t - i;
    const p = a.path[i];
    const q = a.path[i + 1];
    return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f };
  }

  draw(s: GameState, h: Highlights, now: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawTerrain(s);
    this.drawBases(s);

    const fillCells = (cells: Pos[], color: string) => {
      ctx.fillStyle = color;
      for (const c of cells) ctx.fillRect(c.x * TILE + 1, c.y * TILE + 1, TILE - 2, TILE - 2);
    };
    fillCells(h.areaRange, 'rgba(255, 170, 60, 0.10)');
    fillCells(h.moves, 'rgba(90, 160, 255, 0.30)');
    fillCells(h.heals, 'rgba(110, 230, 140, 0.30)');
    fillCells(h.areaPreview, 'rgba(255, 150, 40, 0.45)');
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 90, 80, 0.95)';
    for (const c of h.targets) ctx.strokeRect(c.x * TILE + 3, c.y * TILE + 3, TILE - 6, TILE - 6);

    this.drawStrikes(s, now);

    for (const u of s.units) if (u.alive) this.drawUnit(u, h, now);

    if (h.hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(h.hover.x * TILE + 0.5, h.hover.y * TILE + 0.5, TILE - 1, TILE - 1);
    }

    this.drawEffects(now);
  }

  private drawTerrain(s: GameState): void {
    const ctx = this.ctx;
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const t = s.terrain[y][x];
        const px = x * TILE;
        const py = y * TILE;
        ctx.fillStyle = TERRAIN_FILL[t];
        ctx.fillRect(px, py, TILE, TILE);
        this.drawTerrainMark(t, px, py);
      }
    }
    // Grade sutil.
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= s.width; x++) {
      ctx.moveTo(x * TILE + 0.5, 0);
      ctx.lineTo(x * TILE + 0.5, s.height * TILE);
    }
    for (let y = 0; y <= s.height; y++) {
      ctx.moveTo(0, y * TILE + 0.5);
      ctx.lineTo(s.width * TILE, y * TILE + 0.5);
    }
    ctx.stroke();
  }

  private drawTerrainMark(t: Terrain, px: number, py: number): void {
    const ctx = this.ctx;
    const cx = px + TILE / 2;
    const cy = py + TILE / 2;
    switch (t) {
      case 'floresta':
        ctx.fillStyle = '#3f5a46';
        for (const [dx, dy] of [
          [-10, 4],
          [8, -4],
          [2, 10],
        ]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx, cy + dy - 10);
          ctx.lineTo(cx + dx - 7, cy + dy + 5);
          ctx.lineTo(cx + dx + 7, cy + dy + 5);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case 'colina':
        ctx.strokeStyle = '#6a6458';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy + 12, 16, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy + 20, 12, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
        break;
      case 'ruina':
        ctx.fillStyle = '#58585c';
        ctx.fillRect(cx - 14, cy - 2, 10, 12);
        ctx.fillRect(cx + 2, cy - 10, 12, 20);
        break;
      case 'agua':
        ctx.strokeStyle = '#33506e';
        ctx.lineWidth = 1.5;
        for (const dy of [-8, 6]) {
          ctx.beginPath();
          ctx.moveTo(px + 8, cy + dy);
          ctx.quadraticCurveTo(px + 16, cy + dy - 4, px + 24, cy + dy);
          ctx.quadraticCurveTo(px + 32, cy + dy + 4, px + 40, cy + dy);
          ctx.stroke();
        }
        break;
      case 'ponte':
        ctx.strokeStyle = '#6f5d4b';
        ctx.lineWidth = 2;
        for (let i = 6; i < TILE; i += 9) {
          ctx.beginPath();
          ctx.moveTo(px + 4, py + i);
          ctx.lineTo(px + TILE - 4, py + i);
          ctx.stroke();
        }
        break;
      case 'no_verde':
        ctx.fillStyle = 'rgba(90, 200, 110, 0.35)';
        ctx.beginPath();
        ctx.arc(cx, cy, 7, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'no_roxo':
        ctx.fillStyle = 'rgba(170, 110, 230, 0.35)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx + 8, cy);
        ctx.lineTo(cx, cy + 8);
        ctx.lineTo(cx - 8, cy);
        ctx.closePath();
        ctx.fill();
        break;
      case 'no_laranja':
        ctx.fillStyle = 'rgba(240, 150, 60, 0.35)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 8);
        ctx.lineTo(cx + 8, cy + 7);
        ctx.lineTo(cx - 8, cy + 7);
        ctx.closePath();
        ctx.fill();
        break;
      case 'fonte':
        ctx.strokeStyle = 'rgba(220, 220, 255, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px + 10, py + 10, TILE - 20, TILE - 20);
        break;
      default:
        break;
    }
  }

  private drawBases(s: GameState): void {
    const ctx = this.ctx;
    for (const b of [s.bases.azul, s.bases.vermelho]) {
      const px = b.x * TILE;
      const py = b.y * TILE;
      ctx.fillStyle = b.hp > 0 ? TEAM_DARK[b.team] : '#2a2a2a';
      ctx.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
      ctx.strokeStyle = TEAM_COLOR[b.team];
      ctx.lineWidth = 3;
      ctx.strokeRect(px + 4.5, py + 4.5, TILE - 9, TILE - 9);
      ctx.fillStyle = '#f2ead8';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('QG', px + TILE / 2, py + TILE / 2 - 4);
      this.bar(px + 7, py + TILE - 12, TILE - 14, 5, b.hp / b.maxHp, '#7fd36b');
    }
  }

  private drawStrikes(s: GameState, now: number): void {
    const ctx = this.ctx;
    const blink = 0.35 + 0.25 * Math.sin(now / 160);
    for (const st of s.strikes) {
      ctx.fillStyle = st.team === 'azul' ? `rgba(80,140,255,${blink})` : `rgba(255,80,60,${blink})`;
      for (const c of st.cells) ctx.fillRect(c.x * TILE + 2, c.y * TILE + 2, TILE - 4, TILE - 4);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(strikeCountdown(s, st.resolveAt)), st.cx * TILE + TILE / 2, st.cy * TILE + TILE / 2);
    }
  }

  private drawUnit(u: Unit, h: Highlights, now: number): void {
    const ctx = this.ctx;
    const def = CLASSES[u.cls];
    const p = this.drawPos(u, now);
    const px = p.x * TILE;
    const py = p.y * TILE;
    const inset = 6;
    const dim = u.activated && h.activeId !== u.id;

    ctx.globalAlpha = dim ? 0.5 : 1;
    ctx.fillStyle = TEAM_COLOR[u.team];
    roundRect(ctx, px + inset, py + inset, TILE - inset * 2, TILE - inset * 2 - 6, 6);
    ctx.fill();
    // Borda pela categoria de peso.
    ctx.lineWidth = def.weight === 'leve' ? 1 : def.weight === 'medio' ? 2.5 : 4;
    ctx.strokeStyle = '#ece4cf';
    ctx.stroke();

    // Para onde está virada.
    const f = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[u.facing];
    const cx = px + TILE / 2;
    const cy = py + TILE / 2 - 3;
    ctx.fillStyle = '#ece4cf';
    ctx.beginPath();
    const tipX = cx + f[0] * 19;
    const tipY = cy + f[1] * 16;
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(cx + f[0] * 13 - f[1] * 5, cy + f[1] * 11 - f[0] * 5);
    ctx.lineTo(cx + f[0] * 13 + f[1] * 5, cy + f[1] * 11 + f[0] * 5);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.abbr, cx, cy);

    if (u.ready) {
      ctx.fillStyle = '#ffd25a';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('!', px + TILE - 9, py + 9);
    }

    this.bar(px + 5, py + TILE - 10, TILE - 10, 4, u.hp / def.hp, '#7fd36b');
    this.bar(px + 5, py + TILE - 5, TILE - 10, 2, u.stamina / def.stamina, '#e8c547');
    ctx.globalAlpha = 1;

    if (h.activeId === u.id || h.selectedId === u.id) {
      ctx.strokeStyle = h.activeId === u.id ? '#ffd25a' : 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
    }
  }

  private bar(x: number, y: number, w: number, hgt: number, frac: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, hgt);
    const f = Math.max(0, Math.min(1, frac));
    ctx.fillStyle = f > 0.5 ? color : f > 0.25 ? '#e0b04a' : '#e05a4a';
    if (color !== '#7fd36b') ctx.fillStyle = color;
    ctx.fillRect(x, y, w * f, hgt);
  }

  private drawEffects(now: number): void {
    const ctx = this.ctx;
    this.flashes = this.flashes.filter((f) => now - f.t0 < 500);
    for (const f of this.flashes) {
      const a = 1 - (now - f.t0) / 500;
      ctx.fillStyle = `rgba(255, 190, 90, ${0.6 * a})`;
      for (const c of f.cells) ctx.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
    }
    this.shots = this.shots.filter((sh) => now - sh.t0 < 350);
    for (const sh of this.shots) {
      const a = 1 - (now - sh.t0) / 350;
      ctx.strokeStyle = `rgba(255, 240, 200, ${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sh.from.x * TILE + TILE / 2, sh.from.y * TILE + TILE / 2);
      ctx.lineTo(sh.to.x * TILE + TILE / 2, sh.to.y * TILE + TILE / 2);
      ctx.stroke();
    }
    this.floats = this.floats.filter((fl) => now - fl.t0 < 1100);
    for (const fl of this.floats) {
      const t = (now - fl.t0) / 1100;
      if (t < 0) continue;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = fl.color;
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      const x = fl.x * TILE + TILE / 2;
      const y = fl.y * TILE + 10 - t * 26;
      ctx.strokeText(fl.text, x, y);
      ctx.fillText(fl.text, x, y);
      ctx.globalAlpha = 1;
    }
  }

  cellAt(clientX: number, clientY: number, s: GameState): Pos | null {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - r.left) / r.width) * s.width);
    const y = Math.floor(((clientY - r.top) / r.height) * s.height);
    if (x < 0 || y < 0 || x >= s.width || y >= s.height) return null;
    return { x, y };
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

