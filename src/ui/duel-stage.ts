// Palco do Duelo: os dois jogadores frente a frente num pedaço da quadra, com a bola,
// animando cada lance (com e sem a bola), a vantagem de cada tempo e a falta.

import { sidePlayer } from '../core';
import type { DuelState, GameState, Lance, SideKey, TempoResult } from '../core';
import { BALL, playerSprite, whiteSprite } from './sprites';
import type { Frame } from './sprites';
import { TEAM_COLOR } from './renderer';

const W = 228;
const H = 92;
const SCALE = 3;
const PX = 2;
const GROUND = 40;
const FOOT = { L: 33, R: 81 } as const;

type Pos = 'L' | 'R';

interface Pose {
  dx: number;
  dy: number;
  rot: number;
  frame: Frame;
  back: boolean;
  squash: number;
  ghosts: number[];
  flash: boolean;
  fall: boolean;
}

const ease = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));

export class DuelStage {
  readonly el: HTMLCanvasElement;
  private low: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private raf = 0;
  private side: Record<Pos, SideKey>;
  private anim: {
    t0: number;
    r: TempoResult;
    done: () => void;
    finished: boolean;
  } | null = null;
  private crowd: { x: number; y: number; c: string; ph: number }[] = [];

  constructor(
    private s: GameState,
    private cs: DuelState,
    playerSide: SideKey,
  ) {
    this.side = { L: playerSide, R: playerSide === 'atk' ? 'def' : 'atk' };
    this.el = document.createElement('canvas');
    this.el.className = 'duel-stage';
    this.el.width = W * SCALE;
    this.el.height = H * SCALE;
    this.ctx = this.el.getContext('2d')!;
    this.low = document.createElement('canvas');
    this.low.width = W;
    this.low.height = H;
    this.lctx = this.low.getContext('2d')!;
    this.bg = this.buildBg();
    const loop = (t: number) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  get busy(): boolean {
    return !!this.anim && !this.anim.finished;
  }

  play(r: TempoResult, done: () => void): void {
    this.anim = { t0: performance.now(), r, done, finished: false };
  }

  private p(pos: Pos) {
    return sidePlayer(this.s, this.cs, this.side[pos]);
  }

  private dir(pos: Pos): number {
    return pos === 'L' ? 1 : -1;
  }

  private hasBall(pos: Pos): boolean {
    return this.cs.ball === this.side[pos];
  }

  // ---------- Cenário ----------

  private buildBg(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    // Parede e arquibancada.
    const bands = ['#1d2233', '#232a3f', '#2a3047', '#30364f'];
    bands.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(0, i * 10, W, 10);
    });
    g.fillStyle = '#0f1220';
    g.fillRect(0, 40, W, 9);
    g.fillStyle = '#ffe14d';
    g.font = 'bold 7px monospace';
    g.fillText('TRAMA FUTSAL', 8, 47);
    g.fillStyle = '#7fb0ff';
    g.fillText('VAPOR & BOLA', 130, 47);
    // Piso de madeira em perspectiva (faixas).
    for (let y = 49; y < H; y++) {
      const k = (y - 49) / (H - 49);
      const tone = 200 + Math.round(18 * k);
      g.fillStyle = `rgb(${tone}, ${Math.round(tone * 0.72)}, ${Math.round(tone * 0.43)})`;
      g.fillRect(0, y, W, 1);
    }
    for (let x = -60; x < W + 60; x += 14) {
      g.strokeStyle = 'rgba(120,80,40,0.25)';
      g.beginPath();
      g.moveTo(x + 40, 49);
      g.lineTo(x - 10, H);
      g.stroke();
    }
    // Linha do meio-campo.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(0, 70, W, 1);
    let seed = 3;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const cols = ['#2f6fd8', '#d63a2f', '#ffe14d', '#ffffff', '#2fbf6a'];
    for (let row = 0; row < 3; row++)
      for (let x = 0; x < W; x += 5 + rnd() * 3)
        this.crowd.push({
          x,
          y: 8 + row * 10,
          c: cols[Math.floor(rnd() * cols.length)],
          ph: rnd() * 6.28,
        });
    return c;
  }

  // ---------- Poses ----------

  private pose(pos: Pos, t: number | null): Pose {
    const base: Pose = {
      dx: 0,
      dy: 0,
      rot: 0,
      frame: 'idle',
      back: false,
      squash: 1,
      ghosts: [],
      flash: false,
      fall: false,
    };
    if (t === null || !this.anim) return base;
    const r = this.anim.r;
    const k = this.side[pos];
    const l: Lance = k === 'atk' ? r.atk : r.def;
    const ball = this.hasBall(pos);
    const myGain = k === 'atk' ? r.atkGain : r.defGain;
    const theirGain = k === 'atk' ? r.defGain : r.atkGain;
    const c = Math.min(1, t / 0.45); // ida até o contato
    const back = t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1; // volta
    switch (l) {
      case 'golpe':
        base.dx = (ball ? 14 : 16) * ease(c) * back;
        base.frame = ball ? (Math.floor(t * 10) % 2 ? 'run1' : 'run2') : t < 0.5 ? 'kick' : 'idle';
        base.rot = ball ? 0 : 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.6));
        base.dy = ball ? 0 : Math.sin(Math.PI * Math.min(1, t * 1.6)) * 2;
        if (ball && t < 0.45) base.ghosts = [base.dx - 4, base.dx - 8];
        break;
      case 'guarda':
        base.dx = -2 * ease(c);
        base.back = ball; // vira o corpo para proteger
        base.squash = ball ? 1 : 0.9;
        break;
      case 'finta':
        base.dx = (ball ? 4 : 7) * Math.sin(t * Math.PI * (ball ? 4 : 1.2)) * (1 - t * 0.6);
        base.dy = -Math.abs(Math.sin(t * Math.PI * 3)) * (ball ? 2 : 0);
        base.frame = Math.floor(t * 8) % 2 ? 'run1' : 'idle';
        base.ghosts = t < 0.7 ? [base.dx - 3, base.dx + 3] : [];
        break;
      default:
        base.dx = ball ? 0 : -4 * ease(c);
        base.squash = 0.96 + 0.04 * Math.sin(t * Math.PI * 4);
    }
    // Perdeu o tempo: pisca; se foi desequilibrado, cambaleia; na falta, cai.
    if (theirGain > myGain && t > 0.42 && t < 0.62) base.flash = true;
    if (r.exposed === k && t > 0.45) base.rot += 0.25 * Math.sin((t - 0.45) * Math.PI * 4) * (1 - t);
    if (r.foul && ball && t > 0.4) {
      base.fall = true;
      base.rot = -1.2 * Math.min(1, (t - 0.4) * 3);
      base.dy = 3;
    }
    return base;
  }

  // ---------- Quadro ----------

  private frame(now: number): void {
    const a = this.anim;
    const t = a ? Math.min(1, (now - a.t0) / 1000) : null;
    if (a && !a.finished && t !== null && t >= 1) {
      a.finished = true;
      a.done();
    }
    const live = a && !a.finished ? t : null;
    const c = this.lctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.bg, 0, 0);
    for (const p of this.crowd) {
      const j = Math.max(0, Math.sin(now / 240 + p.ph)) * 2;
      c.fillStyle = p.c;
      c.fillRect(p.x, p.y - j, 3, 3);
      c.fillStyle = 'rgba(240,210,170,0.8)';
      c.fillRect(p.x + 0.5, p.y - 2 - j, 2, 2);
    }
    c.save();
    c.scale(PX, PX);
    const poses = { L: this.pose('L', live), R: this.pose('R', live) };
    for (const pos of ['L', 'R'] as const) this.drawShadow(pos, poses[pos]);
    const order: Pos[] = poses.L.dx >= poses.R.dx ? ['R', 'L'] : ['L', 'R'];
    for (const pos of order) this.drawFighter(pos, poses[pos]);
    this.drawBall(poses, live, now);
    if (live !== null) this.drawEffects(live);
    c.restore();
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.drawImage(this.low, 0, 0, W * SCALE, H * SCALE);
    this.drawTexts(live);
  }

  private drawShadow(pos: Pos, pose: Pose): void {
    const c = this.lctx;
    const x = FOOT[pos] + this.dir(pos) * pose.dx;
    c.fillStyle = 'rgba(60,30,5,0.35)';
    c.fillRect(Math.round(x - 7), GROUND, 14, 2);
  }

  private drawFighter(pos: Pos, pose: Pose): void {
    const p = this.p(pos);
    const view = pose.back ? 'back' : 'front';
    const spr = playerSprite(p, pose.frame, view);
    const d = this.dir(pos);
    const draw = (img: CanvasImageSource, dx: number, alpha: number) => {
      const c = this.lctx;
      c.save();
      c.globalAlpha = alpha;
      c.translate(Math.round(FOOT[pos] + d * dx), GROUND + 2 + Math.round(pose.dy));
      if (pose.rot) c.rotate(pose.rot * d);
      // Lado esquerdo olha para a direita (sprite original); o direito é espelhado.
      c.scale(d * (pose.back ? -1 : 1), pose.squash);
      c.drawImage(img, -spr.width / 2, -spr.height);
      c.restore();
    };
    pose.ghosts.forEach((g, i) => draw(spr, g, 0.28 - i * 0.1));
    draw(spr, pose.dx, 1);
    if (pose.flash) draw(whiteSprite(p, pose.frame, view), pose.dx, 0.8);
  }

  private drawBall(poses: Record<Pos, Pose>, t: number | null, now: number): void {
    const c = this.lctx;
    const ballPos: Pos = this.hasBall('L') ? 'L' : 'R';
    const pose = poses[ballPos];
    const d = this.dir(ballPos);
    let x = FOOT[ballPos] + d * (pose.dx + 7);
    let y = GROUND - 2;
    if (t !== null && this.anim) {
      const r = this.anim.r;
      const k = this.side[ballPos];
      const l = k === 'atk' ? r.atk : r.def;
      if (l === 'finta') x += Math.sin(t * Math.PI * 6) * 4; // pedalada
      if (l === 'guarda') x -= d * 12; // bola atrás do corpo
      if (l === 'esperar') x += Math.sin(t * Math.PI * 2) * 2; // sola
      if (l === 'golpe') x += d * 4 * Math.sin(Math.PI * Math.min(1, t * 2));
      const markGain = k === 'atk' ? r.defGain : r.atkGain;
      // O marcador venceu o tempo: a bola escapa por um instante na direção dele.
      if (markGain > 0 && t > 0.45 && t < 0.8) {
        const q = Math.sin(((t - 0.45) / 0.35) * Math.PI);
        x += d * 10 * q;
        y -= 6 * q;
      }
    } else {
      y -= Math.abs(Math.sin(now / 300)) * 1.5;
    }
    c.fillStyle = 'rgba(60,30,5,0.35)';
    c.fillRect(Math.round(x - 2), GROUND, 4, 1);
    BALL.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) {
        const ch = row[xx];
        if (ch === '.') continue;
        c.fillStyle = ch === 'k' ? '#1a1418' : '#ffffff';
        c.fillRect(Math.round(x - 3 + xx * 0.85), Math.round(y - 6 + yy * 0.85), 1, 1);
      }
    });
  }

  private drawEffects(t: number): void {
    if (!this.anim) return;
    const r = this.anim.r;
    const c = this.lctx;
    const mid = (FOOT.L + FOOT.R) / 2;
    if (t > 0.42 && t < 0.75) {
      const q = (t - 0.42) / 0.33;
      const winner = r.atkGain === r.defGain ? null : r.atkGain > r.defGain ? 'atk' : 'def';
      if (winner || r.foul) {
        const col = r.foul ? '#ffe14d' : '#ffffff';
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          c.fillStyle = col;
          c.fillRect(Math.round(mid + Math.cos(a) * (2 + 10 * q)), Math.round(GROUND - 14 + Math.sin(a) * (2 + 6 * q)), 1, 1);
        }
      } else {
        // Ninguém ganhou: um vento entre os dois.
        c.fillStyle = 'rgba(255,255,255,0.6)';
        c.fillRect(Math.round(mid - 6 + 12 * q), GROUND - 16, 4, 1);
        c.fillRect(Math.round(mid - 4 + 10 * q), GROUND - 12, 3, 1);
      }
    }
    // Poeira no bote e na arrancada.
    for (const pos of ['L', 'R'] as const) {
      const k = this.side[pos];
      const l = k === 'atk' ? r.atk : r.def;
      if (l !== 'golpe' || t > 0.6) continue;
      const x = FOOT[pos] + this.dir(pos) * 6 * t;
      c.fillStyle = 'rgba(240,225,190,0.7)';
      c.fillRect(Math.round(x - this.dir(pos) * 6), GROUND - 1 - Math.round(t * 4), 2, 2);
      c.fillRect(Math.round(x - this.dir(pos) * 9), GROUND - Math.round(t * 2), 2, 2);
    }
  }

  private drawTexts(t: number | null): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Vantagem acumulada de cada um.
    for (const pos of ['L', 'R'] as const) {
      const k = this.side[pos];
      const v = this.cs[k].vantage;
      const p = this.p(pos);
      const x = (pos === 'L' ? 46 : W - 46) * SCALE;
      ctx.fillStyle = 'rgba(10,10,20,0.6)';
      ctx.fillRect(x - 60, 6, 120, 22);
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = TEAM_COLOR[p.team];
      ctx.fillText(`${p.name}${this.hasBall(pos) ? ' ⚽' : ''}`, x - 18, 17);
      ctx.fillStyle = '#ffe14d';
      ctx.fillText(`★ ${v}`, x + 38, 17);
    }
    if (t === null || !this.anim) return;
    const r = this.anim.r;
    const names = {
      bola: {
        golpe: 'Arrancada!',
        guarda: 'Proteger',
        finta: 'Finta!',
        esperar: 'Cadenciar',
      },
      marca: {
        golpe: 'Bote!',
        guarda: 'Fechar',
        finta: 'Simular bote',
        esperar: 'Recuar',
      },
    } as const;
    for (const pos of ['L', 'R'] as const) {
      const k = this.side[pos];
      const l = k === 'atk' ? r.atk : r.def;
      const gain = k === 'atk' ? r.atkGain : r.defGain;
      const x = (FOOT[pos] * PX + (pos === 'L' ? -6 : 6)) * SCALE;
      ctx.globalAlpha = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(12,10,16,0.9)';
      const text = names[this.hasBall(pos) ? 'bola' : 'marca'][l];
      ctx.strokeText(text, x, 44);
      ctx.fillStyle = l === 'golpe' ? '#ff9a6a' : l === 'guarda' ? '#8fc4ff' : l === 'finta' ? '#c9a2ff' : '#d0d0d6';
      ctx.fillText(text, x, 44);
      if (gain > 0 && t > 0.45) {
        ctx.font = 'bold 20px system-ui, sans-serif';
        const y = (GROUND * PX - 50) * SCALE - (t - 0.45) * 50;
        ctx.strokeText(`+${gain}`, x, y);
        ctx.fillStyle = '#ffe14d';
        ctx.fillText(`+${gain}`, x, y);
      }
      ctx.globalAlpha = 1;
    }
    if (r.foul && t > 0.4) {
      ctx.font = '900 30px system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#1a1418';
      ctx.strokeText('FALTA!', (W * SCALE) / 2, 130);
      ctx.fillStyle = '#ffe14d';
      ctx.fillText('FALTA!', (W * SCALE) / 2, 130);
    }
  }
}
