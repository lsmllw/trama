// Quadra 2.5D do Trama Futsal: piso de madeira, linhas, gols com rede, torcida, jogadores
// chibi e a bola. Toda jogada vira uma animação (fila de eventos) antes do jogo seguir.

import { AREA_RADIUS, COURT_H, COURT_W, TEN_METER, absRound, getPlayer } from '../core';
import type { Corner, Emote, GameEvent, GameState, Lance, Player, Pos, SideKey, Team, TempoResult } from '../core';
import { drawRoleBadge } from './roles';
import { BALL, drinkSprite, playerSprite, whiteSprite } from './sprites';
import type { Frame } from './sprites';

type Pt = { x: number; y: number };

// Projeção: o comprimento da quadra corre para a direita (subindo um pouco), a largura desce.
const AX = 30;
const AY = -8;
const BX = 12;
const BY = 17;
const MARGIN_X = 40;
const HEADROOM = 120;
const FOOTROOM = 50;
const MAX_ZOOM = 2.6;
const SCALE = 1.6;
const PARALLAX = { x: 14, y: 8 };

export const TEAM_COLOR: Record<Team, string> = {
  azul: '#2f6fd8',
  vermelho: '#d63a2f',
};
const TEAM_LIGHT: Record<Team, string> = {
  azul: '#7fb0ff',
  vermelho: '#ff8a7a',
};

export interface TargetMark {
  x: number;
  y: number;
  kind: 'passe' | 'passe-alto' | 'drible' | 'desarme' | 'chute';
  tone: 'bom' | 'risco' | 'ruim';
  label?: string;
}

export interface Highlights {
  moves: Pos[];
  targets: TargetMark[];
  /** Linha do passe sob o cursor. */
  passLine: {
    from: Pos;
    to: Pos;
    tone: 'bom' | 'risco' | 'ruim';
    alto: boolean;
  } | null;
  /** Casas onde o adversário corta passe rasteiro. */
  cutZones: Pos[];
  /** Destinos em que quem tem a bola sofre bote automático de um defensor de prontidão. */
  dangerMoves: Pos[];
  /** Chute sob o cursor: mostra o gol alvo e a chance. */
  shot: { team: Team; text: string } | null;
  selectedId: string | null;
  activeId: string | null;
  hover: Pos | null;
  kbCursor: boolean;
}

export const emptyHighlights = (): Highlights => ({
  moves: [],
  targets: [],
  passLine: null,
  cutZones: [],
  dangerMoves: [],
  shot: null,
  selectedId: null,
  activeId: null,
  hover: null,
  kbCursor: false,
});

interface Disp {
  x: number;
  y: number;
  h: number;
  rot: number;
  frame: Frame | null;
  flash: boolean;
  dizzy: boolean;
  /** Olhar para a esquerda da tela. */
  flip: boolean | null;
  back: boolean | null;
  /** Imagens fantasmas (finta), em casas relativas ao jogador. */
  ghosts: { dx: number; dy: number }[];
}

interface BallDisp {
  x: number;
  y: number;
  h: number;
  /** Com quem a bola está na tela (segue os pés), ou null quando voa. */
  owner: string | null;
  spin: number;
  trail: boolean;
}

interface Anim {
  dur: number;
  t0: number;
  step: (t: number, now: number) => void;
  end?: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  t0: number;
  color: string;
  size: number;
  g: number;
}

interface Banner {
  text: string;
  sub?: string;
  color: string;
  t0: number;
  dur: number;
  big: boolean;
}

interface Balloon {
  id: string;
  emote: Emote;
  t0: number;
}

interface Float {
  x: number;
  y: number;
  text: string;
  color: string;
  t0: number;
  /** Coordenadas já no centro do jogador (sem o +0,5 da casa) e altura própria. */
  raw?: boolean;
  h?: number;
  size?: number;
  life?: number;
}

/** Garrafa de energético na tela. */
interface Bottle {
  id: string;
  x: number;
  y: number;
  h: number;
  rot: number;
  expires: number;
  flying: boolean;
  landed: number;
  removing: number;
}

/** Estado do Duelo na quadra: foco da câmera, vinheta e efeitos de início. */
interface DuelFx {
  a: string;
  b: string;
  t0: number;
  end: number | null;
  prev: { z: number; lockId: string | null; held: { tx: number; ty: number } | null };
}

