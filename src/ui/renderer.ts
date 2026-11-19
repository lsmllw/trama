// Desenho do tabuleiro em 2.5D, na vista girada da referência: o quadrado do mapa vira um
// losango inclinado, com a Base Azul perto da ponta esquerda e a Vermelha na ponta oposta.
// Colinas têm altura; árvores, torres das Bases e unidades ficam em pé, com sombra.
// Tudo que fica em pé é desenhado de trás para a frente (pela altura na tela).

import { CLASSES, strikeCountdown } from '../core';
import { drawClassIcon } from './icons';
import type { Dir, GameEvent, GameState, Pos, Team, Terrain, Unit } from '../core';

/**
 * Eixos da projeção (pixels por casa): andar +1 em x vai para a direita e um pouco para cima;
 * andar +1 em y vai para a direita e para baixo. Proporções tiradas do desenho de referência.
 */
const AX = 23;
const AY = -7.5;
const BX = 23;
const BY = 19;
const MARGIN = 14;
const MAX_ZOOM = 3;
/** Quanto o tabuleiro se desloca com o mouse quando não há zoom (pixels). */
const PARALLAX_BOARD = { x: 16, y: 10 };
/** Engrenagens do fundo: posição (fração da tela), raio e velocidade de giro. */
const BG_GEARS: [number, number, number, number][] = [
  [0.08, 0.14, 46, 0.00012],
  [0.17, 0.07, 26, -0.0002],
  [0.9, 0.12, 60, -0.0001],
  [0.97, 0.3, 30, 0.00018],
  [0.12, 0.88, 38, 0.00014],
  [0.86, 0.9, 50, -0.00011],
];
/** Espaço acima da ponta de cima para torres e unidades em pé. */
const HEADROOM = 50;

const TEAM_COLOR = { azul: '#3d7be0', vermelho: '#d4483b' } as const;
const TEAM_LIGHT = { azul: '#6fa2f0', vermelho: '#ea7b6f' } as const;
const TEAM_DARK = { azul: '#1f3f73', vermelho: '#6e231c' } as const;

