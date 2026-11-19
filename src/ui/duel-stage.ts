// Palco do Confronto: os dois sprites frente a frente, cada um diante da arte do seu terreno,
// com animação de cada lance (ataque próprio de cada classe, Guarda, Finta, Esperar), reação
// ao acerto e número de dano. Tudo é desenhado em baixa resolução e ampliado sem borrar; os
// textos vão por cima, em alta resolução.

import { CLASSES, sideUnit } from '../core';
import type { ClassId, ConfrontoState, GameState, Lance, SideKey, Team, TempoResult, Terrain } from '../core';
import { spriteAnchor, spriteCanvas } from './sprites';

const W = 228;
const H = 84;
const SCALE = 3;
const HALF = W / 2;
/** Lutadores e efeitos usam pixels 2× maiores que os do cenário (coordenadas abaixo nessa escala). */
const PX = 2;
const GROUND = 36;
const FOOT = { L: 30, R: 84 } as const;

/** Quanto cada classe avança no golpe (pixels do palco). */
const REACH: Partial<Record<ClassId, number>> = {
  espadachim: 33,
  tank: 29,
  cavaleiro: 27,
  blindado: 25,
  mecanico: 31,
  construtor: 29,
  medico: 33,
  espiao: 34,
};
const HEAVY_HIT: ClassId[] = ['tank', 'blindado', 'construtor'];

const LANCE_TEXT: Record<Lance, { text: string; color: string }> = {
  golpe: { text: 'Golpe!', color: '#ff9a6a' },
  guarda: { text: 'Guarda', color: '#8fc4ff' },
  finta: { text: 'Finta', color: '#c9a2ff' },
  esperar: { text: 'Espera…', color: '#c8c8cc' },
};

type Pos = 'L' | 'R';

interface Act {
  lance: Lance;
  hits: boolean;
  took: number;
  dies: boolean;
  cls: ClassId;
  team: Team;
}

interface Pose {
  dx: number;
  dy: number;
  rot: number;
  alpha: number;
  flash: boolean;
  ghosts: number[];
}

/** Momento (ms) em que o lance deste lado encosta no outro, ou null se não ataca. */
function contactTime(a: Act): number | null {
  if (a.lance === 'golpe') return 300;
  if (a.lance === 'guarda' && a.hits) return 620;
  if (a.lance === 'finta' && a.hits) return 580;
  return null;
}

const ease = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));
const easeOut = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - (1 - p) * (1 - p));
const clamp01 = (p: number) => Math.max(0, Math.min(1, p));

export class DuelStage {
  readonly el: HTMLCanvasElement;
  private low: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private ctx: CanvasRenderingContext2D;
  private bgs: Record<Pos, HTMLCanvasElement>;
  private raf = 0;
  private anim: { t0: number; acts: Record<Pos, Act>; done: () => void; finished: boolean } | null = null;
  private side: Record<Pos, SideKey>;
  private fallen: Record<Pos, boolean> = { L: false, R: false };
  private whites = new Map<string, HTMLCanvasElement>();