const DUEL_ZOOM = 2.35;
const FOCUS_ZOOM = 1.75;
const LANCE_COLOR: Record<Lance, string> = { golpe: '#ff9a6a', guarda: '#8fc4ff', finta: '#d2a8ff', esperar: '#e0e0e6' };
const ease = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private ox: number;
  private oy: number;
  private floor: HTMLCanvasElement;
  cam = { z: 1, tx: 0, ty: 0 };
  private zTarget = 1;
  private pointerFrac: Pt | null = null;
  private lastPointer: Pt | null = null;
  // Mira: escolhendo a casa de destino, a câmera segue o mouse ou o cursor do teclado.
  private aimOn = false;
  /** Zoom de antes de selecionar um jogador (o zoom de foco é desfeito ao soltar). */
  private raisedFrom: number | null = null;
  private aimSrc: 'mouse' | 'key' | null = null;
  private aimCell: Pos | null = null;
  private aimFrac: Pt = { x: 0.5, y: 0.5 };
  private aimStart: Pt | null = null;
  private follow: Pt = { x: 0.5, y: 0.5 };
  private lockId: string | null = null;
  private held: { tx: number; ty: number } | null = null;
  private lastNow = 0;
  private shake = 0;

  private disp = new Map<string, Disp>();
  private ball: BallDisp = {
    x: 0,
    y: 0,
    h: 0,
    owner: null,
    spin: 0,
    trail: false,
  };
  private queue: (() => Anim[])[] = [];
  private running: Anim[] = [];
  private particles: Particle[] = [];
  private banners: Banner[] = [];
  private balloons: Balloon[] = [];
  private floats: Float[] = [];
  private trail: { x: number; y: number; h: number; t: number }[] = [];
  private netBulge: { team: Team; y: number; t0: number } | null = null;
  private crowdSeed: {
    x: number;
    y: number;
    c: string;
    ph: number;
    row: number;
  }[] = [];
  private cheer = 0;
  private duelFx: DuelFx | null = null;
  private bottles = new Map<string, Bottle>();
  private flashT = 0;
  /** Quando as casas de movimento atuais apareceram (para a animação de entrada). */
  private movesKey = '';
  private movesT0 = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    s: GameState,
  ) {
    this.ox = MARGIN_X;
    this.oy = HEADROOM - COURT_W * AY;
    canvas.width = Math.ceil(MARGIN_X * 2 + COURT_W * AX + COURT_H * BX);
    canvas.height = Math.ceil(this.oy + COURT_H * BY + FOOTROOM);
    this.ctx = canvas.getContext('2d')!;
    this.floor = this.buildFloor();
    for (const p of s.players) this.disp.set(p.id, this.freshDisp(p));
    for (const d of s.drinks)
      this.bottles.set(d.id, { id: d.id, x: d.x + 0.5, y: d.y + 0.5, h: 0, rot: 0, expires: d.expires, flying: false, landed: 0, removing: 0 });
    const h = getPlayer(s, s.holder);
    this.ball = {
      x: h.x + 0.5,
      y: h.y + 0.5,
      h: 0,
      owner: h.id,
      spin: 0,
      trail: false,
    };
    this.buildCrowd();
  }

  private freshDisp(p: Player): Disp {
    return {
      x: p.x + 0.5,
      y: p.y + 0.5,
      h: 0,
      rot: 0,
      frame: null,
      flash: false,
      dizzy: false,
      flip: null,
      back: null,
      ghosts: [],
    };
  }

  // ---------- Projeção ----------

  private P(fx: number, fy: number, h = 0): Pt {
    return {
      x: this.ox + fx * AX + fy * BX,
      y: this.oy + fx * AY + fy * BY - h,
    };
  }

  private quad(x: number, y: number): Pt[] {
    return [this.P(x, y), this.P(x + 1, y), this.P(x + 1, y + 1), this.P(x, y + 1)];
  }

  private poly(c: CanvasRenderingContext2D, pts: Pt[], fill?: string, stroke?: string, lw = 1): void {
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) c.lineTo(p.x, p.y);
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lw;
      c.stroke();
    }
  }

  // ---------- Fila de animações ----------

  /** Enfileira as animações dos eventos do jogo (a tela anda atrás das regras). */
  pushEvents(events: GameEvent[], s: GameState): void {
    for (const e of events) this.queue.push(() => this.animFor(e, s));
  }

  get busy(): boolean {
    return this.queue.length > 0 || this.running.length > 0;
  }

  /** Espera a fila de animações acabar. */
  idle(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => (this.busy ? requestAnimationFrame(check) : resolve());
      check();
    });
  }

  private d(id: string): Disp {
    return this.disp.get(id)!;
  }

  private animFor(e: GameEvent, s: GameState): Anim[] {
    switch (e.kind) {
      case 'move':
        return [this.animMove(e.id, e.path, e.withBall, e.sprint)];
      case 'passe':
        return this.animPass(e, s);
      case 'chute':
        return this.animShot(e, s);
      case 'duelo':
        return this.animDuel(e);
      case 'gol':
        return this.animGoal(e.team, e.scorerId, s);
      case 'falta':
        return this.animFoul(e.byId, e.onId, e.count, e.direto);
      case 'reset':
        return [this.animReset(e.positions, e.holderId)];
      case 'apito':
        this.banners.push({
          text: e.text,
          color: '#ffffff',
          t0: performance.now(),
          dur: e.long ? 1500 : 1100,
          big: !!e.long,
        });
        return [{ dur: e.long ? 900 : 500, t0: 0, step: () => {} }];
      case 'emote':
        this.balloons.push({ id: e.id, emote: e.emote, t0: performance.now() });
        return [];
      case 'garrafa':
        return this.animDrink(e);
      case 'texto':
        this.floats.push({
          x: e.x,
          y: e.y,
          text: e.text,
          color: e.color,
          t0: performance.now(),
        });
        return [];
    }
  }

  private animMove(id: string, path: Pos[], withBall: boolean, sprint: boolean): Anim {
    const d = this.d(id);
    const per = sprint ? 85 : 120;
    const pts = path.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    let lastStep = -1;
    return {
      dur: Math.max(1, pts.length - 1) * per,
      t0: 0,
      step: (t) => {
        const f = t * (pts.length - 1);
        const i = Math.min(pts.length - 2, Math.floor(f));
        const k = f - i;
        const a = pts[i];
        const b = pts[i + 1] ?? a;
        d.x = a.x + (b.x - a.x) * k;
        d.y = a.y + (b.y - a.y) * k;
        d.frame = Math.floor(f * 2) % 2 ? 'run1' : 'run2';
        d.h = Math.abs(Math.sin(f * Math.PI)) * 3;
        this.faceTowards(d, b.x - a.x, b.y - a.y);
        if (i !== lastStep) {
          lastStep = i;
          this.dust(d.x, d.y, sprint ? 5 : 3);
        }
        if (withBall) {
          // A bola vai colada no pé, um pouco à frente, quicando a cada passo.
          this.ball.owner = null;
          const lead = 0.38 + 0.12 * Math.sin(f * Math.PI * 2);
          const dx = b.x - a.x || 0.0001;
          const dy = b.y - a.y;
          const n = Math.hypot(dx, dy) || 1;
          this.ball.x = d.x + (dx / n) * lead;
          this.ball.y = d.y + (dy / n) * lead + 0.05;
          this.ball.h = Math.abs(Math.sin(f * Math.PI * 2)) * 2;
          this.ball.spin += 0.5;
        }
      },
      end: () => {
        d.frame = null;
        d.h = 0;
        if (withBall) this.ball.owner = id;
      },
    };
  }

  private faceTowards(d: Disp, dx: number, dy: number): void {
    // Na tela: +x anda para a direita (e sobe), +y desce (e vai um pouco para a direita).
    const sx = dx * AX + dy * BX;
    const sy = dx * AY + dy * BY;
    if (Math.abs(sx) > 0.01) d.flip = sx < 0;
    if (Math.abs(sy) > 0.01) d.back = sy < 0;
  }

  private animPass(e: Extract<GameEvent, { kind: 'passe' }>, s: GameState): Anim[] {
    const from = this.d(e.fromId);
    const to = this.d(e.toId);
    const start = { x: from.x, y: from.y };
    const endPt = { x: to.x, y: to.y };
    const dist = Math.hypot(endPt.x - start.x, endPt.y - start.y);
    const dur = Math.max(260, dist * (e.alto ? 85 : 55));
    const kick: Anim = {
      dur: 160,
      t0: 0,
      step: (t) => {
        from.frame = 'kick';
        this.faceTowards(from, endPt.x - start.x, endPt.y - start.y);
        from.h = Math.sin(t * Math.PI) * 2;
      },
      end: () => {
        from.frame = null;
        this.ball.owner = null;
      },
    };
    const fly: Anim = {
      dur,
      t0: 0,
      step: (t) => {
        this.ball.owner = null;
        // O rasteiro sai forte e perde velocidade; o alto viaja por igual.
        const ease = e.alto ? t : 1 - (1 - t) * (1 - t);
        this.ball.x = start.x + (endPt.x - start.x) * ease;
        this.ball.y = start.y + (endPt.y - start.y) * ease;
        this.ball.h = e.alto ? Math.sin(Math.PI * t) * (26 + dist * 5) : 0;
        this.ball.spin += e.alto ? 0.25 : 0.6;
        this.ball.trail = e.alto;
        // Quem recebe se vira para a bola.
        this.faceTowards(to, start.x - endPt.x, start.y - endPt.y);
      },
      end: () => {
        this.ball.trail = false;
        this.ball.owner = e.toId;
        if (e.result === 'cortado') {
          to.flash = true;
          this.burst(endPt.x, endPt.y, 10, '#ffffff', 8);
          setTimeout(() => (to.flash = false), 140);
        }
      },
    };
    void s;
    return [kick, fly];
  }

  private goalPoint(team: Team, corner: Corner): { x: number; y: number; h: number } {
    // `team` = quem chuta; o gol alvo fica do outro lado.
    const x = team === 'azul' ? COURT_W + 0.35 : -0.35;
    const left = team === 'azul' ? -1 : 1; // "esquerda" do ponto de vista de quem chuta
    const off = corner === 'meio' ? 0 : corner === 'esq' ? left * 0.62 : -left * 0.62;
    return { x, y: COURT_H / 2 + off, h: corner === 'meio' ? 18 : 10 };
  }

  private animShot(e: Extract<GameEvent, { kind: 'chute' }>, s: GameState): Anim[] {
    const sh = this.d(e.shooterId);
    const start = { x: sh.x, y: sh.y };
    const tgt = this.goalPoint(e.team, e.corner);
    const keeper = e.keeperId ? this.d(e.keeperId) : null;
    const kStart = keeper ? { x: keeper.x, y: keeper.y } : null;
    const blocker = e.blockerId ? this.d(e.blockerId) : null;
    let end = tgt;
    if (e.result === 'bloqueio' && blocker) end = { x: blocker.x, y: blocker.y, h: 6 };
    const rebounder = e.result === 'rebote' && e.reboundId ? this.d(e.reboundId) : null;
    if ((e.result === 'defesa' || e.result === 'rebote') && keeper && e.dive) {
      const dp = this.goalPoint(e.team, e.dive);
      end = { x: e.team === 'azul' ? COURT_W - 0.5 : 0.5, y: dp.y, h: 12 };
    }
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const windup: Anim = {
      dur: 240,
      t0: 0,
      step: (t) => {
        sh.frame = t < 0.6 ? 'run2' : 'kick';
        sh.h = t > 0.6 ? 3 : 0;
        this.faceTowards(sh, end.x - start.x, end.y - start.y);
      },
      end: () => {
        this.ball.owner = null;
        this.shake = Math.max(this.shake, 3);
        this.burst(start.x, start.y, 6, '#ffffff', 6);
      },
    };
    const fly: Anim = {
      dur: Math.max(220, dist * 32),
      t0: 0,
      step: (t) => {
        this.ball.owner = null;
        this.ball.trail = true;
        this.ball.x = start.x + (end.x - start.x) * t;
        this.ball.y = start.y + (end.y - start.y) * t;
        this.ball.h = end.h * t + Math.sin(Math.PI * t) * 8;
        this.ball.spin += 1.2;
        if (keeper && kStart && e.dive) {
          // O goleiro salta para o lado escolhido.
          const dp = this.goalPoint(e.team, e.dive);
          const k = Math.min(1, Math.max(0, (t - 0.25) / 0.6));
          keeper.y = kStart.y + (dp.y - kStart.y) * k;
          keeper.x = kStart.x + ((e.team === 'azul' ? COURT_W - 0.6 : 0.6) - kStart.x) * k * 0.5;
          const dir = dp.y > kStart.y + 0.1 ? 1 : dp.y < kStart.y - 0.1 ? -1 : 0;
          keeper.rot = dir * 1.25 * k;
          keeper.h = Math.sin(Math.PI * k) * (dir ? 12 : 20);
          keeper.frame = dir ? 'arms' : 'arms';
        }
      },
      end: () => {
        this.ball.trail = false;
        sh.frame = null;
        sh.h = 0;
      },
    };
    const after: Anim = {
      dur: e.result === 'gol' ? 380 : 520,
      t0: 0,
      step: (t) => {
        if (e.result === 'gol') {
          // A bola estufa a rede.
          this.ball.x = end.x + (e.team === 'azul' ? 0.25 : -0.25) * t;
          this.ball.h = end.h * (1 - t);
          if (!this.netBulge)
            this.netBulge = {
              team: e.team === 'azul' ? 'vermelho' : 'azul',
              y: end.y,
              t0: performance.now(),
            };
        } else if (rebounder) {
          // O goleiro espalma e a bola sobra viva na área.
          const from = { x: end.x, y: end.y };
          this.ball.x = from.x + (rebounder.x - from.x) * t;
          this.ball.y = from.y + (rebounder.y - from.y) * t;
          this.ball.h = Math.sin(Math.PI * t) * 14;
          this.ball.spin += 0.8;
          if (keeper && t > 0.4) {
            keeper.rot *= 0.85;
            keeper.h *= 0.8;
          }
        } else if (e.result === 'defesa' && keeper) {
          this.ball.x = keeper.x;
          this.ball.y = keeper.y;
          this.ball.h = 10 + keeper.h;
          if (t > 0.5) {
            keeper.rot *= 0.85;
            keeper.h *= 0.8;
          }
        } else if (blocker) {
          // Bate no defensor e cai no pé dele.
          this.ball.x = blocker.x + 0.3 * (1 - t);
          this.ball.y = blocker.y;
          this.ball.h = Math.abs(Math.sin(t * Math.PI * 2)) * 10 * (1 - t);
          blocker.flash = t < 0.25;
        }
      },
      end: () => {
        if (keeper) {
          keeper.rot = 0;
          keeper.h = 0;
          keeper.frame = null;
        }
        if (blocker) blocker.flash = false;
        if (e.result === 'defesa') {
          this.ball.owner = e.keeperId;
          this.banners.push({
            text: 'DEFESAÇA!',
            color: '#ffe14d',
            t0: performance.now(),
            dur: 900,
            big: false,
          });
        } else if (e.result === 'rebote') {
          this.ball.owner = e.reboundId ?? null;
          this.banners.push({
            text: 'Rebote!',
            color: '#7dd8ff',
            t0: performance.now(),
            dur: 800,
            big: false,
          });
        } else if (e.result === 'bloqueio') {
          this.ball.owner = e.blockerId ?? null;
          this.banners.push({
            text: 'Bloqueio!',
            color: '#ffffff',
            t0: performance.now(),
            dur: 800,
            big: false,
          });
        }
      },
    };
    void s;
    return [windup, fly, after];
  }

  private animDuel(e: Extract<GameEvent, { kind: 'duelo' }>): Anim[] {
    const h = this.d(e.holderId);
    const o = this.d(e.otherId);
    const hs = { x: h.x, y: h.y };
    const os = { x: o.x, y: o.y };
    if (e.result === 'passou' && e.to) {
      const to = { x: e.to.x + 0.5, y: e.to.y + 0.5 };
      // Contorna o marcador em arco, com a bola indo por um lado e o jogador pelo outro.
      const mid = { x: (hs.x + to.x) / 2, y: (hs.y + to.y) / 2 };
      const nx = -(to.y - hs.y);
      const ny = to.x - hs.x;
      const n = Math.hypot(nx, ny) || 1;
      return [
        {
          dur: 520,
          t0: 0,
          step: (t) => {
            const bulge = Math.sin(Math.PI * t) * 0.7;
            h.x = hs.x + (to.x - hs.x) * t + (nx / n) * bulge;
            h.y = hs.y + (to.y - hs.y) * t + (ny / n) * bulge;
            h.h = Math.sin(Math.PI * t) * 10;
            h.frame = t < 0.5 ? 'run1' : 'run2';
            this.ball.owner = null;
            this.ball.x = mid.x + (to.x - mid.x) * t * 1.0 - (nx / n) * 0.4 * Math.sin(Math.PI * t) + (hs.x - mid.x) * (1 - t);
            this.ball.y = mid.y + (to.y - mid.y) * t - (ny / n) * 0.4 * Math.sin(Math.PI * t) + (hs.y - mid.y) * (1 - t);
            this.ball.h = Math.sin(Math.PI * t) * 6;
            this.ball.spin += 0.8;
            // O marcador gira e cai.
            o.rot = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.9 + (t > 0.6 ? 0.25 : 0);
            o.dizzy = t > 0.4;
            if (t > 0.2 && t < 0.3) this.dust(os.x, os.y, 5);
          },
          end: () => {
            h.h = 0;
            h.frame = null;
            this.ball.owner = e.holderId;
            o.rot = 0;
          },
        },
      ];
    }
    if (e.result === 'roubou') {
      return [
        {
          dur: 460,
          t0: 0,
          step: (t) => {
            const lunge = Math.sin(Math.PI * Math.min(1, t * 1.4));
            o.x = os.x + (hs.x - os.x) * 0.45 * lunge;
            o.y = os.y + (hs.y - os.y) * 0.45 * lunge;
            o.frame = 'kick';
            o.rot = 0.2 * lunge * (hs.x > os.x ? 1 : -1);
            if (t > 0.45) {
              this.ball.owner = null;
              const k = (t - 0.45) / 0.55;
              this.ball.x = hs.x + (os.x - hs.x) * k;
              this.ball.y = hs.y + (os.y - hs.y) * k;
              this.ball.h = Math.sin(Math.PI * k) * 8;
              h.rot = -0.5 * Math.sin(Math.PI * k);
              h.dizzy = true;
            }
          },
          end: () => {
            o.x = os.x;
            o.y = os.y;
            o.frame = null;
            o.rot = 0;
            h.rot = 0;
            this.ball.owner = e.otherId;
            this.burst(os.x, os.y, 8, '#ffe14d', 7);
          },
        },
      ];
    }
    if (e.result === 'falta') {
      return [
        {
          dur: 600,
          t0: 0,
          step: (t) => {
            const lunge = Math.sin(Math.PI * Math.min(1, t * 1.5));
            o.x = os.x + (hs.x - os.x) * 0.5 * lunge;
            o.y = os.y + (hs.y - os.y) * 0.5 * lunge;
            o.rot = (hs.x > os.x ? 1 : -1) * 1.2 * Math.min(1, t * 2);
            o.frame = 'kick';
            h.rot = (hs.x > os.x ? 1 : -1) * 1.3 * Math.max(0, Math.min(1, (t - 0.3) * 2));
            h.h = Math.sin(Math.PI * Math.min(1, t * 1.2)) * 8;
          },
          end: () => {
            o.x = os.x;
            o.y = os.y;
            setTimeout(() => {
              o.rot = 0;
              h.rot = 0;
              o.frame = null;
              h.h = 0;
            }, 450);
          },
        },
      ];
    }
    // Manteve: os dois se empurram e quem tem a bola a protege com o corpo.
    return [
      {
        dur: 360,
        t0: 0,
        step: (t) => {
          const k = Math.sin(Math.PI * t);
          o.x = os.x + (hs.x - os.x) * 0.25 * k;
          o.y = os.y + (hs.y - os.y) * 0.25 * k;
          h.x = hs.x - (os.x - hs.x) * 0.12 * k;
          h.y = hs.y - (os.y - hs.y) * 0.12 * k;
        },
        end: () => {
          o.x = os.x;
          o.y = os.y;
          h.x = hs.x;
          h.y = hs.y;
        },
      },
    ];
  }

  private animFoul(byId: string, onId: string, count: number, direto: boolean): Anim[] {
    void byId;
    void onId;
    this.banners.push({
      text: direto ? 'FALTA! Tiro livre direto' : 'FALTA!',
      sub: `${count}ª falta do time no tempo`,
      color: '#ffe14d',
      t0: performance.now(),
      dur: 1300,
      big: false,
    });
    return [{ dur: 700, t0: 0, step: () => {} }];
  }

  private animGoal(team: Team, scorerId: string, s: GameState): Anim[] {
    const sc = this.d(scorerId);
    const p = getPlayer(s, scorerId);
    this.banners.push({
      text: 'GOOOL!',
      sub: `${p.name} · ${team === 'azul' ? 'Azul' : 'Vermelho'}`,
      color: TEAM_COLOR[team],
      t0: performance.now(),
      dur: 2000,
      big: true,
    });
    this.shake = 9;
    this.cheer = performance.now();
    const gp = this.goalPoint(team, 'meio');
    for (let i = 0; i < 70; i++) {
      const c = [TEAM_COLOR[team], TEAM_LIGHT[team], '#ffffff', '#ffe14d'][i % 4];
      this.particles.push({
        x: gp.x,
        y: gp.y,
        vx: (Math.random() - 0.5) * 6 - (team === 'azul' ? 2 : -2),
        vy: (Math.random() - 0.5) * 4,
        life: 1400 + Math.random() * 600,
        t0: performance.now(),
        color: c,
        size: 3,
        g: 0.6,
      });
    }
    const mates = s.players.filter((q) => q.team === team && q.id !== scorerId).map((q) => this.d(q.id));
    return [
      {
        dur: 1700,
        t0: 0,
        step: (t) => {
          // Quem marcou pula comemorando; os colegas também.
          sc.frame = 'arms';
          sc.h = Math.abs(Math.sin(t * Math.PI * 5)) * 14;
          for (const [i, m] of mates.entries()) {
            m.frame = 'arms';
            m.h = Math.abs(Math.sin(t * Math.PI * 4 + i)) * 7;
          }
        },
        end: () => {
          sc.frame = null;
          sc.h = 0;
          for (const m of mates) {
            m.frame = null;
            m.h = 0;
          }
        },
      },
    ];
  }

  private animReset(positions: Record<string, Pos>, holderId: string): Anim {
    const starts = new Map<string, Pt>();
    for (const id of Object.keys(positions)) {
      const d = this.d(id);
      starts.set(id, { x: d.x, y: d.y });
    }
    const ballStart = { x: this.ball.x, y: this.ball.y };
    let maxDist = 0;
    for (const [id, p] of Object.entries(positions)) {
      const s0 = starts.get(id)!;
      maxDist = Math.max(maxDist, Math.hypot(p.x + 0.5 - s0.x, p.y + 0.5 - s0.y));
    }
    const dur = Math.min(1400, 200 + maxDist * 90);
    return {
      dur,
      t0: 0,
      step: (t) => {
        for (const [id, p] of Object.entries(positions)) {
          const d = this.d(id);
          const s0 = starts.get(id)!;
          const tx = p.x + 0.5;
          const ty = p.y + 0.5;
          const moving = Math.hypot(tx - s0.x, ty - s0.y) > 0.1;
          d.x = s0.x + (tx - s0.x) * t;
          d.y = s0.y + (ty - s0.y) * t;
          d.rot = 0;
          d.dizzy = false;
          d.frame = moving && t < 1 ? (Math.floor(t * 12) % 2 ? 'run1' : 'run2') : null;
          if (moving) this.faceTowards(d, tx - s0.x, ty - s0.y);
        }
        const hp = positions[holderId];
        this.ball.owner = null;
        this.ball.x = ballStart.x + (hp.x + 0.9 - ballStart.x) * t;
        this.ball.y = ballStart.y + (hp.y + 0.5 - ballStart.y) * t;
        this.ball.h = Math.sin(Math.PI * t) * 20;
      },
      end: () => {
        for (const id of Object.keys(positions)) {
          const d = this.d(id);
          d.frame = null;
          d.flip = null;
          d.back = null;
        }
        this.ball.owner = holderId;
      },
    };
  }

  // ---------- Energético ----------

  private animDrink(e: Extract<GameEvent, { kind: 'garrafa' }>): Anim[] {
    const now = performance.now();
    const LIME = '#7dff6a';
    switch (e.acao) {
      case 'cai': {
        // A torcida arremessa a garrafa: voa girando por cima da lateral e cai quicando.
        const d = e.drink;
        const b: Bottle = { id: d.id, x: e.from.x, y: e.from.y, h: 55, rot: 0, expires: d.expires, flying: true, landed: 0, removing: 0 };
        this.bottles.set(d.id, b);
        this.cheer = now - 1200;
        const to = { x: d.x + 0.5, y: d.y + 0.5 };
        const from = { ...e.from };
        return [
          {
            dur: 950,
            t0: 0,
            step: (t) => {
              b.x = from.x + (to.x - from.x) * t;
              b.y = from.y + (to.y - from.y) * t;
              b.h = 55 * (1 - t) + Math.sin(Math.PI * t) * 85;
              b.rot = t * Math.PI * 6;
            },
            end: () => {
              b.flying = false;
              b.h = 0;
              b.rot = 0;
              b.landed = performance.now();
              this.dust(to.x, to.y, 6);
              this.burst(to.x, to.y, 10, LIME, 7);
              this.floats.push({ x: to.x, y: to.y, raw: true, h: 30, text: 'ENERGÉTICO!', color: LIME, t0: performance.now(), size: 13, life: 1300 });
            },
          },
        ];
      }
      case 'pega': {
        const b = this.bottles.get(e.drinkId);
        const pd = this.disp.get(e.playerId);
        if (b) {
          this.bottles.delete(e.drinkId);
          this.burst(b.x, b.y, 12, LIME, 8);
        }
        if (pd) {
          this.floats.push({ x: pd.x, y: pd.y, raw: true, h: 56, text: '+ Energético', color: LIME, t0: now, size: 13, life: 1100 });
          this.balloons.push({ id: e.playerId, emote: 'estrela', t0: now });
        }
        return [];
      }
      case 'some': {
        const b = this.bottles.get(e.drinkId);
        if (b && !b.removing) {
          b.removing = now;
          for (let i = 0; i < 10; i++)
            this.particles.push({
              x: b.x,
              y: b.y,
              vx: (Math.random() - 0.5) * 1.5,
              vy: (Math.random() - 0.5) * 1.5,
              life: 500,
              t0: now,
              color: 'rgba(230,240,235,0.85)',
              size: 2,
              g: -0.04,
            });
        }
        return [];
      }
      case 'volta': {
        const d = e.drink;
        this.bottles.set(d.id, { id: d.id, x: d.x + 0.5, y: d.y + 0.5, h: 0, rot: 0, expires: d.expires, flying: false, landed: now, removing: 0 });
        return [];
      }
      case 'usa': {
        // Toma o energético: brilho verde subindo, um pulinho e "ENERGIA!".
        const pd = this.disp.get(e.playerId);
        if (!pd) return [];
        this.floats.push({ x: pd.x, y: pd.y, raw: true, h: 60, text: 'ENERGIA!', color: '#ffe14d', t0: now, size: 15, life: 1200 });
        return [
          {
            dur: 750,
            t0: 0,
            step: (t) => {
              pd.h = Math.abs(Math.sin(t * Math.PI * 2)) * 7;
              pd.frame = t < 0.6 ? 'arms' : null;
              pd.flash = t < 0.2 && Math.floor(t * 40) % 2 === 0;
              if (Math.random() < 0.6)
                this.particles.push({
                  x: pd.x + (Math.random() - 0.5) * 0.6,
                  y: pd.y + (Math.random() - 0.5) * 0.3,
                  vx: 0,
                  vy: 0,
                  life: 600,
                  t0: performance.now(),
                  color: Math.random() < 0.5 ? LIME : '#ffe14d',
                  size: 2,
                  g: -0.15,
                });
            },
            end: () => {
              pd.h = 0;
              pd.frame = null;
              pd.flash = false;
            },
          },
        ];
      }
    }
  }

  private drawBottle(s: GameState, b: Bottle, now: number): void {
    const ctx = this.ctx;
    let alpha = 1;
    let scale = 1.5;
    if (b.removing) {
      const k = (now - b.removing) / 300;
      if (k >= 1) {
        this.bottles.delete(b.id);
        return;
      }
      alpha = 1 - k;
      scale *= 1 - k * 0.7;
    } else if (!b.flying && absRound(s) >= b.expires - 1) {
      // Última rodada na quadra: pisca para avisar que vai sumir.
      alpha = Math.floor(now / 170) % 2 ? 0.25 : 1;
    }
    const g = this.P(b.x, b.y);
    // Pulinhos ao cair e flutuação leve parada.
    const sinceLand = b.landed ? now - b.landed : Infinity;
    const bounce = sinceLand < 600 ? Math.abs(Math.sin((sinceLand / 600) * Math.PI * 2)) * 10 * (1 - sinceLand / 600) : 0;
    const bob = b.flying ? 0 : 2 + Math.sin(now / 320 + b.x) * 2;
    const h = b.h + bounce + bob;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (!b.flying) {
      // Aura verde pulsando no piso.
      const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      const gl = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, 16 + pulse * 4);
      gl.addColorStop(0, `rgba(125,255,106,${(0.35 + pulse * 0.2).toFixed(3)})`);
      gl.addColorStop(1, 'rgba(125,255,106,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gl;
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, 18 + pulse * 4, 9 + pulse * 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      if (Math.random() < 0.04)
        this.particles.push({ x: b.x + (Math.random() - 0.5) * 0.5, y: b.y, vx: 0, vy: 0, life: 700, t0: now, color: '#d9ffcf', size: 2, g: -0.12 });
    }
    ctx.fillStyle = 'rgba(40,20,5,0.3)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, 5 - Math.min(3, h / 20), 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const spr = drinkSprite();
    const top = this.P(b.x, b.y, h);
    ctx.translate(top.x, top.y - (spr.height * scale) / 2);
    ctx.rotate(b.flying ? b.rot : Math.sin(now / 500 + b.y) * 0.12);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, (-spr.width * scale) / 2, (-spr.height * scale) / 2, spr.width * scale, spr.height * scale);
    ctx.restore();
  }

  private dust(x: number, y: number, n: number): void {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.3,
        y: y + 0.1,
        vx: (Math.random() - 0.5) * 0.8,
        vy: -Math.random() * 0.3,
        life: 380,
        t0: now,
        color: 'rgba(240,225,190,0.8)',
        size: 2,
        g: -0.02,
      });
    }
  }

  private burst(x: number, y: number, n: number, color: string, speed: number): void {
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed * 0.3,
        vy: Math.sin(a) * speed * 0.3,
        life: 420,
        t0: now,
        color,
        size: 2,
        g: 0,
      });
    }
  }

  private stepAnims(s: GameState, now: number): void {
    // Quando nada está animando, a tela acompanha o estado do jogo.
    if (!this.running.length && this.queue.length) {
      const next = this.queue.shift()!;
      this.running = next().map((a) => ({ ...a, t0: 0 }));
      if (!this.running.length) return this.stepAnims(s, now);
    }
    if (this.running.length) {
      const a = this.running[0];
      if (!a.t0) a.t0 = now;
      const t = Math.min(1, (now - a.t0) / a.dur);
      a.step(t, now);
      if (t >= 1) {
        a.end?.();
        this.running.shift();
      }
      return;
    }
    // Sem animação: cada um vai suavemente para onde o jogo diz que está.
    for (const p of s.players) {
      const d = this.disp.get(p.id) ?? this.freshDisp(p);
      this.disp.set(p.id, d);
      d.x += (p.x + 0.5 - d.x) * 0.35;
      d.y += (p.y + 0.5 - d.y) * 0.35;
      // Parado, todo mundo fica de frente para a câmera (o rosto sempre à mostra); de costas só durante o movimento.
      d.back = false;
      d.rot *= 0.8;
      if (Math.abs(d.rot) < 0.01) d.rot = 0;
      d.h *= 0.7;
      if (p.unbalanced) d.dizzy = true;
      else if (!this.duelActive) d.dizzy = false;
    }
    if (this.ball.owner !== s.holder) this.ball.owner = s.holder;
  }

  // ---------- Duelo na quadra ----------

  get duelActive(): boolean {
    return !!this.duelFx && !this.duelFx.end;
  }

  /** Começo do Duelo: clarão, linhas de velocidade, os dois se encaram e a câmera fecha neles. */
  startDuel(aId: string, bId: string, title: string, sub: string): Promise<void> {
    const now = performance.now();
    this.duelFx = { a: aId, b: bId, t0: now, end: null, prev: { z: this.zTarget, lockId: this.lockId, held: this.held } };
    this.flashT = now;
    this.shake = Math.max(this.shake, 5);
    const a = this.d(aId);
    const b = this.d(bId);
    this.burst((a.x + b.x) / 2, (a.y + b.y) / 2, 16, '#ffe14d', 9);
    this.banners.push({ text: title, sub, color: '#ffe14d', t0: now, dur: 1000, big: false });
    return new Promise((resolve) => {
      this.queue.push(() => [
        {
          dur: 560,
          t0: 0,
          step: (t) => {
            this.faceTowards(a, b.x - a.x, b.y - a.y);
            this.faceTowards(b, a.x - b.x, a.y - b.y);
            const k = Math.sin(Math.PI * Math.min(1, t * 1.5));
            a.h = k * 8;
            b.h = k * 8;
            a.frame = t < 0.66 ? 'run1' : null;
            b.frame = t < 0.66 ? 'run2' : null;
          },
          end: () => {
            a.h = 0;
            b.h = 0;
            a.frame = null;
            b.frame = null;
            resolve();
          },
        },
      ]);
    });
  }

  /** Um tempo do Duelo animado ali mesmo, na quadra. */
  duelTempo(r: TempoResult, atkId: string, defId: string, ball: SideKey, names: { atk: string; def: string }): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(() => [this.animTempo(r, atkId, defId, ball, names, resolve)]);
    });
  }

  /** Faixa com o resultado do Duelo. */
  duelResult(text: string, color: string): void {
    this.banners.push({ text, color, t0: performance.now(), dur: 1100, big: false });
    this.shake = Math.max(this.shake, 3);
  }

  /** Fim do Duelo: a câmera volta para onde estava. */
  endDuel(): void {
    const fx = this.duelFx;
    if (!fx || fx.end) return;
    fx.end = performance.now();
    this.zTarget = fx.prev.z;
    this.lockId = fx.prev.lockId;
    this.held = fx.prev.held;
    for (const id of [fx.a, fx.b]) {
      const d = this.disp.get(id);
      if (d) d.ghosts = [];
    }
  }

  /** Posição de um jogador na tela (coordenadas do cliente), para encaixar menus ao lado dele. */
  playerScreen(id: string, hgt = 0): Pt {
    const d = this.disp.get(id)!;
    const w = this.P(d.x, d.y, hgt);
    const p = { x: w.x * this.cam.z + this.cam.tx, y: w.y * this.cam.z + this.cam.ty };
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (p.x / this.canvas.width) * r.width, y: r.top + (p.y / this.canvas.height) * r.height };
  }

  private animTempo(r: TempoResult, atkId: string, defId: string, ball: SideKey, names: { atk: string; def: string }, done: () => void): Anim {
    const A = this.d(atkId);
    const D = this.d(defId);
    let ux = D.x - A.x;
    let uy = D.y - A.y;
    const n = Math.hypot(ux, uy) || 1;
    ux /= n;
    uy /= n;
    const px = -uy;
    const py = ux;
    const sides = [
      { k: 'atk' as SideKey, d: A, b: { x: A.x, y: A.y }, s: 1, l: r.atk, gain: r.atkGain, other: r.defGain },
      { k: 'def' as SideKey, d: D, b: { x: D.x, y: D.y }, s: -1, l: r.def, gain: r.defGain, other: r.atkGain },
    ];
    const holder = ball === 'atk' ? sides[0] : sides[1];
    const marker = ball === 'atk' ? sides[1] : sides[0];
    const now = performance.now();
    for (const sd of sides) {
      sd.d.dizzy = false;
      this.floats.push({ x: sd.b.x, y: sd.b.y, raw: true, h: 54, text: names[sd.k], color: LANCE_COLOR[sd.l], t0: now, size: 13, life: 1150 });
    }
    let hit = false;
    return {
      dur: 1000,
      t0: 0,
      step: (t) => {
        const c = Math.min(1, t / 0.45);
        const back = t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
        const e = ease(c) * back;
        for (const sd of sides) {
          const X = sd.d;
          const hasBall = sd === holder;
          let fwd = 0;
          let lat = 0;
          X.ghosts = [];
          X.frame = null;
          X.h = 0;
          X.rot = 0;
          X.flash = false;
          this.faceTowards(X, ux * sd.s, uy * sd.s);
          switch (sd.l) {
            case 'golpe':
              // Arrancada com a bola ou bote: avança com rastro.
              fwd = (hasBall ? 0.32 : 0.44) * e;
              X.frame = hasBall ? (Math.floor(t * 10) % 2 ? 'run1' : 'run2') : t < 0.55 ? 'kick' : null;
              if (!hasBall) X.h = Math.sin(Math.PI * Math.min(1, t * 1.6)) * 5;
              if (t < 0.45)
                X.ghosts = [
                  { dx: -ux * sd.s * 0.13, dy: -uy * sd.s * 0.13 },
                  { dx: -ux * sd.s * 0.26, dy: -uy * sd.s * 0.26 },
                ];
              break;
            case 'guarda':
              // Proteger: vira de costas para o marcador. Fechar: abre os braços.
              fwd = -0.1 * e;
              if (hasBall) this.faceTowards(X, -ux * sd.s, -uy * sd.s);
              else X.frame = 'arms';
              break;
            case 'finta':
              lat = Math.sin(t * Math.PI * (hasBall ? 4 : 1.6)) * (hasBall ? 0.22 : 0.3) * (1 - t * 0.6);
              X.h = Math.abs(Math.sin(t * Math.PI * 3)) * (hasBall ? 3 : 1.5);
              X.frame = Math.floor(t * 8) % 2 ? 'run1' : null;
              if (t < 0.7)
                X.ghosts = [
                  { dx: px * 0.17, dy: py * 0.17 },
                  { dx: -px * 0.17, dy: -py * 0.17 },
                ];
              break;
            default:
              fwd = hasBall ? 0 : -0.12 * e;
              lat = Math.sin(t * Math.PI * 2) * 0.03;
          }
          X.x = sd.b.x + ux * sd.s * fwd + px * lat;
          X.y = sd.b.y + uy * sd.s * fwd + py * lat;
          if (sd.other > sd.gain && t > 0.42 && t < 0.62) X.flash = Math.floor(t * 30) % 2 === 0;
          if (r.exposed === sd.k && t > 0.45) {
            X.rot = 0.3 * Math.sin((t - 0.45) * Math.PI * 4) * (1 - t);
            X.dizzy = true;
          }
          if (r.foul && hasBall && t > 0.4) {
            X.rot = -1.1 * Math.min(1, (t - 0.4) * 3) * (X.flip ? -1 : 1);
            X.h = 2;
          }
        }
        // A bola acompanha quem a tem: à frente, atrás do corpo (proteger) ou passando de um pé para o outro (finta).
        let bf = 0.3;
        let bl = 0;
        let bh = 0;
        if (holder.l === 'guarda') bf = -0.3;
        if (holder.l === 'finta') bl = Math.sin(t * Math.PI * 6) * 0.22;
        if (holder.l === 'esperar') bl = Math.sin(t * Math.PI * 2) * 0.08;
        if (holder.l === 'golpe') bf += 0.15 * Math.sin(Math.PI * Math.min(1, t * 2));
        if (marker.gain > holder.gain && t > 0.45 && t < 0.85) {
          const q = Math.sin(((t - 0.45) / 0.4) * Math.PI);
          bf += 0.5 * q;
          bh = 9 * q;
        }
        this.ball.owner = null;
        this.ball.x = holder.d.x + ux * holder.s * bf + px * bl;
        this.ball.y = holder.d.y + uy * holder.s * bf + py * bl + 0.05;
        this.ball.h = bh + Math.abs(Math.sin(t * Math.PI * 4)) * 1.5;
        this.ball.spin += 0.4;
        if (!hit && t >= 0.45) {
          hit = true;
          const mx = (A.x + D.x) / 2;
          const my = (A.y + D.y) / 2;
          const at = performance.now();
          if (r.foul) {
            this.burst(mx, my, 18, '#ffe14d', 11);
            this.shake = 6;
            this.banners.push({ text: 'FALTA!', color: '#ffe14d', t0: at, dur: 900, big: false });
          } else if (r.atkGain !== r.defGain) {
            this.burst(mx, my, 12, '#ffffff', 9);
            this.shake = 3.5;
          } else {
            // Ninguém ganhou: só um vento entre os dois.
            for (let i = 0; i < 7; i++)
              this.particles.push({
                x: mx - px * 0.3,
                y: my - py * 0.3,
                vx: px * (1.5 + i * 0.2),
                vy: py * (1.5 + i * 0.2),
                life: 450,
                t0: at,
                color: 'rgba(255,255,255,0.85)',
                size: 2,
                g: 0,
              });
          }
          for (const sd of sides)
            if (sd.gain > 0) this.floats.push({ x: sd.b.x, y: sd.b.y, raw: true, h: 46, text: `+${sd.gain}`, color: '#ffe14d', t0: at, size: 19, life: 900 });
        }
      },
      end: () => {
        for (const sd of sides) {
          sd.d.x = sd.b.x;
          sd.d.y = sd.b.y;
          sd.d.ghosts = [];
          sd.d.frame = null;
          sd.d.flash = false;
          sd.d.h = 0;
          if (!(r.foul && sd === holder)) sd.d.rot = 0;
          sd.d.dizzy = r.exposed === sd.k;
        }
        this.ball.owner = holder.d === A ? atkId : defId;
        done();
      },
    };
  }

  /** Vinheta, faixas de cinema, clarão e linhas de velocidade do Duelo (em coordenadas de tela). */
  private drawDuelOverlay(now: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (this.flashT && now - this.flashT < 220) {
      ctx.fillStyle = `rgba(255,255,255,${(0.55 * (1 - (now - this.flashT) / 220)).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    const fx = this.duelFx;
    if (!fx) return;
    let amt = Math.min(1, (now - fx.t0) / 250);
    if (fx.end) {
      amt *= Math.max(0, 1 - (now - fx.end) / 380);
      if (amt <= 0) {
        this.duelFx = null;
        return;
      }
    }
    const a = this.d(fx.a);
    const b = this.d(fx.b);
    const w = this.P((a.x + b.x) / 2, (a.y + b.y) / 2, 20);
    const cx = w.x * this.cam.z + this.cam.tx;
    const cy = w.y * this.cam.z + this.cam.ty;
    const g = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.2, cx, cy, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(8,6,20,0)');
    g.addColorStop(1, `rgba(8,6,20,${(0.75 * amt).toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const st = (now - fx.t0) / 480;
    if (!fx.end && st < 1) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,255,255,${(0.6 * (1 - st)).toFixed(3)})`;
      for (let i = 0; i < 40; i++) {
        const ang = i * 2.39996;
        const r0 = Math.max(W, H) * (0.7 - 0.42 * ease(st)) + (i % 7) * 12;
        const len = 40 + (i % 5) * 22;
        ctx.lineWidth = 1 + (i % 3);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
        ctx.stroke();
      }
      ctx.restore();
    }
    const bar = H * 0.065 * amt;
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
  }

  // ---------- Câmera ----------

  toCanvas(clientX: number, clientY: number): Pt {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * this.canvas.width,
      y: ((clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  pointer(clientX: number | null, clientY = 0): void {
    if (clientX === null) {
      this.pointerFrac = null;
      this.lastPointer = null;
      return;
    }
    const p = this.toCanvas(clientX, clientY);
    const fx = (p.x / this.canvas.width - 0.08) / 0.84;
    const fy = (p.y / this.canvas.height - 0.08) / 0.84;
    this.pointerFrac = {
      x: Math.min(1, Math.max(0, fx)),
      y: Math.min(1, Math.max(0, fy)),
    };
    this.lastPointer = p;
    if (this.aimOn) {
      if (this.aimSrc !== 'mouse') {
        // Um tremor do mouse não tira a câmera do jogador (ou da casa escolhida pelo teclado).
        if (!this.aimStart) this.aimStart = p;
        else if (Math.hypot(p.x - this.aimStart.x, p.y - this.aimStart.y) > 14) this.aimSrc = 'mouse';
      }
      if (this.aimSrc === 'mouse') this.aimFrac = { ...this.pointerFrac };
    }
  }

  /** Liga/desliga a mira (escolha do destino, do passe ou do alvo): a câmera parte centrada no jogador. */
  setAim(on: boolean): void {
    if (on === this.aimOn) return;
    this.aimOn = on;
    this.aimSrc = null;
    this.aimCell = null;
    this.aimStart = this.lastPointer;
  }

  get aiming(): boolean {
    return this.aimOn && !!this.lockId && !this.held;
  }

  /** Cursor do teclado na casa (x, y): a câmera desliza até centralizá-la. */
  aimAt(x: number, y: number): void {
    this.aimSrc = 'key';
    this.aimCell = { x, y };
    this.aimStart = this.lastPointer;
  }

  /** Ponto do mundo que a câmera deve centralizar durante a mira (null fora dela). */
  private aimCenter(playerPt: Pt, z: number): Pt | null {
    if (!this.aimOn || !this.aimSrc) return null;
    let c: Pt;
    if (this.aimSrc === 'key' && this.aimCell) {
      c = this.P(this.aimCell.x + 0.5, this.aimCell.y + 0.5, 8);
    } else {
      // O mouse puxa a câmera para o lado em que está; perto do centro (zona morta) nada muda.
      const dead = 0.14;
      const shape = (f: number) => {
        const d = f - 0.5;
        return (Math.sign(d) * Math.max(0, Math.abs(d) - dead)) / (0.5 - dead);
      };
      const W = this.canvas.width;
      const H = this.canvas.height;
      c = { x: playerPt.x + shape(this.aimFrac.x) * 0.45 * (W / z), y: playerPt.y + shape(this.aimFrac.y) * 0.45 * (H / z) };
    }
    // Não deixa a câmera fugir da quadra.
    const corners = [this.P(0, 0), this.P(COURT_W, 0), this.P(0, COURT_H), this.P(COURT_W, COURT_H)];
    const xs = corners.map((q) => q.x);
    const ys = corners.map((q) => q.y);
    return {
      x: Math.min(Math.max(...xs), Math.max(Math.min(...xs), c.x)),
      y: Math.min(Math.max(...ys), Math.max(Math.min(...ys), c.y)),
    };
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    if (this.duelFx && !this.duelFx.end) return;
    this.raisedFrom = null; // o zoom escolhido pelo jogador fica
    const zOld = this.zTarget;
    this.zTarget = Math.min(MAX_ZOOM, Math.max(1, this.zTarget * factor));
    if (this.held) {
      const c = this.toCanvas(clientX, clientY);
      const k = this.zTarget / zOld;
      this.held = {
        tx: c.x - (c.x - this.held.tx) * k,
        ty: c.y - (c.y - this.held.ty) * k,
      };
    } else if (!this.lockId) this.pointer(clientX, clientY);
  }

  hold(): void {
    this.lockId = null;
    const k = this.zTarget / this.cam.z;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.held = {
      tx: W / 2 - (W / 2 - this.cam.tx) * k,
      ty: H / 2 - (H / 2 - this.cam.ty) * k,
    };
  }

  lockOn(id: string | null): void {
    if (id) this.held = null;
    if ((this.lockId || this.held) && !id) {
      this.held = null;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const z = this.cam.z;
      const fx = W - W * z ? this.cam.tx / (W - W * z) : 0.5;
      const fy = H - H * z ? this.cam.ty / (H - H * z) : 0.5;
      this.follow = {
        x: Math.min(1, Math.max(0, fx)),
        y: Math.min(1, Math.max(0, fy)),
      };
    }
    if (!id && this.raisedFrom !== null) {
      this.zTarget = this.raisedFrom;
      this.raisedFrom = null;
    }
    this.lockId = id;
  }

  /** Seleciona um jogador: a câmera trava nele e aproxima um pouco, para a mira ter para onde andar. */
  focusOn(id: string): void {
    this.lockOn(id);
    if (this.zTarget < FOCUS_ZOOM - 0.2) {
      if (this.raisedFrom === null) this.raisedFrom = this.zTarget;
      this.zTarget = FOCUS_ZOOM;
    }
  }

  get lockedOn(): string | null {
    return this.lockId;
  }

  get isHeld(): boolean {
    return !!this.held;
  }

  resetCamera(): void {
    this.raisedFrom = null;
    this.lockId = null;
    this.held = null;
    this.zTarget = 1;
  }

  ensureVisible(x: number, y: number, margin = 70): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const base = this.held ?? { tx: this.cam.tx, ty: this.cam.ty };
    const z = this.zTarget;
    const w = this.P(x + 0.5, y + 0.5);
    const sx = w.x * z + base.tx;
    const sy = w.y * z + base.ty;
    const dx = sx < margin ? margin - sx : sx > W - margin ? W - margin - sx : 0;
    const dy = sy < margin ? margin - sy : sy > H - margin ? H - margin - sy : 0;
    if (!dx && !dy) return;
    this.lockId = null;
    this.held = { tx: base.tx + dx, ty: base.ty + dy };
  }

  private stepCamera(now: number): void {
    const dt = this.lastNow ? Math.min(64, now - this.lastNow) : 16;
    this.lastNow = now;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const duel = this.duelFx && !this.duelFx.end ? this.duelFx : null;
    const zGoal = duel ? DUEL_ZOOM : this.zTarget;
    const zNext = this.cam.z + (zGoal - this.cam.z) * (1 - Math.exp(-dt / (duel ? 55 : 90)));
    const locked = this.lockId ? this.disp.get(this.lockId) : undefined;
    let want: { tx: number; ty: number };
    let aimed = false;
    if (duel) {
      // Zoom rápido no meio dos dois, um pouco acima dos pés.
      const a = this.d(duel.a);
      const b = this.d(duel.b);
      const w = this.P((a.x + b.x) / 2, (a.y + b.y) / 2, 22);
      want = { tx: W / 2 - w.x * zNext, ty: H / 2 - w.y * zNext };
    } else if (this.held) {
      const k = zNext / this.zTarget;
      want = {
        tx: W / 2 - (W / 2 - this.held.tx) * k,
        ty: H / 2 - (H / 2 - this.held.ty) * k,
      };
    } else if (locked) {
      const w = this.P(locked.x, locked.y, 20);
      // Escolhendo para onde ir (ou o alvo), segue o mouse ou o cursor do teclado.
      const c = this.busy ? null : this.aimCenter(w, zNext);
      aimed = !!c;
      want = { tx: W / 2 - (c ?? w).x * zNext, ty: H / 2 - (c ?? w).y * zNext };
      // Sem mostrar o vazio fora do ginásio.
      want.tx = Math.min(0, Math.max(W - W * zNext, want.tx));
      want.ty = Math.min(0, Math.max(H - H * zNext, want.ty));
    } else {
      const k = 1 - Math.exp(-dt / 140);
      if (this.pointerFrac) {
        this.follow.x += (this.pointerFrac.x - this.follow.x) * k;
        this.follow.y += (this.pointerFrac.y - this.follow.y) * k;
      }
      const fade = Math.min(1, Math.max(0, (1.4 - zNext) / 0.4));
      want = {
        tx: (W - W * zNext) * this.follow.x + fade * (0.5 - this.follow.x) * PARALLAX.x,
        ty: (H - H * zNext) * this.follow.y + fade * (0.5 - this.follow.y) * PARALLAX.y,
      };
    }
    const m = 1 - Math.exp(-dt / (duel ? 45 : aimed ? 170 : locked ? 110 : 60));
    this.cam = {
      z: zNext,
      tx: this.cam.tx + (want.tx - this.cam.tx) * m,
      ty: this.cam.ty + (want.ty - this.cam.ty) * m,
    };
  }

  // ---------- Desenho ----------

  draw(s: GameState, h: Highlights, now: number): void {
    this.stepAnims(s, now);
    this.stepCamera(now);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawArena(now);
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    this.shake *= 0.88;
    if (this.shake < 0.3) this.shake = 0;
    ctx.setTransform(this.cam.z, 0, 0, this.cam.z, this.cam.tx + sx, this.cam.ty + sy);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.floor, 0, 0);
    this.drawHighlights(s, h, now);
    this.drawObjects(s, h, now);
    this.drawParticles(now);
    this.drawBalloons(now);
    this.drawFloats(now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawDuelOverlay(now);
    this.drawBanners(now);
  }

  /** Ginásio: parede, placas e torcida pulando (mais forte depois de um gol). */
  private drawArena(now: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1d2233');
    g.addColorStop(0.55, '#2a3047');
    g.addColorStop(1, '#15182a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const px = this.cam.tx * 0.15;
    const py = this.cam.ty * 0.1;
    // Arquibancada com a torcida.
    const hype = Math.max(0, 1 - (now - this.cheer) / 2500);
    for (const c of this.crowdSeed) {
      const jump = Math.max(0, Math.sin(now / (260 - hype * 120) + c.ph)) * (1.5 + hype * 6);
      const x = c.x + px;
      const y = c.y + py - jump;
      ctx.fillStyle = c.c;
      ctx.fillRect(x, y, 6, 6);
      ctx.fillStyle = 'rgba(240,210,170,0.85)';
      ctx.fillRect(x + 1, y - 4, 4, 4);
      if (hype > 0.2 && c.row % 2 === 0) {
        ctx.fillRect(x - 1, y - 7 - jump * 0.3, 2, 4);
        ctx.fillRect(x + 5, y - 7 - jump * 0.3, 2, 4);
      }
    }
    // Faixa de placas de publicidade.
    const bandY = HEADROOM * 0.62 + py;
    ctx.fillStyle = '#0f1220';
    ctx.fillRect(0, bandY, W, 16);
    const ads = ['TRAMA', 'FUTSAL', 'ENGRENAGEM', 'VAPOR & BOLA', 'TRAMA', 'FUTSAL'];
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ads.forEach((a, i) => {
      const x = ((i * 150 + ((now / 40) % 150)) % (W + 150)) - 75 + px;
      ctx.fillStyle = i % 2 ? '#ffe14d' : '#7fb0ff';
      ctx.fillText(a, x, bandY + 8);
    });
  }

  private buildCrowd(): void {
    const W = this.canvas.width;
    const colors = ['#2f6fd8', '#d63a2f', '#ffe14d', '#ffffff', '#2fbf6a', '#7fb0ff', '#ff8a7a'];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let row = 0; row < 6; row++) {
      for (let x = -40; x < W + 40; x += 9 + rnd() * 4) {
        const left = x < W / 2;
        const c = rnd() < 0.6 ? (left ? colors[0] : colors[1]) : colors[Math.floor(rnd() * colors.length)];
        this.crowdSeed.push({ x, y: 12 + row * 10, c, ph: rnd() * 6.28, row });
      }
    }
  }

  /** Piso de madeira e linhas da quadra, desenhados uma vez. */
  private buildFloor(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    // Borda externa (área de escape) mais escura.
    const ext = [this.P(-1.2, -0.9), this.P(COURT_W + 1.2, -0.9), this.P(COURT_W + 1.2, COURT_H + 0.9), this.P(-1.2, COURT_H + 0.9)];
    this.poly(g, ext, '#7b4f2c');
    // Sombra sob a quadra.
    // Tábuas.
    for (let y = 0; y < COURT_H; y++) {
      for (let x = 0; x < COURT_W; x++) {
        const plank = (x + (y % 2) * 0.5) % 3 < 1.5;
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const j = (n - Math.floor(n)) * 0.08;
        const base = plank ? [214, 160, 96] : [204, 150, 88];
        const col = `rgb(${Math.round(base[0] * (1 - j))}, ${Math.round(base[1] * (1 - j))}, ${Math.round(base[2] * (1 - j))})`;
        this.poly(g, this.quad(x, y), col);
      }
    }
    // Veios entre as tábuas.
    g.strokeStyle = 'rgba(120, 80, 40, 0.25)';
    g.lineWidth = 1;
    for (let y = 0; y <= COURT_H * 2; y++) {
      const a = this.P(0, y / 2);
      const b = this.P(COURT_W, y / 2);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    // Áreas pintadas.
    for (const team of ['azul', 'vermelho'] as const) {
      const gx = team === 'azul' ? 0 : COURT_W;
      const pts: Pt[] = [];
      for (let i = 0; i <= 24; i++) {
        const a = -Math.PI / 2 + (i / 24) * Math.PI;
        const fx = gx + (team === 'azul' ? 1 : -1) * Math.cos(a) * AREA_RADIUS;
        const fy = COURT_H / 2 + Math.sin(a) * AREA_RADIUS;
        pts.push(this.P(fx, fy));
      }
      this.poly(g, pts, team === 'azul' ? 'rgba(47,111,216,0.28)' : 'rgba(214,58,47,0.28)');
    }
    // Linhas brancas.
    g.strokeStyle = 'rgba(255,255,255,0.92)';
    g.lineWidth = 2;
    this.poly(g, [this.P(0, 0), this.P(COURT_W, 0), this.P(COURT_W, COURT_H), this.P(0, COURT_H)], undefined, 'rgba(255,255,255,0.92)', 2);
    const m1 = this.P(COURT_W / 2, 0);
    const m2 = this.P(COURT_W / 2, COURT_H);
    g.beginPath();
    g.moveTo(m1.x, m1.y);
    g.lineTo(m2.x, m2.y);
    g.stroke();
    const circle = (cx: number, cy: number, r: number, from = 0, to = Math.PI * 2) => {
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = from + ((to - from) * i) / 40;
        const p = this.P(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.stroke();
    };
    circle(COURT_W / 2, COURT_H / 2, 1.5);
    circle(0, COURT_H / 2, AREA_RADIUS, -Math.PI / 2, Math.PI / 2);
    circle(COURT_W, COURT_H / 2, AREA_RADIUS, Math.PI / 2, (Math.PI * 3) / 2);
    // Marcas do pênalti e do 10 m.
    for (const [fx, r] of [
      [3, 2.5],
      [TEN_METER, 2.5],
      [COURT_W - 3, 2.5],
      [COURT_W - TEN_METER, 2.5],
      [COURT_W / 2, 3],
    ]) {
      const p = this.P(fx, COURT_H / 2);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(p.x, p.y, r, r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
    }
    // Logo no centro.
    const cp = this.P(COURT_W / 2, COURT_H / 2);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.font = 'bold 18px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save();
    g.translate(cp.x, cp.y);
    g.transform(1, AY / AX, BX / BY, 1, 0, 0);
    g.fillText('TRAMA', 0, 0);
    g.restore();
    return c;
  }

  /**
   * Casas de movimento: surgem em onda a partir do jogador (crescendo com um brilho) e depois
   * ficam oscilando de leve, numa ondulação que sai dele.
   */
  private drawMoves(s: GameState, h: Highlights, now: number): void {
    const ctx = this.ctx;
    if (!h.moves.length) {
      this.movesKey = '';
      return;
    }
    const key = h.moves.map((c) => `${c.x},${c.y}`).join(';');
    if (key !== this.movesKey) {
      this.movesKey = key;
      this.movesT0 = now;
    }
    const who = h.activeId ? s.players.find((p) => p.id === h.activeId) : undefined;
    const ox = who?.x ?? h.moves[0].x;
    const oy = who?.y ?? h.moves[0].y;
    for (const c of h.moves) {
      const dist = Math.abs(c.x - ox) + Math.abs(c.y - oy);
      const t = (now - this.movesT0 - dist * 45) / 260;
      if (t <= 0) continue;
      const k = Math.min(1, t);
      // Entrada com um leve "salto" (passa um pouco do tamanho e volta).
      const grow = k < 1 ? 1 - Math.pow(1 - k, 3) * Math.cos(k * 4) : 1;
      const center = this.P(c.x + 0.5, c.y + 0.5);
      const pts = this.quad(c.x, c.y).map((q) => ({ x: center.x + (q.x - center.x) * grow, y: center.y + (q.y - center.y) * grow }));
      const wave = 0.5 + 0.5 * Math.sin(now / 420 - dist * 0.75);
      const fill = (0.2 + 0.14 * wave) * k;
      const line = (0.4 + 0.4 * wave) * k;
      // Casa vigiada por um defensor de prontidão: quem para ali sofre o bote.
      const danger = h.dangerMoves.some((d) => d.x === c.x && d.y === c.y);
      if (danger) this.poly(ctx, pts, `rgba(255,120,40,${(fill * 1.1).toFixed(3)})`, `rgba(255,190,120,${line.toFixed(3)})`, 1 + wave * 0.7);
      else this.poly(ctx, pts, `rgba(60,150,255,${fill.toFixed(3)})`, `rgba(180,225,255,${line.toFixed(3)})`, 1 + wave * 0.7);
      // Clarão ao surgir, que se apaga em seguida.
      if (k < 1) this.poly(ctx, pts, `rgba(235,248,255,${(0.55 * (1 - k)).toFixed(3)})`);
      // Brilho que pulsa no centro da casa, mais forte no auge da onda.
      if (wave > 0.35) {
        // Luz somada ao piso (clareia de verdade, sem acinzentar).
        const a = (wave - 0.35) * 0.42 * k;
        const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 17);
        g.addColorStop(0, `rgba(90,170,255,${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(90,170,255,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        this.poly(ctx, pts, undefined);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private drawHighlights(s: GameState, h: Highlights, now: number): void {
    const ctx = this.ctx;
    for (const c of h.cutZones) this.poly(ctx, this.quad(c.x, c.y), 'rgba(214,58,47,0.14)');
    this.drawMoves(s, h, now);
    if (h.passLine) {
      const a = this.P(h.passLine.from.x + 0.5, h.passLine.from.y + 0.5);
      const b = this.P(h.passLine.to.x + 0.5, h.passLine.to.y + 0.5);
      const col = h.passLine.tone === 'bom' ? '#7dff9a' : h.passLine.tone === 'risco' ? '#ffe14d' : '#ff6b5b';
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -now / 40;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      if (h.passLine.alto) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 40 };
        ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
      } else ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
    for (const t of h.targets) {
      const col = t.tone === 'bom' ? '#7dff9a' : t.tone === 'risco' ? '#ffe14d' : '#ff6b5b';
      const p = this.P(t.x + 0.5, t.y + 0.5);
      const pulse = 1 + 0.08 * Math.sin(now / 160);
      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 15 * pulse, 8 * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (t.kind === 'drible' || t.kind === 'desarme') {
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 19 * pulse, 11 * pulse, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (h.shot) {
      // Gol alvo pulsando.
      const gx = h.shot.team === 'azul' ? COURT_W : 0;
      const a = this.P(gx, COURT_H / 2 - 1);
      const b = this.P(gx, COURT_H / 2 + 1);
      ctx.save();
      ctx.strokeStyle = '#ffe14d';
      ctx.lineWidth = 4 + Math.sin(now / 120) * 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 2);
      ctx.lineTo(b.x, b.y - 2);
      ctx.stroke();
      ctx.restore();
    }
    // Cursor (mouse ou teclado).
    if (h.hover) {
      const pulse = h.kbCursor ? 0.65 + 0.35 * Math.sin(now / 140) : 0.5;
      this.poly(
        ctx,
        this.quad(h.hover.x, h.hover.y),
        `rgba(255,255,255,${(0.12 * pulse).toFixed(3)})`,
        h.kbCursor ? `rgba(255,225,77,${pulse.toFixed(3)})` : 'rgba(255,255,255,0.6)',
        h.kbCursor ? 2.5 : 1.5,
      );
    }
    void s;
  }

  private drawObjects(s: GameState, h: Highlights, now: number): void {
    const items: { depth: number; draw: () => void }[] = [];
    const depth = (fx: number, fy: number) => fx * AY + fy * BY;
    for (const team of ['azul', 'vermelho'] as const) {
      // O gol que o time defende: atrás da linha.
      const gx = team === 'azul' ? 0 : COURT_W;
      items.push({
        depth: depth(gx, COURT_H / 2 - 1.2),
        draw: () => this.drawGoal(team, now, 'back'),
      });
      items.push({
        depth: depth(gx, COURT_H / 2 + 1.05),
        draw: () => this.drawGoal(team, now, 'front'),
      });
    }
    for (const p of s.players) {
      const d = this.disp.get(p.id);
      if (!d) continue;
      items.push({
        depth: depth(d.x, d.y),
        draw: () => this.drawPlayer(s, p, d, h, now),
      });
    }
    items.push({
      depth: depth(this.ballPos().x, this.ballPos().y) + 0.5,
      draw: () => this.drawBall(now),
    });
    for (const b of this.bottles.values()) items.push({ depth: depth(b.x, b.y) - 0.2, draw: () => this.drawBottle(s, b, now) });
    items.sort((a, b) => a.depth - b.depth);
    // Sombras primeiro.
    for (const p of s.players) {
      const d = this.disp.get(p.id);
      if (!d) continue;
      const g = this.P(d.x, d.y);
      this.ctx.fillStyle = 'rgba(40,20,5,0.28)';
      this.ctx.beginPath();
      this.ctx.ellipse(g.x, g.y, 11 - Math.min(4, d.h / 4), 5 - Math.min(2, d.h / 8), 0, 0, Math.PI * 2);
      this.ctx.fill();
    }
    for (const it of items) it.draw();
  }

  private ballPos(): { x: number; y: number; h: number } {
    if (this.ball.owner) {
      const d = this.disp.get(this.ball.owner);
      if (d) {
        // Parada no pé, do lado para onde o jogador olha.
        const side = d.flip ? -1 : 1;
        const bob = Math.abs(Math.sin(performance.now() / 300)) * 1.5;
        return { x: d.x + side * 0.32, y: d.y + 0.18, h: d.h + bob };
      }
    }
    return { x: this.ball.x, y: this.ball.y, h: this.ball.h };
  }

  private drawBall(now: number): void {
    const ctx = this.ctx;
    const b = this.ballPos();
    const g = this.P(b.x, b.y);
    // Rastro do chute.
    if (this.ball.trail) {
      this.trail.push({ x: b.x, y: b.y, h: b.h, t: now });
    }
    this.trail = this.trail.filter((t) => now - t.t < 220);
    for (const t of this.trail) {
      const p = this.P(t.x, t.y, t.h + 4);
      const a = 1 - (now - t.t) / 220;
      ctx.fillStyle = `rgba(255,255,255,${(a * 0.55).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 * a + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(40,20,5,0.35)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, 5 - Math.min(3, b.h / 12), 2.5 - Math.min(1.5, b.h / 24), 0, 0, Math.PI * 2);
    ctx.fill();
    const p = this.P(b.x, b.y, b.h + 5);
    const rot = Math.floor(this.ball.spin) % 4;
    const S = 1.5;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((rot * Math.PI) / 2);
    BALL.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.') continue;
        ctx.fillStyle = ch === 'k' ? '#1a1418' : '#ffffff';
        ctx.fillRect((x - 3.5) * S, (y - 3.5) * S, S, S);
      }
    });
    ctx.restore();
  }

  private drawPlayer(s: GameState, p: Player, d: Disp, h: Highlights, now: number): void {
    const ctx = this.ctx;
    const g = this.P(d.x, d.y);
    // Anel do time, mais forte em quem está selecionado.
    const active = h.activeId === p.id || h.selectedId === p.id;
    ctx.save();
    ctx.strokeStyle = active ? '#ffe14d' : p.team === 'azul' ? 'rgba(127,176,255,0.85)' : 'rgba(255,138,122,0.85)';
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, active ? 14 + Math.sin(now / 150) : 12, active ? 7 : 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const activeTeamTurn = s.activeTeam === p.team && !s.over;
    const inDuel = !!this.duelFx && !this.duelFx.end && (this.duelFx.a === p.id || this.duelFx.b === p.id);
    const dim = activeTeamTurn && p.activated && !inDuel;
    // Vista e lado: de frente quando desce na tela, de costas quando sobe.
    const toward = s.holder === p.id ? (p.team === 'azul' ? 'E' : 'W') : p.facing;
    const facingBack = d.back ?? false;
    const facingLeft = d.flip ?? toward === 'W';
    const idleBob = d.frame ? 0 : Math.sin(now / 380 + p.number) > 0.6 ? 1 : 0;
    const frame: Frame = d.frame ?? 'idle';
    const spr = playerSprite(p, frame, facingBack ? 'back' : 'front');
    const sw = spr.width * SCALE;
    const sh = spr.height * SCALE;
    for (const [i, gh] of d.ghosts.entries()) {
      const gp = this.P(d.x + gh.dx, d.y + gh.dy);
      ctx.save();
      ctx.globalAlpha = 0.32 - i * 0.08;
      ctx.translate(gp.x, gp.y - d.h - idleBob);
      if (facingLeft) ctx.scale(-1, 1);
      ctx.drawImage(spr, -sw / 2, -sh + 2, sw, sh);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = dim ? 0.62 : 1;
    ctx.translate(g.x, g.y - d.h - idleBob);
    if (d.rot) ctx.rotate(d.rot);
    if (facingLeft) ctx.scale(-1, 1);
    ctx.drawImage(spr, -sw / 2, -sh + 2, sw, sh);
    if (d.flash) ctx.drawImage(whiteSprite(p, frame, facingBack ? 'back' : 'front'), -sw / 2, -sh + 2, sw, sh);
    ctx.restore();
    // Estrelinhas de tontura (desequilibrado).
    if (d.dizzy || p.unbalanced) {
      for (let i = 0; i < 3; i++) {
        const a = now / 260 + (i * Math.PI * 2) / 3;
        const sp = {
          x: g.x + Math.cos(a) * 10,
          y: g.y - sh - d.h + Math.sin(a) * 3 + 2,
        };
        ctx.fillStyle = '#ffe14d';
        ctx.fillRect(sp.x - 1.5, sp.y - 0.5, 3, 1);
        ctx.fillRect(sp.x - 0.5, sp.y - 1.5, 1, 3);
      }
    }
    // Nome (escondido no Duelo, que já mostra os dois no topo).
    if (this.duelActive) return;
    const top = g.y - sh - d.h - 6;
    // Com zoom, o nome não cresce junto (fica com tamanho parecido na tela).
    const k = Math.min(1, 1.3 / this.cam.z);
    ctx.save();
    ctx.translate(g.x, top);
    ctx.scale(k, k);
    ctx.translate(-g.x, -top);
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(10,10,18,0.55)';
    const label = `${p.number} ${p.name}`;
    const tw = ctx.measureText(label).width + 17;
    ctx.fillRect(g.x - tw / 2, top - 11, tw, 11);
    // Símbolo colorido da posição, antes do nome.
    drawRoleBadge(ctx, p.role, g.x - tw / 2 + 6, top - 5.5, 3.6);
    ctx.fillStyle = p.team === 'azul' ? '#bcd6ff' : '#ffc2b8';
    ctx.fillText(label, g.x + 5.5, top - 1);
    if (p.ready && s.activeTeam !== p.team) {
      ctx.fillStyle = '#ffe14d';
      ctx.fillText('!', g.x + tw / 2 + 4, top - 1);
    }
    if (p.energetico) {
      // Garrafinha ao lado do nome: tem energético guardado.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(drinkSprite(), g.x - tw / 2 - 8, top - 13 + Math.sin(now / 300) * 1, 6, 12);
    }
    ctx.restore();
  }

  private drawGoal(team: Team, now: number, part: 'back' | 'front'): void {
    const ctx = this.ctx;
    const gx = team === 'azul' ? 0 : COURT_W;
    const depthX = team === 'azul' ? -0.75 : COURT_W + 0.75;
    const y0 = COURT_H / 2 - 1;
    const y1 = COURT_H / 2 + 1;
    const H = 30;
    const bulge = this.netBulge && this.netBulge.team === team ? Math.max(0, 1 - (now - this.netBulge.t0) / 700) : 0;
    if (bulge <= 0 && this.netBulge?.team === team) this.netBulge = null;
    const bx = depthX + (team === 'azul' ? -0.35 : 0.35) * bulge;
    if (part === 'back') {
      // Rede: fundo e laterais.
      const net = 'rgba(255,255,255,0.45)';
      ctx.strokeStyle = net;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const y = y0 + ((y1 - y0) * i) / 8;
        const a = this.P(bx, y, 0);
        const b = this.P(bx, y, H * 0.85);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let k = 0; k <= 5; k++) {
        const hh = (H * 0.85 * k) / 5;
        const a = this.P(bx, y0, hh);
        const b = this.P(bx, y1, hh);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      // Teto e lateral de trás.
      for (let i = 0; i <= 4; i++) {
        const fx = gx + (bx - gx) * (i / 4);
        const a = this.P(fx, y0, H - (H * 0.15 * i) / 4);
        const b = this.P(fx, y1, H - (H * 0.15 * i) / 4);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      // Trave de trás (lado de cima da tela).
      this.post(gx, y0, H);
      const c0 = this.P(gx, y0, H);
      const c1 = this.P(gx, y1, H);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c0.x, c0.y);
      ctx.lineTo(c1.x, c1.y);
      ctx.stroke();
      ctx.strokeStyle = team === 'azul' ? '#2f6fd8' : '#d63a2f';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(c0.x, c0.y);
      ctx.lineTo(c1.x, c1.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      this.post(gx, y1, H);
    }
  }

  private post(fx: number, fy: number, H: number): void {
    const ctx = this.ctx;
    const a = this.P(fx, fy, 0);
    const b = this.P(fx, fy, H);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = '#1a1418';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x + 1.5, a.y);
    ctx.lineTo(b.x + 1.5, b.y);
    ctx.stroke();
  }

  private drawParticles(now: number): void {
    const ctx = this.ctx;
    this.particles = this.particles.filter((p) => now - p.t0 < p.life);
    for (const p of this.particles) {
      const t = (now - p.t0) / 1000;
      const fx = p.x + p.vx * t;
      const fy = p.y + p.vy * t;
      const hgt = 20 * t * 3 - p.g * 60 * t * t * 10 + 10;
      const pt = this.P(fx, fy, Math.max(0, hgt));
      ctx.globalAlpha = 1 - (now - p.t0) / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(pt.x, pt.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawBalloons(now: number): void {
    const ctx = this.ctx;
    this.balloons = this.balloons.filter((b) => now - b.t0 < 1300);
    for (const b of this.balloons) {
      const d = this.disp.get(b.id);
      if (!d) continue;
      const t = (now - b.t0) / 1300;
      const pop = t < 0.15 ? t / 0.15 : 1;
      const g = this.P(d.x, d.y, d.h + 62 + t * 6);
      ctx.save();
      ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
      ctx.translate(g.x + 12, g.y);
      ctx.scale(pop, pop);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1a1418';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-10, -10, 20, 16, 5);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-5, 6);
      ctx.lineTo(-9, 11);
      ctx.lineTo(0, 6);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 12px system-ui, sans-serif';
      const map: Record<Emote, [string, string]> = {
        '!': ['!', '#d63a2f'],
        '?': ['?', '#2f6fd8'],
        suor: ['💧', '#2f6fd8'],
        coracao: ['♥', '#e8455a'],
        raiva: ['💢', '#d63a2f'],
        estrela: ['★', '#e8b800'],
        musica: ['♪', '#7a3fd0'],
      };
      const [ch, col] = map[b.emote];
      ctx.fillStyle = col;
      ctx.fillText(ch, 0, -2);
      ctx.restore();
    }
  }

  private drawFloats(now: number): void {
    const ctx = this.ctx;
    this.floats = this.floats.filter((f) => now - f.t0 < (f.life ?? 1000));
    for (const f of this.floats) {
      const t = (now - f.t0) / (f.life ?? 1000);
      const p = f.raw ? this.P(f.x, f.y, (f.h ?? 50) + t * 14) : this.P(f.x + 0.5, f.y + 0.5, 50 + t * 20);
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.4 : 1;
      ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
      // Texto com tamanho parecido na tela, com ou sem zoom.
      const size = ((f.size ?? 12) * pop * 1.5) / Math.max(1.5, this.cam.z);
      ctx.font = `900 ${size.toFixed(1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = size / 4;
      ctx.strokeStyle = '#1a1418';
      ctx.strokeText(f.text, p.x, p.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  private drawBanners(now: number): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.banners = this.banners.filter((b) => now - b.t0 < b.dur);
    this.banners.forEach((b, i) => {
      const t = (now - b.t0) / b.dur;
      const slide = t < 0.12 ? 1 - t / 0.12 : t > 0.85 ? (t - 0.85) / 0.15 : 0;
      const y = H * (b.big ? 0.42 : 0.22) + i * 40;
      const x = W / 2 + slide * (t < 0.5 ? -W : W) * 0.6;
      ctx.save();
      ctx.translate(x, y);
      const scale = b.big ? 1 + 0.06 * Math.sin(now / 80) : 1;
      ctx.scale(scale, scale);
      ctx.font = `900 ${b.big ? 54 : 26}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(b.text).width + 40;
      ctx.fillStyle = 'rgba(10,10,20,0.72)';
      ctx.fillRect(-w / 2, -(b.big ? 40 : 22), w, b.big ? (b.sub ? 96 : 80) : b.sub ? 58 : 44);
      ctx.lineWidth = b.big ? 8 : 5;
      ctx.strokeStyle = '#1a1418';
      ctx.strokeText(b.text, 0, 0);
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, 0, 0);
      if (b.sub) {
        ctx.font = `700 ${b.big ? 16 : 13}px system-ui, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.sub, 0, b.big ? 40 : 24);
      }
      ctx.restore();
    });
  }

  // ---------- Clique ----------

  clientPoint(x: number, y: number): Pt {
    const w = this.P(x + 0.5, y + 0.5);
    const p = {
      x: w.x * this.cam.z + this.cam.tx,
      y: w.y * this.cam.z + this.cam.ty,
    };
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.left + (p.x / this.canvas.width) * r.width,
      y: r.top + (p.y / this.canvas.height) * r.height,
    };
  }

  /** Jogador cujo desenho (corpo e cabeça) está sob o ponto da página; o da frente ganha. */
  playerAtClient(clientX: number, clientY: number): string | null {
    const c = this.toCanvas(clientX, clientY);
    const sx = (c.x - this.cam.tx) / this.cam.z;
    const sy = (c.y - this.cam.ty) / this.cam.z;
    const halfW = 9 * SCALE * 0.8;
    const tall = 26 * SCALE;
    let best: string | null = null;
    let bestDepth = -Infinity;
    for (const [id, d] of this.disp) {
      const g = this.P(d.x, d.y);
      if (sx < g.x - halfW || sx > g.x + halfW || sy < g.y - d.h - tall || sy > g.y + 3) continue;
      const depth = d.x * AY + d.y * BY;
      if (depth > bestDepth) {
        bestDepth = depth;
        best = id;
      }
    }
    return best;
  }

  cellAt(clientX: number, clientY: number): Pos | null {
    const c = this.toCanvas(clientX, clientY);
    const sx = (c.x - this.cam.tx) / this.cam.z;
    const sy = (c.y - this.cam.ty) / this.cam.z;
    const dx = sx - this.ox;
    const dy = sy - this.oy;
    const det = AX * BY - BX * AY;
    const fx = (dx * BY - BX * dy) / det;
    const fy = (AX * dy - AY * dx) / det;
    const p = { x: Math.floor(fx), y: Math.floor(fy) };
    if (p.x < 0 || p.y < 0 || p.x >= COURT_W || p.y >= COURT_H) return null;
    return p;
  }
}