const TERRAIN_FILL: Record<Terrain, string> = {
  planicie: '#4a4e57',
  floresta: '#34483b',
  colina: '#5e584d',
  ruina: '#4c4b4f',
  lama: '#544838',
  agua: '#22384f',
  ponte: '#5f4f3f',
  no_verde: '#4a4e57',
  no_roxo: '#4a4e57',
  no_laranja: '#4a4e57',
  fonte: '#535867',
  base: '#4a4e57',
};
const ELEVATION: Partial<Record<Terrain, number>> = { colina: 9 };
const NODE_COLOR = { verde: '#6fd58a', roxo: '#b88cf0', laranja: '#f0a050', prisma: '#e6e6ff' } as const;
const DIR_VEC: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export interface Highlights {
  /** Time do jogador: só as minas dele aparecem. */
  viewer: Team;
  abilityTargets: Pos[];
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

type Pt = { x: number; y: number };

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private floats: FloatText[] = [];
  private flashes: Flash[] = [];
  private shots: Shot[] = [];
  private ox: number;
  private oy: number;
  anim: MoveAnim | null = null;
  /** Câmera: zoom e deslocamento (pixels do canvas). */
  cam = { z: 1, tx: 0, ty: 0 };
  private zTarget = 1;
  /** Onde o cursor está no canvas (0–1), ou null fora dele; e a versão suavizada que a câmera segue. */
  private pointerFrac: Pt | null = null;
  private follow: Pt = { x: 0.5, y: 0.5 };
  private lastNow = 0;
  /** Unidade em que a câmera está presa (centralizada), ou null. */
  private lockId: string | null = null;
  /** Câmera parada onde está (depois de confirmar uma ação), até soltar com X. */
  private held: { tx: number; ty: number } | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    s: GameState,
  ) {
    this.ox = MARGIN;
    this.oy = HEADROOM - s.width * AY;
    canvas.width = Math.ceil(MARGIN * 2 + s.width * AX + s.height * BX);
    canvas.height = Math.ceil(this.oy + s.height * BY + MARGIN);
    this.ctx = canvas.getContext('2d')!;
  }

  // ---------- Projeção ----------

  /** Ponto do mapa (fx, fy em casas, h em pixels de altura) → tela. */
  private P(fx: number, fy: number, h = 0): Pt {
    return { x: this.ox + fx * AX + fy * BX, y: this.oy + fx * AY + fy * BY - h };
  }

  private elev(s: GameState, x: number, y: number): number {
    return ELEVATION[s.terrain[y][x]] ?? 0;
  }

  private quad(x: number, y: number, h: number): Pt[] {
    return [this.P(x, y, h), this.P(x + 1, y, h), this.P(x + 1, y + 1, h), this.P(x, y + 1, h)];
  }

  private poly(pts: Pt[], fill?: string, stroke?: string, lw = 1): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  /** Caixa em pé sobre uma área do chão (frações da casa), com topo, frente e lado esquerdo. */
  private box(x0: number, y0: number, x1: number, y1: number, base: number, height: number, top: string, front: string, side: string): void {
    const t = [this.P(x0, y0, base + height), this.P(x1, y0, base + height), this.P(x1, y1, base + height), this.P(x0, y1, base + height)];
    const b = [this.P(x0, y1, base), this.P(x1, y1, base)];
    const bl = this.P(x0, y0, base);
    this.poly([t[3], t[2], b[1], b[0]], front);
    this.poly([t[0], t[3], b[0], bl], side);
    this.poly(t, top);
  }

  // ---------- Eventos visuais ----------

  pushEvents(events: GameEvent[], now: number): void {
    for (const e of events) {
      if (e.kind === 'dano') this.floats.push({ x: e.x, y: e.y, text: `-${e.amount}`, color: '#ffb4a8', t0: now });
      else if (e.kind === 'cura') this.floats.push({ x: e.x, y: e.y, text: `+${e.amount}`, color: '#9ff0a8', t0: now });
      else if (e.kind === 'abate') this.floats.push({ x: e.x, y: e.y, text: 'abatido', color: '#ffffff', t0: now + 150 });
      else if (e.kind === 'impacto') this.flashes.push({ cells: e.cells, t0: now });
      else if (e.kind === 'tiro') this.shots.push({ from: e.from, to: e.to, t0: now });
      else if (e.kind === 'texto') this.floats.push({ x: e.x, y: e.y, text: e.text, color: e.color, t0: now + 100 });
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

  // ---------- Quadro ----------

  draw(s: GameState, h: Highlights, now: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.stepCamera(s, now);
    this.drawBackground(now);
    ctx.setTransform(this.cam.z, 0, 0, this.cam.z, this.cam.tx, this.cam.ty);
    this.drawBoardShadow(s);
    this.drawGround(s, now);

    const fill = (cells: Pos[], color: string) => {
      for (const c of cells) this.poly(this.quad(c.x, c.y, this.elev(s, c.x, c.y)), color);
    };
    const outline = (cells: Pos[], color: string) => {
      for (const c of cells) this.poly(this.quad(c.x, c.y, this.elev(s, c.x, c.y)), undefined, color, 2);
    };
    fill(h.areaRange, 'rgba(255, 170, 60, 0.12)');
    fill(h.moves, 'rgba(90, 160, 255, 0.34)');
    fill(h.heals, 'rgba(110, 230, 140, 0.34)');
    fill(h.areaPreview, 'rgba(255, 150, 40, 0.5)');
    fill(h.targets, 'rgba(255, 80, 70, 0.25)');
    outline(h.targets, 'rgba(255, 110, 100, 0.95)');
    fill(h.abilityTargets, 'rgba(180, 120, 255, 0.35)');
    outline(h.abilityTargets, 'rgba(210, 165, 255, 0.95)');
    this.drawStrikes(s, now);
    this.drawMines(s, h);
    if (h.hover) this.poly(this.quad(h.hover.x, h.hover.y, this.elev(s, h.hover.x, h.hover.y)), 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.75)', 1.5);
    this.drawLevelGlows(s, now);

    this.drawObjects(s, h, now);
    this.drawEffects(s, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- Câmera ----------

  get zoom(): number {
    return this.cam.z;
  }

  /** Converte coordenadas da página em pixels do canvas (sem a câmera). */
  toCanvas(clientX: number, clientY: number): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.canvas.width, y: ((clientY - r.top) / r.height) * this.canvas.height };
  }

  /** Posição do cursor (coordenadas da página), ou null quando sai do tabuleiro. */
  pointer(clientX: number | null, clientY = 0): void {
    if (clientX === null) {
      this.pointerFrac = null;
      return;
    }
    const p = this.toCanvas(clientX, clientY);
    // Uma margem nas bordas facilita chegar aos cantos do mapa.
    const fx = (p.x / this.canvas.width - 0.08) / 0.84;
    const fy = (p.y / this.canvas.height - 0.08) / 0.84;
    this.pointerFrac = { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) };
  }

  /**
   * Zoom pela roda do mouse. Presa numa unidade, continua centralizada nela; parada, o ponto sob
   * o cursor fica fixo; solta, a câmera segue o cursor.
   */
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const zOld = this.zTarget;
    this.zTarget = Math.min(MAX_ZOOM, Math.max(1, this.zTarget * factor));
    if (this.held) {
      const c = this.toCanvas(clientX, clientY);
      const k = this.zTarget / zOld;
      this.held = { tx: c.x - (c.x - this.held.tx) * k, ty: c.y - (c.y - this.held.ty) * k };
    } else if (!this.lockId) {
      this.pointer(clientX, clientY);
    }
  }

  /** Para a câmera onde ela está agora (sem seguir unidade nem mouse). */
  hold(): void {
    this.lockId = null;
    // Se ainda está chegando no zoom pedido, guarda a posição já no zoom final.
    const k = this.zTarget / this.cam.z;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.held = { tx: W / 2 - (W / 2 - this.cam.tx) * k, ty: H / 2 - (H / 2 - this.cam.ty) * k };
  }

  get isHeld(): boolean {
    return !!this.held;
  }

  /** Prende a câmera numa unidade (centraliza e acompanha), ou solta (null) para seguir o mouse. */
  lockOn(unitId: string | null): void {
    if (unitId) this.held = null;
    if ((this.lockId || this.held) && !unitId) {
      this.held = null;
      // Ao soltar, a câmera parte de onde está, sem pulo.
      const W = this.canvas.width;
      const H = this.canvas.height;
      const z = this.cam.z;
      const fx = W - W * z ? this.cam.tx / (W - W * z) : 0.5;
      const fy = H - H * z ? this.cam.ty / (H - H * z) : 0.5;
      this.follow = { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) };
    }
    this.lockId = unitId;
  }

  get lockedOn(): string | null {
    return this.lockId;
  }

  /** Visão inteira: sem zoom, solta e seguindo o mouse. */
  resetCamera(): void {
    this.lockId = null;
    this.held = null;
    this.zTarget = 1;
  }

  private stepCamera(s: GameState, now: number): void {
    const dt = this.lastNow ? Math.min(64, now - this.lastNow) : 16;
    this.lastNow = now;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const zNext = this.cam.z + (this.zTarget - this.cam.z) * (1 - Math.exp(-dt / 90));
    const locked = this.lockId ? s.units.find((u) => u.id === this.lockId && u.alive) : undefined;
    let want: { tx: number; ty: number };
    if (this.held) {
      // Parada: fica onde estava; durante um zoom, mantém o centro da tela no lugar.
      const k = zNext / this.zTarget;
      want = { tx: W / 2 - (W / 2 - this.held.tx) * k, ty: H / 2 - (H / 2 - this.held.ty) * k };
    } else if (locked) {
      // Centraliza na unidade (mesmo na borda do mapa) e acompanha enquanto ela anda.
      const p = this.drawPos(locked, now);
      const w = this.P(p.x + 0.5, p.y + 0.5, this.elev(s, Math.round(p.x), Math.round(p.y)) + 14);
      want = { tx: W / 2 - w.x * zNext, ty: H / 2 - w.y * zNext };
    } else {
      const k = 1 - Math.exp(-dt / 140);
      if (this.pointerFrac) {
        this.follow.x += (this.pointerFrac.x - this.follow.x) * k;
        this.follow.y += (this.pointerFrac.y - this.follow.y) * k;
      }
      // Com zoom, a câmera mostra a parte do tabuleiro para onde o cursor aponta.
      // Sem zoom, sobra só um leve deslocamento (parallax) do tabuleiro sobre o fundo.
      const fade = Math.min(1, Math.max(0, (1.4 - zNext) / 0.4));
      want = {
        tx: (W - W * zNext) * this.follow.x + fade * (0.5 - this.follow.x) * PARALLAX_BOARD.x,
        ty: (H - H * zNext) * this.follow.y + fade * (0.5 - this.follow.y) * PARALLAX_BOARD.y,
      };
    }
    const m = 1 - Math.exp(-dt / (locked ? 110 : 60));
    this.cam = { z: zNext, tx: this.cam.tx + (want.tx - this.cam.tx) * m, ty: this.cam.ty + (want.ty - this.cam.ty) * m };
  }

  // ---------- Plano de fundo ----------

  private drawBackground(now: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#13151b');
    g.addColorStop(0.6, '#181920');
    g.addColorStop(1, '#1f1b17');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const off = (depth: number) => ({ x: (0.5 - this.follow.x) * depth, y: (0.5 - this.follow.y) * depth * 0.6 });

    // Engrenagens distantes.
    let o = off(5);
    ctx.save();
    ctx.translate(o.x, o.y);
    for (const [gx, gy, r, sp] of BG_GEARS) drawGear(ctx, gx * W, gy * H, r, now * sp, 'rgba(201, 162, 39, 0.05)');
    ctx.restore();

    // Serra ao longe, embaixo.
    o = off(9);
    ctx.fillStyle = 'rgba(10, 11, 14, 0.55)';
    ctx.beginPath();
    ctx.moveTo(-20 + o.x, H + 10);
    for (let i = 0; i <= 24; i++) {
      const x = (i / 24) * (W + 40) - 20 + o.x;
      const y = H * 0.83 + Math.sin(i * 1.7) * 14 + Math.sin(i * 0.6) * 22 + o.y;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 20 + o.x, H + 10);
    ctx.closePath();
    ctx.fill();

    // Poeira e fuligem flutuando.
    o = off(14);
    for (let i = 0; i < 46; i++) {
      const seed = (i * 9301 + 49297) % 233280;
      const bx = (seed / 233280) * W;
      const by = ((i * 7919) % 1000) / 1000;
      const y = (((by * H - now * (0.006 + (i % 5) * 0.002)) % H) + H) % H;
      const a = 0.05 + (i % 4) * 0.03;
      ctx.fillStyle = `rgba(230, 210, 170, ${a})`;
      ctx.fillRect(bx + o.x + Math.sin(now / 1800 + i) * 6, y + o.y, 2, 2);
    }
  }

  /** Sombra do tabuleiro sobre o fundo, para ele "flutuar". */
  private drawBoardShadow(s: GameState): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 36;
    ctx.shadowOffsetY = 16;
    this.poly([this.P(0, 0, -10), this.P(s.width, 0, -10), this.P(s.width, s.height, -10), this.P(0, s.height, -10)], '#1b1d22');
    ctx.restore();
  }

  /** Brilho colorido na casa de cada unidade, mais forte a cada level. */
  private drawLevelGlows(s: GameState, now: number): void {
    const ctx = this.ctx;
    for (const u of s.units) {
      if (!u.alive) continue;
      const p = this.drawPos(u, now);
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      const e = this.elev(s, cx, cy);
      const lv = u.level;
      const pulse = lv >= 4 ? 0.85 + 0.15 * Math.sin(now / 380 + cx) : 1;
      const alpha = (0.14 + 0.11 * (lv - 1)) * pulse;
      const c = this.P(p.x + 0.5, p.y + 0.5, e);
      const g = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 26 + lv * 3);
      g.addColorStop(0, rgba(TEAM_COLOR[u.team], alpha));
      g.addColorStop(1, rgba(TEAM_COLOR[u.team], 0));
      ctx.fillStyle = g;
      const q = [this.P(p.x, p.y, e), this.P(p.x + 1, p.y, e), this.P(p.x + 1, p.y + 1, e), this.P(p.x, p.y + 1, e)];
      this.poly(q);
      ctx.fill();
      if (lv >= 3) this.poly(q, undefined, rgba(lv >= 5 ? '#ffd25a' : TEAM_LIGHT[u.team], 0.25 + 0.1 * (lv - 3)), 1);
    }
  }


  private drawGround(s: GameState, now: number): void {
    const ctx = this.ctx;
    // Borda do tabuleiro (espessura da "mesa").
    const H = s.height;
    const W = s.width;
    this.poly([this.P(0, H), this.P(W, H), this.P(W, H, -10), this.P(0, H, -10)], '#1e2026');
    this.poly([this.P(0, 0), this.P(0, H), this.P(0, H, -10), this.P(0, 0, -10)], '#26282f');

    const order: Pos[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) order.push({ x, y });
    order.sort((a, b) => depthOf(a.x + 0.5, a.y + 0.5) - depthOf(b.x + 0.5, b.y + 0.5));
    for (const { x, y } of order) {
      {
        const t = s.terrain[y][x];
        const e = this.elev(s, x, y);
        let color = TERRAIN_FILL[t];
        if ((x + y) % 2 === 0 && t !== 'agua') color = shade(color, 0.06);
        if (e > 0) {
          this.box(x, y, x + 1, y + 1, 0, e, shade(color, 0.12), shade(color, -0.25), shade(color, -0.12));
        } else {
          this.poly(this.quad(x, y, 0), color);
        }
        this.drawGroundMark(t, x, y, e, now);
      }
    }
    // Grade sutil.
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) {
      const a = this.P(x, 0);
      const b = this.P(x, H);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    for (let y = 0; y <= H; y++) {
      const a = this.P(0, y);
      const b = this.P(W, y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  private drawGroundMark(t: Terrain, x: number, y: number, e: number, now: number): void {
    const ctx = this.ctx;
    if (t === 'agua') {
      ctx.strokeStyle = 'rgba(120, 170, 220, 0.35)';
      ctx.lineWidth = 1;
      const phase = ((now / 900 + x * 0.37 + y * 0.21) % 1) * 0.5;
      for (const fy of [0.3, 0.7]) {
        const a = this.P(x + 0.15 + phase * 0.3, y + fy);
        const b = this.P(x + 0.55 + phase * 0.3, y + fy);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + b.x) / 2, a.y - 3, b.x, b.y);
        ctx.stroke();
      }
    } else if (t === 'ponte') {
      ctx.strokeStyle = '#7a6550';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 5; i++) {
        const a = this.P(x + 0.05, y + i / 5);
        const b = this.P(x + 0.95, y + i / 5);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else if (t === 'colina') {
      ctx.strokeStyle = 'rgba(150, 140, 115, 0.6)';
      ctx.lineWidth = 1.2;
      const c = this.P(x + 0.5, y + 0.6, e);
      ctx.beginPath();
      ctx.arc(c.x, c.y + 6, 9, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else if (t === 'lama') {
      ctx.fillStyle = 'rgba(90, 70, 45, 0.7)';
      for (const [fx, fy] of [
        [0.3, 0.35],
        [0.65, 0.6],
        [0.4, 0.75],
      ]) {
        const c = this.P(x + fx, y + fy);
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (t === 'fonte') {
      this.poly(this.quad(x + 0.1, y + 0.1, 0).map((p, i) => (i === 0 ? p : p)), undefined, 'rgba(220, 220, 255, 0.25)', 1);
    }
  }

  private drawStrikes(s: GameState, now: number): void {
    const ctx = this.ctx;
    const blink = 0.3 + 0.25 * Math.sin(now / 160);
    for (const st of s.strikes) {
      const color = st.team === 'azul' ? `rgba(80,140,255,${blink})` : `rgba(255,80,60,${blink})`;
      for (const c of st.cells) this.poly(this.quad(c.x, c.y, this.elev(s, c.x, c.y)), color);
      const p = this.P(st.cx + 0.5, st.cy + 0.5, this.elev(s, st.cx, st.cy));
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(strikeCountdown(s, st.resolveAt)), p.x, p.y);
    }
  }

  private drawMines(s: GameState, h: Highlights): void {
    const ctx = this.ctx;
    for (const m of s.mines) {
      if (m.team !== h.viewer) continue;
      const c = this.P(m.x + 0.5, m.y + 0.5, this.elev(s, m.x, m.y));
      ctx.strokeStyle = '#ffcf5a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 6, 3.5, 0, 0, Math.PI * 2);
      ctx.moveTo(c.x - 9, c.y);
      ctx.lineTo(c.x + 9, c.y);
      ctx.stroke();
    }
  }

  // ---------- Objetos em pé (de trás para a frente) ----------

  private drawObjects(s: GameState, h: Highlights, now: number): void {
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    const at = depthOf;

    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const t = s.terrain[y][x];
        if (t === 'floresta') items.push({ depth: at(x + 0.5, y + 0.45), draw: () => this.drawTrees(x, y) });
        else if (t === 'ruina') items.push({ depth: at(x + 0.5, y + 0.5), draw: () => this.drawRuin(x, y) });
      }
    }
    for (const n of s.nodes) items.push({ depth: at(n.x + 0.5, n.y + 0.5), draw: () => this.drawNode(s, n.x, n.y, n.color, n.charges) });
    for (const b of [s.bases.azul, s.bases.vermelho]) items.push({ depth: at(b.x + 0.5, b.y + 0.6), draw: () => this.drawBase(b.x, b.y, b.team, b.hp / b.maxHp, b.hp > 0) });
    for (const b of s.barricades) items.push({ depth: at(b.x + 0.5, b.y + 0.55), draw: () => this.drawBarricade(b.x, b.y, b.team, b.hp) });
    for (const sm of s.smoke) for (const c of sm.cells) items.push({ depth: at(c.x + 0.5, c.y + 0.9), draw: () => this.drawSmoke(c.x, c.y, now) });
    for (const u of s.units) {
      if (!u.alive) continue;
      const p = this.drawPos(u, now);
      items.push({ depth: at(p.x + 0.5, p.y + 0.62), draw: () => this.drawUnit(s, u, p, h) });
    }
    items.sort((a, b) => a.depth - b.depth);
    for (const it of items) it.draw();
  }

  private drawTrees(x: number, y: number): void {
    const ctx = this.ctx;
    for (const [fx, fy, size] of [
      [0.3, 0.35, 1],
      [0.72, 0.42, 0.85],
      [0.48, 0.78, 1.1],
    ]) {
      const g = this.P(x + fx, y + fy);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(g.x + 2, g.y, 7 * size, 3 * size, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a4430';
      ctx.fillRect(g.x - 1.5, g.y - 5 * size, 3, 5 * size);
      ctx.fillStyle = '#2f5a3c';
      ctx.beginPath();
      ctx.moveTo(g.x, g.y - 22 * size);
      ctx.lineTo(g.x - 8 * size, g.y - 4 * size);
      ctx.lineTo(g.x + 8 * size, g.y - 4 * size);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3f7550';
      ctx.beginPath();
      ctx.moveTo(g.x, g.y - 22 * size);
      ctx.lineTo(g.x - 8 * size, g.y - 4 * size);
      ctx.lineTo(g.x, g.y - 6 * size);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawRuin(x: number, y: number): void {
    this.box(x + 0.15, y + 0.3, x + 0.45, y + 0.7, 0, 9, '#77757c', '#4f4d54', '#625f67');
    this.box(x + 0.55, y + 0.2, x + 0.85, y + 0.55, 0, 16, '#807e86', '#56545c', '#6a6870');
  }

  private drawNode(s: GameState, x: number, y: number, color: keyof typeof NODE_COLOR, charges: number): void {
    const ctx = this.ctx;
    const g = this.P(x + 0.5, y + 0.5, this.elev(s, x, y));
    const c = NODE_COLOR[color];
    const occupied = s.units.some((u) => u.alive && u.x === x && u.y === y);
    const lift = occupied ? 0 : 1;
    ctx.globalAlpha = charges > 0 ? 0.95 : 0.35;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    if (lift) {
      // Cristal em pé.
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y - 18);
      ctx.lineTo(g.x + 6, g.y - 8);
      ctx.lineTo(g.x, g.y - 1);
      ctx.lineTo(g.x - 6, g.y - 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(g.x, g.y - 18);
      ctx.lineTo(g.x - 6, g.y - 8);
      ctx.lineTo(g.x, g.y - 8);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < charges; i++) {
      ctx.fillStyle = c;
      ctx.fillRect(g.x - 8 + i * 6, g.y + 3, 4, 3);
    }
    ctx.globalAlpha = 1;
  }

  private drawBase(x: number, y: number, team: Team, frac: number, alive: boolean): void {
    const ctx = this.ctx;
    const height = alive ? 34 : 8;
    this.box(x + 0.08, y + 0.08, x + 0.92, y + 0.92, 0, height, alive ? TEAM_COLOR[team] : '#3a3a3a', alive ? TEAM_DARK[team] : '#262626', alive ? shade(TEAM_DARK[team], 0.1) : '#2e2e2e');
    if (!alive) return;
    // Ameias.
    for (const fx of [0.12, 0.42, 0.72]) this.box(x + fx, y + 0.1, x + fx + 0.16, y + 0.28, height, 5, TEAM_LIGHT[team], TEAM_DARK[team], TEAM_DARK[team]);
    const f = this.P(x + 0.5, y + 0.92, height / 2);
    ctx.fillStyle = '#f2ead8';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QG', f.x, f.y);
    const top = this.P(x + 0.5, y + 0.5, height + 14);
    this.bar(top.x - 15, top.y, 30, 4, frac, '#7fd36b');
  }

  private drawBarricade(x: number, y: number, team: Team, hp: number): void {
    this.box(x + 0.1, y + 0.35, x + 0.9, y + 0.65, 0, 12, '#8a7660', '#5d4c3b', '#6f5d4a');
    const ctx = this.ctx;
    const a = this.P(x + 0.1, y + 0.65, 6);
    const b = this.P(x + 0.9, y + 0.65, 6);
    ctx.strokeStyle = TEAM_COLOR[team];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const top = this.P(x + 0.5, y + 0.5, 22);
    this.bar(top.x - 12, top.y, 24, 3, hp / 15, '#c9a227');
  }

  private drawSmoke(x: number, y: number, now: number): void {
    const ctx = this.ctx;
    for (const [fx, fy, r] of [
      [0.3, 0.4, 9],
      [0.7, 0.5, 10],
      [0.5, 0.75, 8],
    ]) {
      const c = this.P(x + fx, y + fy, 10 + 3 * Math.sin(now / 500 + x + fx * 4));
      ctx.fillStyle = 'rgba(205, 205, 215, 0.33)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawUnit(s: GameState, u: Unit, p: { x: number; y: number }, h: Highlights): void {
    const ctx = this.ctx;
    const def = CLASSES[u.cls];
    const e = this.elev(s, Math.round(p.x), Math.round(p.y));
    const g = this.P(p.x + 0.5, p.y + 0.5, e);
    const dim = u.activated && h.activeId !== u.id;
    const isActive = h.activeId === u.id;
    const isSelected = h.selectedId === u.id;

    // Anel de seleção no chão.
    if (isActive || isSelected) {
      ctx.strokeStyle = isActive ? '#ffd25a' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, 15, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Sombra.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(g.x + 2, g.y + 1, 11, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Para onde está virada: seta no chão.
    const [dx, dy] = DIR_VEC[u.facing];
    const tip = this.P(p.x + 0.5 + dx * 0.48, p.y + 0.5 + dy * 0.48, e);
    const l = this.P(p.x + 0.5 + dx * 0.28 - dy * 0.14, p.y + 0.5 + dy * 0.28 - dx * 0.14, e);
    const r = this.P(p.x + 0.5 + dx * 0.28 + dy * 0.14, p.y + 0.5 + dy * 0.28 + dx * 0.14, e);
    this.poly([tip, l, r], dim ? 'rgba(236,228,207,0.45)' : '#ece4cf');

    ctx.globalAlpha = dim ? 0.55 : 1;
    // Corpo em pé.
    const bw = def.weight === 'pesado' ? 26 : def.weight === 'medio' ? 22 : 19;
    const bh = def.weight === 'pesado' ? 27 : def.weight === 'medio' ? 29 : 31;
    const left = g.x - bw / 2;
    const topY = g.y - bh - 2;
    const grad = ctx.createLinearGradient(0, topY, 0, g.y);
    grad.addColorStop(0, TEAM_LIGHT[u.team]);
    grad.addColorStop(1, TEAM_DARK[u.team]);
    const lv = u.level;
    roundRect(ctx, left, topY, bw, bh, 6);
    ctx.save();
    if (lv >= 5) {
      ctx.shadowColor = rgba(TEAM_LIGHT[u.team], 0.9);
      ctx.shadowBlur = 12;
    }
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    // A borda engrossa e vira latão/ouro conforme o level.
    ctx.lineWidth = (def.weight === 'leve' ? 1 : def.weight === 'medio' ? 2 : 3) + (lv - 1) * 0.5;
    ctx.strokeStyle = lv >= 5 ? '#ffd25a' : lv >= 3 ? '#d0a53a' : '#ece4cf';
    ctx.stroke();
    if (lv >= 4) {
      // Ombreiras.
      ctx.fillStyle = lv >= 5 ? '#ffd25a' : '#c9a227';
      ctx.fillRect(left - 2, topY + 2, 5, 6);
      ctx.fillRect(left + bw - 3, topY + 2, 5, 6);
    }
    if (lv >= 2) {
      // Rebites.
      ctx.fillStyle = lv >= 3 ? '#e2c26a' : 'rgba(236,228,207,0.8)';
      for (const ry of lv >= 3 ? [topY + 4, topY + bh - 5] : [topY + bh - 5]) {
        ctx.beginPath();
        ctx.arc(left + 3.5, ry, 1.2, 0, Math.PI * 2);
        ctx.arc(left + bw - 3.5, ry, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (def.vehicle) {
      // Rodas do Blindado.
      ctx.fillStyle = '#2a2a2a';
      for (const wx of [left + 4, left + bw - 4]) {
        ctx.beginPath();
        ctx.arc(wx, g.y - 3, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Símbolo da classe.
    drawClassIcon(ctx, u.cls, g.x, topY + bh / 2 - 1, Math.min(bw - 5, 17), '#ffffff');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Barras e marcas acima da cabeça.
    const hy = topY - 8;
    this.bar(g.x - 14, hy, 28, 4, u.hp / u.maxHp, '#7fd36b');
    this.bar(g.x - 14, hy + 5, 28, 2, u.stamina / def.stamina, '#e8c547');
    if (u.level > 1) {
      ctx.fillStyle = '#1b1d22';
      ctx.fillRect(g.x - 27, hy - 2, 11, 11);
      ctx.fillStyle = '#ffd25a';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.fillText(String(u.level), g.x - 21.5, hy + 3.5);
    }
    u.items.forEach((it, i) => {
      ctx.fillStyle = it === 'tonico' ? '#6fd58a' : it === 'foco' ? '#b88cf0' : '#f0a050';
      ctx.fillRect(g.x + 16, hy - 1 + i * 5, 4, 4);
    });
    if (u.ready) {
      ctx.fillStyle = '#ffd25a';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText('!', g.x + bw / 2 + 3, topY + 4);
    }
    if (u.oil || u.focus || u.tauntBy || s.phase <= u.stuckUntil) {
      ctx.fillStyle = u.tauntBy || s.phase <= u.stuckUntil ? '#ff7a6a' : '#c9e7ff';
      ctx.beginPath();
      ctx.arc(left + 2, topY + bh - 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private bar(x: number, y: number, w: number, hgt: number, frac: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, w, hgt);
    const f = Math.max(0, Math.min(1, frac));
    let c = color;
    if (color === '#7fd36b') c = f > 0.5 ? color : f > 0.25 ? '#e0b04a' : '#e05a4a';
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w * f, hgt);
  }

  private drawEffects(s: GameState, now: number): void {
    const ctx = this.ctx;
    this.flashes = this.flashes.filter((f) => now - f.t0 < 500);
    for (const f of this.flashes) {
      const a = 1 - (now - f.t0) / 500;
      for (const c of f.cells) this.poly(this.quad(c.x, c.y, this.elev(s, c.x, c.y)), `rgba(255, 190, 90, ${0.65 * a})`);
    }
    this.shots = this.shots.filter((sh) => now - sh.t0 < 350);
    for (const sh of this.shots) {
      const a = 1 - (now - sh.t0) / 350;
      const p = this.P(sh.from.x + 0.5, sh.from.y + 0.5, this.elev(s, sh.from.x, sh.from.y) + 16);
      const q = this.P(sh.to.x + 0.5, sh.to.y + 0.5, this.elev(s, sh.to.x, sh.to.y) + 16);
      ctx.strokeStyle = `rgba(255, 240, 200, ${a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    this.floats = this.floats.filter((fl) => now - fl.t0 < 1100);
    for (const fl of this.floats) {
      const t = (now - fl.t0) / 1100;
      if (t < 0) continue;
      const p = this.P(fl.x + 0.5, fl.y + 0.5, this.elev(s, fl.x, fl.y) + 40 + t * 22);
      ctx.globalAlpha = 1 - t;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(fl.text, p.x, p.y);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Clique ----------

  /** Centro da casa em coordenadas da página (usado pelos testes automatizados). */
  clientPoint(x: number, y: number, s: GameState): Pt {
    const w = this.P(x + 0.5, y + 0.5, this.elev(s, x, y));
    const p = { x: w.x * this.cam.z + this.cam.tx, y: w.y * this.cam.z + this.cam.ty };
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (p.x / this.canvas.width) * r.width, y: r.top + (p.y / this.canvas.height) * r.height };
  }

  /** Casa sob o ponteiro: projeção inversa, conferindo colinas (que ficam mais altas). */
  cellAt(clientX: number, clientY: number, s: GameState): Pos | null {
    const c = this.toCanvas(clientX, clientY);
    const sx = (c.x - this.cam.tx) / this.cam.z;
    const sy = (c.y - this.cam.ty) / this.cam.z;
    const dx = sx - this.ox;
    const dy = sy - this.oy;
    const det = AX * BY - BX * AY;
    const fx = (dx * BY - BX * dy) / det;
    const fy = (AX * dy - AY * dx) / det;
    const guess = { x: Math.floor(fx), y: Math.floor(fy) };
    // Uma colina mais à frente pode cobrir o ponto: testa as vizinhas, da frente para trás.
    const candidates: Pos[] = [];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) candidates.push({ x: guess.x + ox, y: guess.y + oy });
    candidates.sort((a, b) => depthOf(b.x + 0.5, b.y + 0.5) - depthOf(a.x + 0.5, a.y + 0.5));
    for (const c of candidates) {
      if (c.x < 0 || c.y < 0 || c.x >= s.width || c.y >= s.height) continue;
      const e = this.elev(s, c.x, c.y);
      if (e > 0 && inside({ x: sx, y: sy }, this.quad(c.x, c.y, e))) return c;
    }
    if (guess.x < 0 || guess.y < 0 || guess.x >= s.width || guess.y >= s.height) return null;
    return guess;
  }
}

/** Profundidade na tela: quem tem o pé mais embaixo é desenhado por cima. */
function depthOf(fx: number, fy: number): number {
  return fx * AY + fy * BY;
}

function inside(p: Pt, poly: Pt[]): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawGear(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, color: string): void {
  const teeth = Math.max(8, Math.round(r / 5));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const rr = i % 2 === 0 ? r : r * 0.82;
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    ctx.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr);
    ctx.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
  }
  ctx.closePath();
  ctx.moveTo(r * 0.35, 0);
  ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
}

/** Clareia (amt > 0) ou escurece (amt < 0) uma cor #rrggbb. */
function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
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