  constructor(
    private s: GameState,
    private cs: ConfrontoState,
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
    this.bgs = { L: this.backdrop('L'), R: this.backdrop('R') };
    for (const p of ['L', 'R'] as const) this.fallen[p] = !this.unit(p).alive;
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

  /** Anima um tempo já resolvido; `done` é chamado quando a animação termina. */
  play(r: TempoResult, done: () => void): void {
    const mk = (p: Pos): Act => {
      const k = this.side[p];
      const u = this.unit(p);
      const mine = k === 'atk' ? r.atk : r.def;
      const dealt = k === 'atk' ? r.defTook : r.atkTook;
      const took = k === 'atk' ? r.atkTook : r.defTook;
      return { lance: mine, hits: dealt > 0, took, dies: took > 0 && !u.alive, cls: u.cls, team: u.team };
    };
    this.anim = { t0: performance.now(), acts: { L: mk('L'), R: mk('R') }, done, finished: false };
  }

  private unit(p: Pos) {
    return sideUnit(this.s, this.cs, this.side[p]);
  }

  // ---------- Quadro ----------

  private frame(now: number): void {
    const c = this.lctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    const a = this.anim;
    const t = a ? now - a.t0 : 0;
    if (a && !a.finished && t > 1000) {
      a.finished = true;
      for (const p of ['L', 'R'] as const) if (a.acts[p].dies) this.fallen[p] = true;
      a.done();
    }
    const live = a && !a.finished ? a : null;

    // Tremida da tela nos golpes pesados.
    let shx = 0;
    let shy = 0;
    if (live) {
      for (const p of ['L', 'R'] as const) {
        const ct = contactTime(live.acts[p]);
        const other = live.acts[p === 'L' ? 'R' : 'L'];
        if (ct !== null && other.took > 0 && HEAVY_HIT.includes(live.acts[p].cls) && t >= ct && t < ct + 180) {
          shx = Math.round(Math.sin(t * 0.9) * 2);
          shy = Math.round(Math.cos(t * 1.3) * 1);
        }
      }
    }
    c.save();
    c.translate(shx, shy);
    c.drawImage(this.bgs.L, 0, 0);
    c.drawImage(this.bgs.R, HALF, 0);
    // Divisória.
    c.fillStyle = '#1a1418';
    c.fillRect(HALF - 1, 0, 2, H);
    c.fillStyle = '#dcb052';
    c.fillRect(HALF, 0, 1, H);

    const poses = { L: this.pose('L', live, t, now), R: this.pose('R', live, t, now) };
    c.scale(PX, PX);
    for (const p of ['L', 'R'] as const) this.drawShadow(p, poses[p]);
    // Quem avança fica na frente.
    const order: Pos[] = poses.L.dx >= poses.R.dx ? ['R', 'L'] : ['L', 'R'];
    for (const p of order) this.drawFighter(p, poses[p]);
    if (live) this.drawEffects(live, t, poses);
    c.restore();

    // Amplia sem borrar e escreve os textos em alta resolução.
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.drawImage(this.low, 0, 0, W * SCALE, H * SCALE);
    if (live) this.drawTexts(live, t, poses);
  }

  private dir(p: Pos): number {
    return p === 'L' ? 1 : -1;
  }

  // ---------- Poses ----------

  private pose(p: Pos, a: { acts: Record<Pos, Act> } | null, t: number, now: number): Pose {
    const base: Pose = { dx: 0, dy: 0, rot: 0, alpha: 1, flash: false, ghosts: [] };
    if (this.fallen[p]) return { ...base, rot: -1.45, dy: 2, alpha: 0.55 };
    if (!a) {
      // Respiração.
      base.dy = Math.sin(now / 420 + (p === 'L' ? 0 : 1.7)) > 0.55 ? -1 : 0;
      return base;
    }
    const me = a.acts[p];
    const other = a.acts[p === 'L' ? 'R' : 'L'];
    const both = me.lance === 'golpe' && other.lance === 'golpe';
    let pose: Pose;
    switch (me.lance) {
      case 'golpe':
        pose = this.strike(me.cls, t, both ? 0.6 : 1);
        break;
      case 'guarda':
        if (me.hits && t >= 320) pose = this.strike(me.cls, t - 320, 0.85);
        else {
          const back = t < 700 ? -4 * ease(t / 180) : -4 * (1 - ease((t - 700) / 220));
          pose = { ...base, dx: back };
        }
        break;
      case 'finta': {
        if (me.hits && t >= 280) {
          pose = this.strike(me.cls, t - 280, 0.9);
          break;
        }
        let dx: number;
        let dy = 0;
        const ghosts: number[] = [];
        if (t < 130) dx = 9 * easeOut(t / 130);
        else if (t < 300) {
          const q = (t - 130) / 170;
          dx = 9 - 17 * ease(q);
          dy = -Math.round(6 * Math.sin(Math.PI * q));
          ghosts.push(dx + 6, dx + 12);
        } else if (t < 650) dx = -8;
        else dx = -8 * (1 - ease((t - 650) / 250));
        pose = { ...base, dx, dy, ghosts };
        break;
      }
      default:
        pose = { ...base, dy: t > 80 && t < 760 ? 1 : 0 };
    }
    // Reação ao acerto: pisca branco, é empurrado para trás; se cair, tomba.
    if (me.took > 0) {
      const ct = contactTime(other);
      if (ct !== null && t >= ct) {
        const q = (t - ct) / 260;
        pose.flash = t - ct < 110;
        pose.dx -= 8 * (1 - clamp01(q));
        if (me.dies && t > ct + 220) {
          const f = ease((t - ct - 220) / 380);
          pose.rot = -1.45 * f;
          pose.dy = 2 * f;
          pose.alpha = 1 - 0.45 * f;
        }
      }
    }
    return pose;
  }

  /** O golpe de cada classe (t = ms desde o início do golpe; encosta em 300 ms). */
  private strike(cls: ClassId, t: number, reachMul: number): Pose {
    const reach = (REACH[cls] ?? 28) * reachMul;
    const p: Pose = { dx: 0, dy: 0, rot: 0, alpha: 1, flash: false, ghosts: [] };
    const windBack = cls === 'cavaleiro' ? -10 : cls === 'blindado' ? -6 : -4;
    if (t < 140) p.dx = windBack * ease(t / 140);
    else if (t < 300) p.dx = windBack + (reach - windBack) * easeOut((t - 140) / 160);
    else if (t < 420) p.dx = reach;
    else p.dx = reach * (1 - ease((t - 420) / 300));
    const lunge = clamp01((t - 140) / 160);
    switch (cls) {
      case 'espadachim':
      case 'cavaleiro':
        if (t >= 140 && t < 320) p.ghosts = [p.dx - 7, p.dx - 14];
        break;
      case 'construtor':
        // Pula e desce a marreta.
        if (t >= 140 && t < 300) p.dy = -Math.round(13 * Math.sin(Math.PI * lunge));
        p.rot = t < 140 ? -0.25 * ease(t / 140) : t < 300 ? -0.25 + 0.55 * lunge : t < 420 ? 0.3 : 0.3 * (1 - ease((t - 420) / 200));
        break;
      case 'mecanico':
        // Balança a chave por cima.
        p.rot = t < 140 ? -0.35 * ease(t / 140) : t < 300 ? -0.35 + 0.8 * lunge : t < 420 ? 0.45 : 0.45 * (1 - ease((t - 420) / 220));
        break;
      case 'blindado':
        if (t >= 300 && t < 460) p.dx = reach - 6 * Math.sin(Math.PI * ((t - 300) / 160)); // recuo do tiro
        break;
      case 'espiao':
        // Some numa fumaça e reaparece colado no inimigo.
        if (t < 110) p.dx = 0;
        else if (t < 230) {
          p.alpha = 0;
          p.dx = reach;
        } else if (t < 420) p.dx = reach;
        break;
      case 'medico':
        if (t >= 300 && t < 360) p.dx = reach + 3; // estocada da seringa
        break;
      default:
        break;
    }
    return p;
  }

  // ---------- Desenho ----------

  private drawShadow(p: Pos, pose: Pose): void {
    const c = this.lctx;
    const x = Math.round(FOOT[p] + this.dir(p) * pose.dx);
    const w = CLASSES[this.unit(p).cls].vehicle || this.unit(p).cls === 'cavaleiro' ? 13 : 9;
    const shrink = pose.dy < 0 ? 2 : 0;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(x - w + shrink, GROUND, (w - shrink) * 2, 2);
    c.fillRect(x - w + 2 + shrink, GROUND + 2, (w - 2 - shrink) * 2, 1);
  }

  private white(cls: ClassId, team: Team): HTMLCanvasElement {
    const key = `${cls}:${team}`;
    let w = this.whites.get(key);
    if (!w) {
      const src = spriteCanvas(cls, team);
      w = document.createElement('canvas');
      w.width = src.width;
      w.height = src.height;
      const c = w.getContext('2d')!;
      c.drawImage(src, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w.width, w.height);
      this.whites.set(key, w);
    }
    return w;
  }

  private drawFighter(p: Pos, pose: Pose): void {
    const u = this.unit(p);
    const spr = spriteCanvas(u.cls, u.team);
    const ax = Math.round(spriteAnchor(u.cls));
    const d = this.dir(p);
    const draw = (img: CanvasImageSource, dx: number, alpha: number) => {
      const c = this.lctx;
      c.save();
      c.globalAlpha = alpha;
      const fx = Math.round(FOOT[p] + d * dx);
      c.translate(fx, GROUND + 3 + Math.round(pose.dy));
      if (pose.rot) c.rotate(pose.rot * d);
      c.scale(d, 1);
      c.drawImage(img, -ax, -spr.height);
      c.restore();
    };
    pose.ghosts.forEach((g, i) => draw(spr, g, 0.32 - i * 0.12));
    if (pose.alpha <= 0) return;
    draw(spr, pose.dx, pose.alpha);
    if (pose.flash) draw(this.white(u.cls, u.team), pose.dx, 0.85);
  }

  /** Ponta do ataque (na frente do lutador). */
  private front(p: Pos, pose: Pose, ahead = 12): { x: number; y: number } {
    return { x: Math.round(FOOT[p] + this.dir(p) * (pose.dx + ahead)), y: GROUND - 11 };
  }

  private px(x: number, y: number, color: string, w = 1, h = 1): void {
    this.lctx.fillStyle = color;
    this.lctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  private drawEffects(a: { acts: Record<Pos, Act> }, t: number, poses: Record<Pos, Pose>): void {
    for (const p of ['L', 'R'] as const) {
      const me = a.acts[p];
      const o: Pos = p === 'L' ? 'R' : 'L';
      const other = a.acts[o];
      const d = this.dir(p);
      // Guarda: escudo de energia na frente enquanto defende.
      if (me.lance === 'guarda' && t > 60 && t < (me.hits ? 330 : 760)) {
        const f = this.front(p, poses[p], 9);
        const blocked = other.lance === 'golpe' && t >= 290 && t < 420;
        const col = blocked ? '#ffffff' : '#8fc4ff';
        for (let i = -9; i <= 9; i++) {
          const bend = Math.round(3 * (1 - (i * i) / 81));
          this.px(f.x + d * bend, f.y + i - 2, col);
          if (Math.abs(i) < 8 && (i + Math.floor(t / 60)) % 3 === 0) this.px(f.x + d * (bend - 1), f.y + i - 2, 'rgba(143,196,255,0.45)');
        }
      }
      // Finta: redemoinho roxo no salto.
      if (me.lance === 'finta' && t > 120 && t < 340) {
        const f = this.front(p, poses[p], 0);
        for (let i = 0; i < 6; i++) {
          const ang = t / 40 + i;
          this.px(f.x + Math.cos(ang) * 8, f.y - 4 + Math.sin(ang) * 5, '#c9a2ff');
        }
      }
      // Espera: gotinha de suor.
      if (me.lance === 'esperar' && t > 150 && t < 760) {
        const x = Math.round(FOOT[p] + d * (poses[p].dx + 6));
        this.px(x, GROUND - 26 + Math.floor((t - 150) / 120) % 3, '#8fd0ff', 1, 2);
      }
      // Ataque: efeito da classe no momento do contato.
      const ct = contactTime(me);
      if (ct === null) continue;
      const e = t - ct;
      if (me.cls === 'espiao' && me.lance === 'golpe') {
        // Fumaça ao sumir e ao reaparecer.
        for (const [at, x] of [
          [110, FOOT[p]],
          [230, FOOT[p] + d * poses[p].dx],
        ] as const) {
          const q = (t - at) / 220;
          if (q > 0 && q < 1) for (let i = 0; i < 7; i++) this.px(x + Math.cos(i) * 7 * q - 1, GROUND - 10 + Math.sin(i * 2) * 7 * q - q * 5, `rgba(70,64,90,${(1 - q).toFixed(2)})`, 3, 3);
        }
      }
      if (e < 0 || e > 260) continue;
      const f = this.front(p, poses[p]);
      const q = e / 260;
      if (!me.hits && other.lance !== 'golpe') {
        // Bloqueado (Guarda) ou parado pela Recuperação: faísca ou só o vento.
        const col = other.lance === 'guarda' ? '#fff3b0' : 'rgba(255,255,255,0.6)';
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          this.px(f.x + Math.cos(ang) * (2 + 7 * q), f.y + Math.sin(ang) * (2 + 7 * q), col);
        }
        continue;
      }
      this.classEffect(me.cls, f, d, q, e);
    }
  }

  private classEffect(cls: ClassId, f: { x: number; y: number }, d: number, q: number, e: number): void {
    const fade = (1 - q).toFixed(2);
    switch (cls) {
      case 'espadachim': {
        // Arco do corte.
        for (let i = 0; i < 14; i++) {
          const ang = -1.2 + (i / 13) * 2.2 - q * 0.6;
          const r = 13;
          this.px(f.x - d * 6 + d * Math.cos(ang) * r, f.y + Math.sin(ang) * r, i > 3 && i < 11 ? '#ffffff' : `rgba(220,240,255,${fade})`);
        }
        break;
      }
      case 'tank': {
        // Onda do empurrão com escudo.
        const r = 3 + q * 14;
        for (let i = 0; i < 16; i++) {
          const ang = (i / 16) * Math.PI * 2;
          this.px(f.x + Math.cos(ang) * r * 0.6, f.y + Math.sin(ang) * r, `rgba(255,240,200,${fade})`);
        }
        break;
      }
      case 'cavaleiro': {
        // Linhas de velocidade e a ponta da lança.
        for (let i = 0; i < 4; i++) this.px(f.x - d * (14 + i * 5 + q * 10), f.y - 6 + i * 4, `rgba(255,255,255,${fade})`, 6, 1);
        this.star(f.x + d * 4, f.y - 3, 3 + q * 4, '#fff3b0');
        break;
      }
      case 'blindado': {
        // Disparo à queima-roupa: clarão e fumaça.
        this.px(f.x + d * 2, f.y - 5, `rgba(255,216,94,${fade})`, 6, 5);
        this.px(f.x + d * 5, f.y - 4, `rgba(240,138,42,${fade})`, 5, 3);
        for (let i = 0; i < 5; i++) this.px(f.x - 2 + i * 3 * d, f.y - 8 - q * 12 - i, `rgba(200,200,206,${(0.7 * (1 - q)).toFixed(2)})`, 3, 3);
        break;
      }
      case 'mecanico': {
        // Rastro da chave e porcas voando.
        for (let i = 0; i < 6; i++) {
          const ang = -1.4 + i * 0.35;
          this.px(f.x - d * 8 + d * Math.cos(ang) * 12, f.y - 4 + Math.sin(ang) * 12, `rgba(180,186,195,${fade})`);
        }
        for (let i = 0; i < 4; i++) this.px(f.x + d * (q * 10 + i * 2), f.y - 6 + i * 3 - q * 6, '#dcb052', 2, 2);
        break;
      }
      case 'construtor': {
        // A marreta bate no chão: poeira e onda dos dois lados.
        for (let i = 0; i < 5; i++) {
          const x = q * 18 + i * 2;
          this.px(f.x - x, GROUND - 1 - (i % 2), `rgba(190,165,120,${fade})`, 2, 2);
          this.px(f.x + x, GROUND - 1 - (i % 2), `rgba(190,165,120,${fade})`, 2, 2);
        }
        this.star(f.x, f.y + 2, 3 + q * 5, '#fff3b0');
        break;
      }
      case 'medico': {
        // Picada da seringa: brilho verde.
        this.px(f.x - d * 6, f.y - 2, '#f4f7fa', 8, 1);
        for (let i = 0; i < 5; i++) this.px(f.x + Math.cos(i * 1.3) * (3 + q * 6), f.y - 2 + Math.sin(i * 1.3) * (3 + q * 6), `rgba(120,240,150,${fade})`);
        break;
      }
      case 'espiao': {
        // Dois cortes cruzados com a adaga.
        const n = Math.min(10, Math.floor(e / 14));
        for (let i = 0; i < n; i++) {
          this.px(f.x - 5 + i, f.y - 7 + i, '#f4f7fa');
          if (e > 70) this.px(f.x - 5 + i, f.y + 3 - i, '#f4f7fa');
        }
        break;
      }
      default:
        this.star(f.x, f.y, 3 + q * 4, '#fff3b0');
    }
  }

  private star(x: number, y: number, r: number, color: string): void {
    for (let i = -Math.round(r); i <= Math.round(r); i++) {
      this.px(x + i, y, color);
      this.px(x, y + i, color);
    }
    const s = Math.round(r * 0.6);
    for (let i = -s; i <= s; i++) {
      this.px(x + i, y + i, color);
      this.px(x + i, y - i, color);
    }
  }

  private drawTexts(a: { acts: Record<Pos, Act> }, t: number, poses: Record<Pos, Pose>): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of ['L', 'R'] as const) {
      const me = a.acts[p];
      const o = a.acts[p === 'L' ? 'R' : 'L'];
      const x = (FOOT[p] + this.dir(p) * poses[p].dx) * PX * SCALE;
      // Nome do lance acima da cabeça.
      if (t < 760) {
        const lt = LANCE_TEXT[me.lance];
        ctx.globalAlpha = t < 600 ? 1 : 1 - (t - 600) / 160;
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(12,10,16,0.9)';
        ctx.strokeText(lt.text, FOOT[p] * PX * SCALE, 16);
        ctx.fillStyle = lt.color;
        ctx.fillText(lt.text, FOOT[p] * PX * SCALE, 16);
      }
      // Bloqueio.
      const oct = contactTime(o);
      if (me.lance === 'guarda' && o.lance === 'golpe' && !o.hits && oct !== null && t >= oct && t < oct + 500) {
        ctx.globalAlpha = 1 - (t - oct) / 500;
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.strokeText('Bloqueou', x, (GROUND - 27) * PX * SCALE);
        ctx.fillStyle = '#8fc4ff';
        ctx.fillText('Bloqueou', x, (GROUND - 27) * PX * SCALE);
      }
      // Dano.
      if (me.took > 0 && oct !== null && t >= oct) {
        const q = (t - oct) / 700;
        if (q < 1) {
          ctx.globalAlpha = q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3;
          ctx.font = 'bold 20px system-ui, sans-serif';
          const y = (GROUND - 24 - q * 6) * PX * SCALE;
          ctx.lineWidth = 5;
          ctx.strokeText(`-${me.took}`, x, y);
          ctx.fillStyle = me.dies ? '#ffffff' : '#ff8a7a';
          ctx.fillText(`-${me.took}`, x, y);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Cenários ----------

  /** Arte do terreno onde o lutador está (metade do palco). */
  private backdrop(p: Pos): HTMLCanvasElement {
    const u = this.unit(p);
    const terrain = this.s.terrain[u.y][u.x];
    const c = document.createElement('canvas');
    c.width = HALF;
    c.height = H;
    const g = c.getContext('2d')!;
    const R = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };
    const rnd = mulberry(terrain.length * 97 + (p === 'L' ? 1 : 7));
    const flip = p === 'R';
    const X = (x: number, w = 1) => (flip ? HALF - x - w : x);
    // Céu em faixas (fim de tarde enfumaçado) com uma engrenagem ao longe.
    const sky = ['#2b2f4a', '#353956', '#474663', '#5d5470', '#7a6170'];
    sky.forEach((col, i) => R(0, i * 9, HALF, 9, col));
    gear(g, X(86, 0), 14, 6, '#30324a');
    for (let i = 0; i < 3; i++) R(X(20 + i * 30), 8 + i * 5, 10, 1, 'rgba(255,255,255,0.12)');

    const horizon = 46;
    const grassFar = '#3f5e3a';
    switch (terrain as Terrain) {
      case 'floresta': {
        R(0, horizon - 4, HALF, H, '#24402c');
        for (let i = 0; i < 12; i++) pine(g, X(i * 10 + rnd() * 4), horizon + 2, 8 + rnd() * 6, '#1e3626');
        R(0, 60, HALF, H, '#355a32');
        for (let i = 0; i < 20; i++) R(rnd() * HALF, 61 + rnd() * 22, 2, 1, '#2b4a2a');
        pine(g, X(8), 74, 26, '#2d4f33');
        pine(g, X(104), 70, 22, '#3c6b43');
        break;
      }
      case 'colina': {
        R(0, horizon, HALF, H, grassFar);
        g.fillStyle = '#6b5a45';
        g.beginPath();
        g.moveTo(X(-10, 0), H);
        g.lineTo(X(30, 0), 34);
        g.lineTo(X(58, 0), 30);
        g.lineTo(X(96, 0), 40);
        g.lineTo(X(130, 0), H);
        g.fill();
        R(X(36, 18), 33, 18, 2, '#8a7556');
        R(X(60, 20), 31, 20, 2, '#8a7556');
        R(0, 62, HALF, H, '#7a6248');
        for (let i = 0; i < 10; i++) {
          const x = rnd() * HALF;
          R(x, 63 + rnd() * 18, 3 + rnd() * 3, 2, '#9a8466');
        }
        break;
      }
      case 'ruina': {
        R(0, horizon, HALF, H, grassFar);
        for (const [x, h] of [
          [14, 26],
          [34, 18],
          [86, 30],
        ]) {
          R(X(x, 7), horizon + 14 - h, 7, h, '#7c7a82');
          R(X(x, 2), horizon + 14 - h, 2, h, '#5a5860');
          R(X(x - 1, 9), horizon + 13 - h, 9, 2, '#8e8c94');
        }
        R(X(56, 22), 36, 22, 4, '#6e6c74');
        R(0, 60, HALF, H, '#5f6a4f');
        for (let i = 0; i < 9; i++) R(rnd() * HALF, 62 + rnd() * 18, 4, 2, '#7c7a82');
        break;
      }
      case 'lama': {
        R(0, horizon, HALF, H, '#4c5a34');
        R(0, 60, HALF, H, '#5a4632');
        for (let i = 0; i < 6; i++) {
          const x = rnd() * HALF;
          const y = 63 + rnd() * 16;
          R(x, y, 10 + rnd() * 8, 3, '#3e3022');
          R(x + 2, y, 4, 1, '#6e5a44');
        }
        for (let i = 0; i < 8; i++) R(X(4 + i * 14), 54 + (i % 3), 1, 8, '#6b7a3a');
        break;
      }
      case 'ponte': {
        R(0, horizon, HALF, H, '#28476a');
        for (let i = 0; i < 14; i++) R(rnd() * HALF, horizon + 2 + rnd() * 34, 6, 1, '#3f6a94');
        R(0, 62, HALF, 10, '#7a5a3c');
        for (let x = 0; x < HALF; x += 7) R(x, 62, 1, 10, '#4e3826');
        R(0, 61, HALF, 1, '#9a7a56');
        for (let x = 6; x < HALF; x += 26) R(x, 52, 3, 10, '#5a4030');
        R(0, 54, HALF, 1, '#b8a07a');
        R(0, 72, HALF, H, '#203a58');
        break;
      }
      case 'fonte': {
        R(0, horizon, HALF, H, '#2f4d3a');
        for (const [x, col] of [
          [26, '#6fd58a'],
          [58, '#b88cf0'],
          [90, '#f0a050'],
        ] as const) crystal(g, X(x, 0), 36, col);
        R(0, 60, HALF, H, '#6b7080');
        for (let x = 0; x < HALF; x += 12) R(x, 60, 1, H, '#555a68');
        R(0, 70, HALF, 1, '#555a68');
        R(0, 60, HALF, 1, '#8a90a0');
        break;
      }
      default: {
        // Planície (e casas de cristal).
        g.fillStyle = grassFar;
        g.beginPath();
        g.moveTo(0, horizon + 2);
        for (let x = 0; x <= HALF; x += 4) g.lineTo(x, horizon - 3 * Math.sin(x / 14 + (flip ? 2 : 0)));
        g.lineTo(HALF, H);
        g.lineTo(0, H);
        g.fill();
        R(0, 54, HALF, H, '#4e7a3f');
        R(0, 62, HALF, H, '#5d8a46');
        for (let i = 0; i < 26; i++) {
          const x = rnd() * HALF;
          const y = 63 + rnd() * 19;
          R(x, y, 1, 2, '#79a75a');
          R(x + 1, y + 1, 1, 1, '#79a75a');
        }
        break;
      }
    }
    return c;
  }
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pine(g: CanvasRenderingContext2D, x: number, base: number, h: number, col: string): void {
  g.fillStyle = col;
  for (let i = 0; i < h; i++) {
    const w = Math.max(1, Math.round(((i / h) * h) / 2.4));
    g.fillRect(Math.round(x - w), Math.round(base - h + i), w * 2 + 1, 1);
  }
  g.fillStyle = '#4a3122';
  g.fillRect(Math.round(x), Math.round(base), 1, 2);
}

function gear(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string): void {
  g.fillStyle = col;
  for (let yy = -r - 2; yy <= r + 2; yy++) {
    for (let xx = -r - 2; xx <= r + 2; xx++) {
      const d = Math.hypot(xx, yy);
      const ang = Math.atan2(yy, xx);
      const tooth = Math.cos(ang * 8) > 0.5 ? 2 : 0;
      if (d <= r + tooth && d > r * 0.4) g.fillRect(x + xx, y + yy, 1, 1);
    }
  }
}

function crystal(g: CanvasRenderingContext2D, x: number, y: number, col: string): void {
  g.fillStyle = col;
  for (let i = 0; i < 7; i++) g.fillRect(x - Math.min(i, 6 - i), y + i, Math.min(i, 6 - i) * 2 + 1, 1);
  for (let i = 0; i < 5; i++) g.fillRect(x - Math.min(i, 4 - i), y + 7 + i, Math.min(i, 4 - i) * 2 + 1, 1);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(x - 1, y + 2, 1, 4);
}
